import copy
import json
from pathlib import Path

import pytest

from app.diagram_format import (
    MAX_NESTING,
    SCHEMA_VERSION,
    DiagramFormatError,
    empty_document,
    normalize_document,
    to_document,
    to_rows,
)
from app.models import Box, Edge, ExternalSpot

EXAMPLES = Path(__file__).resolve().parents[2] / "examples"


def box(id, children=(), edges=(), **extra):
    return {
        "id": id,
        "title": id.upper(),
        "position": {"x": 0, "y": 0},
        "children": list(children),
        "edges": list(edges),
        **extra,
    }


def valid_file():
    """root > (a > a1, a2), b. Sibling edge a-b on root, cross-level a1-b on root."""
    return {
        "schemaVersion": SCHEMA_VERSION,
        "root": box(
            "root",
            children=[box("a", children=[box("a1"), box("a2")]), box("b")],
            edges=[
                {"id": "e1", "from": "a", "to": "b", "label": "calls"},
                {"id": "e2", "from": "a1", "to": "b"},
            ],
        ),
    }


def error_of(data):
    with pytest.raises(DiagramFormatError) as info:
        normalize_document(data)
    return str(info.value)


def file_with(patch):
    data = valid_file()
    patch(data)
    return data


def child(data, i=0):
    return data["root"]["children"][i]


def test_accepts_a_valid_file_unchanged():
    assert normalize_document(valid_file()) == valid_file()


def test_accepts_the_example_gallery():
    data = json.loads((EXAMPLES / "box-types-gallery.json").read_text(encoding="utf-8"))
    out = normalize_document(data)
    assert out["schemaVersion"] == SCHEMA_VERSION
    assert out["root"]["children"][0]["typeId"] == "actor"


def test_empty_document_is_valid():
    doc = empty_document()
    assert normalize_document(doc) == doc
    assert doc["root"]["title"] == "Root"
    assert empty_document()["root"]["id"] != doc["root"]["id"]


def test_keeps_where_external_boxes_were_put_and_forgets_boxes_not_in_the_file():
    data = valid_file()
    child(data)["externals"] = {"b": {"x": 600, "y": -40}, "gone": {"x": 1, "y": 1}}
    out = normalize_document(data)
    assert child(out)["externals"] == {"b": {"x": 600, "y": -40}}

    data = valid_file()
    child(data)["externals"] = {"gone": {"x": 1, "y": 1}}
    assert "externals" not in child(normalize_document(data))


@pytest.mark.parametrize(
    "externals",
    [
        [],
        {"b": {"x": 1}},
        {"b": {"x": "1", "y": 0}},
        {"b": None},
        {"b": {"x": float("nan"), "y": 0}},
    ],
)
def test_rejects_malformed_places_for_external_boxes(externals):
    data = valid_file()
    child(data)["externals"] = externals
    assert error_of(data) == 'Box "a" has invalid places for external boxes.'


@pytest.mark.parametrize("version", [1, 2, 3, 4])
def test_reads_older_versions_and_writes_the_current_one(version):
    data = {"schemaVersion": version, "root": box("root", children=[box("a")])}
    assert normalize_document(data)["schemaVersion"] == SCHEMA_VERSION


def test_drops_unknown_fields_but_keeps_unknown_type_ids():
    data = valid_file()
    data["extra"] = 1
    child(data)["color"] = "red"
    child(data)["typeId"] = "some-type-from-the-future"
    data["root"]["edges"][0]["style"] = "bold"
    data["root"]["edges"][0]["typeId"] = "connection-type-from-the-future"

    out = normalize_document(data)

    assert "extra" not in out
    assert "color" not in child(out)
    assert child(out)["typeId"] == "some-type-from-the-future"
    assert "style" not in out["root"]["edges"][0]
    assert out["root"]["edges"][0]["typeId"] == "connection-type-from-the-future"


def test_keeps_connection_types_in_the_editor_field_order():
    data = valid_file()
    # Written in a different order on purpose.
    data["root"]["edges"][0] = {
        "label": "calls",
        "typeId": "request",
        "to": "b",
        "from": "a",
        "id": "e1",
    }
    out = normalize_document(data)["root"]["edges"][0]
    assert list(out) == ["id", "from", "to", "typeId", "label"]
    assert out["typeId"] == "request"


def test_does_not_modify_its_input():
    data = valid_file()
    child(data)["color"] = "red"
    before = copy.deepcopy(data)
    normalize_document(data)
    assert data == before


