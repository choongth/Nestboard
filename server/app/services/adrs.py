"""Architecture decision records. Free of HTTP concerns so other callers (the
future AI/MCP integration) can use it directly. Who may do what is decided
by the caller (see app.access); this module keeps the record straight.

ADRs belong to a project and are numbered in it. Each has a scope: the
whole project, or one box of one of its diagrams and everything inside it.
A box-scoped ADR links only to that box, the boxes inside it, and
connections touching them; a project-wide one to anything in the project's
diagrams. A proposed ADR can move to another scope, if its links fit there.

Lifecycle:

    proposed ──> accepted ──> deprecated
       │            └───────> superseded  (only by a newer ADR; not a manual step)
       └──────> rejected

Only a proposed ADR can be edited, change its relations, or be deleted. Once
decided, an ADR is a record of what was decided: to change course, write a new
ADR that supersedes it. When that one is accepted, the old one becomes
superseded in the same transaction.

Links to boxes and connections can change in any status, since diagrams are
redrawn while decisions stay. A link whose target (or diagram) has been
deleted is kept and reported as orphaned; so is a scope whose box has gone.

Every change is kept as a revision, with who made it.
"""

import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Select, func, select, update
from sqlalchemy import delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.diagram_tree import Flat
from app.errors import Conflict, Invalid, NotFound
from app.models import (
    Adr,
    AdrLink,
    AdrRelation,
    AdrRevision,
    AdrStatus,
    LinkKind,
    Project,
    RelationKind,
    RevisionAction,
)
from app.schemas.adrs import CONTENT_FIELDS, adr_ref
from app.services import diagrams, versions
from app.services.projects import ProjectNotFound

# Manual transitions. Superseding is done by the newer ADR, never by hand.
TRANSITIONS: dict[AdrStatus, frozenset[AdrStatus]] = {
    AdrStatus.PROPOSED: frozenset({AdrStatus.ACCEPTED, AdrStatus.REJECTED}),
    AdrStatus.ACCEPTED: frozenset({AdrStatus.DEPRECATED}),
    AdrStatus.REJECTED: frozenset(),
    AdrStatus.DEPRECATED: frozenset(),
    AdrStatus.SUPERSEDED: frozenset(),
}
DECIDING = {AdrStatus.ACCEPTED, AdrStatus.REJECTED}
# Relations that only make sense against a decision currently in force.
NEEDS_ACCEPTED_TARGET = {RelationKind.SUPERSEDES, RelationKind.AMENDS}


class AdrNotFound(NotFound):
    code = "adr_not_found"


class AdrLocked(Conflict):
    code = "adr_locked"


class AdrReferenced(Conflict):
    code = "adr_referenced"


class InvalidTransition(Conflict):
    code = "invalid_transition"


class NotSupersedable(Conflict):
    code = "not_supersedable"


class UnknownLinkTarget(Invalid):
    code = "unknown_link_target"


class LinkOutsideScope(Invalid):
    code = "link_outside_scope"


class InvalidRelation(Invalid):
    code = "invalid_relation"


@dataclass(frozen=True)
class Author:
    """Who makes a change, as the record will show them."""

    id: uuid.UUID
    name: str
    # Their job title in the organization, if they have one.
    title: str | None = None


# ---- Creating ----


async def create(
    session: AsyncSession,
    project_id: uuid.UUID,
    author: Author,
    title: str,
    context: str = "",
    decisions: Sequence[str] = (),
    positive_consequences: Sequence[str] = (),
    negative_consequences: Sequence[str] = (),
    diagram_id: uuid.UUID | None = None,
    box_id: str | None = None,
) -> Adr:
    """A proposed ADR with the project's next number, about the whole project
    or (diagram_id and box_id) one box of one of its diagrams."""
    box_title = None
    if diagram_id is not None and box_id is not None:
        box_title = await _scope_box_title(session, project_id, diagram_id, box_id)
    else:
        diagram_id = box_id = None
    adr = await _insert(
        session,
        project_id,
        {
            "title": title,
            "context": context,
            "decisions": list(decisions),
            "positive_consequences": list(positive_consequences),
            "negative_consequences": list(negative_consequences),
        },
        diagram_id=diagram_id,
        box_id=box_id,
        box_title=box_title,
    )
    await _record_revision(session, adr, RevisionAction.CREATED, author)
    await session.commit()
    await session.refresh(adr)
    return adr


