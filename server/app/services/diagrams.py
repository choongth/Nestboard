"""Diagram storage. Free of HTTP concerns so other callers (the future AI/MCP
integration) can use it directly.

A diagram is a row of its own (name, version) plus a row per box, connection
and spot of an external box (app.models.diagram). A save names the boxes and
connections it adds, changes or deletes, and only those rows are written.

Every change to a diagram is told to everyone who has it open (app.live)."""

import asyncio
import uuid
from collections.abc import Collection
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import box_rights, diagram_changes, live
from app.diagram_format import (
    DiagramFormatError,
    Rows,
    empty_document,
    normalize_document,
    to_document,
    to_rows,
)
from app.diagram_tree import Flat
from app.errors import Invalid, NotFound
from app.models import Box, Diagram, Edge, ExternalSpot
from app.pdf_export import outline as pdf_outline
from app.pdf_export.document import Cover, PaperName, export_pdf
from app.schemas.diagrams import Changes
from app.services import versions


class DiagramNotFound(NotFound):
    code = "diagram_not_found"


class BoxNotFound(NotFound):
    """A box asked for in the address that the diagram does not have."""

    code = "box_not_found"


class UnknownBox(Invalid):
    """A box named in the request (an ADR's scope, a grant) that the diagram
    does not have."""

    code = "unknown_box"


class InvalidDocument(Invalid):
    code = "invalid_document"


def _missing(diagram_id: uuid.UUID) -> DiagramNotFound:
    return DiagramNotFound(f"Diagram {diagram_id} does not exist.")


def normalize(document: Any) -> dict[str, Any]:
    """The document in the current format, or InvalidDocument."""
    try:
        return normalize_document(document)
    except DiagramFormatError as e:
        raise InvalidDocument(str(e)) from e


async def create(
    session: AsyncSession, project_id: uuid.UUID, name: str, document: Any | None
) -> Diagram:
    """A new diagram holding `document` (the editor's file format), or only
    an empty root canvas."""
    rows = to_rows(empty_document() if document is None else normalize(document))
    diagram = Diagram(project_id=project_id, name=name)
    session.add(diagram)
    await session.flush()
    await _insert(session, diagram.id, rows)
    await session.commit()
    await session.refresh(diagram)
    return diagram


async def _insert(session: AsyncSession, diagram_id: uuid.UUID, rows: Rows) -> None:
    # Boxes first, each before the boxes inside it, as the rows refer to them.
    for model, values in ((Box, rows.boxes), (Edge, rows.edges), (ExternalSpot, rows.spots)):
        if values:
            await session.execute(insert(model), [{"diagram_id": diagram_id, **v} for v in values])


async def get(session: AsyncSession, diagram_id: uuid.UUID) -> Diagram:
    diagram = await session.get(Diagram, diagram_id)
    if diagram is None:
        raise _missing(diagram_id)
    return diagram


@dataclass
class Content:
    """Everything in a diagram, boxes and connections in the order they were
    added."""

    boxes: list[Box]
    edges: list[Edge]
    spots: list[ExternalSpot]


async def content(
    session: AsyncSession,
    diagram_id: uuid.UUID,
    box_ids: Collection[str] | None = None,
    edge_ids: Collection[str] | None = None,
) -> Content:
    """Everything, or only the boxes (with the spots on their canvases) and
    connections with these ids. As written so far in this session's
    transaction, even rows it loaded before a bulk write."""
    boxes = select(Box).where(Box.diagram_id == diagram_id).order_by(Box.seq)
    edges = select(Edge).where(Edge.diagram_id == diagram_id).order_by(Edge.seq)
    spots = (
        select(ExternalSpot)
        .where(ExternalSpot.diagram_id == diagram_id)
        .order_by(ExternalSpot.canvas_id, ExternalSpot.box_id)
    )
    if box_ids is not None:
        boxes = boxes.where(Box.id.in_(box_ids))
        spots = spots.where(ExternalSpot.canvas_id.in_(box_ids))
    if edge_ids is not None:
        edges = edges.where(Edge.id.in_(edge_ids))
    fresh = {"populate_existing": True}
    return Content(
        list(await session.scalars(boxes, execution_options=fresh)),
        list(await session.scalars(edges, execution_options=fresh)),
        list(await session.scalars(spots, execution_options=fresh)),
    )


async def read(session: AsyncSession, diagram_id: uuid.UUID) -> dict[str, Any]:
    """The diagram with everything in it, as the API shows it
    (schemas.diagrams.DiagramOut)."""
    diagram = await get(session, diagram_id)
    found = await content(session, diagram_id)
    return {
        "id": diagram.id,
        "project_id": diagram.project_id,
        "name": diagram.name,
        "version": diagram.version,
        "created_at": diagram.created_at,
        "updated_at": diagram.updated_at,
        "root_id": next(b.id for b in found.boxes if b.parent_id is None),
        **_records(found),
    }


