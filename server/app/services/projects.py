"""Projects, and who may do what in them. Free of HTTP concerns.

Access comes only from grants: (a user or a group) + a role (viewer < editor
< owner). Someone's role in a project is the highest grant that applies to
them, directly or through any group they count as being in (a group's
members include everyone in its subgroups). Only members of the project's
organization can have a role.

Without a role a project is invisible: ProjectNotFound, as if it did not
exist. The one exception is the organization's admins, who see every
project's name in the list and may take a project over (become an owner),
which the project's activity log records for everyone in it.

A grant covers the whole project, or one box of a diagram and everything
inside it (see app.box_rights for what that allows). Grants only on boxes
still make the project visible, as a viewer everywhere else. Box grants are
given by owners of the box, of a box above it, or of the project, so whoever
is in charge of a service can hand out the parts inside it.

A project always keeps at least one project-wide owner grant. Changes to
grants lock the project's row, so two owners removing each other at once
cannot leave none.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, or_, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import box_rights, live
from app.box_rights import RANK
from app.diagram_tree import Flat
from app.errors import Conflict, NotFound
from app.models import (
    Group,
    Organization,
    OrgMembership,
    OrgRole,
    Project,
    ProjectActivity,
    ProjectGrant,
    ProjectRole,
    User,
)
from app.models.project import PROJECT_SCOPE
from app.services import diagrams, groups, organizations, versions
from app.services.organizations import MemberNotFound, NotAllowed

# Who holds a role or a higher one, for messages: "Only the project's owners can ...".
HOLDERS = {ProjectRole.EDITOR: "editors and owners", ProjectRole.OWNER: "owners"}


class ProjectNotFound(NotFound):
    code = "project_not_found"


class GrantNotFound(NotFound):
    code = "grant_not_found"


class LastProjectOwner(Conflict):
    code = "last_owner"


def highest(roles: Sequence[str]) -> ProjectRole | None:
    return max((ProjectRole(r) for r in roles), key=RANK.__getitem__, default=None)


async def _applying(session: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> Any:
    """A condition: the grant is to the user, or to a group they count as in."""
    group_ids = await groups.effective_group_ids(session, org_id, user_id)
    return or_(ProjectGrant.user_id == user_id, ProjectGrant.group_id.in_(group_ids))


def project_wide_role(grants: Sequence[tuple[str, str | None]]) -> ProjectRole | None:
    """From (role, box_id) pairs: the highest project-wide grant. Grants only
    on boxes still let the user see the project, as a viewer: they could not
    work on their boxes otherwise."""
    wide = highest([role for role, box in grants if box is None])
    if wide is None and grants:
        return ProjectRole.VIEWER
    return wide


async def role_in(
    session: AsyncSession, project: Project, user_id: uuid.UUID
) -> ProjectRole | None:
    """The user's project-wide role, or None if they have no grant at all."""
    if await session.get(OrgMembership, (project.org_id, user_id)) is None:
        return None
    rows = await session.execute(
        select(ProjectGrant.role, ProjectGrant.box_id).where(
            ProjectGrant.project_id == project.id,
            await _applying(session, project.org_id, user_id),
        )
    )
    return project_wide_role([(role, box) for role, box in rows])


async def box_roles(
    session: AsyncSession, project: Project, user_id: uuid.UUID, diagram_id: uuid.UUID
) -> dict[str, ProjectRole]:
    """The user's grants on boxes of the diagram: the highest per box."""
    rows = await session.execute(
        select(ProjectGrant.box_id, ProjectGrant.role).where(
            ProjectGrant.diagram_id == diagram_id,
            await _applying(session, project.org_id, user_id),
        )
    )
    by_box: dict[str, list[str]] = {}
    for box_id, role in rows:
        by_box.setdefault(box_id, []).append(role)
    return {box_id: highest(roles) for box_id, roles in by_box.items()}  # type: ignore[misc]


async def rights_in(
    session: AsyncSession, found: "Access", user_id: uuid.UUID, diagram_id: uuid.UUID
) -> box_rights.Rights:
    """The user's roles in one diagram of the project: project-wide, and from
    grants on its boxes."""
    return box_rights.Rights(
        found.role, await box_roles(session, found.project, user_id, diagram_id)
    )


async def granted_boxes(session: AsyncSession, diagram_id: uuid.UUID) -> set[str]:
    """Every box of the diagram that has a grant, whoever it is for."""
    return set(
        await session.scalars(
            select(ProjectGrant.box_id).where(ProjectGrant.diagram_id == diagram_id).distinct()
        )
    )


