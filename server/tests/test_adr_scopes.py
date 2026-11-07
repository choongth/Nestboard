"""ADRs about a box: who may propose, decide and supersede them, what they
may link to, and who the history says did what."""

import copy

import conftest
import pytest
from conftest import API, box, code

# Shop ▸ Payments ▸ Ledger, Shop ▸ Orders, and Web; Web → Payments, Orders → Ledger,
# Web → Orders (touches neither Payments nor Ledger).
DOC = {
    "schemaVersion": 4,
    "root": box(
        "root",
        "Root",
        [
            box(
                "shop",
                "Shop",
                [box("payments", "Payments", [box("ledger", "Ledger")]), box("orders", "Orders")],
                [{"id": "e2", "from": "orders", "to": "ledger"}],
            ),
            box("web", "Web"),
        ],
        [
            {"id": "e1", "from": "web", "to": "payments", "label": "pays"},
            {"id": "e3", "from": "web", "to": "orders"},
        ],
    ),
}


@pytest.fixture
async def project(alice, org):
    """Checkout, owned by Alice, with the Shop diagram."""
    created = (
        await alice.post(f"{API}/orgs/{org['id']}/projects", json={"name": "Checkout"})
    ).json()
    diagram = (
        await alice.post(
            f"{API}/projects/{created['id']}/diagrams", json={"name": "Shop", "document": DOC}
        )
    ).json()
    return {**created, "diagram": diagram}


@pytest.fixture
def person(person, org):
    """Brings someone into Acme, with a job title if given."""
    return lambda name, **invitation: person(org, name, **invitation)


async def grant(client, project, role, box_id=None, *, user_id):
    response = await conftest.grant(client, project, role, box_id, user_id=user_id)
    assert response.status_code == 200, response.text


async def propose(client, project, title="Decision", box_id=None):
    body = {"title": title}
    if box_id:
        body |= {"diagram_id": project["diagram"]["id"], "box_id": box_id}
    return await client.post(f"{API}/projects/{project['id']}/adrs", json=body)


async def proposed(client, project, title="Decision", box_id=None):
    response = await propose(client, project, title, box_id)
    assert response.status_code == 201, response.text
    return response.json()


async def current(client, adr):
    return (await client.get(f"{API}/adrs/{adr['id']}")).json()


async def move(client, adr, to):
    adr = await current(client, adr)
    return await client.post(
        f"{API}/adrs/{adr['id']}/transition", json={"version": adr["version"], "to": to}
    )


async def put_links(client, adr, links, diagram_id):
    adr = await current(client, adr)
    return await client.put(
        f"{API}/adrs/{adr['id']}/links",
        json={
            "version": adr["version"],
            "links": [{"diagram_id": diagram_id, "kind": k, "id": i} for k, i in links],
        },
    )


async def put_relations(client, adr, relations):
    adr = await current(client, adr)
    return await client.put(
        f"{API}/adrs/{adr['id']}/relations",
        json={
            "version": adr["version"],
            "relations": [{"kind": k, "adr_id": target["id"]} for k, target in relations],
        },
    )


async def save_document(client, project, document):
    response = await conftest.save_document(client, project["diagram"]["id"], document)
    assert response.status_code == 200, response.text


# ---- Scopes ----


async def test_an_adr_about_a_box_names_it(alice, project):
    adr = await proposed(alice, project, box_id="payments")

    assert adr["scope"] == {
        "diagram_id": project["diagram"]["id"],
        "box_id": "payments",
        "title": "Payments",
        "orphaned": False,
    }


async def test_the_scope_must_be_a_box_of_the_project(alice, org, project):
    other = (await alice.post(f"{API}/orgs/{org['id']}/projects", json={"name": "O"})).json()
    elsewhere = (
        await alice.post(f"{API}/projects/{other['id']}/diagrams", json={"name": "Elsewhere"})
    ).json()
    url = f"{API}/projects/{project['id']}/adrs"

    unknown = await propose(alice, project, box_id="nope")
    root = await propose(alice, project, box_id="root")
    other_project = await alice.post(
        url, json={"title": "x", "diagram_id": elsewhere["id"], "box_id": "root"}
    )
    half = await alice.post(url, json={"title": "x", "box_id": "payments"})

    assert [unknown.status_code, root.status_code] == [422, 422]
    assert code(unknown) == "unknown_box"
    assert other_project.status_code == 404
    assert half.status_code == 422


