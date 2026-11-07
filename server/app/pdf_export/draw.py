"""Draws one canvas as Typst code, looking like the editor at rest.

canvas.py says where everything goes; this module adds how it looks (the
editor's colours, line styles, arrowheads, icons and logos) and writes calls
to the drawing functions in canvas.typ, which lay out the text. Ported from:

    frontend/src/canvas/BoxNode.tsx         boxes
    frontend/src/canvas/ExternalBoxNode.tsx  boxes from other levels
    frontend/src/canvas/ConnectionEdge.tsx   lines and their labels
    frontend/src/canvas/LineMarkers.tsx      arrowheads and dots
    frontend/src/index.css                   line widths and dashes (.nb-stroke-*)

What a printed page cannot show is left out: hover and selection, moving
dashes, and the faint glow around lines.
"""

import math
from dataclasses import dataclass
from typing import Any

from app.diagram_format import BOX_HEIGHT, BOX_WIDTH
from app.pdf_export import typst_code as typ
from app.pdf_export import visuals
from app.pdf_export.canvas import Box, CanvasLayout, ExternalBox, Line, Point
from app.pdf_export.visuals import COLORS, ICON_TILE_TINT, LINES, ColorLogo, Logo

# Space around everything on the canvas.
PADDING = 40
# How faint lifted lines and their labels are (.nb-lifted), and external boxes
# (opacity-75 in ExternalBoxNode.tsx).
LIFTED_OPACITY: float = LINES["liftedOpacity"]
EXTERNAL_OPACITY = 0.75
# Markers are drawn in a 10×10 box shown 12×12 (LineMarkers.tsx).
MARKER_SCALE = 1.2
# Where the core of a double line stops short of each end (DOUBLE_END_GAP in
# ConnectionEdge.tsx).
DOUBLE_END_GAP = 12
# The widest a connection's label gets (max-w-48 in ConnectionEdge.tsx).
LABEL_MAX_WIDTH = 192
# Roughly how far a label reaches around its centre, for the canvas bounds.
_LABEL_REACH = (LABEL_MAX_WIDTH / 2, 12)


@dataclass(frozen=True)
class Drawing:
    """Typst code that draws a canvas `width` × `height` pt (editor pixels).
    `code` is a code block: write `#` before it in markup. It expects
    canvas.typ to be imported."""

    width: float
    height: float
    code: str


def draw(layout: CanvasLayout) -> Drawing:
    left, top, right, bottom = _bounds(layout)
    shift = (PADDING - left, PADDING - top)
    svgs = _Svgs()
    calls = (
        [_line(line, shift, svgs) for line in layout.lines]
        + [label for line in layout.lines if (label := _label(line, shift, svgs))]
        + [_box(box, shift, svgs) for box in layout.boxes]
        + [_external(external, shift, svgs) for external in layout.external]
    )
    width, height = right - left + 2 * PADDING, bottom - top + 2 * PADDING
    canvas = typ.call(
        "nb-canvas",
        width,
        height,
        COLORS["canvas"],
        COLORS["canvas-dot"],
        typ.Code(typ.block(calls)),
    )
    return Drawing(width, height, typ.block([f"let svg = {typ.value(svgs.items)}", canvas]))


# ---- Boxes ----


def _box(box: Box, shift: Point, svgs: "_Svgs") -> str:
    node = box.node
    resolved = visuals.box_type(node.get("typeId"))
    kind = resolved.type
    look = "default"
    if resolved.known and kind.id in ("group", "note"):
        look = kind.id
    colors = {
        "canvas": COLORS["canvas"],
        "fill": COLORS["note"] if look == "note" else COLORS["surface-raised"],
        "border": {"group": COLORS["line-strong"], "note": COLORS["note-edge"]}.get(
            look, COLORS["line"]
        ),
        "title": COLORS["fg"],
    }
    if look == "group":
        colors["fill"] = _alpha(colors["fill"], 0.35)
    options: dict[str, Any] = {"look": look, "colors": colors}
    if look == "note":
        # The folded corner (.nb-note): a 225° gradient, canvas for 9px then
        # the edge colour to 14px, cuts the corner at 45°.
        options["fold"] = {"inner": 9 * math.sqrt(2), "outer": 14 * math.sqrt(2)}

    # Generic boxes have no label; unknown types show the id they were saved with.
    if not resolved.known:
        options["label"] = {
            "known": False,
            "text": resolved.stored_id,
            "color": COLORS["fg-muted"],
            "border": COLORS["line-strong"],
            "tile": _alpha(kind.category.color, ICON_TILE_TINT),
            "icon": svgs.icon(kind.icon, kind.category.color, 2.25),
            # The pill may be as wide as the box less 12px each side.
            "max": BOX_WIDTH - 24 - 2 - 8 - 16 - 4,
        }
    elif kind.id != visuals.GENERIC_BOX_TYPE.id:
        options["label"] = {
            "known": True,
            "text": kind.label,
            "color": kind.category.color,
            "tile": _alpha(kind.category.color, ICON_TILE_TINT),
            "icon": svgs.icon(kind.icon, kind.category.color, 2.25),
            "max": BOX_WIDTH - 24 - 8 - 16 - 4,
        }

    mark = visuals.technology_mark(node.get("technology"), on_note=look == "note")
    if isinstance(mark, Logo):
        options["tech"] = {"kind": "logo", "svg": svgs.logo(mark), "backing": None}
    elif isinstance(mark, ColorLogo):
        options["tech"] = {"kind": "logo", "svg": svgs.add(mark.svg), "backing": mark.backing}
    elif mark is not None:
        options["tech"] = {
            "kind": "monogram",
            "text": mark.text,
            "fill": COLORS["surface-hover"],
            "color": COLORS["fg-muted"],
        }

    if box.child_count:
        options["count"] = {
            "n": box.child_count,
            "fill": _hex(COLORS["accent-soft"]),
            "color": COLORS["accent"],
            "icon": svgs.icon("layers", COLORS["accent"], 2),
        }
    return typ.call("nb-box", *_moved((box.rect.x, box.rect.y), shift), node["title"], **options)