@dataclass
class Access:
    """A project as seen by one user."""

    project: Project
    org: Organization
    role: ProjectRole

    def at_least(self, role: ProjectRole) -> bool:
        return box_rights.at_least(self.role, role)

    def require(self, role: ProjectRole, doing: str) -> None:
        """`doing` completes "Only the project's ... can ...", e.g. "edit it"."""
        if not self.at_least(role):
            raise NotAllowed(
                f"Only the project's {HOLDERS[role]} can {doing}.", {"role": self.role}
            )


def _not_found(project_id: uuid.UUID) -> ProjectNotFound:
    return ProjectNotFound(f"Project {project_id} does not exist.")


async def access(
    session: AsyncSession, project_id: uuid.UUID, user: User, *, lock: bool = False
) -> Access:
    """The project and the user's role in it; ProjectNotFound without one.
    `lock` holds the project's row until commit."""
    query = (
        select(Project, Organization)
        .join(Organization, Organization.id == Project.org_id)
        .where(Project.id == project_id)
    )
    if lock:
        query = query.with_for_update(of=Project)
    row = (await session.execute(query)).one_or_none()
    if row is None:
        raise _not_found(project_id)
    project, org = row[0], row[1]
    role = await role_in(session, project, user.id)
    if role is None:
        raise _not_found(project_id)
    return Access(project, org, role)


async def _log(
    session: AsyncSession, project_id: uuid.UUID, actor: User, kind: str, **details: Any
) -> None:
    session.add(
        ProjectActivity(project_id=project_id, actor_id=actor.id, kind=kind, details=details)
    )


# ---- Projects ----


async def create(session: AsyncSession, org_id: uuid.UUID, user: User, name: str) -> Access:
    """Needs "can create projects" in the organization (owners and admins
    always have it). The creator becomes the project's owner."""
    org, membership = await organizations.get(session, org_id, user)
    if not organizations.can_create_projects(membership):
        raise NotAllowed(
            "You may not create projects in this organization. Ask an admin to allow it.",
            {"role": membership.role},
        )
    project = Project(org_id=org_id, name=name)
    session.add(project)
    await session.flush()
    session.add(ProjectGrant(project_id=project.id, user_id=user.id, role=ProjectRole.OWNER))
    await _log(session, project.id, user, "created")
    await session.commit()
    await session.refresh(project)
    return Access(project, org, ProjectRole.OWNER)


async def list_for_org(
    session: AsyncSession, org_id: uuid.UUID, user: User
) -> list[tuple[Project, ProjectRole | None]]:
    """The projects the user has a role in, by name. Org admins get every
    project, with role None for those they have no grant in."""
    _, membership = await organizations.get(session, org_id, user)
    rows = await session.execute(
        select(ProjectGrant.project_id, ProjectGrant.role, ProjectGrant.box_id)
        .join(Project, Project.id == ProjectGrant.project_id)
        .where(Project.org_id == org_id, await _applying(session, org_id, user.id))
    )
    by_project: dict[uuid.UUID, list[tuple[str, str | None]]] = {}
    for project_id, role, box_id in rows:
        by_project.setdefault(project_id, []).append((role, box_id))
    query = select(Project).where(Project.org_id == org_id)
    if not organizations.at_least(membership, OrgRole.ADMIN):
        query = query.where(Project.id.in_(by_project))
    found = await session.scalars(query.order_by(func.lower(Project.name), Project.id))
    return [(p, project_wide_role(by_project.get(p.id, []))) for p in found]


async def update_project(
    session: AsyncSession,
    project_id: uuid.UUID,
    user: User,
    version: int,
    name: str,
) -> Access:
    found = await access(session, project_id, user)
    found.require(ProjectRole.OWNER, "rename the project")
    updated = await versions.bump(
        session, Project, project_id, version, "The project", _not_found(project_id), name=name
    )
    await session.commit()
    await session.refresh(updated)
    return Access(updated, found.org, found.role)


async def delete_project(session: AsyncSession, project_id: uuid.UUID, user: User) -> None:
    """Owners only. Its diagrams and their ADRs go with it."""
    found = await access(session, project_id, user)
    found.require(ProjectRole.OWNER, "delete the project")
    await session.delete(found.project)
    await session.commit()
    live.hub.access_changed(project_id=project_id)


