import asyncio
import uuid

import pytest
from conftest import as_document, diagrams_path

from app.diagram_format import MAX_NESTING, SCHEMA_VERSION

pytestmark = pytest.mark.usefixtures("project")

DOC = {
    "schemaVersion": SCHEMA_VERSION,
    "root": {
        "id": "root",
        "title": "Root",
        "position": {"x": 0, "y": 0},
        "children": [
            {
                "id": "web",
                "title": "Web",
                "typeId": "web-app",
                "technology": "React",
                "position": {"x": 0, "y": 0},
                "children": [],
                "edges": [],
            },
            {
                "id": "api",
                "title": "API",
                "position": {"x": 300, "y": 0},
                "externals": {"web": {"x": 900, "y": 100}},
                "children": [
                    {
                        "id": "handler",
                        "title": "Handler",
                        "position": {"x": 0, "y": 0},
                        "children": [],
                        "edges": [],
                    }
                ],
                "edges": [],
            },
        ],
        "edges": [{"id": "e1", "from": "web", "to": "handler", "typeId": "request"}],
    },
}


def box(id, parent_id, title="", **extra):
    """A box as the API sends and takes it."""
    return {
        "id": id,
        "parent_id": parent_id,
        "title": title,
        "type_id": None,
        "technology": None,
        "description": None,
        "position": {"x": 0, "y": 0},
        "externals": {},
        **extra,
    }


def edge(id, src, dst, **extra):
    return {"id": id, "from": src, "to": dst, "type_id": None, "label": None, **extra}


async def create(client, name="Shop", document=None):
    body = {"name": name} if document is None else {"name": name, "document": document}
    response = await client.post(diagrams_path(), json=body)
    assert response.status_code == 201, response.text
    return response.json()


async def change(client, diagram, **changes):
    """Saves `changes` (boxes, edges, removed_boxes, removed_edges) to the
    diagram as last read; returns the response."""
    return await client.post(
        f"/api/v1/diagrams/{diagram['id']}/changes",
        json={"version": diagram["version"], **changes},
    )


async def read(client, diagram):
    return (await client.get(f"/api/v1/diagrams/{diagram['id']}")).json()


def by_id(items):
    return {item["id"]: item for item in items}


def error(response):
    return response.json()["error"]


# ---- Creating and reading ----


async def test_create_without_a_document_starts_empty(client):
    diagram = await create(client, name="  Shop  ")

    assert diagram["name"] == "Shop"
    assert diagram["version"] == 1
    assert uuid.UUID(diagram["id"])
    assert diagram["boxes"] == [box(diagram["root_id"], None, "Root")]
    assert diagram["edges"] == []


async def test_create_with_a_document_and_read_it_back(client):
    created = await create(client, document=DOC)

    response = await client.get(f"/api/v1/diagrams/{created['id']}")

    assert response.status_code == 200
    assert response.json() == created
    assert created["root_id"] == "root"
    assert created["boxes"] == [
        box("root", None, "Root"),
        box("web", "root", "Web", type_id="web-app", technology="React"),
        box(
            "api",
            "root",
            "API",
            position={"x": 300, "y": 0},
            externals={"web": {"x": 900, "y": 100}},
        ),
        box("handler", "api", "Handler"),
    ]
    assert created["edges"] == [edge("e1", "web", "handler", type_id="request")]
    assert as_document(created) == DOC


async def test_create_normalizes_older_documents(client):
    created = await create(client, document={**DOC, "schemaVersion": 1, "extra": True})
    assert as_document(created) == DOC


async def test_create_rejects_an_invalid_document_with_the_editors_message(client):
    bad = {**DOC, "root": {**DOC["root"], "edges": [{"id": "e1", "from": "web", "to": "web"}]}}

    response = await client.post(diagrams_path(), json={"name": "Shop", "document": bad})

    assert response.status_code == 422
    assert error(response) == {
        "code": "invalid_document",
        "message": 'Connection "e1" is invalid: a box cannot connect to itself.',
    }


async def test_create_rejects_a_blank_name_and_unknown_fields(client):
    blank = await client.post(diagrams_path(), json={"name": "   "})
    unknown = await client.post(diagrams_path(), json={"name": "Shop", "owner": "me"})

    for response in (blank, unknown):
        assert response.status_code == 422
        assert error(response)["code"] == "validation_failed"
    assert error(blank)["details"]["issues"][0]["location"] == "body.name"
    assert error(unknown)["details"]["issues"][0]["location"] == "body.owner"


