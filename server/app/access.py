"""Finds the project a diagram or an ADR belongs to, and the signed-in user's
role in it. Without a role the diagram or ADR does not exist for them: the
same 404 as for a made-up id.

Also: the user's role at an ADR's scope, which decides what they may do
with it (see require_at_scope)."""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import box_rights
from app.errors import NotFound
from app.models import Adr, Diagram, OrgMembership, ProjectRole, User
from app.services import diagrams, projects
from app.services.adrs import AdrNotFound, Author
from app.services.diagrams import DiagramNotFound
from app.services.organizations import NotAllowed


async def for_diagram(session: AsyncSession, diagram_id: uuid.UUID, user: User) -> projects.Access:
    project_of = select(Diagram.project_id).where(Diagram.id == diagram_id)
    missing = DiagramNotFound(f"Diagram {diagram_id} does not exist.")
    return await _project(session, project_of, user, missing)


async def for_adr(session: AsyncSession, adr_id: uuid.UUID, user: User) -> projects.Access:
    project_of = select(Adr.project_id).where(Adr.id == adr_id)
    return await _project(session, project_of, user, AdrNotFound(f"ADR {adr_id} does not exist."))


async def _project(
    session: AsyncSession, project_of: Any, user: User, missing: NotFound
) -> projects.Access:
    """The user's access to the project `project_of` selects; `missing` if
    nothing is found, or they have no role in it."""
    project_id = await session.scalar(project_of)
    if project_id is None:
        raise missing
    try:
        return await projects.access(session, project_id, user)
    except projects.ProjectNotFound:
        raise missing from None


async def author(session: AsyncSession, found: projects.Access, user: User) -> Author:
    """The user as ADR history shows them: name and job title in the org."""
    membership = await session.get(OrgMembership, (found.org.id, user.id))
    return Author(user.id, user.display_name, membership.title if membership else None)


async def role_at_scope(
    session: AsyncSession,
    found: projects.Access,
    user: User,
    diagram_id: uuid.UUID | None,
    box_id: str | None,
) -> tuple[ProjectRole, str | None]:
    """The user's role at a scope (the whole project, or a box), and the box's
    name. A box deleted since, or in a deleted diagram, is outside every
    grant on boxes: there only the project-wide role counts."""
    if diagram_id is None or box_id is None:
        return found.role, None
    flat = await diagrams.outline(session, diagram_id, found.project.id)
    if flat is None or box_id not in flat.parent:
        return found.role, None
    rights = await projects.rights_in(session, found, user.id, diagram_id)
    return rights.role_at(flat, box_id), flat.title[box_id]


async def require_at_scope(
    session: AsyncSession,
    found: projects.Access,
    user: User,
    diagram_id: uuid.UUID | None,
    box_id: str | None,
    role: ProjectRole,
    doing: str,
) -> None:
    """403 unless the user has `role` at the scope. `doing` completes
    "Only ... can ...", e.g. "decide on its ADRs"."""
    if box_id is None:
        found.require(role, doing)
        return
    have, name = await role_at_scope(session, found, user, diagram_id, box_id)
    if box_rights.at_least(have, role):
        return
    where = f'"{name}"' if name else "this deleted box"
    raise NotAllowed(
        f"Only {projects.HOLDERS[role]} of {where} (or of a box above it, or of the project) "
        f"can {doing}.",
        {"role": have, "box_id": box_id},
    )


async def require_at_adr(
    session: AsyncSession,
    found: projects.Access,
    user: User,
    adr: Adr,
    role: ProjectRole,
    doing: str,
) -> None:
    await require_at_scope(session, found, user, adr.diagram_id, adr.box_id, role, doing)
