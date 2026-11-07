"""Checks one set of changes (schemas.diagrams.Changes) against the stored
diagram and works out what to write. No database here: the caller loads
what the changes touch and writes what comes back.

Changes are made on top of the diagram as it is now, field by field, so
several people can change it at once (see Changes). What is refused, whole,
is a change that breaks the editor's rules, as for a whole file
(app.diagram_format): every box but the root sits in a box, no deeper than
MAX_NESTING; a connection joins two boxes, neither inside the other. On top
of that a box keeps the box it sits in, and one set of changes does not
contradict itself (e.g. change a box it deletes).
"""

from collections import Counter
from dataclasses import dataclass, field, replace
from typing import Any, NoReturn

from app.box_rights import BoxChange, Ends
from app.diagram_format import MAX_NESTING
from app.diagram_tree import Flat, connection_problem
from app.errors import Invalid
from app.models import Box, Edge
from app.schemas.diagrams import Box as BoxIn
from app.schemas.diagrams import BoxPatch, Changes, EdgePatch, Position

# A canvas's spots: (x, y) of external boxes by box id.
Spots = dict[str, tuple[float, float]]


class InvalidChange(Invalid):
    code = "invalid_change"


@dataclass
class Stored:
    """The diagram as stored, as far as the changes need it."""

    flat: Flat
    # The boxes and connections the changes add or change, if they exist.
    boxes: dict[str, Box]
    edges: dict[str, Edge]
    # The spots on the canvases of those boxes.
    spots: dict[str, Spots]


@dataclass
class Plan:
    """What to write, what changes for app.box_rights to check, and what
    happened to each box and connection named."""

    after: Flat
    # Every box deleted, those inside deleted boxes too.
    removed_boxes: set[str]
    # The connections named as deleted that were there.
    removed_edges: set[str]
    # Every connection deleted: those named, and those that go with their boxes.
    gone_edges: set[str]
    # Column values by name. New boxes come before the boxes inside them.
    new_boxes: list[dict[str, Any]] = field(default_factory=list)
    changed_boxes: list[dict[str, Any]] = field(default_factory=list)
    new_edges: list[dict[str, Any]] = field(default_factory=list)
    changed_edges: list[dict[str, Any]] = field(default_factory=list)
    # Canvases whose spots are replaced, with their new spots.
    spots: dict[str, Spots] = field(default_factory=dict)
    box_changes: dict[str, BoxChange] = field(default_factory=dict)
    edge_changes: list[tuple[Ends, Ends]] = field(default_factory=list)
    # Boxes and connections added or changed that are there afterwards
    # (whether anything about them changed or not), and those skipped.
    kept_boxes: list[str] = field(default_factory=list)
    kept_edges: list[str] = field(default_factory=list)
    skipped_boxes: list[str] = field(default_factory=list)
    skipped_edges: list[str] = field(default_factory=list)


_BOX_FIELDS = ("title", "type_id", "technology", "description")
_EDGE_FIELDS = ("from_id", "to_id", "type_id", "label")