async def test_numbers_are_shared_by_every_scope(alice, project):
    first = await proposed(alice, project)
    second = await proposed(alice, project, box_id="ledger")

    assert [first["ref"], second["ref"]] == ["ADR-0001", "ADR-0002"]


async def test_a_deleted_box_leaves_the_adr_about_it(alice, project):
    adr = await proposed(alice, project, box_id="ledger")
    without_ledger = copy.deepcopy(DOC)
    without_ledger["root"]["children"][0]["children"][0]["children"] = []
    without_ledger["root"]["children"][0]["edges"] = []

    await save_document(alice, project, without_ledger)

    assert (await current(alice, adr))["scope"]["orphaned"] is True
    assert (await current(alice, adr))["scope"]["title"] == "Ledger"


async def test_a_deleted_diagram_leaves_the_adr_about_its_box(alice, project):
    adr = await proposed(alice, project, box_id="ledger")

    await alice.delete(f"{API}/diagrams/{project['diagram']['id']}")

    assert (await current(alice, adr))["scope"]["orphaned"] is True


# ---- Who may do what ----


async def test_box_editors_propose_adrs_about_their_box_only(alice, project, person):
    bob, bob_id = await person("Bob")
    await grant(alice, project, "editor", "payments", user_id=bob_id)

    mine = await propose(bob, project, box_id="ledger")
    elsewhere = await propose(bob, project, box_id="orders")
    project_wide = await propose(bob, project)

    assert mine.status_code == 201
    assert [elsewhere.status_code, project_wide.status_code] == [403, 403]
    assert code(elsewhere) == "not_allowed"
    assert '"Orders"' in elsewhere.json()["error"]["message"]


async def test_box_editors_edit_and_delete_only_adrs_of_their_box(alice, project, person):
    bob, bob_id = await person("Bob")
    await grant(alice, project, "editor", "payments", user_id=bob_id)
    mine = await proposed(alice, project, box_id="payments")
    theirs = await proposed(alice, project, box_id="orders")

    edited = await bob.patch(f"{API}/adrs/{mine['id']}", json={"version": 1, "title": "Mine"})
    refused = await bob.patch(f"{API}/adrs/{theirs['id']}", json={"version": 1, "title": "No"})
    not_deleted = await bob.delete(f"{API}/adrs/{theirs['id']}")
    deleted = await bob.delete(f"{API}/adrs/{mine['id']}")

    assert edited.status_code == 200
    assert [refused.status_code, not_deleted.status_code] == [403, 403]
    assert deleted.status_code == 204


async def test_owners_of_the_box_decide(alice, project, person):
    carol, carol_id = await person("Carol")
    bob, bob_id = await person("Bob")
    dave, dave_id = await person("Dave")
    await grant(alice, project, "owner", "payments", user_id=carol_id)
    await grant(alice, project, "editor", "payments", user_id=bob_id)
    await grant(alice, project, "editor", user_id=dave_id)  # the whole project
    about_ledger = await proposed(bob, project, box_id="ledger")
    project_wide = await proposed(alice, project)

    by_bob = await move(bob, about_ledger, "accepted")
    by_dave = await move(dave, about_ledger, "accepted")
    on_the_project = await move(carol, project_wide, "accepted")
    by_carol = await move(carol, about_ledger, "accepted")  # Ledger is inside Payments

    assert [by_bob.status_code, by_dave.status_code, on_the_project.status_code] == [403] * 3
    assert by_carol.status_code == 200
    assert by_carol.json()["status"] == "accepted"


async def test_project_owners_decide_anywhere(alice, project):
    adr = await proposed(alice, project, box_id="ledger")
    assert (await move(alice, adr, "accepted")).status_code == 200


async def test_viewers_only_read(alice, project, person):
    eve, eve_id = await person("Eve")
    await grant(alice, project, "viewer", user_id=eve_id)
    adr = await proposed(alice, project, box_id="payments")

    assert (await eve.get(f"{API}/adrs/{adr['id']}")).status_code == 200
    assert (await propose(eve, project, box_id="payments")).status_code == 403


async def test_a_deleted_box_is_left_to_the_projects_editors(alice, project, person):
    bob, bob_id = await person("Bob")
    await grant(alice, project, "editor", "ledger", user_id=bob_id)
    adr = await proposed(bob, project, box_id="ledger")
    without_ledger = copy.deepcopy(DOC)
    without_ledger["root"]["children"][0]["children"][0]["children"] = []
    without_ledger["root"]["children"][0]["edges"] = []
    await save_document(alice, project, without_ledger)

    response = await bob.patch(f"{API}/adrs/{adr['id']}", json={"version": 1, "title": "Still"})

    assert response.status_code == 403
    assert "deleted box" in response.json()["error"]["message"]