async def supersede(
    session: AsyncSession, adr_id: uuid.UUID, author: Author, title: str | None = None
) -> Adr:
    """Starts a proposed ADR that supersedes an accepted one: a copy of its
    sections, scope and links, plus the `supersedes` relation. The old ADR
    stays accepted until the new one is."""
    old = await get(session, adr_id)
    if old.status != AdrStatus.ACCEPTED:
        raise NotSupersedable(
            f"{adr_ref(old.number)} is {old.status}; only an accepted ADR can be superseded.",
            {"status": old.status},
        )
    content = {field: getattr(old, field) for field in CONTENT_FIELDS}
    new = await _insert(
        session,
        old.project_id,
        {**content, "title": title or old.title},
        diagram_id=old.diagram_id,
        box_id=old.box_id,
        box_title=old.box_title,
    )
    session.add(AdrRelation(source_id=new.id, target_id=old.id, kind=RelationKind.SUPERSEDES))
    for link in await session.scalars(select(AdrLink).where(AdrLink.adr_id == old.id)):
        session.add(
            AdrLink(
                adr_id=new.id,
                diagram_id=link.diagram_id,
                kind=link.kind,
                target_id=link.target_id,
                title=link.title,
            )
        )
    await _record_revision(session, new, RevisionAction.CREATED, author)
    await session.commit()
    await session.refresh(new)
    return new


async def _insert(
    session: AsyncSession, project_id: uuid.UUID, content: dict[str, Any], **scope: Any
) -> Adr:
    """A new proposed ADR with the project's next number. `content` has every
    field of CONTENT_FIELDS; `scope` the diagram_id, box_id and box_title."""
    # Taking the next number locks the project's row until commit, so two
    # ADRs created at once can never get the same number.
    number = await session.scalar(
        update(Project)
        .where(Project.id == project_id)
        .values(last_adr_number=Project.last_adr_number + 1)
        .returning(Project.last_adr_number)
    )
    if number is None:
        raise ProjectNotFound(f"Project {project_id} does not exist.")
    adr = Adr(
        project_id=project_id,
        number=number,
        status=AdrStatus.PROPOSED,
        version=1,
        **content,
        **scope,
    )
    session.add(adr)
    await session.flush()
    return adr


async def _scope_box_title(
    session: AsyncSession, project_id: uuid.UUID, diagram_id: uuid.UUID, box_id: str
) -> str:
    flat = await diagrams.project_outline(session, project_id, diagram_id)
    return diagrams.box_title(flat, box_id)


# ---- Reading ----


async def get(session: AsyncSession, adr_id: uuid.UUID) -> Adr:
    adr = await session.get(Adr, adr_id)
    if adr is None:
        raise AdrNotFound(f"ADR {adr_id} does not exist.")
    return adr


async def get_by_number(session: AsyncSession, project_id: uuid.UUID, number: int) -> Adr:
    adr = await session.scalar(
        select(Adr).where(Adr.project_id == project_id, Adr.number == number)
    )
    if adr is None:
        raise AdrNotFound(f"{adr_ref(number)} does not exist in this project.")
    return adr


async def list_for_project(
    session: AsyncSession,
    project_id: uuid.UUID,
    statuses: Collection[AdrStatus] | None = None,
    diagram_id: uuid.UUID | None = None,
    box_id: str | None = None,
    connection_id: str | None = None,
) -> list[Adr]:
    """In number order, optionally only those with some statuses, or linked
    to a given box or connection of a diagram (or to anything in it)."""
    query = select(Adr).where(Adr.project_id == project_id).order_by(Adr.number)
    if statuses:
        query = query.where(Adr.status.in_([s.value for s in statuses]))
    if diagram_id is not None:
        linked = select(AdrLink.adr_id).where(AdrLink.diagram_id == diagram_id)
        for kind, target_id in ((LinkKind.BOX, box_id), (LinkKind.CONNECTION, connection_id)):
            if target_id is not None:
                linked = linked.where(AdrLink.kind == kind, AdrLink.target_id == target_id)
        query = query.where(Adr.id.in_(linked))
    return list(await session.scalars(query))