async def test_box_ids_belong_to_their_diagram(client):
    first = await create(client, document=DOC)
    copy = await create(client, name="Copy", document=DOC)

    assert [b["id"] for b in copy["boxes"]] == [b["id"] for b in first["boxes"]]


async def test_get_unknown_diagram(client):
    missing = await client.get(f"/api/v1/diagrams/{uuid.uuid4()}")
    malformed = await client.get("/api/v1/diagrams/not-a-uuid")

    assert missing.status_code == 404
    assert error(missing)["code"] == "diagram_not_found"
    assert malformed.status_code == 422


async def test_list_is_newest_change_first_paginated_and_without_content(client):
    first = await create(client, name="First")
    second = await create(client, name="Second")
    third = await create(client, name="Third")
    await client.patch(f"/api/v1/diagrams/{first['id']}", json={"version": 1, "name": "First!"})

    page = (await client.get(diagrams_path(), params={"limit": 2})).json()
    rest = (await client.get(diagrams_path(), params={"limit": 2, "offset": 2})).json()

    assert page["total"] == 3
    assert [d["name"] for d in page["items"]] == ["First!", "Third"]
    assert [d["id"] for d in rest["items"]] == [second["id"]]
    assert "boxes" not in page["items"][0]
    assert third["id"] == page["items"][1]["id"]


async def test_list_rejects_bad_paging(client):
    assert (await client.get(diagrams_path(), params={"limit": 0})).status_code == 422
    assert (await client.get(diagrams_path(), params={"limit": 201})).status_code == 422
    assert (await client.get(diagrams_path(), params={"offset": -1})).status_code == 422


# ---- Renaming ----


async def test_rename_bumps_the_version(client):
    created = await create(client, document=DOC)

    response = await client.patch(
        f"/api/v1/diagrams/{created['id']}", json={"version": 1, "name": "Shop v2"}
    )

    updated = response.json()
    assert response.status_code == 200
    assert (updated["name"], updated["version"]) == ("Shop v2", 2)
    assert updated["updated_at"] > created["updated_at"]
    assert updated["created_at"] == created["created_at"]
    assert (await read(client, created))["boxes"] == created["boxes"]


async def test_rename_based_on_an_old_version_conflicts(client):
    created = await create(client)
    url = f"/api/v1/diagrams/{created['id']}"
    await client.patch(url, json={"version": 1, "name": "Mine"})

    response = await client.patch(url, json={"version": 1, "name": "Theirs"})

    assert response.status_code == 409
    assert error(response)["code"] == "version_conflict"
    assert error(response)["details"] == {"current_version": 2}
    assert (await client.get(url)).json()["name"] == "Mine"


async def test_concurrent_renames_from_the_same_version_let_exactly_one_win(client):
    created = await create(client)
    url = f"/api/v1/diagrams/{created['id']}"

    responses = await asyncio.gather(
        *(client.patch(url, json={"version": 1, "name": f"Writer {i}"}) for i in range(5))
    )

    codes = sorted(r.status_code for r in responses)
    assert codes == [200, 409, 409, 409, 409]
    assert (await client.get(url)).json()["version"] == 2


async def test_rename_without_a_version_renames_whatever_version_it_is_at(client):
    created = await create(client, document=DOC)
    url = f"/api/v1/diagrams/{created['id']}"
    await change(client, {**created, "version": None}, changed_boxes=[{"id": "web", "title": "W"}])

    response = await client.patch(url, json={"name": "Shop v2"})
    unknown = await client.patch(f"/api/v1/diagrams/{uuid.uuid4()}", json={"name": "x"})

    assert (response.json()["name"], response.json()["version"]) == ("Shop v2", 3)
    assert error(unknown)["code"] == "diagram_not_found"


async def test_rename_needs_a_name_and_takes_no_document(client):
    created = await create(client)
    url = f"/api/v1/diagrams/{created['id']}"

    nameless = await client.patch(url, json={"version": 1})
    with_document = await client.patch(url, json={"version": 1, "name": "x", "document": DOC})

    assert nameless.status_code == 422
    assert error(with_document)["details"]["issues"][0]["location"] == "body.document"


async def test_rename_unknown_diagram(client):
    response = await client.patch(
        f"/api/v1/diagrams/{uuid.uuid4()}", json={"version": 1, "name": "x"}
    )
    assert response.status_code == 404
    assert error(response)["code"] == "diagram_not_found"


# ---- Saving changes ----


