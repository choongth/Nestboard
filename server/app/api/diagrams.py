import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, box_rights, live
from app.api.downloads import attachment
from app.auth import CurrentUser
from app.db import SessionDep
from app.errors import ROLE_RESPONSES
from app.models import ProjectRole, User
from app.schemas.diagrams import (
    Changes,
    DiagramAccess,
    DiagramChanges,
    DiagramCreate,
    DiagramOut,
    DiagramPage,
    DiagramSaved,
    DiagramSummary,
    DiagramUpdate,
)
from app.services import diagrams, projects

router = APIRouter(tags=["diagrams"], responses=ROLE_RESPONSES)


@router.post(
    "/projects/{project_id}/diagrams",
    response_model=DiagramOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_diagram(
    project_id: uuid.UUID, body: DiagramCreate, user: CurrentUser, session: SessionDep
):
    """Editors and owners of the whole project (a grant only on boxes is not
    enough: a new diagram is outside every box)."""
    found = await projects.access(session, project_id, user)
    found.require(ProjectRole.EDITOR, "create diagrams")
    diagram = await diagrams.create(session, project_id, body.name, body.document)
    return await diagrams.read(session, diagram.id)


@router.get("/projects/{project_id}/diagrams", response_model=DiagramPage)
async def list_diagrams(
    project_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    await projects.access(session, project_id, user)
    items, total = await diagrams.list_page(session, project_id, limit, offset)
    return DiagramPage(
        items=[DiagramSummary.model_validate(d) for d in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/diagrams/{diagram_id}", response_model=DiagramOut)
async def get_diagram(diagram_id: uuid.UUID, user: CurrentUser, session: SessionDep):
    """The diagram with all its boxes and connections."""
    await access.for_diagram(session, diagram_id, user)
    return await diagrams.read(session, diagram_id)


@router.patch("/diagrams/{diagram_id}", response_model=DiagramSummary)
async def update_diagram(
    diagram_id: uuid.UUID, body: DiagramUpdate, user: CurrentUser, session: SessionDep
):
    """Renames the diagram (project editors). With `version`, only if nobody
    changed the diagram since (409 `version_conflict`)."""
    found = await access.for_diagram(session, diagram_id, user)
    found.require(ProjectRole.EDITOR, "rename diagrams")
    sender = live.Sender(user.id, user.display_name)
    return await diagrams.rename(session, diagram_id, body.version, body.name, sender)


@router.post("/diagrams/{diagram_id}/changes", response_model=DiagramSaved)
async def save_diagram_changes(
    diagram_id: uuid.UUID, body: DiagramChanges, user: CurrentUser, session: SessionDep
):
    """Saves changes to the diagram's boxes and connections: those added
    (whole), changed (only what changes) and deleted, on top of the diagram
    as it is now; everyone with the diagram open sees them at once (see
    /diagrams/{diagram_id}/live). Project editors, or anyone with a grant on
    the boxes the changes touch: each change must be inside what the user may
    edit (403 `outside_your_part`, naming the box in `details.box_id`). A
    change that breaks the editor's rules, e.g. a box moved into another box,
    fails with 422 `invalid_change`; nothing is saved.

    With `version`, only if nobody saved since (409 `version_conflict`).
    """
    saved = await save(session, diagram_id, body, user, body.version)
    return DiagramSaved(
        **DiagramSummary.model_validate(saved.diagram).model_dump(),
        skipped_boxes=saved.skipped_boxes,
        skipped_edges=saved.skipped_edges,
    )


async def save(
    session: AsyncSession,
    diagram_id: uuid.UUID,
    changes: Changes,
    user: User,
    version: int | None = None,
    sender: live.Sender | None = None,
) -> diagrams.Saved:
    """Saves changes as `user`, inside what they may edit (also for app.api.live)."""
    found = await access.for_diagram(session, diagram_id, user)
    rights: box_rights.Rights | None = None
    granted: set[str] = set()
    if not found.at_least(ProjectRole.OWNER):
        rights = await projects.rights_in(session, found, user.id, diagram_id)
        granted = await projects.granted_boxes(session, diagram_id)
    return await diagrams.save_changes(
        session,
        diagram_id,
        changes,
        rights,
        granted,
        version=version,
        sender=sender or live.Sender(user.id, user.display_name),
    )


@router.get("/diagrams/{diagram_id}/access", response_model=DiagramAccess)
async def get_diagram_access(diagram_id: uuid.UUID, user: CurrentUser, session: SessionDep):
    """Your roles in the diagram, for showing what you may change: your
    project-wide role, and your grants on its boxes. Your role at a box is
    the highest of these on the box and the boxes above it."""
    found = await access.for_diagram(session, diagram_id, user)
    return DiagramAccess(
        project_role=found.role,
        box_roles=await projects.box_roles(session, found.project, user.id, diagram_id),
    )


@router.get(
    "/diagrams/{diagram_id}/export.pdf",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}}},
)
async def export_pdf(
    diagram_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
    box: Annotated[
        str | None,
        Query(description="Only the inside of this box (its id) and what is nested in it."),
    ] = None,
    paper: Annotated[Literal["a4", "letter"], Query()] = "a4",
) -> Response:
    """The diagram as a PDF report, for anyone in the project: a cover, a
    table of contents, then one page per canvas (the root, then each box
    with boxes inside), depth first like the sections of a report. The PDF
    does not say who exported it. 404 `box_not_found` for an unknown `box`."""
    found = await access.for_diagram(session, diagram_id, user)
    diagram = await diagrams.get(session, diagram_id)
    pdf = await diagrams.pdf(session, diagram, found.project.name, box, paper)
    # "Shop.pdf", or "Shop - Payments.pdf" for the inside of a box.
    name = diagram.name
    flat = await diagrams.outline(session, diagram_id)
    if box is not None and flat is not None and box != flat.root_id:
        name = f"{name} - {flat.title[box]}"
    return Response(pdf, media_type="application/pdf", headers=attachment(f"{name}.pdf"))


@router.delete("/diagrams/{diagram_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_diagram(diagram_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    """Project owners only. Its ADRs go with it."""
    found = await access.for_diagram(session, diagram_id, user)
    found.require(ProjectRole.OWNER, "delete diagrams")
    await diagrams.delete_diagram(session, diagram_id, live.Sender(user.id, user.display_name))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