async def describe(session: AsyncSession, adrs: Sequence[Adr]) -> list[dict[str, Any]]:
    """The full API view of each ADR: its fields plus scope and links (checked
    against the current diagrams), relations in both directions, and who
    proposed and decided it."""
    if not adrs:
        return []
    ids = [a.id for a in adrs]

    link_rows = list(
        await session.scalars(
            select(AdrLink)
            .where(AdrLink.adr_id.in_(ids))
            .order_by(AdrLink.kind, AdrLink.title, AdrLink.target_id)
        )
    )
    diagram_ids = {a.diagram_id for a in adrs if a.diagram_id} | {
        link.diagram_id for link in link_rows
    }
    flats = await diagrams.outlines(session, diagram_ids)

    links: dict[uuid.UUID, list[dict[str, Any]]] = {i: [] for i in ids}
    for link in link_rows:
        flat = flats.get(link.diagram_id)
        name = _target_name(flat, link.kind, link.target_id) if flat else None
        links[link.adr_id].append(
            {
                "diagram_id": link.diagram_id,
                "kind": link.kind,
                "id": link.target_id,
                "title": name if name is not None else link.title,
                "orphaned": name is None,
            }
        )

    outgoing: dict[uuid.UUID, list[dict[str, Any]]] = {i: [] for i in ids}
    rows = await session.execute(
        select(AdrRelation, Adr)
        .join(Adr, Adr.id == AdrRelation.target_id)
        .where(AdrRelation.source_id.in_(ids))
        .order_by(Adr.number)
    )
    for relation, target in rows:
        outgoing[relation.source_id].append(_related(relation.kind, target))

    incoming: dict[uuid.UUID, list[dict[str, Any]]] = {i: [] for i in ids}
    rows = await session.execute(
        select(AdrRelation, Adr)
        .join(Adr, Adr.id == AdrRelation.source_id)
        .where(AdrRelation.target_id.in_(ids))
        .order_by(Adr.number)
    )
    for relation, source in rows:
        incoming[relation.target_id].append(_related(relation.kind, source))

    proposed_by: dict[uuid.UUID, dict[str, Any] | None] = {}
    decided_by: dict[uuid.UUID, dict[str, Any] | None] = {}
    for revision in await session.scalars(
        select(AdrRevision)
        .where(
            AdrRevision.adr_id.in_(ids),
            (AdrRevision.revision == 1) | AdrRevision.action.in_([s.value for s in DECIDING]),
        )
        .order_by(AdrRevision.revision)
    ):
        if revision.revision == 1:
            proposed_by[revision.adr_id] = author_view(revision)
        else:
            decided_by[revision.adr_id] = author_view(revision)

    return [
        {
            **{column: getattr(adr, column) for column in _COLUMNS},
            "scope": _scope_view(adr, flats.get(adr.diagram_id) if adr.diagram_id else None),
            "links": links[adr.id],
            "relations": outgoing[adr.id],
            "referenced_by": incoming[adr.id],
            "proposed_by": proposed_by.get(adr.id),
            "decided_by": decided_by.get(adr.id),
        }
        for adr in adrs
    ]


_COLUMNS = (
    "id",
    "project_id",
    "number",
    "title",
    "status",
    "context",
    "decisions",
    "positive_consequences",
    "negative_consequences",
    "version",
    "created_at",
    "updated_at",
    "decided_at",
)


def _scope_view(adr: Adr, flat: Flat | None) -> dict[str, Any] | None:
    """None for the whole project; else the box, under its current name."""
    if adr.diagram_id is None or adr.box_id is None:
        return None
    current = flat.title.get(adr.box_id) if flat and adr.box_id != flat.root_id else None
    return {
        "diagram_id": adr.diagram_id,
        "box_id": adr.box_id,
        "title": current if current is not None else adr.box_title,
        "orphaned": current is None,
    }


def author_view(revision: AdrRevision) -> dict[str, Any] | None:
    """Who made a revision; None if unknown (made before authors were kept)."""
    if revision.author_name is None:
        return None
    return {
        "user_id": revision.author_id,
        "name": revision.author_name,
        "title": revision.author_title,
    }