async def test_changes_add_edit_and_delete_boxes_and_connections(client):
    created = await create(client, document=DOC)

    response = await change(
        client,
        created,
        added_boxes=[box("db", "api", "Database", type_id="database", technology="PostgreSQL")],
        changed_boxes=[{"id": "web", "title": "Website", "technology": "Vue"}],
        added_edges=[edge("e2", "handler", "db", type_id="query", label="reads")],
        changed_edges=[{"id": "e1", "label": "calls"}],
    )

    assert response.status_code == 200, response.text
    saved = response.json()
    assert (saved["version"], saved["name"]) == (2, "Shop")
    assert (saved["skipped_boxes"], saved["skipped_edges"]) == ([], [])
    assert "boxes" not in saved
    after = await read(client, created)
    boxes = by_id(after["boxes"])
    assert boxes["db"] == box("db", "api", "Database", type_id="database", technology="PostgreSQL")
    # What the change leaves out stays: Web's type.
    assert (boxes["web"]["title"], boxes["web"]["technology"]) == ("Website", "Vue")
    assert boxes["web"]["type_id"] == "web-app"
    assert by_id(after["edges"])["e1"] == edge(
        "e1", "web", "handler", type_id="request", label="calls"
    )
    # Added last, so listed last: the order the editor keeps them in.
    assert [b["id"] for b in after["boxes"]] == ["root", "web", "api", "handler", "db"]
    assert [e["id"] for e in after["edges"]] == ["e1", "e2"]

    removed = await change(client, after, removed_boxes=["api"])

    assert removed.status_code == 200, removed.text
    left = await read(client, created)
    # Everything inside, and every connection touching it, goes too.
    assert [b["id"] for b in left["boxes"]] == ["root", "web"]
    assert left["edges"] == []


async def test_a_change_clears_fields_set_to_null(client):
    created = await create(client, document=DOC)

    await change(
        client, created, changed_boxes=[{"id": "web", "type_id": None, "technology": None}]
    )

    web = by_id((await read(client, created))["boxes"])["web"]
    assert (web["type_id"], web["technology"], web["title"]) == (None, None, "Web")


async def test_only_named_rows_change(client):
    created = await create(client, document=DOC)

    await change(client, created, changed_boxes=[{"id": "handler", "title": "Handler v2"}])

    after = await read(client, created)
    before = by_id(created["boxes"])
    for b in after["boxes"]:
        if b["id"] != "handler":
            assert b == before[b["id"]]
    assert after["edges"] == created["edges"]


async def test_a_change_to_what_a_box_already_is_changes_nothing_but_the_version(client):
    created = await create(client, document=DOC)

    response = await change(client, created, changed_boxes=[{"id": "web", "title": "Web"}])

    assert response.json()["version"] == 2
    assert (await read(client, created))["boxes"] == created["boxes"]


async def test_spots_of_external_boxes_change_one_by_one(client):
    created = await create(client, document=DOC)

    await change(
        client, created, changed_boxes=[{"id": "api", "externals": {"web": {"x": 1, "y": 2}}}]
    )
    moved = await read(client, created)
    await change(client, moved, changed_boxes=[{"id": "api", "externals": {"web": None}}])
    forgotten = await read(client, created)

    assert by_id(moved["boxes"])["api"]["externals"] == {"web": {"x": 1, "y": 2}}
    assert by_id(forgotten["boxes"])["api"]["externals"] == {}


async def test_a_spot_goes_with_its_box(client):
    created = await create(client, document=DOC)

    await change(client, created, removed_boxes=["web"])

    assert by_id((await read(client, created))["boxes"])["api"]["externals"] == {}


async def test_spots_for_boxes_not_in_the_diagram_are_dropped(client):
    created = await create(client, document=DOC)

    await change(
        client, created, changed_boxes=[{"id": "api", "externals": {"ghost": {"x": 1, "y": 2}}}]
    )

    assert by_id((await read(client, created))["boxes"])["api"]["externals"] == {
        "web": {"x": 900, "y": 100}
    }


async def test_new_boxes_inside_new_boxes_in_any_order(client):
    created = await create(client)
    root = created["root_id"]

    response = await change(
        client, created, added_boxes=[box("inner", "outer", "Inner"), box("outer", root, "Outer")]
    )

    assert response.status_code == 200, response.text
    parents = {b["id"]: b["parent_id"] for b in (await read(client, created))["boxes"]}
    assert parents == {root: None, "outer": root, "inner": "outer"}