# ---- Links stay in the scope ----


async def test_an_adr_about_a_box_links_only_inside_it(alice, project):
    adr = await proposed(alice, project, box_id="payments")
    diagram_id = project["diagram"]["id"]

    inside = await put_links(
        alice,
        adr,
        [("box", "payments"), ("box", "ledger"), ("connection", "e1"), ("connection", "e2")],
        diagram_id,
    )
    outside_box = await put_links(alice, adr, [("box", "orders")], diagram_id)
    outside_connection = await put_links(alice, adr, [("connection", "e3")], diagram_id)

    assert inside.status_code == 200
    assert [link["id"] for link in inside.json()["links"]] == ["ledger", "payments", "e2", "e1"]
    for refused in (outside_box, outside_connection):
        assert refused.status_code == 422
        assert code(refused) == "link_outside_scope"
    assert '"Orders"' in outside_box.json()["error"]["message"]


async def test_an_adr_about_a_box_links_only_into_its_own_diagram(alice, project):
    other = (
        await alice.post(
            f"{API}/projects/{project['id']}/diagrams", json={"name": "Other", "document": DOC}
        )
    ).json()
    adr = await proposed(alice, project, box_id="payments")

    response = await put_links(alice, adr, [("box", "payments")], other["id"])

    assert code(response) == "link_outside_scope"


async def test_a_project_wide_adr_links_into_any_diagram_of_the_project(alice, org, project):
    other = (
        await alice.post(
            f"{API}/projects/{project['id']}/diagrams", json={"name": "Other", "document": DOC}
        )
    ).json()
    foreign_project = (
        await alice.post(f"{API}/orgs/{org['id']}/projects", json={"name": "F"})
    ).json()
    foreign = (
        await alice.post(
            f"{API}/projects/{foreign_project['id']}/diagrams", json={"name": "F", "document": DOC}
        )
    ).json()
    adr = await proposed(alice, project)

    first = await put_links(alice, adr, [("box", "orders")], project["diagram"]["id"])
    both = await alice.put(
        f"{API}/adrs/{adr['id']}/links",
        json={
            "version": first.json()["version"],
            "links": [
                {"diagram_id": project["diagram"]["id"], "kind": "box", "id": "orders"},
                {"diagram_id": other["id"], "kind": "box", "id": "orders"},
            ],
        },
    )
    into_another_project = await put_links(alice, adr, [("box", "orders")], foreign["id"])

    assert both.status_code == 200
    assert {link["diagram_id"] for link in both.json()["links"]} == {
        project["diagram"]["id"],
        other["id"],
    }
    assert code(into_another_project) == "unknown_link_target"


async def test_a_link_from_before_a_box_moved_out_can_be_sent_back(alice, project):
    adr = await proposed(alice, project, box_id="shop")
    linked = await put_links(alice, adr, [("box", "orders")], project["diagram"]["id"])
    # Boxes do not move into other boxes: Orders is deleted from Shop, then
    # one with the same id is added at the top level.
    moved = copy.deepcopy(DOC)
    shop = moved["root"]["children"][0]
    orders = shop["children"].pop()
    shop["edges"] = []
    moved["root"]["edges"] = moved["root"]["edges"][:1]
    await save_document(alice, project, moved)
    moved["root"]["children"].append(orders)
    await save_document(alice, project, moved)

    kept = await put_links(alice, linked.json(), [("box", "orders")], project["diagram"]["id"])

    assert kept.status_code == 200


# ---- Superseding ----


async def test_superseding_needs_an_owner_where_the_old_adr_is(alice, project, person):
    carol, carol_id = await person("Carol")
    bob, bob_id = await person("Bob")
    await grant(alice, project, "owner", "payments", user_id=carol_id)
    await grant(alice, project, "owner", "ledger", user_id=bob_id)
    old = await proposed(carol, project, "Old", box_id="payments")
    await move(carol, old, "accepted")
    new = await proposed(bob, project, "New", box_id="ledger")

    by_bob = await put_relations(bob, new, [("supersedes", old)])
    starting_a_copy = await bob.post(f"{API}/adrs/{old['id']}/supersede", json={})
    relating = await put_relations(bob, new, [("relates_to", old)])

    assert [by_bob.status_code, starting_a_copy.status_code] == [403, 403]
    assert "ADR-0001" in by_bob.json()["error"]["message"]
    assert relating.status_code == 200