def _external(external: ExternalBox, shift: Point, svgs: "_Svgs") -> str:
    kind = visuals.box_type(external.node.get("typeId")).type
    faded = EXTERNAL_OPACITY
    return typ.call(
        "nb-external",
        *_moved((external.rect.x, external.rect.y), shift),
        external.node["title"],
        external.location,
        colors={
            "fill": _alpha(COLORS["surface"], 0.6 * faded),
            "border": _alpha(COLORS["line-strong"], faded),
            "tile": _alpha(kind.category.color, ICON_TILE_TINT * faded),
            "title": _alpha(COLORS["fg"], faded),
            "location": _alpha(COLORS["fg-subtle"], faded),
        },
        icon=svgs.icon(kind.icon, kind.category.color, 2, opacity=faded),
    )


# ---- Lines ----


def _line(line: Line, shift: Point, svgs: "_Svgs") -> str:
    style = visuals.edge_type(line.edge.get("typeId")).type.style
    opacity = LIFTED_OPACITY if line.lifted else 1
    color = _alpha(COLORS["connection"], opacity)
    points = [_moved(p, shift) for p in _points(line)]
    strokes = LINES["strokes"]
    spec = strokes.get(style.stroke, strokes["solid"])
    stroke: dict[str, Any] = {
        "paint": typ.Code(f'rgb("{color}")'),
        "thickness": typ.pt(spec["width"]),
    }
    if "dash" in spec:
        stroke["dash"] = {"array": tuple(typ.pt(d) for d in spec["dash"])}
    if "cap" in spec:
        stroke["cap"] = spec["cap"]
    options: dict[str, Any] = {}
    if style.stroke == "double":
        # A canvas-coloured core over a wide line, stopping short of both ends
        # so it does not cut through the arrowheads.
        length = _curve_length(points)
        core = max(length - 2 * DOUBLE_END_GAP, 0)
        options["core"] = {
            "paint": typ.Code(f'rgb("{COLORS["canvas"]}")'),
            "thickness": typ.pt(LINES["doubleCoreWidth"]),
            "dash": {"array": (typ.pt(0), typ.pt(DOUBLE_END_GAP), typ.pt(core), typ.pt(100000))},
        }
    ends = [
        end
        for kind, at, toward in (
            (style.start, points[0], points[1]),
            (style.end, points[3], points[2]),
        )
        if (end := _marker(kind, at, toward, points, color))
    ]
    return typ.call("nb-line", points, stroke, ends=ends, **options)


def _marker(kind: str, at: Point, toward: Point, points: list[Point], color: str) -> dict | None:
    """An arrowhead or dot where a line meets a box. Markers point out of the
    line at either end (orient="auto-start-reverse")."""
    if kind == "none":
        return None
    if kind == "dot":
        return {"kind": "dot", "center": at, "radius": 4.5 * MARKER_SCALE, "color": color}
    # The way the line runs into this end; straight from the other end when
    # the control point sits on the end itself.
    dx, dy = at[0] - toward[0], at[1] - toward[1]
    if math.hypot(dx, dy) < 1e-9:
        other = points[0] if at == points[3] else points[3]
        dx, dy = at[0] - other[0], at[1] - other[1]
    length = math.hypot(dx, dy) or 1
    ux, uy = dx / length, dy / length

    def place(u: float, v: float) -> Point:
        # Marker coordinates, with the reference point (9, 5) on the end.
        a, b = (u - 9) * MARKER_SCALE, (v - 5) * MARKER_SCALE
        return (at[0] + a * ux - b * uy, at[1] + a * uy + b * ux)

    if kind == "open-arrow":
        shape = [place(1, 1), place(9, 5), place(1, 9)]
        return {
            "kind": "open-arrow",
            "points": shape,
            "width": LINES["openArrowWidth"] * MARKER_SCALE,
            "color": color,
        }
    return {"kind": "arrow", "points": [place(0, 1), place(9, 5), place(0, 9)], "color": color}


