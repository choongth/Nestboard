"""Grants on boxes through the API: who may give them, what they allow when
saving, and what happens when the box goes."""

import pytest
from conftest import API, as_document, box, changes_to, code, grant, grants

# Shop ▸ Payments ▸ Ledger, Shop ▸ Orders, and Web.
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
            ),
            box("web", "Web"),
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
    """Brings someone into Acme."""
    return lambda name: person(org, name)


def nodes(doc):
    found, stack = {}, [doc["root"]]
    while stack:
        node = stack.pop()
        found[node["id"]] = node
        stack.extend(node["children"])
    return found


async def save(client, project, change):
    """Saves the diagram with `change(nodes by id)` applied to its current content."""
    url = f"{API}/diagrams/{project['diagram']['id']}"
    current = (await client.get(url)).json()
    document = as_document(current)
    change(nodes(document))
    return await client.post(f"{url}/changes", json=changes_to(current, document))


async def current_document(client, project):
    return as_document((await client.get(f"{API}/diagrams/{project['diagram']['id']}")).json())


def rename(box_id, title):
    return lambda n: n[box_id].update(title=title)


def delete(box_id):
    def change(n):
        for node in n.values():
            node["children"] = [c for c in node["children"] if c["id"] != box_id]

    return change


# ---- Seeing and saving with a grant on a box ----


async def test_a_grant_on_a_box_lets_you_see_the_project(alice, org, project, person):
    bob, bob_id = await person("Bob")

    response = await grant(alice, project, "editor", "payments", user_id=bob_id)

    assert response.status_code == 200
    assert response.json()["box_id"] == "payments"
    assert response.json()["box_title"] == "Payments"
    listed = (await bob.get(f"{API}/orgs/{org['id']}/projects")).json()
    assert [(p["name"], p["role"]) for p in listed] == [("Checkout", "viewer")]
    access = (await bob.get(f"{API}/diagrams/{project['diagram']['id']}/access")).json()
    assert access == {"project_role": "viewer", "box_roles": {"payments": "editor"}}


async def test_you_save_changes_inside_your_box_only(alice, project, person):
    bob, bob_id = await person("Bob")
    await grant(alice, project, "editor", "payments", user_id=bob_id)

    inside = await save(bob, project, rename("ledger", "General ledger"))
    outside = await save(bob, project, rename("orders", "Mine"))

    assert inside.status_code == 200
    assert nodes(await current_document(bob, project))["ledger"]["title"] == "General ledger"
    assert outside.status_code == 403
    assert code(outside) == "outside_your_part"
    assert outside.json()["error"]["details"] == {"box_id": "orders", "needs": "editor"}


async def test_renaming_the_diagram_needs_a_project_editor(alice, project, person):
    bob, bob_id = await person("Bob")
    await grant(alice, project, "owner", "shop", user_id=bob_id)

    response = await bob.patch(
        f"{API}/diagrams/{project['diagram']['id']}",
        json={"version": project["diagram"]["version"], "name": "Mine"},
    )

    assert response.status_code == 403


async def test_owning_a_box_does_not_let_you_create_diagrams(alice, project, person):
    bob, bob_id = await person("Bob")
    await grant(alice, project, "owner", "shop", user_id=bob_id)

    response = await bob.post(f"{API}/projects/{project['id']}/diagrams", json={"name": "Mine"})

    assert response.status_code == 403


async def test_a_grant_to_a_group_on_a_box_covers_its_subgroups(alice, org, project, person):
    bob, bob_id = await person("Bob")
    team = (await alice.post(f"{API}/orgs/{org['id']}/groups", json={"name": "Payments"})).json()
    sub = (
        await alice.post(
            f"{API}/orgs/{org['id']}/groups", json={"name": "Ledger team", "parent_id": team["id"]}
        )
    ).json()
    await alice.put(f"{API}/orgs/{org['id']}/groups/{sub['id']}/members/{bob_id}", json={})
    await grant(alice, project, "editor", "payments", group_id=team["id"])

    assert (await save(bob, project, rename("payments", "Pay"))).status_code == 200


async def test_project_editors_still_cannot_delete_a_box_with_access_of_its_own(
    alice, org, project, person
):
    carol, carol_id = await person("Carol")
    _, bob_id = await person("Bob")
    await grant(alice, project, "editor", user_id=carol_id)
    await grant(alice, project, "editor", "ledger", user_id=bob_id)

    refused = await save(carol, project, delete("ledger"))
    by_owner = await save(alice, project, delete("ledger"))

    assert refused.status_code == 403
    assert refused.json()["error"]["details"] == {"box_id": "ledger", "needs": "owner"}
    assert by_owner.status_code == 200


# ---- Giving grants on boxes ----


async def test_whoever_owns_a_box_hands_out_the_parts_inside_it(alice, project, person):
    carol, carol_id = await person("Carol")
    _, bob_id = await person("Bob")
    await grant(alice, project, "owner", "shop", user_id=carol_id)

    inside = await grant(carol, project, "editor", "payments", user_id=bob_id)
    on_her_box = await grant(carol, project, "viewer", "shop", user_id=bob_id)
    elsewhere = await grant(carol, project, "editor", "web", user_id=bob_id)
    project_wide = await grant(carol, project, "editor", user_id=bob_id)

    assert [inside.status_code, on_her_box.status_code] == [200, 200]
    assert [elsewhere.status_code, project_wide.status_code] == [403, 403]