async def take_over(session: AsyncSession, project_id: uuid.UUID, user: User) -> Access:
    """An org admin makes themselves an owner of the project, e.g. when its
    owners have left. Recorded in the project's activity."""
    project = await session.get(Project, project_id, with_for_update=True)
    if project is None:
        raise _not_found(project_id)
    org, membership = await organizations.get(session, project.org_id, user)
    organizations.require(membership, OrgRole.ADMIN, "take over projects")
    await session.execute(
        insert(ProjectGrant)
        .values(project_id=project_id, user_id=user.id, role=ProjectRole.OWNER)
        .on_conflict_do_update(
            index_elements=[ProjectGrant.project_id, ProjectGrant.user_id],
            index_where=text(f"user_id IS NOT NULL AND {PROJECT_SCOPE}"),
            set_={"role": ProjectRole.OWNER},
        )
    )
    await _log(session, project_id, user, "taken_over")
    await session.commit()
    live.hub.access_changed(project_id=project_id, user_id=user.id)
    return Access(project, org, ProjectRole.OWNER)


# ---- Grants ----


@dataclass
class GrantView:
    grant: ProjectGrant
    user: User | None
    group: Group | None
    # For a grant on a box: the box's current name, or its name when granted
    # if it has been deleted from the diagram since (then `orphaned`).
    box_title: str | None = None
    orphaned: bool = False


async def list_grants(session: AsyncSession, project_id: uuid.UUID, user: User) -> list[GrantView]:
    """Who has which role: project-wide grants first, then grants on boxes;
    people before groups, each by name. Anyone in the project may look."""
    await access(session, project_id, user)
    rows = await session.execute(
        select(ProjectGrant, User, Group)
        .outerjoin(User, User.id == ProjectGrant.user_id)
        .outerjoin(Group, Group.id == ProjectGrant.group_id)
        .where(ProjectGrant.project_id == project_id)
    )
    views = [GrantView(grant, person, group) for grant, person, group in rows]
    diagram_ids = {v.grant.diagram_id for v in views if v.grant.diagram_id}
    titles = {
        diagram_id: flat.title
        for diagram_id, flat in (await diagrams.outlines(session, diagram_ids)).items()
    }
    for view in views:
        grant = view.grant
        if grant.box_id is None or grant.diagram_id is None:
            continue
        current = titles.get(grant.diagram_id, {}).get(grant.box_id)
        view.box_title = current if current is not None else grant.box_title
        view.orphaned = current is None
    return sorted(
        views,
        key=lambda v: (
            v.grant.box_id is not None,
            (v.box_title or "").lower(),
            v.group is not None,
            (v.user.display_name if v.user else v.group.name if v.group else "").lower(),
        ),
    )


async def _box_scope(
    session: AsyncSession, found: Access, user: User, diagram_id: uuid.UUID
) -> tuple[Flat, box_rights.Rights]:
    """The outline of the diagram, and the user's rights in it."""
    flat = await diagrams.project_outline(session, found.project.id, diagram_id)
    return flat, await rights_in(session, found, user.id, diagram_id)


def _require_box_owner(rights: box_rights.Rights, flat: Flat, box_id: str) -> None:
    if not rights.can(flat, box_id, ProjectRole.OWNER):
        raise NotAllowed(
            "Only owners of this box, of a box above it, or of the project can change who "
            "works on it.",
            {"role": rights.role_at(flat, box_id)},
        )


async def set_grant(
    session: AsyncSession,
    project_id: uuid.UUID,
    user: User,
    *,
    user_id: uuid.UUID | None = None,
    group_id: uuid.UUID | None = None,
    role: ProjectRole,
    diagram_id: uuid.UUID | None = None,
    box_id: str | None = None,
) -> GrantView:
    """Gives an organization member or group a role, or changes it: on the
    whole project (project owners only; the last owner cannot be demoted),
    or on one box of a diagram and everything inside it (owners of that box,
    of a box above it, or of the project)."""
    found = await access(session, project_id, user, lock=True)
    box_title: str | None = None
    if box_id is None or diagram_id is None:
        found.require(ProjectRole.OWNER, "change who has access to the whole project")
    else:
        flat, rights = await _box_scope(session, found, user, diagram_id)
        box_title = diagrams.box_title(flat, box_id)
        _require_box_owner(rights, flat, box_id)

    subject: User | Group | None
    if user_id is not None:
        if await session.get(OrgMembership, (found.org.id, user_id)) is None:
            raise MemberNotFound(f"User {user_id} is not a member of this organization.")
        subject = await session.get(User, user_id)
        same_subject = ProjectGrant.user_id == user_id
    else:
        subject = await session.get(Group, group_id)
        if subject is None or subject.org_id != found.org.id:
            raise groups.GroupNotFound(f"Group {group_id} does not exist in this organization.")
        same_subject = ProjectGrant.group_id == group_id
    same_scope = (
        ProjectGrant.box_id.is_(None)
        if box_id is None
        else (ProjectGrant.diagram_id == diagram_id) & (ProjectGrant.box_id == box_id)
    )
    existing = await session.scalar(
        select(ProjectGrant).where(ProjectGrant.project_id == project_id, same_subject, same_scope)
    )
    if existing is None:
        existing = ProjectGrant(
            project_id=project_id,
            user_id=user_id,
            group_id=group_id,
            role=role,
            diagram_id=diagram_id if box_id else None,
            box_id=box_id,
            box_title=box_title,
        )
        session.add(existing)
    else:
        if existing.role == ProjectRole.OWNER and role != ProjectRole.OWNER and box_id is None:
            await _keep_an_owner(session, project_id)
        existing.role = role
        if box_title is not None:
            existing.box_title = box_title
    await _log(
        session,
        project_id,
        user,
        "grant_set",
        role=role,
        **_subject_details(subject),
        **_scope_details(diagram_id, box_id, box_title),
    )
    await session.commit()
    live.hub.access_changed(project_id=project_id)
    await session.refresh(existing)
    return GrantView(
        existing,
        subject if isinstance(subject, User) else None,
        subject if isinstance(subject, Group) else None,
        box_title,
    )


