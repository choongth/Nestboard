"""Where everything on one canvas goes: its boxes, the boxes from other levels
its connections lead to, and the curve of every line. A port of how the
editor draws a canvas at rest, so a PDF page looks like the editor:

    frontend/src/model/lift.ts             connectionsOn: which connections a canvas shows
    frontend/src/canvas/externalLayout.ts  externalBoxes (at rest): where external boxes go
    frontend/src/canvas/edgeGeometry.ts    facingAnchors, spreadAnchors: where lines attach
    frontend/src/canvas/Canvas.tsx         externalLocation: the way to an external box
    @xyflow/system getBezierPath           the curve, and the label's place on it

Keep them in step. tests/test_pdf_canvas.py compares this module with
tests/fixtures/editor_layout.json, which the editor's own code writes
(frontend/src/serverFiles.test.ts).
"""

import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Literal

from app.diagram_format import BOX_HEIGHT, BOX_WIDTH

EXTERNAL_WIDTH = 200
EXTERNAL_HEIGHT = 72
# Between external boxes, and between them and the canvas's own boxes.
EXTERNAL_GAP = 24
EXTERNAL_MARGIN = 160
# Between neighbouring lines joining the same two boxes.
PARALLEL_GAP = 26
CURVATURE = 0.25

Side = Literal["top", "right", "bottom", "left"]
Point = tuple[float, float]


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class Anchor:
    """Where a line meets a box: a point on one of its sides."""

    x: float
    y: float
    side: Side


@dataclass(frozen=True, eq=False)
class Box:
    """A box on the canvas."""

    node: dict[str, Any]
    rect: Rect
    # How many boxes are directly inside it (the badge in its corner).
    child_count: int


@dataclass(frozen=True, eq=False)
class ExternalBox:
    """A box elsewhere in the diagram that a connection on this canvas leads to."""

    node: dict[str, Any]
    rect: Rect
    # The way to it, e.g. "Payments › Ledger".
    location: str


@dataclass(frozen=True, eq=False)
class Line:
    """A connection as drawn: a cubic Bézier curve from `source` to `target`."""

    edge: dict[str, Any]
    # The boxes (or external boxes) it is drawn between, in its direction.
    from_id: str
    to_id: str
    # True when an end is nested deeper and drawn at the box containing it.
    lifted: bool
    source: Anchor
    target: Anchor
    controls: tuple[Point, Point]
    # The middle of the curve, where its label goes.
    label: Point


@dataclass(frozen=True, eq=False)
class CanvasLayout:
    boxes: list[Box]
    external: list[ExternalBox]
    lines: list[Line]


@dataclass(frozen=True)
class _Ends:
    """A connection on one canvas, before it has a shape."""

    edge: dict[str, Any]
    from_id: str
    to_id: str
    lifted: bool
    # Set for a connection leaving the canvas: its far end.
    outside: str | None