def plan(stored: Stored, changes: Changes) -> Plan:
    """Raises InvalidChange, with a readable message, for changes that break
    a rule."""
    before = stored.flat
    _no_repeats(
        "Box",
        [*(b.id for b in changes.added_boxes), *(b.id for b in changes.changed_boxes)],
        changes.removed_boxes,
    )
    _no_repeats(
        "Connection",
        [*(e.id for e in changes.added_edges), *(e.id for e in changes.changed_edges)],
        changes.removed_edges,
    )

    removed: set[str] = set()
    for box_id in changes.removed_boxes:
        if box_id == before.root_id:
            _fail("The top level cannot be deleted.")
        if box_id in before.parent:
            removed.update([box_id, *before.descendants(box_id)])
    removed_edges = {e for e in changes.removed_edges if e in before.edges}
    gone_edges = removed_edges | {
        edge_id for edge_id, e in before.edges.items() if {e["from"], e["to"]} & removed
    }
    after = Flat.of(
        (
            (box_id, parent, before.title[box_id])
            for box_id, parent in before.parent.items()
            if box_id not in removed
        ),
        (
            (edge_id, e["from"], e["to"], e["label"])
            for edge_id, e in before.edges.items()
            if edge_id not in gone_edges
        ),
    )
    result = Plan(after, removed, removed_edges, gone_edges)

    new: dict[str, BoxIn] = {}
    replaced: list[tuple[Box, BoxIn]] = []
    for box in changes.added_boxes:
        if box.parent_id is None:
            _fail(f'Box "{box.id}" needs a box to sit in: only the top level has none.')
        if box.id in removed or box.parent_id in removed:
            _fail(f'Box "{box.id}" is inside a box that is being deleted.')
        old = stored.boxes.get(box.id)
        if old is None:
            new[box.id] = box
        elif box.parent_id != old.parent_id:
            _fail(
                f'Box "{box.id}" cannot move into another box. Add a new box there '
                "and delete this one instead."
            )
        else:
            replaced.append((old, box))
    for patch in changes.changed_boxes:
        if patch.id in removed:
            _fail(f'Box "{patch.id}" is inside a box that is being deleted.')

    # New boxes first, so that spots and connections may refer to them.
    order = _parents_first({b.id: b.parent_id for b in new.values()}, after, result.skipped_boxes)
    for box_id in order:
        after.add(box_id, new[box_id].parent_id, new[box_id].title)
    if any(_depth(after, box_id) > MAX_NESTING for box_id in order):
        _fail(f"Boxes are nested too deeply (more than {MAX_NESTING} levels).")
    for box_id in order:
        box = new[box_id]
        result.new_boxes.append(
            {
                "id": box.id,
                "parent_id": box.parent_id,
                **{key: getattr(box, key) for key in _BOX_FIELDS},
                "x": box.position.x,
                "y": box.position.y,
            }
        )
        result.box_changes[box.id] = BoxChange(box.id, added=True)
        result.kept_boxes.append(box.id)
        spots = _present(after, {k: (p.x, p.y) for k, p in box.externals.items()})
        if spots:
            result.spots[box.id] = spots

    # Already there: replaced, as if changed field by field.
    for old, box in replaced:
        fields = {key: getattr(box, key) for key in (*_BOX_FIELDS, "position")}
        _change_box(result, stored, old, fields, {k: (p.x, p.y) for k, p in box.externals.items()})
    for patch in changes.changed_boxes:
        old = stored.boxes.get(patch.id)
        if old is None:
            result.skipped_boxes.append(patch.id)
            continue
        spots = dict(stored.spots.get(patch.id, {}))
        for k, p in (patch.externals or {}).items():
            if p is None:
                spots.pop(k, None)
            else:
                spots[k] = (p.x, p.y)
        _change_box(result, stored, old, _given(patch), spots)

    for edge_id in changes.removed_edges:
        if edge_id in removed_edges:
            ends = before.edges[edge_id]
            result.edge_changes.append(((ends["from"], ends["to"]), None))
    for edge in changes.added_edges:
        row = {
            "id": edge.id,
            "from_id": edge.from_,
            "to_id": edge.to,
            "type_id": edge.type_id,
            "label": edge.label,
        }
        old = stored.edges.get(edge.id)
        # One deleted with a box at its end is new again.
        _put_edge(result, None if edge.id in gone_edges else old, row)
    for edge_patch in changes.changed_edges:
        old = stored.edges.get(edge_patch.id)
        if old is None or edge_patch.id in gone_edges:
            result.skipped_edges.append(edge_patch.id)
            continue
        given = _given(edge_patch)
        row = {"id": old.id, **{key: getattr(old, key) for key in _EDGE_FIELDS}}
        row |= {key: given[key] for key in ("type_id", "label") if key in given}
        row["from_id"] = given.get("from_", row["from_id"])
        row["to_id"] = given.get("to", row["to_id"])
        _put_edge(result, old, row)
    return result