def _label(line: Line, shift: Point, svgs: "_Svgs") -> str | None:
    resolved = visuals.edge_type(line.edge.get("typeId"))
    kind = resolved.type
    typed = kind.id != visuals.GENERIC_EDGE_TYPE.id
    # A typed line without a label of its own still says what it is.
    text = line.edge.get("label") or (kind.verb if typed else None)
    if not text:
        return None
    opacity = LIFTED_OPACITY if line.lifted else 1
    return typ.call(
        "nb-label",
        *_moved(line.label, shift),
        text,
        italic=not line.edge.get("label"),
        icon=svgs.icon(kind.icon, kind.category.color, 2, opacity=opacity) if typed else None,
        colors={
            "fill": _alpha(COLORS["surface-raised"], opacity),
            "border": _alpha(COLORS["line"], opacity),
            "text": _alpha(COLORS["fg-muted"], opacity),
        },
        max_width=LABEL_MAX_WIDTH,
    )


def _points(line: Line) -> list[Point]:
    s, t = line.source, line.target
    return [(s.x, s.y), line.controls[0], line.controls[1], (t.x, t.y)]


def _curve_length(points: list[Point], steps: int = 64) -> float:
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = points

    def at(t: float) -> Point:
        m = 1 - t
        return (
            m**3 * x0 + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t**3 * x3,
            m**3 * y0 + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t**3 * y3,
        )

    samples = [at(i / steps) for i in range(steps + 1)]
    return sum(math.dist(a, b) for a, b in zip(samples, samples[1:], strict=False))


# ---- Bounds ----


def _bounds(layout: CanvasLayout) -> tuple[float, float, float, float]:
    """Left, top, right and bottom of everything drawn, roughly for labels."""
    xs: list[float] = []
    ys: list[float] = []
    for box in layout.boxes:
        # The type label sits half above the top border.
        xs += [box.rect.x, box.rect.x + BOX_WIDTH]
        ys += [box.rect.y - 11, box.rect.y + BOX_HEIGHT]
    for external in layout.external:
        xs += [external.rect.x, external.rect.x + external.rect.width]
        ys += [external.rect.y, external.rect.y + external.rect.height]
    marker = 6 * MARKER_SCALE
    for line in layout.lines:
        for x, y in _points(line):
            xs += [x - marker, x + marker]
            ys += [y - marker, y + marker]
        xs += [line.label[0] - _LABEL_REACH[0], line.label[0] + _LABEL_REACH[0]]
        ys += [line.label[1] - _LABEL_REACH[1], line.label[1] + _LABEL_REACH[1]]
    if not xs:
        return 0, 0, BOX_WIDTH, BOX_HEIGHT
    return min(xs), min(ys), max(xs), max(ys)


# ---- Icons and logos ----


class _Svgs:
    """The SVG icons a canvas uses, each written once."""

    def __init__(self) -> None:
        self.items: list[typ.Code] = []
        self._index: dict[str, int] = {}

    def icon(self, key: str, color: str, width: float, opacity: float = 1) -> "typ.Code":
        return self.add(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" '
            f'stroke="{color}" stroke-opacity="{typ.num(opacity)}" stroke-width="{typ.num(width)}" '
            f'stroke-linecap="round" stroke-linejoin="round">{visuals.icon(key)}</svg>'
        )

    def logo(self, logo: Logo) -> "typ.Code":
        return self.add(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
            f'<path fill="{logo.color}" d="{logo.path}"/></svg>'
        )

    def add(self, svg: str) -> "typ.Code":
        if svg not in self._index:
            self._index[svg] = len(self.items)
            self.items.append(typ.Code(f"bytes({typ.value(svg)})"))
        return typ.Code(f"svg.at({self._index[svg]})")


# ---- Colours ----


def _hex(color: str) -> str:
    """A theme colour as #rrggbb or #rrggbbaa; accepts "rgb(79 107 255 / 0.16)"."""
    if color.startswith("#"):
        return color
    inside = color.removeprefix("rgb(").removesuffix(")")
    channels, _, alpha = inside.partition("/")
    r, g, b = (int(c) for c in channels.split())
    return _alpha(f"#{r:02x}{g:02x}{b:02x}", float(alpha) if alpha else 1)


def _alpha(color: str, opacity: float) -> str:
    """`color` (#rrggbb or #rrggbbaa) made `opacity` times as opaque."""
    color = _hex(color)
    base = int(color[7:9], 16) / 255 if len(color) == 9 else 1
    value = round(base * opacity * 255)
    return color[:7] if value >= 255 else f"{color[:7]}{value:02x}"


def _moved(point: Point, shift: Point) -> Point:
    return point[0] + shift[0], point[1] + shift[1]