async def test_changes_based_on_an_old_version_conflict_and_change_nothing(client):
    created = await create(client, document=DOC)
    await client.patch(f"/api/v1/diagrams/{created['id']}", json={"version": 1, "name": "Mine"})

    response = await change(client, created, removed_boxes=["web"])

    assert response.status_code == 409
    assert error(response)["details"] == {"current_version": 2}
    assert len((await read(client, created))["boxes"]) == 4


async def test_concurrent_saves_from_the_same_version_let_exactly_one_win(client):
    created = await create(client, document=DOC)

    responses = await asyncio.gather(
        *(change(client, created, added_boxes=[box(f"new{i}", "root")]) for i in range(5))
    )

    assert sorted(r.status_code for r in responses) == [200, 409, 409, 409, 409]
    after = await read(client, created)
    assert after["version"] == 2
    assert len(after["boxes"]) == 5


async def test_saves_without_a_version_all_happen_one_after_another(client):
    created = await create(client, document=DOC)
    latest = {**created, "version": None}

    responses = await asyncio.gather(
        *(change(client, latest, added_boxes=[box(f"new{i}", "root")]) for i in range(5))
    )

    assert sorted(r.json()["version"] for r in responses) == [2, 3, 4, 5, 6]
    assert len((await read(client, created))["boxes"]) == 9


async def test_for_each_field_the_later_change_wins(client):
    created = await create(client, document=DOC)
    latest = {**created, "version": None}

    # As two people would, each from the diagram as they last saw it.
    await change(client, latest, changed_boxes=[{"id": "web", "title": "Shop front"}])
    await change(client, latest, changed_boxes=[{"id": "web", "position": {"x": 5, "y": 6}}])
    await change(client, latest, changed_boxes=[{"id": "web", "title": "Storefront"}])

    web = by_id((await read(client, created))["boxes"])["web"]
    assert (web["title"], web["position"]) == ("Storefront", {"x": 5, "y": 6})


async def test_changes_to_what_is_no_longer_there_are_skipped(client):
    created = await create(client, document=DOC)
    latest = {**created, "version": None}
    await change(client, latest, removed_boxes=["api"])

    # Someone who has not heard yet that API (with Handler and e1) is gone:
    response = await change(
        client,
        latest,
        added_boxes=[
            box("db", "handler", "Database"),
            box("table", "db", "Table"),
            box("ok", "root"),
        ],
        changed_boxes=[{"id": "handler", "title": "Handler v2"}],
        added_edges=[edge("e2", "web", "handler"), edge("e3", "web", "ok")],
        changed_edges=[{"id": "e1", "label": "calls"}],
        # Already gone: nothing to do.
        removed_boxes=["api"],
    )

    assert response.status_code == 200, response.text
    saved = response.json()
    assert sorted(saved["skipped_boxes"]) == ["db", "handler", "table"]
    assert sorted(saved["skipped_edges"]) == ["e1", "e2"]
    after = await read(client, created)
    assert [b["id"] for b in after["boxes"]] == ["root", "web", "ok"]
    assert [e["id"] for e in after["edges"]] == ["e3"]


async def test_adding_what_is_already_there_replaces_it(client):
    created = await create(client, document=DOC)
    latest = {**created, "version": None}
    sent = {"added_boxes": [box("db", "api", "Database")], "added_edges": [edge("e2", "web", "db")]}

    # Sent again, e.g. after a lost connection, and once more changed.
    first = await change(client, latest, **sent)
    again = await change(client, latest, **sent)
    changed = await change(client, latest, added_boxes=[box("db", "api", "Postgres")])

    assert [r.status_code for r in (first, again, changed)] == [200, 200, 200]
    after = await read(client, created)
    assert by_id(after["boxes"])["db"]["title"] == "Postgres"
    assert [b["id"] for b in after["boxes"]].count("db") == 1
    assert [e["id"] for e in after["edges"]] == ["e1", "e2"]


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"added_boxes": [box("web", "api", "Web")]}, 'Box "web" cannot move into another box.'),
        ({"added_boxes": [box("new", None)]}, 'Box "new" needs a box to sit in'),
        ({"added_boxes": [box("a", "b"), box("b", "a")]}, "nested too deeply"),
        ({"added_boxes": [box("x", "handler")], "removed_boxes": ["api"]}, "being deleted"),
        ({"changed_boxes": [{"id": "handler"}], "removed_boxes": ["api"]}, "being deleted"),
        ({"changed_boxes": [{"id": "web"}], "removed_boxes": ["web"]}, "named more than once"),
        ({"removed_boxes": ["root"]}, "The top level cannot be deleted."),
        ({"added_edges": [edge("e2", "web", "web")]}, "cannot connect to itself"),
        ({"added_edges": [edge("e2", "api", "handler")]}, "nested inside it"),
        ({"changed_edges": [{"id": "e1", "to": "web"}]}, "cannot connect to itself"),
        ({"added_edges": [edge("e", "web", "api"), edge("e", "web", "api")]}, "more than once"),
    ],
)
async def test_changes_that_break_a_rule_are_refused_whole(client, changes, message):
    created = await create(client, document=DOC)

    response = await change(client, created, **{"added_boxes": [box("ok", "root")], **changes})

    assert response.status_code == 422
    assert error(response)["code"] == "invalid_change"
    assert message in error(response)["message"]
    assert await read(client, created) == created


