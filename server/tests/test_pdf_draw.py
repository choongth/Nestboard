import io
import json
import math
from pathlib import Path

import pytest
from pypdf import PdfReader

from app.diagram_format import normalize_document
from app.pdf_export import draw as drawing
from app.pdf_export import typst_code as typ
from app.pdf_export.canvas import Tree
from app.pdf_export.draw import PADDING, draw
from app.pdf_export.render import render

EDITOR = json.loads(
    (Path(__file__).parent / "fixtures" / "editor_layout.json").read_text(encoding="utf-8")
)


def page_text(source):
    """Renders a drawing on a page of its own and reads the text back."""
    pdf = render(f"#set page(width: auto, height: auto, margin: 0pt)\n#{source}")
    reader = PdfReader(io.BytesIO(pdf))
    assert len(reader.pages) == 1
    return reader.pages[0].extract_text()


def node(title, x=0, y=0, children=(), edges=(), **extra):
    return {
        "id": title,
        "title": title,
        "position": {"x": x, "y": y},
        "children": list(children),
        "edges": list(edges),
        **extra,
    }


def layout_of(*children, edges=()):
    document = normalize_document(
        {"schemaVersion": 4, "root": node("Root", children=children, edges=edges)}
    )
    root = document["root"]["id"]
    return Tree(document).layout(root)


@pytest.mark.parametrize(
    "diagram",
    [d for d in EDITOR["diagrams"] if d["name"] != "box-types-gallery.json"],
    ids=lambda d: d["name"],
)
def test_every_canvas_draws_with_its_titles_as_text(diagram):
    tree = Tree(normalize_document(diagram["document"]))
    for canvas in diagram["canvases"]:
        layout = tree.layout(canvas["canvas"])
        text = page_text(draw(layout).code)
        for box in layout.boxes + layout.external:
            assert box.node["title"] in text


def test_every_box_type_draws():
    gallery = next(d for d in EDITOR["diagrams"] if d["name"] == "box-types-gallery.json")
    layout = Tree(normalize_document(gallery["document"])).layout("root")
    text = page_text(draw(layout).code)
    assert "Orders DB" in text
    assert "RELATIONAL DATABASE" in text  # type labels are upper case
    assert "quantum-router" in text  # an unknown type shows the id it was saved with


def test_every_kind_of_technology_mark_draws():
    # One-colour, full-colour, full-colour on a light backing, maker's logo, two letters.
    techs = ["PostgreSQL", "AWS Lambda", "OpenAI", "Azure SQL Database", "HAProxy"]
    layout = layout_of(*(node(t, x=i * 300, technology=t) for i, t in enumerate(techs)))
    code = draw(layout).code
    assert code.count('backing: "#') == 1  # only OpenAI, which is black
    text = page_text(code)
    for t in techs:
        assert t in text


def test_titles_are_written_exactly_whatever_they_contain():
    tricky = 'Say "hi" \\ #set *bold* $x$ <a> @ref'
    text = page_text(draw(layout_of(node(tricky))).code)
    # It wraps onto two lines.
    assert tricky in " ".join(text.split())


def test_long_titles_stop_after_two_lines():
    long = " ".join(["Payments"] * 30)
    text = page_text(draw(layout_of(node(long))).code)
    assert text.count("Payments") < 10
    assert "…" in text


def test_long_labels_are_cut_short():
    long = "Sends every order event " * 10
    layout = layout_of(
        node("A"),
        node("B", x=600),
        edges=[{"id": "e", "from": "A", "to": "B", "label": long}],
    )
    text = page_text(draw(layout).code)
    assert "Sends every order" in text
    assert text.count("event") < 5
    assert "…" in text


def test_the_canvas_reaches_past_everything_drawn():
    layout = layout_of(node("A", x=-500, y=-300), node("B", x=400, y=200))
    result = draw(layout)
    assert result.width == 400 + 240 + 500 + 2 * PADDING
    # Half a type label (11) may sit above the top box.
    assert result.height == 200 + 140 + 300 + 11 + 2 * PADDING


def test_generic_boxes_have_no_type_label_and_unknown_ones_show_their_id():
    generic = draw(layout_of(node("Plain"))).code
    unknown = draw(layout_of(node("Odd", typeId="from-the-future"))).code
    assert "label:" not in generic
    assert 'text: "from-the-future"' in unknown and "known: false" in unknown


def test_lifted_lines_are_fainter():
    inner = node("Inner")
    layout = layout_of(
        node("A", children=[inner]),
        node("B", x=600),
        edges=[{"id": "e", "from": "Inner", "to": "B"}],
    )
    assert layout.lines[0].lifted
    assert drawing._alpha("#6b8cff", 0.5) in draw(layout).code


def test_arrowheads_point_at_the_box_at_the_end():
    layout = layout_of(
        node("A"),
        node("B", x=600),
        edges=[{"id": "e", "from": "A", "to": "B", "typeId": "request"}],
    )
    line = layout.lines[0]
    points = [(line.source.x, line.source.y), *line.controls, (line.target.x, line.target.y)]
    arrow = drawing._marker("arrow", points[3], points[2], points, "#fff")
    tip = arrow["points"][1]
    assert tip == pytest.approx(points[3])
    # The base is behind the tip, back along the line.
    assert all(p[0] < tip[0] for p in (arrow["points"][0], arrow["points"][2]))
    start = drawing._marker("arrow", points[0], points[1], points, "#fff")
    assert all(p[0] > start["points"][1][0] for p in (start["points"][0], start["points"][2]))
    dot = drawing._marker("dot", points[0], points[1], points, "#fff")
    assert dot["center"] == points[0]
    assert drawing._marker("none", points[0], points[1], points, "#fff") is None


def test_a_double_line_has_a_core_that_stops_short_of_both_ends():
    layout = layout_of(
        node("A"),
        node("B", x=600),
        edges=[{"id": "e", "from": "A", "to": "B", "typeId": "replication"}],
    )
    source = draw(layout).code
    assert "core:" in source
    # A straight line between the boxes: 600 - 240 long.
    assert drawing._curve_length([(240, 70), (420, 70), (420, 70), (600, 70)]) == pytest.approx(360)


def test_colours_are_read_as_the_editor_writes_them():
    assert drawing._hex("#242831") == "#242831"
    assert drawing._hex("rgb(79 107 255 / 0.16)") == "#4f6bff29"
    assert drawing._alpha("#242831", 0.35) == "#24283159"
    assert drawing._alpha("#4f6bff29", 0.5) == "#4f6bff14"
    assert drawing._alpha("#242831", 1) == "#242831"


def test_values_are_written_as_typst():
    value = typ.value
    assert value({"a": [1, 2.5], "b": None, "c": True, "d": (3,)}) == (
        "(a: (1, 2.5), b: none, c: true, d: (3,))"
    )
    assert value({}) == "(:)"
    assert value('a "b" \\ c\nd') == '"a \\"b\\" \\\\ c\\nd"'
    assert value(math.pi) == "3.142"
