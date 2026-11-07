"""Which canvases a PDF export shows, in what order, and under which headings.

Every canvas with boxes on it is one diagram: the root, or the inside of a box.
They come depth first, like the sections of a report: a box's diagram is
followed by the diagrams nested inside it before the next box's.

    Diagram 1  Root level      H1
    Diagram 2  Service 1       H1
    Diagram 3  Service 1.1     H2
    Diagram 4  Service 1.2     H2
    Diagram 5  Service 2       H1

The starting canvas and the boxes directly on it both get H1 (they are the
title and the chapters); each level deeper is one heading level smaller.
Boxes with nothing inside have no diagram of their own.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from app.diagram_format import BOX_HEIGHT

ROOT_HEADING = "Root level"


class UnknownBox(LookupError):
    pass


@dataclass(frozen=True, eq=False)
class Page:
    """One diagram of the export."""

    # "Diagram 1", "Diagram 2", … in reading order.
    number: int
    # 1 for H1. Not capped: how deep levels look is up to the renderer.
    level: int
    title: str
    # Titles of the boxes above, from the root down, e.g. ("Root", "Service 1").
    trail: tuple[str, ...]
    # The box (or root) whose canvas this page draws, from the normalized document.
    node: dict[str, Any]


def outline(document: dict[str, Any], start: str | None = None) -> list[Page]:
    """The pages for a normalized document, starting from the root or from the
    box with id `start` (only that box's inside and what is nested in it).
    Raises UnknownBox if there is no such box."""
    root = document["root"]
    if start is None:
        found: tuple[dict[str, Any], tuple[str, ...]] | None = (root, ())
    else:
        found = _find(root, start, ())
        if found is None:
            raise UnknownBox(f'There is no box "{start}" in this diagram.')
    node, trail = found
    pages: list[Page] = []
    for depth, n, t in _walk(node, trail, 0):
        title = ROOT_HEADING if n is root else n["title"]
        pages.append(Page(len(pages) + 1, max(1, depth), title, t, n))
    return pages


def reading_order(boxes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Boxes as a reader meets them on the canvas: in rows from top to bottom,
    each row left to right. A box is in a row when its top is less than half
    a box below the row's top box, so slightly uneven rows still read as rows.
    Boxes in exactly the same place keep their order in the file."""
    by_top = sorted(boxes, key=lambda b: (b["position"]["y"], b["position"]["x"]))
    rows: list[list[dict[str, Any]]] = []
    for b in by_top:
        if rows and b["position"]["y"] < rows[-1][0]["position"]["y"] + BOX_HEIGHT / 2:
            rows[-1].append(b)
        else:
            rows.append([b])
    return [b for row in rows for b in sorted(row, key=lambda b: b["position"]["x"])]


def _walk(
    node: dict[str, Any], trail: tuple[str, ...], depth: int
) -> Iterator[tuple[int, dict[str, Any], tuple[str, ...]]]:
    """(depth below the start, node, trail) for each canvas with boxes, depth first.
    Recursion is safe: documents are at most MAX_NESTING levels deep."""
    if not node["children"]:
        return
    yield depth, node, trail
    inner = (*trail, node["title"])
    for child in reading_order(node["children"]):
        yield from _walk(child, inner, depth + 1)


def _find(
    node: dict[str, Any], box_id: str, trail: tuple[str, ...]
) -> tuple[dict[str, Any], tuple[str, ...]] | None:
    if node["id"] == box_id:
        return node, trail
    for child in node["children"]:
        found = _find(child, box_id, (*trail, node["title"]))
        if found is not None:
            return found
    return None