def _records(found: Content) -> dict[str, list[dict[str, Any]]]:
    """Boxes and connections as the API shows them (schemas.diagrams.Box, Edge)."""
    spots: dict[str, dict[str, dict[str, float]]] = {}
    for spot in found.spots:
        spots.setdefault(spot.canvas_id, {})[spot.box_id] = {"x": spot.x, "y": spot.y}
    return {
        "boxes": [
            {
                "id": b.id,
                "parent_id": b.parent_id,
                "title": b.title,
                "type_id": b.type_id,
                "technology": b.technology,
                "description": b.description,
                "position": {"x": b.x, "y": b.y},
                "externals": spots.get(b.id, {}),
            }
            for b in found.boxes
        ],
        "edges": [
            {"id": e.id, "from": e.from_id, "to": e.to_id, "type_id": e.type_id, "label": e.label}
            for e in found.edges
        ],
    }


async def outlines(
    session: AsyncSession,
    diagram_ids: Collection[uuid.UUID],
    project_id: uuid.UUID | None = None,
) -> dict[uuid.UUID, Flat]:
    """What is inside what in each diagram, and the names of things. Diagrams
    that do not exist (or are not in the project `project_id`) are left out."""
    if not diagram_ids:
        return {}
    query = (
        select(Box.diagram_id, Box.id, Box.parent_id, Box.title)
        .where(Box.diagram_id.in_(diagram_ids))
        .order_by(Box.seq)
    )
    if project_id is not None:
        query = query.join(Diagram, Diagram.id == Box.diagram_id).where(
            Diagram.project_id == project_id
        )
    boxes: dict[uuid.UUID, list[Any]] = {}
    for diagram_id, *box in await session.execute(query):
        boxes.setdefault(diagram_id, []).append(box)
    edges: dict[uuid.UUID, list[Any]] = {}
    for diagram_id, *edge in await session.execute(
        select(Edge.diagram_id, Edge.id, Edge.from_id, Edge.to_id, Edge.label)
        .where(Edge.diagram_id.in_(boxes))
        .order_by(Edge.seq)
    ):
        edges.setdefault(diagram_id, []).append(edge)
    return {d: Flat.of(rows, edges.get(d, [])) for d, rows in boxes.items()}


async def outline(
    session: AsyncSession, diagram_id: uuid.UUID, project_id: uuid.UUID | None = None
) -> Flat | None:
    return (await outlines(session, [diagram_id], project_id)).get(diagram_id)


async def project_outline(
    session: AsyncSession, project_id: uuid.UUID, diagram_id: uuid.UUID
) -> Flat:
    """The outline of one of the project's diagrams; DiagramNotFound if the
    project has no such diagram."""
    flat = await outline(session, diagram_id, project_id)
    if flat is None:
        raise DiagramNotFound(f"Diagram {diagram_id} is not in this project.")
    return flat


def box_title(flat: Flat, box_id: str) -> str:
    """The name of a box of the diagram; UnknownBox for one it does not have,
    and for the root canvas, which is not a box."""
    if box_id not in flat.parent or box_id == flat.root_id:
        raise UnknownBox(f'There is no box "{box_id}" in this diagram.', {"box_id": box_id})
    return flat.title[box_id]


async def list_page(
    session: AsyncSession, project_id: uuid.UUID, limit: int, offset: int
) -> tuple[list[Diagram], int]:
    """The project's diagrams, most recently changed first."""
    total = await session.scalar(
        select(func.count()).select_from(Diagram).where(Diagram.project_id == project_id)
    )
    rows = await session.scalars(
        select(Diagram)
        .where(Diagram.project_id == project_id)
        .order_by(Diagram.updated_at.desc(), Diagram.id)
        .limit(limit)
        .offset(offset)
    )
    return list(rows), total or 0


async def rename(
    session: AsyncSession,
    diagram_id: uuid.UUID,
    version: int | None,
    name: str,
    sender: live.Sender | None = None,
) -> Diagram:
    """Renames the diagram; with `version`, only if it is still at it
    (VersionConflict otherwise)."""
    async with live.hub.writing(diagram_id):
        diagram = await versions.bump(
            session, Diagram, diagram_id, version, "The diagram", _missing(diagram_id), name=name
        )
        await session.commit()
        # The session may hold this diagram from before the update (e.g. a
        # permission check read it): load what was written.
        await session.refresh(diagram)
        live.hub.publish(
            diagram_id,
            {
                "type": "renamed",
                "version": diagram.version,
                "name": diagram.name,
                "by": sender.described() if sender else None,
            },
        )
    return diagram


@dataclass
class Saved:
    diagram: Diagram
    skipped_boxes: list[str]
    skipped_edges: list[str]


