import json
from pathlib import Path

import pytest

from app.diagram_format import normalize_document
from app.pdf_export.canvas import (
    PARALLEL_GAP,
    Anchor,
    Rect,
    Tree,
    facing_anchors,
    spread_anchors,
)

# Written by the editor's own code: frontend/src/serverFiles.test.ts.
EDITOR = json.loads(
    (Path(__file__).parent / "fixtures" / "editor_layout.json").read_text(encoding="utf-8")
)
CANVASES = [
    pytest.param(d, c, id=f"{d['name']}:{c['canvas']}")
    for d in EDITOR["diagrams"]
    for c in d["canvases"]
]


def anchor_of(a):
    return {"x": pytest.approx(a.x), "y": pytest.approx(a.y), "side": a.side}


@pytest.mark.parametrize(("diagram", "expected"), CANVASES)
def test_canvases_are_laid_out_as_the_editor_does(diagram, expected):
    layout = Tree(normalize_document(diagram["document"])).layout(expected["canvas"])

    assert [b.node["id"] for b in layout.boxes] == expected["boxes"]
    assert [
        {"id": e.node["id"], "x": e.rect.x, "y": e.rect.y, "location": e.location}
        for e in layout.external
    ] == expected["external"]
    assert [
        {
            "edge": line.edge["id"],
            "from": line.from_id,
            "to": line.to_id,
            "lifted": line.lifted,
            "source": anchor_of(line.source),
            "target": anchor_of(line.target),
            "controls": [list(map(pytest.approx, c)) for c in line.controls],
            "label": list(map(pytest.approx, line.label)),
        }
        for line in layout.lines
    ] == expected["lines"]


def test_the_sample_covers_what_canvases_can_show():
    """So the comparison above means something."""
    shop = next(d for d in EDITOR["diagrams"] if d["name"] == "shop")
    lines = [line for c in shop["canvases"] for line in c["lines"]]
    assert {line["source"]["side"] for line in lines} == {"top", "right", "bottom", "left"}
    assert any(line["lifted"] for line in lines)
    assert any(not line["lifted"] for line in lines)
    assert any(c["external"] for c in shop["canvases"])
    # An external box the user moved, and others resting in the column.
    users = next(c for c in shop["canvases"] if c["canvas"] == "Users")
    at = {e["id"]: (e["x"], e["y"]) for e in users["external"]}
    assert at["Fraud"] == (620, -260)
    # The boxes inside Users end at x 840; the column starts at their top, without a gap.
    assert [at[k] for k in ("Admin", "Payments", "Wishlist", "Ledger")] == [
        (1000, 0),
        (1000, 96),
        (1000, 192),
        (1000, 288),
    ]
    pairs = [frozenset((line["from"], line["to"])) for line in lines]
    assert len(pairs) > len(set(pairs))  # some lines run side by side


def shop_tree():
    shop = next(d for d in EDITOR["diagrams"] if d["name"] == "shop")
    return Tree(normalize_document(shop["document"]))


def test_boxes_count_what_is_inside_them():
    layout = shop_tree().layout("Root")
    assert {b.node["id"]: b.child_count for b in layout.boxes} == {
        "Shop": 2,
        "Payments": 2,
        "Users": 4,
        "Admin": 0,
    }


def test_a_canvas_without_connections_has_no_lines_or_external_boxes():
    layout = shop_tree().layout("Payments")
    inside = shop_tree().layout("Cart")
    assert layout.lines and inside.external  # the sample connects both
    lonely = Tree(
        normalize_document(
            {
                "schemaVersion": 4,
                "root": {
                    "id": "r",
                    "title": "Root",
                    "position": {"x": 0, "y": 0},
                    "children": [
                        {
                            "id": "a",
                            "title": "A",
                            "position": {"x": 0, "y": 0},
                            "children": [],
                            "edges": [],
                        }
                    ],
                    "edges": [],
                },
            }
        )
    ).layout("r")
    assert [b.node["id"] for b in lonely.boxes] == ["a"]
    assert lonely.lines == [] and lonely.external == []


# The editor's own cases for edgeGeometry.ts, as a readable second check.


def box(x, y):
    return Rect(x, y, 240, 140)


def test_side_by_side_boxes_connect_right_to_left():
    source, target = facing_anchors(box(0, 0), box(400, 30))
    assert source == Anchor(240, 70, "right")
    assert target == Anchor(400, 100, "left")
    assert [a.side for a in facing_anchors(box(400, 0), box(0, 0))] == ["left", "right"]


def test_stacked_boxes_connect_bottom_to_top():
    assert facing_anchors(box(0, 0), box(50, 300))[0].side == "bottom"
    assert facing_anchors(box(0, 300), box(50, 0))[0].side == "top"


def test_diagonals_are_judged_by_the_box_shape():
    assert facing_anchors(box(0, 0), box(260, 200))[0].side == "bottom"
    assert facing_anchors(box(0, 0), box(600, 200))[0].side == "right"


def test_parallel_lines_are_spaced_around_the_middle():
    across = facing_anchors(box(0, 0), box(400, 0))
    down = facing_anchors(box(0, 0), box(0, 300))
    assert spread_anchors(*across, 0, 1) == across
    assert [spread_anchors(*across, i, 3)[0].y for i in range(3)] == [
        70 - PARALLEL_GAP,
        70,
        70 + PARALLEL_GAP,
    ]
    assert [spread_anchors(*down, i, 2)[0].x for i in range(2)] == [
        120 - PARALLEL_GAP / 2,
        120 + PARALLEL_GAP / 2,
    ]