def _related(kind: str, adr: Adr) -> dict[str, Any]:
    return {
        "kind": kind,
        "adr_id": adr.id,
        "ref": adr_ref(adr.number),
        "title": adr.title,
        "status": adr.status,
    }


async def revisions(session: AsyncSession, adr_id: uuid.UUID) -> list[AdrRevision]:
    """Oldest first."""
    await get(session, adr_id)
    return list(
        await session.scalars(
            select(AdrRevision).where(AdrRevision.adr_id == adr_id).order_by(AdrRevision.revision)
        )
    )


def _superseded_by(adr_id: uuid.UUID) -> Select[tuple[Adr]]:
    """The ADRs that `adr_id` says it supersedes."""
    return (
        select(Adr)
        .join(AdrRelation, AdrRelation.target_id == Adr.id)
        .where(AdrRelation.source_id == adr_id, AdrRelation.kind == RelationKind.SUPERSEDES)
    )


async def superseded_by_accepting(session: AsyncSession, adr_id: uuid.UUID) -> list[Adr]:
    """The ADRs that accepting this one would supersede."""
    return list(await session.scalars(_superseded_by(adr_id).order_by(Adr.number)))


async def newly_superseded(
    session: AsyncSession,
    adr_id: uuid.UUID,
    project_id: uuid.UUID,
    relations: Sequence[tuple[RelationKind, uuid.UUID]],
) -> list[Adr]:
    """The ADRs of the project that `relations` would have the ADR supersede,
    and that it does not supersede already."""
    already = {adr.id for adr in await superseded_by_accepting(session, adr_id)}
    wanted = [t for kind, t in relations if kind == RelationKind.SUPERSEDES and t not in already]
    if not wanted:
        return []
    return list(
        await session.scalars(
            select(Adr).where(Adr.id.in_(wanted), Adr.project_id == project_id).order_by(Adr.number)
        )
    )


# ---- Changing ----


async def edit(
    session: AsyncSession,
    adr_id: uuid.UUID,
    author: Author,
    version: int,
    changes: dict[str, Any],
) -> Adr:
    """Changes any of the content fields (CONTENT_FIELDS) of a proposed ADR."""
    adr = await _lock(session, adr_id, version)
    _require_proposed(adr, "edited")
    for field in CONTENT_FIELDS:
        if field in changes:
            setattr(adr, field, changes[field])
    return await _save(session, adr, RevisionAction.EDITED, author)


async def set_links(
    session: AsyncSession,
    adr_id: uuid.UUID,
    author: Author,
    version: int,
    links: Sequence[tuple[uuid.UUID, LinkKind, str]],
) -> Adr:
    """Replaces the ADR's links, each (diagram_id, kind, target id). New
    targets must exist in a diagram of the project and lie in the ADR's
    scope; links the ADR already has are kept even if their target has since
    been deleted or moved out, so a client can send back the list it read."""
    adr = await _lock(session, adr_id, version)
    # Plain rows, not ORM objects: these rows are deleted and re-inserted below.
    existing = {
        (diagram_id, kind, target_id): title
        for diagram_id, kind, target_id, title in await session.execute(
            select(AdrLink.diagram_id, AdrLink.kind, AdrLink.target_id, AdrLink.title).where(
                AdrLink.adr_id == adr.id
            )
        )
    }
    flats = await diagrams.outlines(session, {d for d, _, _ in links}, adr.project_id)

    wanted: dict[tuple[uuid.UUID, str, str], str] = {}
    for diagram_id, kind, target_id in links:
        key = (diagram_id, str(kind), target_id)
        if key in wanted:
            continue
        flat = flats.get(diagram_id)
        name = _target_name(flat, kind, target_id) if flat else None
        if key in existing:
            wanted[key] = name if name is not None else existing[key]
            continue
        details = {"diagram_id": str(diagram_id), "kind": kind, "id": target_id}
        if flat is None:
            raise UnknownLinkTarget(f"There is no diagram {diagram_id} in this project.", details)
        if name is None:
            if kind == LinkKind.BOX and target_id == flat.root_id:
                raise UnknownLinkTarget(
                    "The top level of a diagram is not a box; an ADR about the whole "
                    "project needs no link.",
                    details,
                )
            raise UnknownLinkTarget(
                f'There is no {kind} with id "{target_id}" in this diagram.', details
            )
        if not _in_scope(adr.diagram_id, adr.box_id, diagram_id, flat, kind, target_id):
            raise LinkOutsideScope(
                f"{adr_ref(adr.number)} is about {_scope_name(adr, flat)}, so it can only "
                f"link to what is in it, not to the {kind} {_quote(name)}.",
                details,
            )
        wanted[key] = name

    await session.execute(sql_delete(AdrLink).where(AdrLink.adr_id == adr.id))
    for (diagram_id, kind, target_id), title in wanted.items():
        session.add(
            AdrLink(
                adr_id=adr.id, diagram_id=diagram_id, kind=kind, target_id=target_id, title=title
            )
        )
    return await _save(session, adr, RevisionAction.LINKED, author)