def _given(patch: BoxPatch | EdgePatch) -> dict[str, Any]:
    """The fields a change gives, apart from its id (and a box's spots)."""
    return {name: getattr(patch, name) for name in patch.model_fields_set - {"id", "externals"}}


def _present(after: Flat, spots: Spots) -> Spots:
    """Spots of boxes that are there; the others are dropped, as when reading a file."""
    return {k: p for k, p in spots.items() if k in after.parent}


def _change_box(
    result: Plan, stored: Stored, old: Box, fields: dict[str, Any], spots: Spots
) -> None:
    """`old` gets `fields` (title, position...: any of them), and `spots` for
    the external boxes on its canvas."""
    row = {"id": old.id, **{key: getattr(old, key) for key in _BOX_FIELDS}, "x": old.x, "y": old.y}
    row |= {key: fields[key] for key in _BOX_FIELDS if key in fields}
    position: Position | None = fields.get("position")
    if position is not None:
        row["x"], row["y"] = position.x, position.y
    moved = (old.x, old.y) != (row["x"], row["y"])
    edited = any(getattr(old, key) != row[key] for key in _BOX_FIELDS)
    if moved or edited:
        result.changed_boxes.append(row)
    change = BoxChange(old.id, moved=moved, edited=edited)
    spots = _present(result.after, spots)
    if spots != _present(result.after, stored.spots.get(old.id, {})):
        result.spots[old.id] = spots
        change = replace(change, arranged=True)
    result.box_changes[old.id] = change
    result.kept_boxes.append(old.id)
    result.after.title[old.id] = row["title"]


def _put_edge(result: Plan, old: Edge | None, row: dict[str, Any]) -> None:
    """Adds the connection `row`, or makes `old` into it; skipped when an end
    is not there."""
    after = result.after
    source, target = row["from_id"], row["to_id"]
    if source not in after.parent or target not in after.parent:
        result.skipped_edges.append(row["id"])
        return
    problem = connection_problem(after, source, target)
    if problem:
        _fail(f'Connection "{row["id"]}" is invalid: {problem}.')
    if old is None:
        result.new_edges.append(row)
        result.edge_changes.append((None, (source, target)))
    elif any(getattr(old, key) != row[key] for key in _EDGE_FIELDS):
        result.changed_edges.append(row)
        result.edge_changes.append(((old.from_id, old.to_id), (source, target)))
    after.edges[row["id"]] = {"from": source, "to": target, "label": row["label"]}
    result.kept_edges.append(row["id"])


def _parents_first(parent_of: dict[str, str], after: Flat, skipped: list[str]) -> list[str]:
    """The new boxes (`parent_of` gives the box each sits in) that can be
    added, each after the box it sits in. Those in a box that is not there
    (deleted meanwhile, or never was) go to `skipped`, with the new boxes
    inside them; boxes inside each other in a ring are refused."""
    order: list[str] = []
    placed: set[str] = set()
    left_out: set[str] = set()
    for box_id in parent_of:
        chain: list[str] = []
        current = box_id
        while current in parent_of and current not in placed and current not in left_out:
            if current in chain:
                _fail(f"Boxes are nested too deeply (more than {MAX_NESTING} levels).")
            chain.append(current)
            current = parent_of[current]
        ok = current in placed or (current not in left_out and current in after.parent)
        for item in reversed(chain):
            (placed if ok else left_out).add(item)
            (order if ok else skipped).append(item)
    return order


def _depth(flat: Flat, box_id: str) -> int:
    """How deep a box sits (the root's children are at 1), counting no
    further than one past MAX_NESTING."""
    steps, current = 0, flat.parent[box_id]
    while current is not None and steps <= MAX_NESTING:
        current, steps = flat.parent[current], steps + 1
    return steps


def _no_repeats(kind: str, changed: list[str], removed: list[str]) -> None:
    for item_id, count in (Counter(changed) + Counter(removed)).items():
        if count > 1:
            _fail(f'{kind} "{item_id}" is named more than once.')


def _fail(message: str) -> NoReturn:
    raise InvalidChange(message)
