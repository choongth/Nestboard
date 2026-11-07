"""How the editor shows things: its colours, box and connection types, icons
and technology logos. They come from visuals.json, which the editor's code
writes (frontend/src/serverFiles.test.ts); do not edit that file by hand.

Ported from the editor, and checked against it by tests/test_pdf_visuals.py:
    frontend/src/registry/registry.ts        resolving a stored type id
    frontend/src/registry/technologyLogos.ts  technologyMark, monogram
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_DATA: dict[str, Any] = json.loads(
    Path(__file__).with_name("visuals.json").read_text(encoding="utf-8")
)

# Theme colours by name, e.g. COLORS["surface-raised"] == "#242831".
COLORS: dict[str, str] = _DATA["colors"]
# How lines are drawn (index.css): for each stroke its width and maybe dash
# pattern and line cap; the core of double lines; open arrowheads; lifted lines.
LINES: dict[str, Any] = _DATA["lines"]
# How strongly a category colour tints the tile behind a type icon.
ICON_TILE_TINT: float = _DATA["iconTileTint"]


@dataclass(frozen=True)
class Category:
    label: str
    color: str


@dataclass(frozen=True)
class BoxType:
    id: str
    label: str
    category: Category
    # An icon key, for icon().
    icon: str


@dataclass(frozen=True)
class LineStyle:
    # "solid", "dashed", "long-dashed", "dotted" or "double".
    stroke: str
    # Moving dashes in the editor; a PDF cannot show them.
    flow: str
    # At the `from` end and the `to` end: "none", "arrow", "open-arrow" or "dot".
    start: str
    end: str


@dataclass(frozen=True)
class EdgeType:
    id: str
    label: str
    # What a typed line without a label of its own says: "Calls", "Reads from"…
    verb: str
    category: Category
    icon: str
    style: LineStyle


@dataclass(frozen=True)
class Resolved[T]:
    """What to show for a stored type id."""

    # The type itself, or the generic type when the id is missing or unknown.
    type: T
    # False when the stored id is not a type this version knows.
    known: bool
    stored_id: str | None


def _categories(data: dict[str, Any]) -> dict[str, Category]:
    return {key: Category(c["label"], c["color"]) for key, c in data["categories"].items()}


_box_categories = _categories(_DATA["boxTypes"])
_BOX_TYPES = {
    key: BoxType(key, t["label"], _box_categories[t["category"]], t["icon"])
    for key, t in _DATA["boxTypes"]["types"].items()
}
_edge_categories = _categories(_DATA["edgeTypes"])
_EDGE_TYPES = {
    key: EdgeType(
        key,
        t["label"],
        t["verb"],
        _edge_categories[t["category"]],
        t["icon"],
        LineStyle(**t["style"]),
    )
    for key, t in _DATA["edgeTypes"]["types"].items()
}
GENERIC_BOX_TYPE = _BOX_TYPES[_DATA["boxTypes"]["fallback"]]
GENERIC_EDGE_TYPE = _EDGE_TYPES[_DATA["edgeTypes"]["fallback"]]


def box_type(stored_id: str | None) -> Resolved[BoxType]:
    found = GENERIC_BOX_TYPE if stored_id is None else _BOX_TYPES.get(stored_id)
    return Resolved(found or GENERIC_BOX_TYPE, found is not None, stored_id)


def edge_type(stored_id: str | None) -> Resolved[EdgeType]:
    found = GENERIC_EDGE_TYPE if stored_id is None else _EDGE_TYPES.get(stored_id)
    return Resolved(found or GENERIC_EDGE_TYPE, found is not None, stored_id)


_ICONS: dict[str, str] = _DATA["icons"]


def icon(key: str) -> str:
    """A lucide icon's SVG elements, to go inside an <svg viewBox="0 0 24 24">
    that sets the stroke. Unknown keys get the generic box icon."""
    return _ICONS.get(key, _ICONS["box"])


# ---- Technology logos ----


@dataclass(frozen=True)
class Logo:
    """A one-colour logo (simple-icons)."""

    title: str
    # SVG path data, 24×24, to fill with `color`.
    path: str
    color: str


@dataclass(frozen=True)
class ColorLogo:
    """A full-colour logo (SVG Logos), drawn as it is."""

    title: str
    # Its key in SVG Logos, e.g. "aws-lambda".
    key: str
    # A whole <svg>, any aspect ratio.
    svg: str
    # What it sits on when parts of it are too dark for the box, else None.
    backing: str | None


@dataclass(frozen=True)
class Monogram:
    # Two letters, e.g. "HA" for HAProxy.
    text: str


_LOGO_BACKING: str = _DATA["logoBacking"]


def _normalise(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


# Each logo as drawn on a box and on a note, by every name it answers to.
_LOGOS_BY_NAME: dict[str, tuple[Logo | ColorLogo, Logo | ColorLogo]] = {}
for _logo in _DATA["logos"]:
    if _logo["set"] == "simple":
        _looks = (
            Logo(_logo["title"], _logo["path"], _logo["colorOnBox"]),
            Logo(_logo["title"], _logo["path"], _logo["colorOnNote"]),
        )
    else:
        _looks = tuple(
            ColorLogo(
                _logo["title"], _logo["key"], _logo["svg"], _LOGO_BACKING if _logo[backed] else None
            )
            for backed in ("backingOnBox", "backingOnNote")
        )
    for _name in _logo["names"]:
        _LOGOS_BY_NAME[_normalise(_name)] = _looks


def technology_mark(
    technology: str | None, on_note: bool = False
) -> Logo | ColorLogo | Monogram | None:
    """What to show for a box's technology: its logo, two letters when it has
    none, or None when no technology is set. One-colour logos are lightened
    to read on a box, or on a note when `on_note`; full-colour ones get a
    light backing there if they need one."""
    text = (technology or "").strip()
    if not text:
        return None
    # Exact name first; otherwise the leading words ("PostgreSQL 16", "Redis Cluster").
    words = text.split()
    for n in range(len(words), 0, -1):
        found = _LOGOS_BY_NAME.get(_normalise(" ".join(words[:n])))
        if found:
            return found[1] if on_note else found[0]
    return Monogram(monogram(text))


def monogram(text: str) -> str:
    """Two letters for a name: HAProxy → HA, AWS Lambda → AL, SQS → SQ."""
    words = re.findall(r"[^\W_]+", text)
    if not words:
        return "?"
    letters = words[0][0] + words[1][0] if len(words) >= 2 else words[0][:2]
    return letters.upper()