async def set_scope(
    session: AsyncSession,
    adr_id: uuid.UUID,
    author: Author,
    version: int,
    diagram_id: uuid.UUID | None,
    box_id: str | None,
) -> Adr:
    """Moves a proposed ADR to another scope: the whole project (both None)
    or a box. Every link it has must fit the new scope (links whose target
    has been deleted are not in the way); remove the others first."""
    adr = await _lock(session, adr_id, version)
    _require_proposed(adr, "moved to another scope")
    box_title = None
    if diagram_id is not None and box_id is not None:
        box_title = await _scope_box_title(session, adr.project_id, diagram_id, box_id)
    else:
        diagram_id = box_id = None
    links = list(
        await session.scalars(
            select(AdrLink)
            .where(AdrLink.adr_id == adr.id)
            .order_by(AdrLink.kind, AdrLink.title, AdrLink.target_id)
        )
    )
    flats = await diagrams.outlines(session, {link.diagram_id for link in links}, adr.project_id)
    for link in links:
        flat = flats.get(link.diagram_id)
        name = _target_name(flat, link.kind, link.target_id) if flat else None
        if flat is None or name is None:
            continue
        if not _in_scope(diagram_id, box_id, link.diagram_id, flat, link.kind, link.target_id):
            where = _quote(box_title) if box_title else "the whole project"
            raise LinkOutsideScope(
                f"{adr_ref(adr.number)} links to the {link.kind} {_quote(name)}, which is not "
                f"in {where}. Remove that link first.",
                {"diagram_id": str(link.diagram_id), "kind": link.kind, "id": link.target_id},
            )
    adr.diagram_id, adr.box_id, adr.box_title = diagram_id, box_id, box_title
    return await _save(session, adr, RevisionAction.SCOPED, author)


def _target_name(flat: Flat, kind: str, target_id: str) -> str | None:
    if kind == LinkKind.BOX:
        return flat.title.get(target_id) if target_id != flat.root_id else None
    edge = flat.edges.get(target_id)
    if edge is None:
        return None
    return edge.get("label") or f"{flat.title[edge['from']]} → {flat.title[edge['to']]}"


def _in_scope(
    scope_diagram_id: uuid.UUID | None,
    scope_box_id: str | None,
    diagram_id: uuid.UUID,
    flat: Flat,
    kind: str,
    target_id: str,
) -> bool:
    """Is the target (in `flat`, the diagram `diagram_id`) inside the scope? A
    connection is when either end is (it touches the box)."""
    if scope_box_id is None:
        return True
    if diagram_id != scope_diagram_id or scope_box_id not in flat.parent:
        return False
    inside = {scope_box_id, *flat.descendants(scope_box_id)}
    if kind == LinkKind.BOX:
        return target_id in inside
    edge = flat.edges[target_id]
    return edge["from"] in inside or edge["to"] in inside


def _scope_name(adr: Adr, flat: Flat | None) -> str:
    if adr.box_id is None:
        return "the whole project"
    current = flat.title.get(adr.box_id) if flat and adr.diagram_id else None
    return _quote(current or adr.box_title or adr.box_id)


def _quote(name: str) -> str:
    return f'"{name}"'