async def save_changes(
    session: AsyncSession,
    diagram_id: uuid.UUID,
    changes: Changes,
    rights: box_rights.Rights | None = None,
    granted: Collection[str] = (),
    *,
    version: int | None = None,
    sender: live.Sender | None = None,
) -> Saved:
    """Makes changes on top of the diagram as it is, writing only the rows
    they change (InvalidChange for one that breaks a rule). With `version`,
    only if the diagram is still at it (VersionConflict otherwise). With
    `rights`, every change must be inside what they allow (403
    `outside_your_part`); without, the caller may change anything.

    Saves to one diagram happen one after another, each a new version, and
    everyone with it open hears of each in that order: the boxes and
    connections as they now are (those named), and what was deleted.
    """
    async with live.hub.writing(diagram_id):
        # Locked until the commit, also against other processes.
        current = await session.scalar(
            select(Diagram.version).where(Diagram.id == diagram_id).with_for_update()
        )
        if current is None:
            raise _missing(diagram_id)
        if version is not None and current != version:
            raise versions.conflict("The diagram", current, version)

        before = await outline(session, diagram_id)
        assert before is not None  # every diagram has a root box
        named = await content(
            session,
            diagram_id,
            [*(b.id for b in changes.added_boxes), *(b.id for b in changes.changed_boxes)],
            [*(e.id for e in changes.added_edges), *(e.id for e in changes.changed_edges)],
        )
        spots: dict[str, diagram_changes.Spots] = {}
        for spot in named.spots:
            spots.setdefault(spot.canvas_id, {})[spot.box_id] = (spot.x, spot.y)
        stored = diagram_changes.Stored(
            before, {b.id: b for b in named.boxes}, {e.id: e for e in named.edges}, spots
        )

        plan = diagram_changes.plan(stored, changes)
        if rights is not None:
            box_rights.check_changes(
                rights,
                granted,
                before,
                plan.after,
                plan.removed_boxes,
                plan.box_changes.values(),
                plan.edge_changes,
            )
        await _write(session, diagram_id, plan)
        # Locked at that version above, so this cannot conflict.
        diagram = await versions.bump(
            session, Diagram, diagram_id, current, "The diagram", _missing(diagram_id)
        )
        now = await content(session, diagram_id, plan.kept_boxes, plan.kept_edges)
        await session.commit()
        await session.refresh(diagram)
        live.hub.publish(
            diagram_id,
            {
                "type": "change",
                "version": diagram.version,
                "by": sender.described() if sender else None,
                "change_id": sender.change_id if sender else None,
                **_records(now),
                "removed_boxes": sorted(plan.removed_boxes),
                "removed_edges": sorted(plan.gone_edges),
                "skipped_boxes": plan.skipped_boxes,
                "skipped_edges": plan.skipped_edges,
            },
        )
    return Saved(diagram, plan.skipped_boxes, plan.skipped_edges)


async def _write(session: AsyncSession, diagram_id: uuid.UUID, plan: diagram_changes.Plan) -> None:
    def rows(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [{"diagram_id": diagram_id, **v} for v in values]

    # Deleting a box deletes what is inside it, its connections and the spots
    # that go with it (see app.models.diagram).
    if plan.removed_boxes:
        await session.execute(
            delete(Box).where(Box.diagram_id == diagram_id, Box.id.in_(plan.removed_boxes))
        )
    if plan.removed_edges:
        await session.execute(
            delete(Edge).where(Edge.diagram_id == diagram_id, Edge.id.in_(plan.removed_edges))
        )
    # By primary key: diagram_id and id are in every row.
    if plan.changed_boxes:
        await session.execute(update(Box), rows(plan.changed_boxes))
    if plan.changed_edges:
        await session.execute(update(Edge), rows(plan.changed_edges))
    if plan.new_boxes:
        await session.execute(insert(Box), rows(plan.new_boxes))
    if plan.new_edges:
        await session.execute(insert(Edge), rows(plan.new_edges))
    if plan.spots:
        await session.execute(
            delete(ExternalSpot).where(
                ExternalSpot.diagram_id == diagram_id, ExternalSpot.canvas_id.in_(plan.spots)
            )
        )
        new_spots = [
            {"canvas_id": canvas, "box_id": box_id, "x": x, "y": y}
            for canvas, spots in plan.spots.items()
            for box_id, (x, y) in spots.items()
        ]
        if new_spots:
            await session.execute(insert(ExternalSpot), rows(new_spots))


async def delete_diagram(
    session: AsyncSession, diagram_id: uuid.UUID, sender: live.Sender | None = None
) -> None:
    async with live.hub.writing(diagram_id):
        result = await session.execute(delete(Diagram).where(Diagram.id == diagram_id))
        if result.rowcount == 0:
            raise _missing(diagram_id)
        await session.commit()
        live.hub.publish(
            diagram_id, {"type": "deleted", "by": sender.described() if sender else None}
        )
        live.hub.close_diagram(diagram_id, live.GONE, "The diagram was deleted.")


async def pdf(
    session: AsyncSession,
    diagram: Diagram,
    project_name: str,
    box: str | None = None,
    paper: PaperName = "a4",
) -> bytes:
    """The diagram as a PDF report (see app/pdf_export): every canvas, or only
    those inside `box`. Drawn on a worker thread: it takes a second or two for
    a large diagram. BoxNotFound when `box` is not in the diagram."""
    found = await content(session, diagram.id)
    document = to_document(found.boxes, found.edges, found.spots)
    cover = Cover(diagram.name, project_name, datetime.now(UTC))
    try:
        return await asyncio.to_thread(export_pdf, document, cover, start=box, paper=paper)
    except pdf_outline.UnknownBox as e:
        raise BoxNotFound(str(e), {"box": box}) from e
