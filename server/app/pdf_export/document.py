"""Puts an export together: a cover, the contents, then one page per diagram
in the order outline.py gives, each under its heading with the way to it, and
drawn as large as the page allows, turned sideways when that is larger.
Headings become the PDF's bookmarks, nested like the boxes."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from app.pdf_export import typst_code as typ
from app.pdf_export.canvas import Tree
from app.pdf_export.draw import Drawing, draw
from app.pdf_export.outline import Page, outline
from app.pdf_export.render import render

PaperName = Literal["a4", "letter"]


@dataclass(frozen=True)
class Paper:
    typst: str
    # Portrait, in mm.
    width: float
    height: float


PAPERS: dict[str, Paper] = {
    "a4": Paper("a4", 210, 297),
    "letter": Paper("us-letter", 215.9, 279.4),
}
# Page margins in mm; the bottom one holds the footer.
MARGIN = {"x": 18, "top": 20, "bottom": 22}
# Room on a diagram's page for its heading, the way to it and its caption.
HEADING_ROOM = 90
# Diagrams are never drawn larger than this, so a few boxes do not fill a page
# with giant type. (1 is the editor at 100%.)
MAX_SCALE = 0.75
_PT_PER_MM = 72 / 25.4


@dataclass(frozen=True)
class Cover:
    """What the first page says. Who exported it is left out: the PDF is meant
    to be passed around."""

    diagram: str
    project: str
    exported_at: datetime


def export_pdf(
    document: dict[str, Any],
    cover: Cover,
    *,
    start: str | None = None,
    paper: PaperName = "a4",
) -> bytes:
    """The PDF for a normalized document, from the root or from the box `start`.
    Raises outline.UnknownBox if there is no such box."""
    pdf = render(build(document, cover, start=start, paper=paper))
    assert isinstance(pdf, bytes)
    return pdf


def build(
    document: dict[str, Any],
    cover: Cover,
    *,
    start: str | None = None,
    paper: PaperName = "a4",
) -> str:
    """The Typst source of the export."""
    pages = outline(document, start)
    tree = Tree(document)
    size = PAPERS[paper]
    date = cover.exported_at
    parts = [
        "#show: "
        + typ.call(
            "nb-report.with",
            title=f"{cover.diagram} — {cover.project}",
            date=typ.Code(f"datetime(year: {date.year}, month: {date.month}, day: {date.day})"),
            paper=size.typst,
            margin={key: typ.Code(f"{mm}mm") for key, mm in MARGIN.items()},
            footer=cover.diagram,
        ),
        "#"
        + typ.call("nb-cover", cover.diagram, cover.project, _details(cover, tree, start, pages)),
    ]
    # The table of contents always follows the cover, even with nothing to list.
    contents = (
        "outline(title: [Table of Contents], indent: auto)"
        if pages
        else "heading(outlined: false, [Table of Contents]); "
        + typ.call("text", "There are no boxes to show.", fill=typ.Code("nb-muted"))
    )
    parts.append(f"#page({{counter(page).update(1); {contents}}})")
    parts += [_page(page, draw(tree.layout(page.node["id"])), size) for page in pages]
    return "\n".join(parts) + "\n"


def _details(
    cover: Cover, tree: Tree, start: str | None, pages: list[Page]
) -> list[tuple[str, str]]:
    shows = "The whole diagram"
    if start is not None and start != tree.root["id"]:
        shows = "Inside " + " › ".join(tree.titles(start))
    count = f"{len(pages)} {'diagram' if len(pages) == 1 else 'diagrams'}"
    return [
        ("Shows", f"{shows}, {count}"),
        # Day month year, as everywhere in Nestboard: "02 Nov 2026".
        ("Exported on", f"{cover.exported_at:%d %b %Y}"),
    ]


def _page(page: Page, drawing: Drawing, paper: Paper) -> str:
    flipped, scale = fit(drawing, paper)
    percent = typ.Code(f"{typ.num(scale * 100)}%")
    figure = typ.call(
        "figure",
        typ.Code(typ.call("scale", typ.Code(drawing.code), x=percent, y=percent, reflow=True)),
        kind="diagram",
        supplement="Diagram",
        caption=page.title,
    )
    lines = [typ.call("heading", page.title, level=page.level)]
    if page.trail:
        lines.append(typ.call("nb-trail", " › ".join(page.trail)))
    lines.append(figure)
    return "#" + typ.call("page", typ.Code(typ.block(lines)), flipped=flipped)


def fit(drawing: Drawing, paper: Paper) -> tuple[bool, float]:
    """Whether to turn the page sideways, and how much to scale the drawing,
    to show it as large as possible. Upright when both fit as well."""
    best = (False, 0.0)
    for flipped in (False, True):
        width, height = (paper.height, paper.width) if flipped else (paper.width, paper.height)
        room_x = (width - 2 * MARGIN["x"]) * _PT_PER_MM
        room_y = (height - MARGIN["top"] - MARGIN["bottom"]) * _PT_PER_MM - HEADING_ROOM
        scale = min(MAX_SCALE, room_x / drawing.width, room_y / drawing.height)
        if scale > best[1] + 1e-9:
            best = (flipped, scale)
    return best