async def set_relations(
    session: AsyncSession,
    adr_id: uuid.UUID,
    author: Author,
    version: int,
    relations: Sequence[tuple[RelationKind, uuid.UUID]],
) -> Adr:
    """Replaces the ADR's relations to other ADRs of the same project. Only a
    proposed ADR can change them. `supersedes` and `amends` need an accepted
    target, except for relations the ADR already has, which are kept as they
    are (acceptance checks `supersedes` again)."""
    adr = await _lock(session, adr_id, version)
    _require_proposed(adr, "given new relations")
    # Plain rows, not ORM objects: these rows are deleted and re-inserted below.
    existing = {
        (kind, target_id)
        for kind, target_id in await session.execute(
            select(AdrRelation.kind, AdrRelation.target_id).where(AdrRelation.source_id == adr.id)
        )
    }
    targets = {
        t.id: t
        for t in await session.scalars(
            select(Adr).where(
                Adr.id.in_([target_id for _, target_id in relations]),
                Adr.project_id == adr.project_id,
            )
        )
    }

    seen: set[uuid.UUID] = set()
    for kind, target_id in relations:
        if target_id == adr.id:
            raise InvalidRelation(f"{adr_ref(adr.number)} cannot relate to itself.")
        if target_id in seen:
            raise InvalidRelation("Give at most one relation per ADR.", {"adr_id": str(target_id)})
        seen.add(target_id)
        target = targets.get(target_id)
        if target is None:
            raise InvalidRelation(
                f"There is no ADR with id {target_id} in this project.",
                {"adr_id": str(target_id)},
            )
        if (
            kind in NEEDS_ACCEPTED_TARGET
            and target.status != AdrStatus.ACCEPTED
            and (kind, target_id) not in existing
        ):
            raise InvalidRelation(
                f"{adr_ref(adr.number)} cannot {_verb(kind)} {adr_ref(target.number)}, "
                f"which is {target.status}; only an accepted ADR can be {_participle(kind)}.",
                {"adr_id": str(target_id), "status": target.status},
            )

    await session.execute(sql_delete(AdrRelation).where(AdrRelation.source_id == adr.id))
    for kind, target_id in relations:
        session.add(AdrRelation(source_id=adr.id, target_id=target_id, kind=kind))
    return await _save(session, adr, RevisionAction.RELATED, author)


async def transition(
    session: AsyncSession, adr_id: uuid.UUID, author: Author, version: int, to: AdrStatus
) -> Adr:
    adr = await _lock(session, adr_id, version)
    current = AdrStatus(adr.status)
    allowed = TRANSITIONS[current]
    if to not in allowed:
        if to == AdrStatus.SUPERSEDED:
            reason = "An ADR becomes superseded only when a newer ADR replaces it."
        elif not allowed:
            reason = f"{adr_ref(adr.number)} is {current}, which is final."
        else:
            reason = (
                f"{_article(current).capitalize()} {current} ADR can only become {_or(allowed)}."
            )
        raise InvalidTransition(
            f"{adr_ref(adr.number)} cannot go from {current} to {to}. {reason}",
            {"from": current, "to": to, "allowed": sorted(allowed)},
        )
    if to == AdrStatus.ACCEPTED:
        await _supersede_targets(session, adr, author)
    adr.status = to
    if to in DECIDING:
        adr.decided_at = func.now()
    return await _save(session, adr, RevisionAction(to.value), author)


async def _supersede_targets(session: AsyncSession, adr: Adr, author: Author) -> None:
    """Accepting `adr` supersedes every ADR it says it supersedes. They must
    all still be accepted; otherwise nothing changes."""
    targets = list(
        await session.scalars(
            _superseded_by(adr.id)
            # A fixed lock order, so concurrent acceptances cannot deadlock.
            .order_by(Adr.id)
            .with_for_update(of=Adr)
            .execution_options(populate_existing=True)
        )
    )
    blocking = [t for t in targets if t.status != AdrStatus.ACCEPTED]
    if blocking:
        names = ", ".join(f"{adr_ref(t.number)} ({t.status})" for t in blocking)
        raise InvalidTransition(
            f"{adr_ref(adr.number)} cannot be accepted: it supersedes ADRs that are no longer "
            f"accepted: {names}. Remove those relations first.",
            {"blocking": [{"adr_id": str(t.id), "status": t.status} for t in blocking]},
        )
    for target in targets:
        target.status = AdrStatus.SUPERSEDED
        target.version += 1
        target.updated_at = func.now()
        await _record_revision(session, target, RevisionAction.SUPERSEDED, author)