def test_keeps_children_in_file_order():
    names = [f"n{i}" for i in range(10)]
    data = {"schemaVersion": 3, "root": box("root", children=[box(n) for n in names])}
    out = normalize_document(data)
    assert [c["id"] for c in out["root"]["children"]] == names


def nested(levels):
    """A root with a chain of `levels` boxes below it: n0 > n1 > ... > n<levels>."""
    root = node = box("n0")
    for i in range(1, levels + 1):
        node["children"].append(box(f"n{i}"))
        node = node["children"][0]
    return {"schemaVersion": SCHEMA_VERSION, "root": root}


def test_accepts_nesting_up_to_the_limit():
    data = nested(MAX_NESTING)
    # Give the deepest box a sibling and connect the two, so connections at
    # the deepest level are checked as well.
    deepest_parent = data["root"]
    for _ in range(MAX_NESTING - 1):
        deepest_parent = deepest_parent["children"][0]
    deepest_parent["children"].append(box("sibling"))
    deepest_parent["edges"].append({"id": "e", "from": f"n{MAX_NESTING}", "to": "sibling"})

    assert normalize_document(data) == data


def test_rejects_nesting_beyond_the_limit_without_recursing():
    message = f"Boxes are nested too deeply (more than {MAX_NESTING} levels)."
    assert error_of(nested(MAX_NESTING + 1)) == message
    # Far deeper than Python's recursion limit: still a clean error.
    assert error_of(nested(5000)) == message


@pytest.mark.parametrize(
    ("data", "message"),
    [
        ([], "This is not a Nestboard file."),
        ({"root": {}}, "This is not a Nestboard file."),
        ({"schemaVersion": "3", "root": {}}, "This is not a Nestboard file."),
        ({"schemaVersion": True, "root": {}}, "This is not a Nestboard file."),
        (
            {"schemaVersion": SCHEMA_VERSION + 1, "root": {}},
            f"This file was made by a newer version of Nestboard (format {SCHEMA_VERSION + 1}). "
            "Please update the app.",
        ),
        ({"schemaVersion": 0, "root": {}}, "Unsupported file format version: 0."),
        ({"schemaVersion": 1.5, "root": {}}, "Unsupported file format version: 1.5."),
    ],
)
def test_explains_files_that_are_not_readable(data, message):
    assert error_of(data) == message


def test_a_whole_float_version_is_accepted():
    data = valid_file()
    data["schemaVersion"] = 3.0
    assert normalize_document(data)["schemaVersion"] == SCHEMA_VERSION


@pytest.mark.parametrize(
    ("patch", "message"),
    [
        (lambda f: child(f).update(id=7), "Box at root.children[0] has no id."),
        (lambda f: child(f).update(id=""), "Box at root.children[0] has no id."),
        (
            lambda f: child(f)["children"].__setitem__(0, "x"),
            "Box at root.children[0].children[0] is not an object.",
        ),
        (lambda f: child(f).pop("title"), 'Box "a" has no title.'),
        (lambda f: child(f).update(typeId=42), 'Box "a" has an invalid type.'),
        (lambda f: child(f).update(typeId=""), 'Box "a" has an invalid type.'),
        (lambda f: child(f).update(typeId=None), 'Box "a" has an invalid type.'),
        (lambda f: child(f).update(technology=None), 'Box "a" has an invalid technology.'),
        (lambda f: child(f).update(description=1), 'Box "a" has an invalid description.'),
        (
            lambda f: child(f).update(position={"x": float("nan"), "y": 0}),
            'Box "a" has an invalid position.',
        ),
        (
            lambda f: child(f).update(position={"x": float("inf"), "y": 0}),
            'Box "a" has an invalid position.',
        ),
        (
            lambda f: child(f).update(position={"x": 10**400, "y": 0}),
            'Box "a" has an invalid position.',
        ),
        (
            lambda f: child(f).update(position={"x": True, "y": 0}),
            'Box "a" has an invalid position.',
        ),
        (
            lambda f: child(f).update(position={"x": "1", "y": 0}),
            'Box "a" has an invalid position.',
        ),
        (lambda f: child(f).update(position=[0, 0]), 'Box "a" has an invalid position.'),
        (lambda f: child(f).pop("children"), 'Box "a" is missing its children list.'),
        (lambda f: child(f).update(edges=None), 'Box "a" is missing its connections list.'),
        (lambda f: child(f, 1).update(id="a1"), 'Duplicate box id "a1".'),
    ],
)
def test_rejects_malformed_boxes(patch, message):
    assert error_of(file_with(patch)) == message


