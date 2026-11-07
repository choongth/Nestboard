"""Organizations and their members. Free of HTTP concerns.

Someone outside an organization cannot tell it exists: every lookup answers
OrgNotFound for non-members. Inside it, roles rank member < admin < owner:

- members see the organization and who is in it;
- admins also invite and remove members, and set titles and who may create
  projects;
- owners also rename or delete it and change anyone's role.

An organization always keeps at least one owner. Every change to who is in it
locks the organization's row first, so two owners demoting each other at the
same moment cannot leave it with none.
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import live
from app.errors import Conflict, Forbidden, NotFound
from app.models import (
    Group,
    GroupMember,
    Organization,
    OrgMembership,
    OrgRole,
    Project,
    ProjectGrant,
    User,
)
from app.services import versions

RANK = {OrgRole.MEMBER: 0, OrgRole.ADMIN: 1, OrgRole.OWNER: 2}


class OrgNotFound(NotFound):
    code = "organization_not_found"


class MemberNotFound(NotFound):
    code = "member_not_found"


class NotAllowed(Forbidden):
    code = "not_allowed"


class LastOwner(Conflict):
    code = "last_owner"


def at_least(membership: OrgMembership, role: OrgRole) -> bool:
    return RANK[OrgRole(membership.role)] >= RANK[role]


def require(membership: OrgMembership, role: OrgRole, doing: str) -> None:
    """Raises NotAllowed unless the member's role is `role` or higher.
    `doing` completes "Only ... can ...", e.g. "invite people"."""
    if not at_least(membership, role):
        who = "owners" if role == OrgRole.OWNER else "owners and admins"
        raise NotAllowed(f"Only the organization's {who} can {doing}.", {"role": membership.role})


def can_create_projects(membership: OrgMembership) -> bool:
    return membership.can_create_projects or at_least(membership, OrgRole.ADMIN)


# ---- Organizations ----


async def create(
    session: AsyncSession, user: User, name: str
) -> tuple[Organization, OrgMembership]:
    """Only the instance admin creates organizations, and becomes the first
    owner. To hand one over: invite its real owner, then leave."""
    if not user.is_instance_admin:
        raise NotAllowed("Only the instance admin can create organizations.")
    org = Organization(name=name)
    session.add(org)
    await session.flush()
    membership = OrgMembership(org_id=org.id, user_id=user.id, role=OrgRole.OWNER)
    session.add(membership)
    await session.commit()
    await session.refresh(org)
    await session.refresh(membership)
    return org, membership


async def list_mine(session: AsyncSession, user: User) -> list[tuple[Organization, OrgMembership]]:
    rows = await session.execute(
        select(Organization, OrgMembership)
        .join(OrgMembership, OrgMembership.org_id == Organization.id)
        .where(OrgMembership.user_id == user.id)
        .order_by(func.lower(Organization.name), Organization.id)
    )
    return [(org, membership) for org, membership in rows]


async def get(
    session: AsyncSession, org_id: uuid.UUID, user: User, *, lock: bool = False
) -> tuple[Organization, OrgMembership]:
    """The organization and the user's membership of it. `lock` holds the
    organization's row until commit (for changes to who is in it)."""
    query = (
        select(Organization, OrgMembership)
        .join(OrgMembership, OrgMembership.org_id == Organization.id)
        .where(Organization.id == org_id, OrgMembership.user_id == user.id)
    )
    if lock:
        query = query.with_for_update(of=Organization)
    row = (await session.execute(query)).one_or_none()
    if row is None:
        raise OrgNotFound(f"Organization {org_id} does not exist.")
    return row[0], row[1]


async def update_org(
    session: AsyncSession,
    org_id: uuid.UUID,
    user: User,
    version: int,
    name: str,
) -> tuple[Organization, OrgMembership]:
    _, membership = await get(session, org_id, user)
    require(membership, OrgRole.OWNER, "rename the organization")
    missing = OrgNotFound(f"Organization {org_id} does not exist.")
    updated = await versions.bump(
        session, Organization, org_id, version, "The organization", missing, name=name
    )
    await session.commit()
    await session.refresh(updated)
    return updated, membership