class Tree:
    """A normalized document, indexed once for laying out any of its canvases."""

    def __init__(self, document: dict[str, Any]) -> None:
        self.root: dict[str, Any] = document["root"]
        self.nodes: dict[str, dict[str, Any]] = {}
        # Ids from the root down to each box, inclusive.
        self._paths: dict[str, list[str]] = {}
        # Every connection, in the order the editor holds them (boxes depth first).
        self._edges: list[dict[str, Any]] = []
        self._index(self.root, [])
        # For each canvas, the connections with an end nested in it, in that order.
        self._touching: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for edge in self._edges:
            ends = self._paths[edge["from"]][:-1] + self._paths[edge["to"]][:-1]
            for canvas_id in dict.fromkeys(ends):
                self._touching[canvas_id].append(edge)

    def _index(self, node: dict[str, Any], above: list[str]) -> None:
        # Recursion is safe: documents are at most MAX_NESTING levels deep.
        path = [*above, node["id"]]
        self.nodes[node["id"]] = node
        self._paths[node["id"]] = path
        self._edges.extend(node["edges"])
        for child in node["children"]:
            self._index(child, path)

    def layout(self, canvas_id: str) -> CanvasLayout:
        canvas = self.nodes[canvas_id]
        boxes = [
            Box(
                child,
                Rect(child["position"]["x"], child["position"]["y"], BOX_WIDTH, BOX_HEIGHT),
                len(child["children"]),
            )
            for child in canvas["children"]
        ]
        lines, leaving = self._connections(canvas_id)
        external = self._external_boxes(canvas, leaving)

        rects = {b.node["id"]: b.rect for b in boxes} | {e.node["id"]: e.rect for e in external}
        drawn = []
        for ends, parallel in [*lines, *leaving]:
            source, target = spread_anchors(
                *facing_anchors(rects[ends.from_id], rects[ends.to_id]), *parallel
            )
            controls, label = bezier(source, target)
            drawn.append(
                Line(
                    ends.edge,
                    ends.from_id,
                    ends.to_id,
                    ends.lifted,
                    source,
                    target,
                    controls,
                    label,
                )
            )
        return CanvasLayout(boxes, external, drawn)

    def _connections(
        self, canvas_id: str
    ) -> tuple[list[tuple[_Ends, tuple[int, int]]], list[tuple[_Ends, tuple[int, int]]]]:
        """connectionsOn: lines between boxes on the canvas, and lines leaving it,
        each with its (index, count) among the lines joining the same two boxes."""

        def shown_by(node_id: str) -> str | None:
            # The box on this canvas containing the node (or the node itself).
            path = self._paths[node_id]
            for i in range(len(path) - 1):
                if path[i] == canvas_id:
                    return path[i + 1]
            return None

        lines: list[_Ends] = []
        leaving: list[_Ends] = []
        for edge in self._touching[canvas_id]:
            source, target = shown_by(edge["from"]), shown_by(edge["to"])
            if source is not None and target is not None:
                # Both ends in the same box: the connection is internal to it.
                if source != target:
                    lifted = source != edge["from"] or target != edge["to"]
                    lines.append(_Ends(edge, source, target, lifted, None))
            elif source is not None:
                lifted = source != edge["from"]
                leaving.append(_Ends(edge, source, edge["to"], lifted, edge["to"]))
            elif target is not None:
                lifted = target != edge["to"]
                leaving.append(_Ends(edge, edge["from"], target, lifted, edge["from"]))
        return _number_parallel(lines), _number_parallel(leaving)

    def _external_boxes(
        self, canvas: dict[str, Any], leaving: list[tuple[_Ends, tuple[int, int]]]
    ) -> list[ExternalBox]:
        """externalBoxes at rest: each far end of a line leaving the canvas
        where the user put it (the canvas box's `externals`), or else in a
        column to the right of the canvas's boxes."""
        far_ends = list(dict.fromkeys(ends.outside for ends, _ in leaving if ends.outside))
        if not far_ends:
            return []
        bounds = _children_bounds(canvas) or Rect(0, 0, BOX_WIDTH, BOX_HEIGHT)
        saved = canvas.get("externals", {})
        x = bounds.x + bounds.width + EXTERNAL_MARGIN
        step = EXTERNAL_HEIGHT + EXTERNAL_GAP
        placed = []
        column = 0
        for node_id in far_ends:
            spot = saved.get(node_id)
            if spot is None:
                spot = {"x": x, "y": bounds.y + column * step}
                column += 1
            rect = Rect(spot["x"], spot["y"], EXTERNAL_WIDTH, EXTERNAL_HEIGHT)
            placed.append(ExternalBox(self.nodes[node_id], rect, self._location(node_id)))
        return placed

    def titles(self, node_id: str) -> list[str]:
        """Titles from the root down to the box, inclusive."""
        return [self.nodes[i]["title"] for i in self._paths[node_id]]

    def _location(self, node_id: str) -> str:
        titles = self.titles(node_id)
        return " › ".join(titles[1:] if len(titles) > 2 else titles)