async def test_badly_formed_changes_are_validation_errors(client):
    created = await create(client, document=DOC)

    empty = await change(client, created)
    blank_type = await change(client, created, added_boxes=[box("x", "root", type_id="")])
    infinite = await client.post(
        f"/api/v1/diagrams/{created['id']}/changes",
        content='{"version": 1, "added_boxes": [{"id": "x", "parent_id": "root", "title": "", '
        '"position": {"x": 1e999, "y": 0}}]}',
        headers={"content-type": "application/json"},
    )
    unknown = await change(client, created, added_boxes=[box("x", "root", colour="red")])
    moved = await change(client, created, changed_boxes=[{"id": "web", "parent_id": "api"}])
    no_title = await change(client, created, changed_boxes=[{"id": "web", "title": None}])
    no_end = await change(client, created, changed_edges=[{"id": "e1", "from": None}])

    for response in (empty, blank_type, infinite, unknown, moved, no_title, no_end):
        assert response.status_code == 422, response.text
        assert error(response)["code"] == "validation_failed"
    assert "at least one box or connection" in error(empty)["details"]["issues"][0]["message"]
    assert "title cannot be null" in error(no_title)["details"]["issues"][0]["message"]
    assert "from cannot be null" in error(no_end)["details"]["issues"][0]["message"]


async def test_changes_to_an_unknown_diagram(client):
    response = await change(client, {"id": uuid.uuid4(), "version": 1}, removed_boxes=["x"])

    assert response.status_code == 404
    assert error(response)["code"] == "diagram_not_found"


# ---- Deleting ----


async def test_delete(client):
    created = await create(client)
    url = f"/api/v1/diagrams/{created['id']}"

    first = await client.delete(url)
    second = await client.delete(url)

    assert first.status_code == 204
    assert first.content == b""
    assert second.status_code == 404
    assert (await client.get(url)).status_code == 404


async def test_unknown_routes_use_the_error_shape(client):
    response = await client.get("/api/v1/nope")
    assert response.status_code == 404
    assert error(response)["code"] == "not_found"


# ---- Nesting ----


def chain(levels):
    root = node = {
        "id": "n0",
        "title": "",
        "position": {"x": 0, "y": 0},
        "children": [],
        "edges": [],
    }
    for i in range(1, levels + 1):
        child = {"id": f"n{i}", "title": "", "position": {"x": 0, "y": 0}}
        node["children"].append({**child, "children": [], "edges": []})
        node = node["children"][0]
    return {"schemaVersion": SCHEMA_VERSION, "root": root}


async def test_the_deepest_allowed_diagram_round_trips(client):
    created = await create(client, document=chain(MAX_NESTING))

    response = await client.get(f"/api/v1/diagrams/{created['id']}")

    assert response.status_code == 200
    assert as_document(response.json()) == chain(MAX_NESTING)


async def test_too_deep_diagrams_are_rejected(client):
    response = await client.post(
        diagrams_path(), json={"name": "Deep", "document": chain(MAX_NESTING + 1)}
    )
    assert response.status_code == 422
    assert error(response)["code"] == "invalid_document"


async def test_boxes_cannot_be_added_below_the_deepest_level(client):
    created = await create(client, document=chain(MAX_NESTING))
    deepest = f"n{MAX_NESTING}"

    response = await change(client, created, added_boxes=[box("deeper", deepest)])
    beside = await change(client, created, added_boxes=[box("beside", f"n{MAX_NESTING - 1}")])

    assert "nested too deeply" in error(response)["message"]
    assert beside.status_code == 200


async def test_a_body_too_deeply_nested_to_parse_is_a_client_error(client):
    body = '{"name": "x", "document": ' + "[" * 100_000 + "]" * 100_000 + "}"

    response = await client.post(
        diagrams_path(), content=body, headers={"content-type": "application/json"}
    )

    assert response.status_code in (400, 422)
    assert "error" in response.json()