async def delete(session: AsyncSession, adr_id: uuid.UUID) -> None:
    """Only proposed ADRs that no other ADR refers to can be deleted."""
    adr = await session.get(Adr, adr_id, with_for_update=True)
    if adr is None:
        raise AdrNotFound(f"ADR {adr_id} does not exist.")
    if adr.status != AdrStatus.PROPOSED:
        raise AdrLocked(
            f"{adr_ref(adr.number)} is {adr.status}, so it is part of the record and "
            "cannot be deleted.",
            {"status": adr.status},
        )
    referrers = list(
        await session.scalars(
            select(Adr)
            .join(AdrRelation, AdrRelation.source_id == Adr.id)
            .where(AdrRelation.target_id == adr.id)
            .order_by(Adr.number)
        )
    )
    if referrers:
        refs = ", ".join(adr_ref(r.number) for r in referrers)
        raise AdrReferenced(
            f"{adr_ref(adr.number)} cannot be deleted while other ADRs refer to it ({refs}).",
            {"referenced_by": [str(r.id) for r in referrers]},
        )
    await session.delete(adr)
    await session.commit()


# ---- Helpers ----


def _require_proposed(adr: Adr, action: str) -> None:
    if adr.status != AdrStatus.PROPOSED:
        raise AdrLocked(
            f"{adr_ref(adr.number)} is {adr.status}, so it can no longer be {action}. "
            "To change course, write a new ADR.",
            {"status": adr.status},
        )


async def _lock(session: AsyncSession, adr_id: uuid.UUID, version: int) -> Adr:
    """Loads the ADR for a change, holding its row until commit so concurrent
    changes queue up and each sees the other's result."""
    adr = await session.get(Adr, adr_id, with_for_update=True, populate_existing=True)
    if adr is None:
        raise AdrNotFound(f"ADR {adr_id} does not exist.")
    if adr.version != version:
        raise versions.conflict(adr_ref(adr.number), adr.version, version)
    return adr


async def _save(session: AsyncSession, adr: Adr, action: RevisionAction, author: Author) -> Adr:
    adr.version += 1
    adr.updated_at = func.now()
    await _record_revision(session, adr, action, author)
    await session.commit()
    await session.refresh(adr)
    return adr


async def _record_revision(
    session: AsyncSession, adr: Adr, action: RevisionAction, author: Author
) -> None:
    """Appends the ADR as it is now (after pending changes) to its history."""
    snapshot: dict[str, Any] = {
        field: list_or_text(getattr(adr, field)) for field in CONTENT_FIELDS
    }
    snapshot["status"] = str(adr.status)
    snapshot["scope"] = (
        {"diagram_id": str(adr.diagram_id), "box_id": adr.box_id} if adr.box_id else None
    )
    snapshot["links"] = [
        {"diagram_id": str(link.diagram_id), "kind": link.kind, "id": link.target_id}
        for link in await session.scalars(
            select(AdrLink)
            .where(AdrLink.adr_id == adr.id)
            .order_by(AdrLink.diagram_id, AdrLink.kind, AdrLink.target_id)
        )
    ]
    snapshot["relations"] = [
        {"kind": r.kind, "adr_id": str(r.target_id)}
        for r in await session.scalars(
            select(AdrRelation)
            .where(AdrRelation.source_id == adr.id)
            .order_by(AdrRelation.target_id)
        )
    ]
    session.add(
        AdrRevision(
            adr_id=adr.id,
            revision=adr.version,
            snapshot=snapshot,
            action=action,
            author_id=author.id,
            author_name=author.name,
            author_title=author.title,
        )
    )


def list_or_text(value: Any) -> Any:
    """A copy safe to keep in a snapshot (lists must not share the ADR's list)."""
    return list(value) if isinstance(value, list) else value


def _verb(kind: RelationKind) -> str:
    return {RelationKind.SUPERSEDES: "supersede", RelationKind.AMENDS: "amend"}[kind]


def _participle(kind: RelationKind) -> str:
    return {RelationKind.SUPERSEDES: "superseded", RelationKind.AMENDS: "amended"}[kind]


def _article(word: str) -> str:
    return "an" if word[0] in "aeiou" else "a"


def _or(statuses: Collection[AdrStatus]) -> str:
    return " or ".join(sorted(statuses))