async def test_editors_of_a_box_do_not_hand_it_out(alice, project, person):
    bob, bob_id = await person("Bob")
    _, carol_id = await person("Carol")
    await grant(alice, project, "editor", "shop", user_id=bob_id)

    response = await grant(bob, project, "editor", "payments", user_id=carol_id)

    assert response.status_code == 403


async def test_grants_go_on_boxes_that_exist(alice, org, project, person):
    _, bob_id = await person("Bob")
    other = (await alice.post(f"{API}/orgs/{org['id']}/projects", json={"name": "Other"})).json()
    elsewhere = (
        await alice.post(f"{API}/projects/{other['id']}/diagrams", json={"name": "Elsewhere"})
    ).json()

    unknown = await grant(alice, project, "editor", "nope", user_id=bob_id)
    root = await grant(alice, project, "editor", "root", user_id=bob_id)
    other_project = await alice.put(
        f"{API}/projects/{project['id']}/grants",
        json={"role": "editor", "user_id": bob_id, "diagram_id": elsewhere["id"], "box_id": "x"},
    )
    half = await alice.put(
        f"{API}/projects/{project['id']}/grants",
        json={"role": "editor", "user_id": bob_id, "box_id": "payments"},
    )

    assert [unknown.status_code, root.status_code] == [422, 422]
    assert code(unknown) == "unknown_box"
    assert other_project.status_code == 404
    assert half.status_code == 422


async def test_a_box_grant_is_separate_from_the_project_wide_one(alice, project, person):
    _, bob_id = await person("Bob")
    await grant(alice, project, "viewer", user_id=bob_id)
    await grant(alice, project, "editor", "payments", user_id=bob_id)
    await grant(alice, project, "owner", "payments", user_id=bob_id)  # changes the box grant

    listed = [
        (g["user"]["display_name"], g["role"], g["box_title"]) for g in await grants(alice, project)
    ]

    assert listed == [
        ("Alice", "owner", None),
        ("Bob", "viewer", None),
        ("Bob", "owner", "Payments"),
    ]


async def test_owning_a_box_does_not_count_as_owning_the_project(alice, project, person):
    _, bob_id = await person("Bob")
    await grant(alice, project, "owner", "shop", user_id=bob_id)
    alice_grant = next(g for g in await grants(alice, project) if g["box_id"] is None)

    response = await alice.delete(f"{API}/projects/{project['id']}/grants/{alice_grant['id']}")

    assert response.status_code == 409
    assert code(response) == "last_owner"


async def test_box_owners_take_back_what_they_handed_out(alice, project, person):
    carol, carol_id = await person("Carol")
    _, bob_id = await person("Bob")
    await grant(alice, project, "owner", "shop", user_id=carol_id)
    bob_grant = (await grant(carol, project, "editor", "payments", user_id=bob_id)).json()
    carol_grant = next(g for g in await grants(alice, project) if g["user"]["id"] == carol_id)

    mine_to_give = await carol.delete(f"{API}/projects/{project['id']}/grants/{bob_grant['id']}")
    project_wide = next(g for g in await grants(alice, project) if g["box_id"] is None)
    not_mine = await carol.delete(f"{API}/projects/{project['id']}/grants/{project_wide['id']}")

    assert mine_to_give.status_code == 204
    assert not_mine.status_code == 403
    assert carol_grant["box_id"] == "shop"


# ---- When the box goes ----


async def test_a_grant_outlives_its_box_and_reads_as_orphaned(alice, project, person):
    _, bob_id = await person("Bob")
    await grant(alice, project, "editor", "ledger", user_id=bob_id)

    await save(alice, project, delete("ledger"))

    orphan = next(g for g in await grants(alice, project) if g["box_id"] == "ledger")
    assert orphan["orphaned"] is True
    assert orphan["box_title"] == "Ledger"


async def test_cleaning_up_a_grant_on_a_deleted_box_needs_a_project_owner(alice, project, person):
    carol, carol_id = await person("Carol")
    _, bob_id = await person("Bob")
    await grant(alice, project, "owner", "shop", user_id=carol_id)
    await grant(carol, project, "editor", "ledger", user_id=bob_id)
    await save(carol, project, delete("ledger"))  # Carol owns Shop, so Payments too
    orphan = next(g for g in await grants(alice, project) if g["box_id"] == "ledger")

    by_carol = await carol.delete(f"{API}/projects/{project['id']}/grants/{orphan['id']}")
    by_alice = await alice.delete(f"{API}/projects/{project['id']}/grants/{orphan['id']}")

    assert [by_carol.status_code, by_alice.status_code] == [403, 204]


async def test_box_grants_are_in_the_activity(alice, project, person):
    _, bob_id = await person("Bob")
    await grant(alice, project, "editor", "payments", user_id=bob_id)

    activity = (await alice.get(f"{API}/projects/{project['id']}/activity")).json()

    assert activity[0]["details"] == {
        "role": "editor",
        "user_id": bob_id,
        "name": "Bob",
        "diagram_id": project["diagram"]["id"],
        "box_id": "payments",
        "box": "Payments",
    }