async def delete_org(session: AsyncSession, org_id: uuid.UUID, user: User) -> None:
    org, membership = await get(session, org_id, user)
    require(membership, OrgRole.OWNER, "delete the organization")
    await session.delete(org)
    await session.commit()
    live.hub.access_changed(org_id=org_id)


# ---- Members ----


async def list_members(
    session: AsyncSession, org_id: uuid.UUID, user: User
) -> Sequence[tuple[OrgMembership, User]]:
    """Everyone in the organization, by name. Any member may look."""
    await get(session, org_id, user)
    rows = await session.execute(
        select(OrgMembership, User)
        .join(User, User.id == OrgMembership.user_id)
        .where(OrgMembership.org_id == org_id)
        .order_by(func.lower(User.display_name), User.id)
    )
    return [tuple(row) for row in rows]


async def _member(
    session: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID
) -> tuple[OrgMembership, User]:
    row = (
        await session.execute(
            select(OrgMembership, User)
            .join(User, User.id == OrgMembership.user_id)
            .where(OrgMembership.org_id == org_id, OrgMembership.user_id == user_id)
        )
    ).one_or_none()
    if row is None:
        raise MemberNotFound(f"User {user_id} is not a member of this organization.")
    return row[0], row[1]


async def _owners(session: AsyncSession, org_id: uuid.UUID) -> int:
    return (
        await session.scalar(
            select(func.count())
            .select_from(OrgMembership)
            .where(OrgMembership.org_id == org_id, OrgMembership.role == OrgRole.OWNER)
        )
    ) or 0


async def _keep_an_owner(session: AsyncSession, org_id: uuid.UUID, target: OrgMembership) -> None:
    """Refuses to take away the last owner. Call with the organization locked."""
    if target.role == OrgRole.OWNER and await _owners(session, org_id) <= 1:
        raise LastOwner(
            "An organization needs at least one owner. Make someone else an owner first."
        )


async def update_member(
    session: AsyncSession,
    org_id: uuid.UUID,
    user: User,
    target_id: uuid.UUID,
    *,
    role: OrgRole | None = None,
    title: str | None = None,
    can_create: bool | None = None,
) -> tuple[OrgMembership, User]:
    """Roles are changed by owners; titles and who may create projects by
    admins. An owner may step down if another owner remains."""
    _, mine = await get(session, org_id, user, lock=True)
    if role is not None:
        require(mine, OrgRole.OWNER, "change roles")
    if title is not None or can_create is not None:
        require(mine, OrgRole.ADMIN, "change titles and who may create projects")
    target, target_user = await _member(session, org_id, target_id)
    if role is not None and role != target.role:
        await _keep_an_owner(session, org_id, target)
        target.role = role
    if title is not None:
        target.title = title
    if can_create is not None:
        target.can_create_projects = can_create
    await session.commit()
    if role is not None:
        live.hub.access_changed(org_id=org_id, user_id=target_id)
    return target, target_user


async def remove_member(
    session: AsyncSession, org_id: uuid.UUID, user: User, target_id: uuid.UUID
) -> None:
    """Anyone may leave. Admins remove members; only owners remove admins and
    other owners. The last owner can neither leave nor be removed."""
    _, mine = await get(session, org_id, user, lock=True)
    target, _ = (mine, user) if target_id == user.id else await _member(session, org_id, target_id)
    if target_id != user.id:
        require(mine, OrgRole.ADMIN, "remove people")
        if at_least(target, OrgRole.ADMIN):
            require(mine, OrgRole.OWNER, "remove admins and owners")
    await _keep_an_owner(session, org_id, target)
    # Their places in the organization's groups, and their own grants in its
    # projects, go with them. A project whose only owner leaves can be taken
    # over by an admin.
    await session.execute(
        delete(GroupMember).where(
            GroupMember.user_id == target_id,
            GroupMember.group_id.in_(select(Group.id).where(Group.org_id == org_id)),
        )
    )
    await session.execute(
        delete(ProjectGrant).where(
            ProjectGrant.user_id == target_id,
            ProjectGrant.project_id.in_(select(Project.id).where(Project.org_id == org_id)),
        )
    )
    await session.delete(target)
    await session.commit()
    live.hub.access_changed(org_id=org_id, user_id=target_id)