async def test_accepting_needs_an_owner_of_what_it_supersedes(alice, project, person):
    carol, carol_id = await person("Carol")
    bob, bob_id = await person("Bob")
    await grant(alice, project, "owner", "payments", user_id=carol_id)
    await grant(alice, project, "owner", "ledger", user_id=bob_id)
    old = await proposed(carol, project, "Old", box_id="payments")
    await move(carol, old, "accepted")
    new = await proposed(bob, project, "New", box_id="ledger")
    await put_relations(carol, new, [("supersedes", old)])  # Carol owns Ledger too

    by_bob = await move(bob, new, "accepted")
    by_carol = await move(carol, new, "accepted")

    assert by_bob.status_code == 403
    assert by_carol.status_code == 200
    assert (await current(carol, old))["status"] == "superseded"


async def test_a_superseding_copy_keeps_the_scope(alice, project):
    old = await proposed(alice, project, box_id="payments")
    await move(alice, old, "accepted")

    new = (await alice.post(f"{API}/adrs/{old['id']}/supersede", json={})).json()

    assert new["scope"]["box_id"] == "payments"


# ---- Who did it ----


async def test_the_history_names_who_did_each_change(alice, project, person):
    carol, carol_id = await person("Carol", title="Payments lead")
    bob, bob_id = await person("Bob", title="Developer")
    await grant(alice, project, "owner", "payments", user_id=carol_id)
    await grant(alice, project, "editor", "payments", user_id=bob_id)
    adr = await proposed(bob, project, box_id="ledger")
    await bob.patch(f"{API}/adrs/{adr['id']}", json={"version": 1, "context": "Why"})
    await move(carol, adr, "accepted")

    history = (await alice.get(f"{API}/adrs/{adr['id']}/revisions")).json()

    assert [(r["action"], r["author"]["name"], r["author"]["title"]) for r in history] == [
        ("created", "Bob", "Developer"),
        ("edited", "Bob", "Developer"),
        ("accepted", "Carol", "Payments lead"),
    ]
    assert history[0]["author"]["user_id"] == bob_id


async def test_an_adr_says_who_proposed_and_decided_it(alice, project, person):
    carol, carol_id = await person("Carol", title="Payments lead")
    bob, bob_id = await person("Bob", title="Developer")
    await grant(alice, project, "owner", "payments", user_id=carol_id)
    await grant(alice, project, "editor", "payments", user_id=bob_id)
    adr = await proposed(bob, project, "Use a ledger", box_id="ledger")
    await move(carol, adr, "rejected")

    seen = await current(alice, adr)
    markdown = (await alice.get(f"{API}/adrs/{adr['id']}/markdown")).text

    assert seen["proposed_by"] == {"user_id": bob_id, "name": "Bob", "title": "Developer"}
    assert seen["decided_by"]["name"] == "Carol"
    assert "Proposed by Bob (Developer). Rejected by Carol (Payments lead)." in markdown


async def test_the_history_keeps_names_as_they_were(alice, org, project, person):
    bob, bob_id = await person("Bob", title="Developer")
    await grant(alice, project, "editor", user_id=bob_id)
    adr = await proposed(bob, project)

    await alice.patch(f"{API}/orgs/{org['id']}/members/{bob_id}", json={"title": "Architect"})
    await bob.patch(f"{API}/auth/me", json={"display_name": "Robert"})

    assert (await current(alice, adr))["proposed_by"]["title"] == "Developer"
    assert (await current(alice, adr))["proposed_by"]["name"] == "Bob"


async def test_superseding_is_recorded_on_the_old_adr_by_who_accepted(alice, project):
    old = await proposed(alice, project)
    await move(alice, old, "accepted")
    new = (await alice.post(f"{API}/adrs/{old['id']}/supersede", json={})).json()
    await move(alice, new, "accepted")

    history = (await alice.get(f"{API}/adrs/{old['id']}/revisions")).json()

    assert [r["action"] for r in history] == ["created", "accepted", "superseded"]
    assert history[-1]["author"]["name"] == "Alice"


# ---- Changing the scope ----


