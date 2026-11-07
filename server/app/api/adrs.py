import io
import uuid
import zipfile
from typing import Annotated

from fastapi import APIRouter, Path, Query, Response, status

from app import access, adr_markdown
from app.api.downloads import attachment
from app.auth import CurrentUser
from app.db import SessionDep
from app.errors import ROLE_RESPONSES, Invalid
from app.models import AdrStatus, ProjectRole
from app.schemas.adrs import (
    AdrCreate,
    AdrLinksUpdate,
    AdrOut,
    AdrRelationsUpdate,
    AdrRevisionOut,
    AdrScopeUpdate,
    AdrSupersede,
    AdrTransition,
    AdrUpdate,
    adr_ref,
)
from app.services import adrs, projects

# Anyone in the project reads its ADRs. What else you may do depends on your
# role at the ADR's scope (the whole project, or a box and what is inside):
# editors there propose, edit, link and move it (to a scope they edit too);
# owners there decide (accept, reject, deprecate). Superseding an ADR needs an
# owner where that ADR is.
router = APIRouter(tags=["adrs"], responses=ROLE_RESPONSES)

EDITOR, OWNER = ProjectRole.EDITOR, ProjectRole.OWNER


async def _views(session: SessionDep, found: projects.Access, user, found_adrs) -> list[dict]:
    """The API view of ADRs, each with the user's role at its scope
    (`my_role`), so a client can show only what they may do."""
    described = await adrs.describe(session, found_adrs)
    roles: dict[tuple, ProjectRole] = {}
    for view in described:
        scope = view["scope"]
        key = (scope["diagram_id"], scope["box_id"]) if scope else (None, None)
        if key not in roles:
            roles[key], _ = await access.role_at_scope(session, found, user, *key)
        view["my_role"] = roles[key]
    return described


async def _one(session: SessionDep, found: projects.Access, user, adr) -> dict:
    return (await _views(session, found, user, [adr]))[0]


@router.get("/projects/{project_id}/adrs", response_model=list[AdrOut])
async def list_adrs(
    project_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
    statuses: Annotated[
        list[AdrStatus] | None,
        Query(alias="status", description="Only these statuses (repeatable)."),
    ] = None,
    diagram_id: Annotated[
        uuid.UUID | None, Query(description="Only ADRs linked to something in this diagram.")
    ] = None,
    box_id: Annotated[
        str | None, Query(description="Only ADRs linked to this box (needs diagram_id).")
    ] = None,
    connection_id: Annotated[
        str | None, Query(description="Only ADRs linked to this connection (needs diagram_id).")
    ] = None,
):
    """The project's ADRs in number order."""
    if diagram_id is None and (box_id is not None or connection_id is not None):
        raise Invalid("Filtering by box or connection needs the diagram_id too.")
    found = await projects.access(session, project_id, user)
    listed = await adrs.list_for_project(
        session, project_id, statuses, diagram_id, box_id, connection_id
    )
    return await _views(session, found, user, listed)


@router.post(
    "/projects/{project_id}/adrs", response_model=AdrOut, status_code=status.HTTP_201_CREATED
)
async def create_adr(
    project_id: uuid.UUID, body: AdrCreate, user: CurrentUser, session: SessionDep
):
    """Proposes an ADR with the project's next number, about the whole project
    or (diagram_id and box_id) one box. Editors and owners of that scope; the
    box must exist (422 `unknown_box`)."""
    found = await projects.access(session, project_id, user)
    await access.require_at_scope(
        session, found, user, body.diagram_id, body.box_id, EDITOR, "propose ADRs there"
    )
    author = await access.author(session, found, user)
    created = await adrs.create(session, project_id, author, **body.model_dump())
    return await _one(session, found, user, created)


