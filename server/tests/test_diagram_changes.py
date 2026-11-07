"""Working out what a save writes (app.diagram_changes). The rules it refuses
are covered through the API in test_diagrams_api.py."""

from app.box_rights import BoxChange
from app.diagram_changes import Stored, plan
from app.diagram_format import normalize_document, to_rows
from app.diagram_tree import Flat
from app.models import Box, Edge
from app.schemas.diagrams import Changes


def node(id, title, children=(), edges=(), **extra):
    return {
        "id": id,
        "title": title,
        "position": {"x": 0, "y": 0},
        **extra,
        "children": list(children),
        "edges": list(edges),
    }


# Shop ▸ (Payments ▸ Ledger, Orders), Web; Web → Payments; Shop shows Web at a spot.
DOC = normalize_document(
    {
        "schemaVersion": 5,
        "root": node(
            "root",
            "Root",
            [
                node(
                    "shop",
                    "Shop",
                    [
                        node("payments", "Payments", [node("ledger", "Ledger")]),
                        node("orders", "Orders"),
                    ],
                    externals={"web": {"x": 9, "y": 9}},
                ),
                node("web", "Web"),
            ],
            [{"id": "e1", "from": "web", "to": "payments"}],
        ),
    }
)
ROWS = to_rows(DOC)


def stored(changes: Changes) -> Stored:
    """What the service loads for `changes`."""
    named = {b.id for b in [*changes.added_boxes, *changes.changed_boxes]}
    named_edges = {e.id for e in [*changes.added_edges, *changes.changed_edges]}
    spots: dict = {}
    for spot in ROWS.spots:
        if spot["canvas_id"] in named:
            spots.setdefault(spot["canvas_id"], {})[spot["box_id"]] = (spot["x"], spot["y"])
    return Stored(
        Flat.of(
            [(b["id"], b["parent_id"], b["title"]) for b in ROWS.boxes],
            [(e["id"], e["from_id"], e["to_id"], e["label"]) for e in ROWS.edges],
        ),
        {b["id"]: Box(**b) for b in ROWS.boxes if b["id"] in named},
        {e["id"]: Edge(**e) for e in ROWS.edges if e["id"] in named_edges},
        spots,
    )


def box(id, parent_id, title="", x=0, y=0, **extra):
    return {"id": id, "parent_id": parent_id, "title": title, "position": {"x": x, "y": y}, **extra}


def planned(**changes):
    body = Changes.model_validate(changes)
    return plan(stored(body), body)


def test_each_box_says_what_changed_about_it():
    result = planned(
        changed_boxes=[
            {"id": "payments", "position": {"x": 50, "y": 0}},
            {"id": "orders", "title": "Sales"},
            {"id": "ledger", "title": "Ledger"},
            {"id": "shop", "externals": {"web": {"x": 1, "y": 1}}},
        ]
    )

    assert result.box_changes == {
        "payments": BoxChange("payments", moved=True),
        "orders": BoxChange("orders", edited=True),
        "ledger": BoxChange("ledger"),
        "shop": BoxChange("shop", arranged=True),
    }
    # Ledger and Shop's own fields are as stored: only Shop's spots are written.
    assert [row["id"] for row in result.changed_boxes] == ["payments", "orders"]
    assert result.changed_boxes[0] | {"x": 50} == result.changed_boxes[0]
    assert result.changed_boxes[1]["title"] == "Sales"
    assert result.spots == {"shop": {"web": (1, 1)}}
    assert result.after.title["orders"] == "Sales"
    assert result.kept_boxes == ["payments", "orders", "ledger", "shop"]


def test_a_box_added_again_is_changed_to_what_was_sent():
    result = planned(added_boxes=[box("orders", "shop", "Sales")])

    assert result.new_boxes == []
    assert result.box_changes == {"orders": BoxChange("orders", edited=True)}
    # Spots not sent are forgotten, as the box is sent whole.
    replaced_shop = planned(added_boxes=[box("shop", "root", "Shop")])
    assert replaced_shop.spots == {"shop": {}}


def test_deleting_a_box_deletes_what_is_inside_it():
    result = planned(removed_boxes=["payments"])

    assert result.removed_boxes == {"payments", "ledger"}
    assert "ledger" not in result.after.parent
    # Web → Payments goes with Payments.
    assert result.after.edges == {}
    assert result.gone_edges == {"e1"}
    assert result.removed_edges == set()


def test_a_spot_that_goes_with_its_deleted_box_is_no_change():
    # The editor forgets Shop's spot for Web when Web is deleted, and sends Shop.
    result = planned(
        removed_boxes=["web"], changed_boxes=[{"id": "shop", "externals": {"web": None}}]
    )

    assert result.box_changes["shop"] == BoxChange("shop")
    assert result.spots == {}


def test_new_boxes_are_written_after_the_boxes_they_sit_in():
    result = planned(
        added_boxes=[
            box("deepest", "deeper"),
            box("deeper", "new"),
            box("new", "ledger"),
            box("beside", "root"),
        ]
    )

    assert [row["id"] for row in result.new_boxes] == ["new", "deeper", "deepest", "beside"]
    assert all(change.added for change in result.box_changes.values())
    assert result.after.ancestors("deepest") == [
        "deeper",
        "new",
        "ledger",
        "payments",
        "shop",
        "root",
    ]


def test_whatever_sits_in_a_box_that_is_not_there_is_skipped():
    result = planned(
        added_boxes=[box("inner", "outer"), box("outer", "gone"), box("fine", "shop")],
        changed_boxes=[{"id": "gone", "title": "Back?"}],
        added_edges=[{"id": "e2", "from": "inner", "to": "web"}],
        changed_edges=[{"id": "e9", "label": "?"}],
    )

    assert [row["id"] for row in result.new_boxes] == ["fine"]
    assert sorted(result.skipped_boxes) == ["gone", "inner", "outer"]
    assert result.skipped_edges == ["e2", "e9"]
    assert (result.kept_boxes, result.kept_edges) == (["fine"], [])


def test_connections_say_how_they_were_and_how_they_are():
    unchanged = planned(changed_edges=[{"id": "e1", "label": None}])
    relabelled = planned(changed_edges=[{"id": "e1", "label": "pays"}])
    rewired = planned(changed_edges=[{"id": "e1", "to": "orders"}])
    deleted = planned(removed_edges=["e1"])

    assert (unchanged.changed_edges, unchanged.edge_changes) == ([], [])
    assert relabelled.edge_changes == [(("web", "payments"), ("web", "payments"))]
    assert relabelled.changed_edges[0]["label"] == "pays"
    assert rewired.edge_changes == [(("web", "payments"), ("web", "orders"))]
    assert deleted.edge_changes == [(("web", "payments"), None)]


def test_a_connection_deleted_with_its_box_is_new_again():
    result = planned(
        removed_boxes=["payments"], added_edges=[{"id": "e1", "from": "web", "to": "orders"}]
    )

    assert [row["id"] for row in result.new_edges] == ["e1"]
    assert result.changed_edges == []
    assert result.edge_changes == [(None, ("web", "orders"))]


def test_a_change_to_a_connection_deleted_with_its_box_is_skipped():
    result = planned(removed_boxes=["payments"], changed_edges=[{"id": "e1", "label": "pays"}])

    assert result.skipped_edges == ["e1"]
    assert result.edge_changes == []