async def put_scope(client, adr, box_id=None, diagram_id=None):
    adr = await current(client, adr)
    body = {"version": adr["version"]}
    if box_id:
        body |= {"diagram_id": diagram_id or adr["scope"]["diagram_id"], "box_id": box_id}
    return await client.put(f"{API}/adrs/{adr['id']}/scope", json=body)


async def test_a_proposed_adr_moves_to_another_scope(alice, project):
    adr = await proposed(alice, project)
    diagram_id = project["diagram"]["id"]

    to_a_box = await put_scope(alice, adr, "payments", diagram_id)
    back = await put_scope(alice, adr)

    assert to_a_box.status_code == 200
    assert to_a_box.json()["scope"]["box_id"] == "payments"
    assert back.json()["scope"] is None
    history = (await alice.get(f"{API}/adrs/{adr['id']}/revisions")).json()
    assert [r["action"] for r in history] == ["created", "scoped", "scoped"]
    assert history[1]["snapshot"]["scope"] == {"diagram_id": diagram_id, "box_id": "payments"}
    assert history[2]["snapshot"]["scope"] is None


async def test_moving_needs_an_editor_of_both_scopes(alice, project, person):
    bob, bob_id = await person("Bob")
    await grant(alice, project, "editor", "payments", user_id=bob_id)
    adr = await proposed(bob, project, box_id="ledger")
    diagram_id = project["diagram"]["id"]

    inside = await put_scope(bob, adr, "payments")
    out_of_reach = await put_scope(bob, adr, "orders")
    to_the_project = await put_scope(bob, adr)
    theirs = await proposed(alice, project, box_id="orders")
    into_mine = await put_scope(bob, theirs, "payments", diagram_id)

    assert inside.status_code == 200
    assert [out_of_reach.status_code, to_the_project.status_code, into_mine.status_code] == [
        403,
        403,
        403,
    ]


async def test_links_must_fit_the_new_scope(alice, project):
    adr = await proposed(alice, project, box_id="shop")
    diagram_id = project["diagram"]["id"]
    await put_links(alice, adr, [("box", "orders"), ("box", "ledger")], diagram_id)

    refused = await put_scope(alice, adr, "payments")
    await put_links(alice, adr, [("box", "ledger")], diagram_id)
    moved = await put_scope(alice, adr, "payments")

    assert refused.status_code == 422
    assert code(refused) == "link_outside_scope"
    assert '"Orders"' in refused.json()["error"]["message"]
    assert moved.status_code == 200


async def test_links_to_deleted_boxes_are_not_in_the_way(alice, project):
    adr = await proposed(alice, project)
    await put_links(alice, adr, [("box", "orders")], project["diagram"]["id"])
    without_orders = copy.deepcopy(DOC)
    without_orders["root"]["children"][0]["children"] = without_orders["root"]["children"][0][
        "children"
    ][:1]
    without_orders["root"]["children"][0]["edges"] = []
    without_orders["root"]["edges"] = without_orders["root"]["edges"][:1]
    await save_document(alice, project, without_orders)

    assert (await put_scope(alice, adr, "payments", project["diagram"]["id"])).status_code == 200


async def test_only_proposed_adrs_move(alice, project):
    adr = await proposed(alice, project)
    await move(alice, adr, "accepted")

    response = await put_scope(alice, adr, "payments", project["diagram"]["id"])

    assert response.status_code == 409
    assert code(response) == "adr_locked"


async def test_the_new_scope_must_be_a_box_of_the_project(alice, project):
    adr = await proposed(alice, project)

    unknown = await put_scope(alice, adr, "nope", project["diagram"]["id"])
    half = await alice.put(
        f"{API}/adrs/{adr['id']}/scope", json={"version": 1, "box_id": "payments"}
    )

    assert code(unknown) == "unknown_box"
    assert half.status_code == 422


# ---- What the client is told ----


async def test_each_adr_says_your_role_at_its_scope(alice, project, person):
    bob, bob_id = await person("Bob")
    await grant(alice, project, "owner", "payments", user_id=bob_id)
    await proposed(alice, project, "Project-wide")
    await proposed(alice, project, "About Ledger", box_id="ledger")
    await proposed(alice, project, "About Orders", box_id="orders")

    listed = (await bob.get(f"{API}/projects/{project['id']}/adrs")).json()

    assert [(a["title"], a["my_role"]) for a in listed] == [
        ("Project-wide", "viewer"),
        ("About Ledger", "owner"),
        ("About Orders", "viewer"),
    ]