# Declared before /adrs/{number}, which would otherwise claim this path.
@router.get(
    "/projects/{project_id}/adrs/export.zip",
    response_class=Response,
    responses={200: {"content": {"application/zip": {}}}},
)
async def export_adrs(project_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    """Every ADR of the project as Markdown files (adr-tools layout), zipped:
    ready to drop into a repository's docs/adr folder."""
    found = await projects.access(session, project_id, user)
    described = await adrs.describe(session, await adrs.list_for_project(session, project_id))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for adr in described:
            name = adr_markdown.filename(adr["number"], adr["title"])
            archive.writestr(name, adr_markdown.render(adr))
    return Response(
        buffer.getvalue(),
        media_type="application/zip",
        headers=attachment(f"{found.project.name} ADRs.zip"),
    )


@router.get("/projects/{project_id}/adrs/{number}", response_model=AdrOut)
async def get_adr_by_number(
    project_id: uuid.UUID,
    number: Annotated[int, Path(ge=1)],
    user: CurrentUser,
    session: SessionDep,
):
    """Looks an ADR up by its number, e.g. 7 for ADR-0007."""
    found = await projects.access(session, project_id, user)
    return await _one(session, found, user, await adrs.get_by_number(session, project_id, number))


@router.get("/adrs/{adr_id}", response_model=AdrOut)
async def get_adr(adr_id: uuid.UUID, user: CurrentUser, session: SessionDep):
    found = await access.for_adr(session, adr_id, user)
    return await _one(session, found, user, await adrs.get(session, adr_id))


@router.get(
    "/adrs/{adr_id}/markdown",
    response_class=Response,
    responses={200: {"content": {"text/markdown": {}}}},
)
async def export_adr(adr_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    """The ADR as a Markdown file in Nygard's format (adr-tools layout)."""
    await access.for_adr(session, adr_id, user)
    adr = (await adrs.describe(session, [await adrs.get(session, adr_id)]))[0]
    return Response(
        adr_markdown.render(adr),
        media_type="text/markdown; charset=utf-8",
        headers=attachment(adr_markdown.filename(adr["number"], adr["title"])),
    )


async def _for_change(
    session: SessionDep, adr_id: uuid.UUID, user, role: ProjectRole, doing: str
) -> tuple[projects.Access, adrs.Author]:
    """Checks the user has `role` at the ADR's scope; returns their access and
    how the history will name them."""
    found = await access.for_adr(session, adr_id, user)
    await access.require_at_adr(session, found, user, await adrs.get(session, adr_id), role, doing)
    return found, await access.author(session, found, user)


@router.patch("/adrs/{adr_id}", response_model=AdrOut)
async def edit_adr(adr_id: uuid.UUID, body: AdrUpdate, user: CurrentUser, session: SessionDep):
    """Edits a proposed ADR. Decided ADRs are locked (409 `adr_locked`).
    Editors and owners of its scope."""
    found, author = await _for_change(session, adr_id, user, EDITOR, "edit its ADRs")
    changes = body.model_dump(exclude={"version"}, exclude_none=True)
    edited = await adrs.edit(session, adr_id, author, body.version, changes)
    return await _one(session, found, user, edited)


@router.put("/adrs/{adr_id}/links", response_model=AdrOut)
async def set_links(
    adr_id: uuid.UUID, body: AdrLinksUpdate, user: CurrentUser, session: SessionDep
):
    """Replaces the boxes and connections the ADR is about. Allowed in any
    status. New targets must exist in a diagram of the project (422
    `unknown_link_target`) and, for an ADR about a box, be that box, inside
    it, or a connection touching them (422 `link_outside_scope`). Links the
    ADR already has may be sent back even if orphaned. Editors and owners of
    its scope."""
    found, author = await _for_change(
        session, adr_id, user, EDITOR, "change what its ADRs are about"
    )
    links = [(link.diagram_id, link.kind, link.id) for link in body.links]
    linked = await adrs.set_links(session, adr_id, author, body.version, links)
    return await _one(session, found, user, linked)


@router.put("/adrs/{adr_id}/scope", response_model=AdrOut)
async def set_scope(
    adr_id: uuid.UUID, body: AdrScopeUpdate, user: CurrentUser, session: SessionDep
):
    """Moves a proposed ADR to another scope: the whole project, or
    (diagram_id and box_id) a box. Its links must fit there (422
    `link_outside_scope`). Editors of both the old and the new scope."""
    found, author = await _for_change(session, adr_id, user, EDITOR, "move its ADRs elsewhere")
    await access.require_at_scope(
        session, found, user, body.diagram_id, body.box_id, EDITOR, "move ADRs there"
    )
    moved = await adrs.set_scope(
        session, adr_id, author, body.version, body.diagram_id, body.box_id
    )
    return await _one(session, found, user, moved)


@router.put("/adrs/{adr_id}/relations", response_model=AdrOut)
async def set_relations(
    adr_id: uuid.UUID, body: AdrRelationsUpdate, user: CurrentUser, session: SessionDep
):
    """Replaces the ADR's relations to other ADRs in the project; only while
    it is proposed. `supersedes` and `amends` need an accepted target.
    Accepting an ADR marks every ADR it supersedes as superseded. Editors
    and owners of its scope; a new `supersedes` relation also needs an owner
    of the superseded ADR's scope."""
    found, author = await _for_change(session, adr_id, user, EDITOR, "relate its ADRs")
    relations = [(r.kind, r.adr_id) for r in body.relations]
    # ADRs of other projects are refused by set_relations, as unknown.
    for target in await adrs.newly_superseded(session, adr_id, found.project.id, relations):
        await access.require_at_adr(
            session, found, user, target, OWNER, f"supersede {adr_ref(target.number)}"
        )
    related = await adrs.set_relations(session, adr_id, author, body.version, relations)
    return await _one(session, found, user, related)


@router.post("/adrs/{adr_id}/supersede", response_model=AdrOut, status_code=status.HTTP_201_CREATED)
async def supersede_adr(
    adr_id: uuid.UUID, body: AdrSupersede, user: CurrentUser, session: SessionDep
):
    """Starts a proposed ADR that supersedes this accepted one, copying its
    sections, scope and links. This one becomes superseded when the new one
    is accepted. Owners of its scope."""
    found, author = await _for_change(session, adr_id, user, OWNER, "supersede its ADRs")
    created = await adrs.supersede(session, adr_id, author, body.title)
    return await _one(session, found, user, created)


@router.post("/adrs/{adr_id}/transition", response_model=AdrOut)
async def transition_adr(
    adr_id: uuid.UUID, body: AdrTransition, user: CurrentUser, session: SessionDep
):
    """Moves the ADR to another status: proposed → accepted | rejected,
    accepted → deprecated. Anything else is 409 `invalid_transition`. Owners
    of its scope; accepting an ADR that supersedes others also needs an owner
    of theirs."""
    found, author = await _for_change(session, adr_id, user, OWNER, "decide on its ADRs")
    if body.to == AdrStatus.ACCEPTED:
        for target in await adrs.superseded_by_accepting(session, adr_id):
            await access.require_at_adr(
                session, found, user, target, OWNER, f"supersede {adr_ref(target.number)}"
            )
    moved = await adrs.transition(session, adr_id, author, body.version, body.to)
    return await _one(session, found, user, moved)


@router.delete("/adrs/{adr_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_adr(adr_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    """Deletes a proposed ADR that no other ADR refers to. Its number is not
    reused. Editors and owners of its scope."""
    await _for_change(session, adr_id, user, EDITOR, "delete its ADRs")
    await adrs.delete(session, adr_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/adrs/{adr_id}/revisions", response_model=list[AdrRevisionOut])
async def list_revisions(adr_id: uuid.UUID, user: CurrentUser, session: SessionDep):
    """Every version of the ADR, oldest first, with who made it."""
    await access.for_adr(session, adr_id, user)
    return [
        {
            "revision": r.revision,
            "action": r.action,
            "author": adrs.author_view(r),
            "snapshot": r.snapshot,
            "created_at": r.created_at,
        }
        for r in await adrs.revisions(session, adr_id)
    ]
