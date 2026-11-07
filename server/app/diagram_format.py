"""Checks and normalizes a diagram document (the nested file format), and
turns it into the rows a diagram is stored in (app.models.diagram) and back.

The reader is a port of the frontend's in frontend/src/model/serialize.ts: the same rules
and the same error messages, so a file the editor opens is a document the
server accepts, and the other way round. Keep the two in step.
"""

import math
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, NoReturn

from app.diagram_tree import Flat, connection_problem
from app.models import Box, Edge, ExternalSpot

# The file format version the frontend writes (SCHEMA_VERSION in frontend/src/model/types.ts).
SCHEMA_VERSION = 5
OLDEST_READABLE_VERSION = 1
ROOT_TITLE = "Root"
# Every box has this size on its canvas (BOX_WIDTH / BOX_HEIGHT in frontend/src/model/types.ts).
BOX_WIDTH = 240
BOX_HEIGHT = 140
# How many levels of boxes may sit below the root. Far beyond any real diagram
# (C4 has four). Each level is two levels of JSON (box + children list), and
# Pydantic refuses to encode JSON deeper than 100, so without this cap a
# document could be stored and then never read back. Tested end to end.
MAX_NESTING = 40


class DiagramFormatError(ValueError):
    pass


def empty_document() -> dict[str, Any]:
    """What the editor's File > New starts from."""
    return {
        "schemaVersion": SCHEMA_VERSION,
        "root": {
            "id": str(uuid.uuid4()),
            "title": ROOT_TITLE,
            "position": {"x": 0, "y": 0},
            "children": [],
            "edges": [],
        },
    }


def normalize_document(data: Any) -> dict[str, Any]:
    """Validates `data` and returns a clean copy in the current format.

    Like the editor, it reads every older version (each only adds to the one
    before), writes the current one, and drops fields it does not know. Raises
    DiagramFormatError with a readable message.
    """
    if not isinstance(data, dict) or "root" not in data or "schemaVersion" not in data:
        _fail("This is not a Nestboard file.")
    version = data["schemaVersion"]
    if not _is_number(version):
        _fail("This is not a Nestboard file.")
    if version > SCHEMA_VERSION:
        _fail(
            f"This file was made by a newer version of Nestboard (format {_num(version)}). "
            "Please update the app."
        )
    is_whole = not isinstance(version, float) or version.is_integer()
    if not is_whole or version < OLDEST_READABLE_VERSION:
        _fail(f"Unsupported file format version: {_num(version)}.")

    flat = Flat("")
    raw_edges: list[tuple[Any, str, str, list[dict[str, Any]]]] = []
    with_spots: list[dict[str, Any]] = []

    # Iterative walk, so nesting is checked against MAX_NESTING before
    # anything could hit Python's recursion limit.
    out_root: dict[str, Any] = {}
    stack: list[tuple[Any, str | None, str, dict[str, Any], int]] = [
        (data["root"], None, "root", out_root, 0)
    ]
    while stack:
        raw, parent_id, where, out, depth = stack.pop()
        if depth > MAX_NESTING:
            _fail(f"Boxes are nested too deeply (more than {MAX_NESTING} levels).")
        node_id = _read_node(raw, where, out)
        if node_id in flat.parent:
            _fail(f'Duplicate box id "{node_id}".')
        flat.add(node_id, parent_id, out["title"])
        if "externals" in out:
            with_spots.append(out)

        for i, edge in enumerate(raw["edges"]):
            raw_edges.append((edge, node_id, f"{where}.edges[{i}]", out["edges"]))
        out["children"] = [{} for _ in raw["children"]]
        # Pushed in reverse so boxes are checked in file order.
        for i in range(len(raw["children"]) - 1, -1, -1):
            child = raw["children"][i]
            stack.append((child, node_id, f"{where}.children[{i}]", out["children"][i], depth + 1))

    # Spots for external boxes that are not in the file cannot be shown: dropped.
    for out in with_spots:
        known = {k: p for k, p in out["externals"].items() if k in flat.parent}
        if known:
            out["externals"] = known
        else:
            del out["externals"]

    # Connections are checked once every box is known, so a broken box is
    # reported as itself rather than as a connection pointing at it.
    edge_ids: set[str] = set()
    for raw, canvas_id, where, out_edges in raw_edges:
        edge = _read_edge(raw, canvas_id, flat, where)
        if edge["id"] in edge_ids:
            _fail(f'Duplicate connection id "{edge["id"]}".')
        edge_ids.add(edge["id"])
        out_edges.append(edge)

    return {"schemaVersion": SCHEMA_VERSION, "root": out_root}


