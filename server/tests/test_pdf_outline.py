import json
from pathlib import Path

import pytest

from app.diagram_format import MAX_NESTING, SCHEMA_VERSION, normalize_document
from app.pdf_export.outline import UnknownBox, outline, reading_order

EXAMPLES = Path(__file__).resolve().parents[2] / "examples"


def box(title, children=(), x=0, y=0):
    return {
        "id": title,
        "title": title,
        "position": {"x": x, "y": y},
        "children": list(children),
        "edges": [],
    }


def row(*boxes):
    """Lays boxes out left to right, so their reading order is the order given."""
    for i, b in enumerate(boxes):
        b["position"] = {"x": i * 300, "y": 0}
    return list(boxes)


def leaves(prefix, count):
    return row(*(box(f"{prefix}.{i}") for i in range(1, count + 1)))


def document(*children):
    return normalize_document({"schemaVersion": SCHEMA_VERSION, "root": box("Root", children)})


def services():
    """The example from the plan: three services, nested two levels deep."""
    return document(
        *row(
            box(
                "Service 1",
                row(
                    box("Service 1.1", leaves("Service 1.1", 3)),
                    box("Service 1.2", leaves("Service 1.2", 2)),
                    box("Service 1.3"),
                ),
            ),
            box(
                "Service 2",
                row(
                    box("Service 2.1", leaves("Service 2.1", 2)),
                    box("Service 2.2", leaves("Service 2.2", 3)),
                ),
            ),
            box("Service 3", leaves("Service 3", 4)),
        )
    )


def summary(pages):
    return [(p.number, p.level, p.title) for p in pages]


def test_diagrams_come_depth_first_like_a_report():
    assert summary(outline(services())) == [
        (1, 1, "Root level"),
        (2, 1, "Service 1"),
        (3, 2, "Service 1.1"),
        (4, 2, "Service 1.2"),
        (5, 1, "Service 2"),
        (6, 2, "Service 2.1"),
        (7, 2, "Service 2.2"),
        (8, 1, "Service 3"),
    ]


def test_each_page_draws_its_box_canvas_and_knows_the_way_there():
    pages = outline(services())
    assert [c["title"] for c in pages[0].node["children"]] == [
        "Service 1",
        "Service 2",
        "Service 3",
    ]
    assert [c["title"] for c in pages[2].node["children"]] == [
        "Service 1.1.1",
        "Service 1.1.2",
        "Service 1.1.3",
    ]
    assert pages[0].trail == ()
    assert pages[1].trail == ("Root",)
    assert pages[2].trail == ("Root", "Service 1")


def test_each_level_deeper_is_one_heading_smaller():
    deepest = box("Level 5", leaves("Level 5", 1))
    for n in (4, 3, 2, 1):
        deepest = box(f"Level {n}", [deepest])
    assert summary(outline(document(deepest))) == [
        (1, 1, "Root level"),
        (2, 1, "Level 1"),
        (3, 2, "Level 2"),
        (4, 3, "Level 3"),
        (5, 4, "Level 4"),
        (6, 5, "Level 5"),
    ]


def test_the_deepest_diagram_a_document_can_hold():
    deepest = box(f"Level {MAX_NESTING}")
    for n in range(MAX_NESTING - 1, 0, -1):
        deepest = box(f"Level {n}", [deepest])
    pages = outline(document(deepest))
    assert len(pages) == MAX_NESTING
    assert pages[-1].level == MAX_NESTING - 1
    assert len(pages[-1].trail) == MAX_NESTING - 1


def test_an_empty_diagram_has_no_pages():
    assert outline(document()) == []


def test_starting_from_a_box_exports_only_its_inside():
    pages = outline(services(), start="Service 2")
    assert summary(pages) == [
        (1, 1, "Service 2"),
        (2, 1, "Service 2.1"),
        (3, 1, "Service 2.2"),
    ]
    assert pages[0].trail == ("Root",)
    assert pages[1].trail == ("Root", "Service 2")


def test_starting_deeper_still_counts_levels_from_the_start():
    pages = outline(services(), start="Service 1")
    assert summary(pages) == [
        (1, 1, "Service 1"),
        (2, 1, "Service 1.1"),
        (3, 1, "Service 1.2"),
    ]


def test_starting_from_the_root_by_id_is_the_whole_diagram():
    assert summary(outline(services(), start="Root")) == summary(outline(services()))


def test_starting_from_a_box_with_nothing_inside_has_no_pages():
    assert outline(services(), start="Service 1.3") == []


def test_starting_from_a_missing_box_fails():
    with pytest.raises(UnknownBox, match='no box "nope"'):
        outline(services(), start="nope")


def at(title, x, y):
    return box(title, x=x, y=y)


def titles(boxes):
    return [b["title"] for b in reading_order(boxes)]


def test_reading_order_is_rows_top_to_bottom_then_left_to_right():
    boxes = [at("D", 0, 400), at("B", 300, 0), at("C", 600, 0), at("A", 0, 0), at("E", 300, 400)]
    assert titles(boxes) == ["A", "B", "C", "D", "E"]


def test_slightly_uneven_boxes_still_read_as_one_row():
    # B sits a little higher than A but is to its right: same row, so A first.
    boxes = [at("B", 300, -30), at("A", 0, 20), at("C", 600, 60)]
    assert titles(boxes) == ["A", "B", "C"]


def test_a_box_half_a_box_lower_starts_a_new_row():
    boxes = [at("B", 0, 70), at("A", 300, 0)]
    assert titles(boxes) == ["A", "B"]
    boxes = [at("B", 0, 69), at("A", 300, 0)]
    assert titles(boxes) == ["B", "A"]


def test_boxes_in_the_same_place_keep_their_file_order():
    boxes = [at("first", 10, 10), at("second", 10, 10), at("third", 10, 10)]
    assert titles(boxes) == ["first", "second", "third"]


def test_sibling_diagrams_follow_reading_order_not_file_order():
    doc = document(
        box("Right", leaves("Right", 1), x=600, y=0),
        box("Bottom", leaves("Bottom", 1), x=0, y=400),
        box("Left", leaves("Left", 1), x=0, y=0),
    )
    assert [p.title for p in outline(doc)] == ["Root level", "Left", "Right", "Bottom"]


@pytest.mark.parametrize("name", sorted(p.name for p in EXAMPLES.glob("*.json")))
def test_example_files_have_an_outline(name):
    doc = normalize_document(json.loads((EXAMPLES / name).read_text(encoding="utf-8")))
    pages = outline(doc)
    assert pages[0].title == "Root level"
    assert [p.number for p in pages] == list(range(1, len(pages) + 1))