def _number_parallel(items: list[_Ends]) -> list[tuple[_Ends, tuple[int, int]]]:
    """Numbers the items that join the same two boxes, whichever way they point."""

    def pair(item: _Ends) -> tuple[str, str]:
        a, b = item.from_id, item.to_id
        return (a, b) if a < b else (b, a)

    counts: dict[tuple[str, str], int] = defaultdict(int)
    for item in items:
        counts[pair(item)] += 1
    seen: dict[tuple[str, str], int] = defaultdict(int)
    numbered = []
    for item in items:
        key = pair(item)
        numbered.append((item, (seen[key], counts[key])))
        seen[key] += 1
    return numbered


def _children_bounds(canvas: dict[str, Any]) -> Rect | None:
    """The area covered by the canvas's boxes (getChildrenBounds)."""
    if not canvas["children"]:
        return None
    xs = [c["position"]["x"] for c in canvas["children"]]
    ys = [c["position"]["y"] for c in canvas["children"]]
    x, y = min(xs), min(ys)
    return Rect(x, y, max(xs) + BOX_WIDTH - x, max(ys) + BOX_HEIGHT - y)


def facing_anchors(source: Rect, target: Rect) -> tuple[Anchor, Anchor]:
    """The middles of the sides the two boxes face each other with. Judged
    relative to the box shape, so wide boxes side by side join left to right."""
    dx = (target.x + target.width / 2) - (source.x + source.width / 2)
    dy = (target.y + target.height / 2) - (source.y + source.height / 2)
    horizontal = abs(dx) / (source.width + target.width) >= abs(dy) / (
        source.height + target.height
    )
    if horizontal:
        side: Side = "right" if dx >= 0 else "left"
    else:
        side = "bottom" if dy >= 0 else "top"
    return anchor(source, side), anchor(target, _OPPOSITE[side])


def anchor(box: Rect, side: Side) -> Anchor:
    match side:
        case "top":
            return Anchor(box.x + box.width / 2, box.y, side)
        case "bottom":
            return Anchor(box.x + box.width / 2, box.y + box.height, side)
        case "left":
            return Anchor(box.x, box.y + box.height / 2, side)
        case "right":
            return Anchor(box.x + box.width, box.y + box.height / 2, side)


_OPPOSITE: dict[Side, Side] = {"top": "bottom", "bottom": "top", "left": "right", "right": "left"}


def spread_anchors(source: Anchor, target: Anchor, index: int, count: int) -> tuple[Anchor, Anchor]:
    """Moves lines joining the same two boxes apart, side by side. Both ends
    move the same way whatever the line's direction, so a line and its
    opposite land on different tracks. A single line is unchanged."""
    offset = (index - (count - 1) / 2) * PARALLEL_GAP
    if offset == 0:
        return source, target

    def shift(a: Anchor) -> Anchor:
        if a.side in ("left", "right"):
            return Anchor(a.x, a.y + offset, a.side)
        return Anchor(a.x + offset, a.y, a.side)

    return shift(source), shift(target)


def bezier(source: Anchor, target: Anchor) -> tuple[tuple[Point, Point], Point]:
    """getBezierPath: the curve's two control points, and its middle (t = 0.5)."""
    c1 = _control(source, target)
    c2 = _control(target, source)
    label = (
        source.x * 0.125 + c1[0] * 0.375 + c2[0] * 0.375 + target.x * 0.125,
        source.y * 0.125 + c1[1] * 0.375 + c2[1] * 0.375 + target.y * 0.125,
    )
    return (c1, c2), label


def _control(at: Anchor, other: Anchor) -> Point:
    match at.side:
        case "left":
            return at.x - _control_offset(at.x - other.x), at.y
        case "right":
            return at.x + _control_offset(other.x - at.x), at.y
        case "top":
            return at.x, at.y - _control_offset(at.y - other.y)
        case "bottom":
            return at.x, at.y + _control_offset(other.y - at.y)


def _control_offset(distance: float) -> float:
    if distance >= 0:
        return 0.5 * distance
    return CURVATURE * 25 * math.sqrt(-distance)