@dataclass
class Rows:
    """A document as table rows (column values by name, without diagram_id),
    in the order the editor reads the file: each box before the boxes inside
    it, siblings in file order, connections canvas by canvas."""

    boxes: list[dict[str, Any]] = field(default_factory=list)
    edges: list[dict[str, Any]] = field(default_factory=list)
    spots: list[dict[str, Any]] = field(default_factory=list)


def to_rows(document: dict[str, Any]) -> Rows:
    """The rows of a normalized document."""
    rows = Rows()
    stack: list[tuple[dict[str, Any], str | None]] = [(document["root"], None)]
    while stack:
        node, parent_id = stack.pop()
        rows.boxes.append(
            {
                "id": node["id"],
                "parent_id": parent_id,
                "title": node["title"],
                "type_id": node.get("typeId"),
                "technology": node.get("technology"),
                "description": node.get("description"),
                "x": node["position"]["x"],
                "y": node["position"]["y"],
            }
        )
        for box_id, spot in node.get("externals", {}).items():
            rows.spots.append({"canvas_id": node["id"], "box_id": box_id, **spot})
        for edge in node["edges"]:
            rows.edges.append(
                {
                    "id": edge["id"],
                    "from_id": edge["from"],
                    "to_id": edge["to"],
                    "type_id": edge.get("typeId"),
                    "label": edge.get("label"),
                }
            )
        # Pushed in reverse so boxes come in file order.
        stack.extend((child, node["id"]) for child in reversed(node["children"]))
    return rows


def to_document(
    boxes: Sequence[Box], edges: Sequence[Edge], spots: Sequence[ExternalSpot]
) -> dict[str, Any]:
    """The nested document of a stored diagram, in the current format: boxes
    and connections in the order given, each connection on the deepest box
    holding both its ends."""
    spots_on: dict[str, dict[str, Any]] = {}
    for spot in spots:
        spots_on.setdefault(spot.canvas_id, {})[spot.box_id] = {"x": spot.x, "y": spot.y}
    # Same field order as the editor writes.
    nodes: dict[str, dict[str, Any]] = {}
    flat = Flat("")
    root: dict[str, Any] | None = None
    for box in boxes:
        node: dict[str, Any] = {"id": box.id, "title": box.title}
        for key, value in (
            ("typeId", box.type_id),
            ("technology", box.technology),
            ("description", box.description),
        ):
            if value is not None:
                node[key] = value
        node["position"] = {"x": box.x, "y": box.y}
        if box.id in spots_on:
            node["externals"] = spots_on[box.id]
        node["children"], node["edges"] = [], []
        nodes[box.id] = node
        flat.add(box.id, box.parent_id, box.title)
    for box in boxes:
        if box.parent_id is None:
            root = nodes[box.id]
        else:
            nodes[box.parent_id]["children"].append(nodes[box.id])
    for edge in edges:
        out: dict[str, Any] = {"id": edge.id, "from": edge.from_id, "to": edge.to_id}
        if edge.type_id is not None:
            out["typeId"] = edge.type_id
        if edge.label is not None:
            out["label"] = edge.label
        canvas = flat.lowest_common_ancestor(edge.from_id, edge.to_id)
        assert canvas is not None  # both ends are boxes below the root
        nodes[canvas]["edges"].append(out)
    assert root is not None, "every diagram has a root box"
    return {"schemaVersion": SCHEMA_VERSION, "root": root}