async def remove_grant(
    session: AsyncSession, project_id: uuid.UUID, user: User, grant_id: uuid.UUID
) -> None:
    """Takes a grant away: who may give it may take it away. A grant on a box
    deleted since needs a project owner. The last project-wide owner grant
    cannot go."""
    found = await access(session, project_id, user, lock=True)
    grant = await session.scalar(
        select(ProjectGrant).where(
            ProjectGrant.id == grant_id, ProjectGrant.project_id == project_id
        )
    )
    if grant is None:
        raise GrantNotFound(f"Grant {grant_id} does not exist in this project.")
    if grant.box_id is None or grant.diagram_id is None:
        found.require(ProjectRole.OWNER, "change who has access to the whole project")
        if grant.role == ProjectRole.OWNER:
            await _keep_an_owner(session, project_id)
    else:
        flat, rights = await _box_scope(session, found, user, grant.diagram_id)
        if grant.box_id in flat.parent:
            _require_box_owner(rights, flat, grant.box_id)
        else:
            found.require(ProjectRole.OWNER, "clean up access to deleted boxes")
    subject = (
        await session.get(User, grant.user_id)
        if grant.user_id
        else await session.get(Group, grant.group_id)
    )
    await session.delete(grant)
    await _log(
        session,
        project_id,
        user,
        "grant_removed",
        role=grant.role,
        **_subject_details(subject),
        **_scope_details(grant.diagram_id, grant.box_id, grant.box_title),
    )
    await session.commit()
    live.hub.access_changed(project_id=project_id)


async def _keep_an_owner(session: AsyncSession, project_id: uuid.UUID) -> None:
    """Refuses to take away the last project-wide owner grant. Call with the
    project locked."""
    owners = await session.scalar(
        select(func.count())
        .select_from(ProjectGrant)
        .where(
            ProjectGrant.project_id == project_id,
            ProjectGrant.role == ProjectRole.OWNER,
            ProjectGrant.box_id.is_(None),
        )
    )
    if (owners or 0) <= 1:
        raise LastProjectOwner(
            "A project needs at least one owner. Make someone else an owner first."
        )


def _scope_details(
    diagram_id: uuid.UUID | None, box_id: str | None, box_title: str | None
) -> dict[str, Any]:
    if box_id is None:
        return {}
    return {"diagram_id": str(diagram_id), "box_id": box_id, "box": box_title}


def _subject_details(subject: User | Group | None) -> dict[str, Any]:
    if isinstance(subject, User):
        return {"user_id": str(subject.id), "name": subject.display_name}
    if isinstance(subject, Group):
        return {"group_id": str(subject.id), "name": subject.name}
    return {}


# ---- Activity ----


async def activity(
    session: AsyncSession, project_id: uuid.UUID, user: User
) -> list[tuple[ProjectActivity, User | None]]:
    """Newest first."""
    await access(session, project_id, user)
    rows = await session.execute(
        select(ProjectActivity, User)
        .outerjoin(User, User.id == ProjectActivity.actor_id)
        .where(ProjectActivity.project_id == project_id)
        .order_by(ProjectActivity.created_at.desc(), ProjectActivity.id)
    )
    return [(entry, actor) for entry, actor in rows]