def edges(f):
    return f["root"]["edges"]


@pytest.mark.parametrize(
    ("patch", "message"),
    [
        (lambda f: edges(f).append("x"), "Connection at root.edges[2] is not an object."),
        (lambda f: edges(f)[0].update(id=""), "Connection at root.edges[0] has no id."),
        (
            lambda f: edges(f)[0].update(to="ghost"),
            'Connection "e1" must join two boxes in this file.',
        ),
        (
            lambda f: edges(f)[0].update(to=None),
            'Connection "e1" must join two boxes in this file.',
        ),
        (
            lambda f: edges(f)[0].update(to="a"),
            'Connection "e1" is invalid: a box cannot connect to itself.',
        ),
        (
            lambda f: edges(f)[0].update(to="a1"),
            'Connection "e1" is invalid: a box cannot connect to a box nested inside it.',
        ),
        (
            lambda f: edges(f)[0].update(**{"from": "a2", "to": "a"}),
            'Connection "e1" is invalid: a box cannot connect to a box nested inside it.',
        ),
        # a1-a2 are siblings inside "a", so the edge belongs on "a", not on the root.
        (
            lambda f: edges(f)[0].update(**{"from": "a1", "to": "a2"}),
            'Connection "e1" is stored in the wrong box.',
        ),
        (lambda f: edges(f)[1].update(id="e1"), 'Duplicate connection id "e1".'),
        (lambda f: edges(f)[0].update(label=5), 'Connection "e1" has an invalid label.'),
        (lambda f: edges(f)[0].update(typeId=7), 'Connection "e1" has an invalid type.'),
        (lambda f: edges(f)[0].update(typeId=""), 'Connection "e1" has an invalid type.'),
        (lambda f: edges(f)[0].update(typeId=None), 'Connection "e1" has an invalid type.'),
    ],
)
def test_rejects_malformed_connections(patch, message):
    assert error_of(file_with(patch)) == message


def test_a_broken_box_is_reported_before_connections_pointing_at_it():
    data = valid_file()
    data["root"]["children"][1]["title"] = None  # box "b", which e1 and e2 point at
    assert error_of(data) == 'Box "b" has no title.'


# ---- Rows ----


def from_rows(rows):
    """The document the rows make, as when reading a stored diagram."""
    return to_document(
        [Box(**row) for row in rows.boxes],
        [Edge(**row) for row in rows.edges],
        [ExternalSpot(**row) for row in rows.spots],
    )


def test_rows_list_each_box_before_the_boxes_inside_it_in_file_order():
    data = valid_file()
    child(data)["typeId"] = "service"
    child(data)["technology"] = "Go"
    child(data, 1)["externals"] = {"a1": {"x": 5, "y": 6}}

    rows = to_rows(normalize_document(data))

    assert [(b["id"], b["parent_id"]) for b in rows.boxes] == [
        ("root", None),
        ("a", "root"),
        ("a1", "a"),
        ("a2", "a"),
        ("b", "root"),
    ]
    assert rows.boxes[1] == {
        "id": "a",
        "parent_id": "root",
        "title": "A",
        "type_id": "service",
        "technology": "Go",
        "description": None,
        "x": 0,
        "y": 0,
    }
    assert rows.edges == [
        {"id": "e1", "from_id": "a", "to_id": "b", "type_id": None, "label": "calls"},
        {"id": "e2", "from_id": "a1", "to_id": "b", "type_id": None, "label": None},
    ]
    assert rows.spots == [{"canvas_id": "b", "box_id": "a1", "x": 5, "y": 6}]


def test_rows_make_the_same_document_again():
    data = valid_file()
    child(data)["externals"] = {"b": {"x": 1, "y": 2}}
    # Stored on the deepest box holding both ends.
    child(data)["edges"] = [{"id": "e3", "from": "a1", "to": "a2", "typeId": "request"}]

    assert from_rows(to_rows(normalize_document(data))) == data


@pytest.mark.parametrize("name", ["box-types-gallery.json", "connection-types-gallery.json"])
def test_the_example_galleries_survive_rows(name):
    gallery = normalize_document(json.loads((EXAMPLES / name).read_text(encoding="utf-8")))

    assert from_rows(to_rows(gallery)) == gallery