def _read_node(raw: Any, where: str, out: dict[str, Any]) -> str:
    if not isinstance(raw, dict):
        _fail(f"Box at {where} is not an object.")
    node_id = raw.get("id")
    if not isinstance(node_id, str) or node_id == "":
        _fail(f"Box at {where} has no id.")
    if not isinstance(raw.get("title"), str):
        _fail(f'Box "{node_id}" has no title.')
    # Any non-empty string is accepted, known or not, and kept exactly as written.
    if "typeId" in raw and (not isinstance(raw["typeId"], str) or raw["typeId"] == ""):
        _fail(f'Box "{node_id}" has an invalid type.')
    if "technology" in raw and not isinstance(raw["technology"], str):
        _fail(f'Box "{node_id}" has an invalid technology.')
    if "description" in raw and not isinstance(raw["description"], str):
        _fail(f'Box "{node_id}" has an invalid description.')
    position = raw.get("position")
    if (
        not isinstance(position, dict)
        or not _is_finite(position.get("x"))
        or not _is_finite(position.get("y"))
    ):
        _fail(f'Box "{node_id}" has an invalid position.')
    externals = raw.get("externals")
    if "externals" in raw and not (
        isinstance(externals, dict)
        and all(
            isinstance(p, dict) and _is_finite(p.get("x")) and _is_finite(p.get("y"))
            for p in externals.values()
        )
    ):
        _fail(f'Box "{node_id}" has invalid places for external boxes.')
    if not isinstance(raw.get("children"), list):
        _fail(f'Box "{node_id}" is missing its children list.')
    if not isinstance(raw.get("edges"), list):
        _fail(f'Box "{node_id}" is missing its connections list.')

    out["id"] = node_id
    out["title"] = raw["title"]
    for key in ("typeId", "technology", "description"):
        if key in raw:
            out[key] = raw[key]
    out["position"] = {"x": position["x"], "y": position["y"]}
    if "externals" in raw:
        # Boxes not in the file are dropped once every box is known.
        out["externals"] = {k: {"x": p["x"], "y": p["y"]} for k, p in externals.items()}
    out["edges"] = []
    return node_id


def _read_edge(raw: Any, canvas_id: str, flat: Flat, where: str) -> dict[str, Any]:
    if not isinstance(raw, dict):
        _fail(f"Connection at {where} is not an object.")
    edge_id = raw.get("id")
    if not isinstance(edge_id, str) or edge_id == "":
        _fail(f"Connection at {where} has no id.")
    source, target = raw.get("from"), raw.get("to")
    if not (isinstance(source, str) and source in flat.parent) or not (
        isinstance(target, str) and target in flat.parent
    ):
        _fail(f'Connection "{edge_id}" must join two boxes in this file.')
    problem = connection_problem(flat, source, target)
    if problem:
        _fail(f'Connection "{edge_id}" is invalid: {problem}.')
    # Each connection is stored on the deepest box containing both ends.
    if flat.lowest_common_ancestor(source, target) != canvas_id:
        _fail(f'Connection "{edge_id}" is stored in the wrong box.')
    # Like box types: any non-empty string, known or not, kept exactly as written.
    type_id = raw.get("typeId")
    if "typeId" in raw and (not isinstance(type_id, str) or type_id == ""):
        _fail(f'Connection "{edge_id}" has an invalid type.')
    label = raw.get("label")
    if "label" in raw and not isinstance(label, str):
        _fail(f'Connection "{edge_id}" has an invalid label.')

    # Same field order as the editor writes.
    edge = {"id": edge_id, "from": source, "to": target}
    if "typeId" in raw:
        edge["typeId"] = type_id
    if "label" in raw:
        edge["label"] = label
    return edge


def _is_number(value: Any) -> bool:
    # bool is an int in Python; JSON true/false are not numbers.
    return isinstance(value, int | float) and not isinstance(value, bool)


def _is_finite(value: Any) -> bool:
    if not _is_number(value):
        return False
    try:
        # An integer too large for a double becomes Infinity in the browser.
        return math.isfinite(float(value))
    except OverflowError:
        return False


def _num(value: int | float) -> str:
    """Formats a number the way JavaScript would print it in a message."""
    if isinstance(value, int):
        return str(value)
    return str(int(value)) if value.is_integer() else str(value)


def _fail(message: str) -> NoReturn:
    raise DiagramFormatError(message)
