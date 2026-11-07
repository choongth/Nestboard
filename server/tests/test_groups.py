import asyncio

import pytest
from conftest import API, code


def groups_url(org):
    return f"{API}/orgs/{org['id']}/groups"


async def new_group(client, org, name, parent=None, **extra):
    body = {"name": name, **extra}
    if parent is not None:
        body["parent_id"] = parent["id"]
    return await client.post(groups_url(org), json=body)


async def group(client, org, name, parent=None):
    response = await new_group(client, org, name, parent)
    assert response.status_code == 201, response.text
    return response.json()


async def put_member(client, org, g, user_id, is_lead=False):
    return await client.put(
        f"{groups_url(org)}/{g['id']}/members/{user_id}", json={"is_lead": is_lead}
    )


async def patch(client, org, g, **body):
    return await client.patch(f"{groups_url(org)}/{g['id']}", json={"version": 1, **body})


@pytest.fixture
async def tree(alice, org):
    """Engineering ▸ Platform ▸ Payments, and Engineering ▸ Infra."""
    engineering = await group(alice, org, "Engineering")
    platform = await group(alice, org, "Platform", engineering)
    payments = await group(alice, org, "Payments", platform)
    infra = await group(alice, org, "Infra", engineering)
    return {"engineering": engineering, "platform": platform, "payments": payments, "infra": infra}


# ---- Groups ----


async def test_admins_create_groups_inside_groups(alice, org, tree):
    response = await alice.get(groups_url(org))

    listed = {g["name"]: g for g in response.json()}
    assert list(listed) == ["Engineering", "Infra", "Payments", "Platform"]
    assert listed["Engineering"]["parent_id"] is None
    assert listed["Platform"]["parent_id"] == tree["engineering"]["id"]
    assert listed["Payments"]["parent_id"] == tree["platform"]["id"]
    assert listed["Payments"]["member_count"] == 0
    assert all(g["can_manage"] for g in listed.values())


async def test_a_group_shows_the_groups_above_it(alice, org, tree):
    response = await alice.get(f"{groups_url(org)}/{tree['payments']['id']}")

    assert [g["name"] for g in response.json()["path"]] == ["Engineering", "Platform"]


async def test_every_member_sees_the_groups(org, tree, person):
    bob, _ = await person(org, "Bob")

    listed = (await bob.get(groups_url(org))).json()

    assert len(listed) == 4
    assert not any(g["can_manage"] for g in listed)


async def test_members_cannot_create_top_level_groups(org, person):
    bob, _ = await person(org, "Bob")

    response = await new_group(bob, org, "Mine")

    assert response.status_code == 403
    assert code(response) == "not_allowed"


async def test_leads_create_groups_below_the_ones_they_lead(alice, org, tree, person):
    bob, bob_id = await person(org, "Bob")
    await put_member(alice, org, tree["platform"], bob_id, is_lead=True)

    under_platform = await new_group(bob, org, "Ledger", tree["platform"])
    under_payments = await new_group(bob, org, "Refunds", tree["payments"])
    under_infra = await new_group(bob, org, "Network", tree["infra"])
    top_level = await new_group(bob, org, "Bob's")

    assert [under_platform.status_code, under_payments.status_code] == [201, 201]
    assert [under_infra.status_code, top_level.status_code] == [403, 403]


async def test_names_differ_between_groups_with_the_same_parent(alice, org, tree):
    taken = await new_group(alice, org, "platform", tree["engineering"])
    taken_at_top = await new_group(alice, org, " ENGINEERING ")
    elsewhere = await new_group(alice, org, "Platform", tree["infra"])

    assert [taken.status_code, taken_at_top.status_code] == [409, 409]
    assert code(taken) == "group_name_taken"
    assert elsewhere.status_code == 201


async def test_groups_nest_at_most_ten_levels(alice, org):
    parent = None
    for level in range(1, 11):
        parent = await group(alice, org, f"Level {level}", parent)

    response = await new_group(alice, org, "Level 11", parent)

    assert response.status_code == 422
    assert code(response) == "group_too_deep"


async def test_outsiders_cannot_see_groups(alice, org, tree, person):
    other = (await alice.post(f"{API}/orgs", json={"name": "Other"})).json()
    olga, _ = await person(other, "Olga")

    response = await olga.get(groups_url(org))

    assert response.status_code == 404
    assert code(response) == "organization_not_found"


async def test_a_group_from_another_organization_is_not_found(alice, org):
    other = (await alice.post(f"{API}/orgs", json={"name": "Other"})).json()
    theirs = await group(alice, other, "Theirs")

    response = await alice.get(f"{groups_url(org)}/{theirs['id']}")
    as_parent = await new_group(alice, org, "Child", theirs)

    assert [response.status_code, as_parent.status_code] == [404, 404]
    assert code(response) == "group_not_found"


async def test_leads_rename_their_groups(alice, org, tree, person):
    bob, bob_id = await person(org, "Bob")
    await put_member(alice, org, tree["platform"], bob_id, is_lead=True)

    response = await patch(bob, org, tree["payments"], name="Payments Team", description="Pay")

    assert response.status_code == 200
    assert response.json()["name"] == "Payments Team"
    assert response.json()["description"] == "Pay"
    assert response.json()["version"] == 2
    stale = await patch(bob, org, tree["payments"], name="Again")
    assert stale.status_code == 409
    assert code(stale) == "version_conflict"


async def test_others_cannot_change_a_group(org, tree, person):
    bob, _ = await person(org, "Bob")

    response = await patch(bob, org, tree["payments"], name="Mine")

    assert response.status_code == 403


async def test_a_change_must_change_something(alice, org, tree):
    response = await alice.patch(f"{groups_url(org)}/{tree['infra']['id']}", json={"version": 1})

    assert response.status_code == 422


# ---- Moving groups ----


async def test_moving_a_group_takes_its_subgroups_along(alice, org, tree):
    response = await patch(alice, org, tree["platform"], parent_id=tree["infra"]["id"])

    assert response.status_code == 200
    assert response.json()["parent_id"] == tree["infra"]["id"]
    payments = (await alice.get(f"{groups_url(org)}/{tree['payments']['id']}")).json()
    assert [g["name"] for g in payments["path"]] == ["Engineering", "Infra", "Platform"]


async def test_moving_a_group_to_the_top_level(alice, org, tree):
    response = await patch(alice, org, tree["payments"], parent_id=None)

    assert response.status_code == 200
    assert response.json()["parent_id"] is None


async def test_leaving_out_the_parent_keeps_the_group_in_place(alice, org, tree):
    response = await patch(alice, org, tree["payments"], name="Pay")

    assert response.json()["parent_id"] == tree["platform"]["id"]


async def test_a_group_cannot_move_inside_itself(alice, org, tree):
    into_itself = await patch(alice, org, tree["platform"], parent_id=tree["platform"]["id"])
    into_child = await patch(alice, org, tree["engineering"], parent_id=tree["payments"]["id"])

    assert [into_itself.status_code, into_child.status_code] == [422, 422]
    assert {code(into_itself), code(into_child)} == {"group_loop"}


async def test_moving_counts_the_subgroups_that_move_along(alice, org, tree):
    parent = None
    for level in range(1, 9):
        parent = await group(alice, org, f"Level {level}", parent)

    # Platform has Payments below it: 8 + 2 levels fits, 9 + 2 would not.
    fits = await patch(alice, org, tree["platform"], parent_id=parent["id"])
    deeper = await group(alice, org, "Level 9", parent)
    too_deep = await alice.patch(
        f"{groups_url(org)}/{tree['platform']['id']}",
        json={"version": 2, "parent_id": deeper["id"]},
    )

    assert fits.status_code == 200
    assert too_deep.status_code == 422
    assert code(too_deep) == "group_too_deep"


async def test_moving_needs_both_levels(alice, org, tree, person):
    """Leading Payments is not enough to move Payments: that changes Platform.
    Leading Engineering covers both Platform and Infra."""
    bob, bob_id = await person(org, "Bob")
    carol, carol_id = await person(org, "Carol")
    await put_member(alice, org, tree["payments"], bob_id, is_lead=True)
    await put_member(alice, org, tree["engineering"], carol_id, is_lead=True)

    by_bob = await patch(bob, org, tree["payments"], parent_id=tree["infra"]["id"])
    by_carol = await patch(carol, org, tree["payments"], parent_id=tree["infra"]["id"])
    out_of_engineering = await carol.patch(
        f"{groups_url(org)}/{tree['payments']['id']}", json={"version": 2, "parent_id": None}
    )

    assert by_bob.status_code == 403
    assert by_carol.status_code == 200
    assert out_of_engineering.status_code == 403


async def test_two_moves_at_once_cannot_make_a_loop(alice, org):
    a = await group(alice, org, "A")
    b = await group(alice, org, "B")

    responses = await asyncio.gather(
        patch(alice, org, a, parent_id=b["id"]), patch(alice, org, b, parent_id=a["id"])
    )

    assert sorted(r.status_code for r in responses) == [200, 422]


# ---- Deleting groups ----


async def test_a_group_with_subgroups_cannot_be_deleted(alice, org, tree):
    response = await alice.delete(f"{groups_url(org)}/{tree['platform']['id']}")

    assert response.status_code == 409
    assert code(response) == "group_has_subgroups"
    assert response.json()["error"]["details"] == {"subgroups": 1}


async def test_deleting_a_group_needs_the_level_above(alice, org, tree, person):
    bob, bob_id = await person(org, "Bob")
    carol, carol_id = await person(org, "Carol")
    await put_member(alice, org, tree["payments"], bob_id, is_lead=True)
    await put_member(alice, org, tree["platform"], carol_id, is_lead=True)
    url = f"{groups_url(org)}/{tree['payments']['id']}"

    assert (await bob.delete(url)).status_code == 403
    assert (await carol.delete(url)).status_code == 204
    # Bob is still in the organization.
    assert (await bob.get(groups_url(org))).status_code == 200
    assert len((await bob.get(groups_url(org))).json()) == 3


# ---- Members ----


async def test_managers_put_people_in_groups(alice, org, tree, person):
    _, bob_id = await person(org, "Bob", title="Developer")

    response = await put_member(alice, org, tree["payments"], bob_id)

    assert response.status_code == 200
    assert response.json()["user"]["display_name"] == "Bob"
    assert response.json()["title"] == "Developer"
    assert response.json()["is_lead"] is False
    members = (await alice.get(f"{groups_url(org)}/{tree['payments']['id']}/members")).json()
    assert [m["user"]["display_name"] for m in members] == ["Bob"]
    listed = {g["name"]: g for g in (await alice.get(groups_url(org))).json()}
    assert listed["Payments"]["member_count"] == 1


async def test_putting_someone_in_again_changes_whether_they_lead(alice, org, tree, person):
    _, bob_id = await person(org, "Bob")
    await put_member(alice, org, tree["payments"], bob_id)

    response = await put_member(alice, org, tree["payments"], bob_id, is_lead=True)

    assert response.json()["is_lead"] is True
    members = (await alice.get(f"{groups_url(org)}/{tree['payments']['id']}/members")).json()
    assert len(members) == 1
    assert members[0]["is_lead"] is True


async def test_leading_a_group_covers_the_groups_below_it(alice, org, tree, person):
    carol, carol_id = await person(org, "Carol")
    _, bob_id = await person(org, "Bob")
    await put_member(alice, org, tree["engineering"], carol_id, is_lead=True)

    assert (await put_member(carol, org, tree["payments"], bob_id, True)).status_code == 200
    listed = {g["name"]: g["can_manage"] for g in (await carol.get(groups_url(org))).json()}
    assert listed == {"Engineering": True, "Infra": True, "Payments": True, "Platform": True}


async def test_a_plain_member_of_a_group_cannot_manage_it(alice, org, tree, person):
    bob, bob_id = await person(org, "Bob")
    _, carol_id = await person(org, "Carol")
    await put_member(alice, org, tree["payments"], bob_id)

    response = await put_member(bob, org, tree["payments"], carol_id)

    assert response.status_code == 403


async def test_only_organization_members_can_be_put_in_groups(alice, org, tree, person):
    other = (await alice.post(f"{API}/orgs", json={"name": "Other"})).json()
    _, olga_id = await person(other, "Olga")

    response = await put_member(alice, org, tree["payments"], olga_id)

    assert response.status_code == 404
    assert code(response) == "member_not_found"


async def test_being_in_a_group_counts_for_the_groups_above_it(alice, org, tree, person):
    _, bob_id = await person(org, "Bob")
    _, carol_id = await person(org, "Carol")
    await put_member(alice, org, tree["payments"], bob_id)
    await put_member(alice, org, tree["platform"], carol_id, is_lead=True)
    await put_member(alice, org, tree["engineering"], bob_id)
    url = f"{groups_url(org)}/{tree['engineering']['id']}/members"

    direct = (await alice.get(url)).json()
    everyone = (await alice.get(url, params={"include_subgroups": "true"})).json()

    assert [m["user"]["display_name"] for m in direct] == ["Bob"]
    people = {m["user"]["display_name"]: m for m in everyone}
    assert list(people) == ["Bob", "Carol"]
    assert people["Bob"]["direct"] is True
    assert [g["name"] for g in people["Bob"]["via"]] == ["Payments"]
    assert people["Carol"]["direct"] is False
    assert people["Carol"]["is_lead"] is False  # leads Platform, not Engineering
    assert [g["name"] for g in people["Carol"]["via"]] == ["Platform"]


async def test_the_groups_someone_counts_as_being_in(alice, org, tree, person):
    bob, bob_id = await person(org, "Bob")
    await put_member(alice, org, tree["payments"], bob_id, is_lead=True)

    response = await bob.get(f"{API}/orgs/{org['id']}/members/{bob_id}/groups")

    groups = {g["group"]["name"]: g for g in response.json()}
    assert list(groups) == ["Engineering", "Payments", "Platform"]
    assert groups["Payments"]["direct"] is True
    assert groups["Payments"]["is_lead"] is True
    assert groups["Platform"]["direct"] is False
    assert groups["Engineering"]["parent_id"] is None


async def test_anyone_can_leave_a_group(alice, org, tree, person):
    bob, bob_id = await person(org, "Bob")
    await put_member(alice, org, tree["payments"], bob_id)

    response = await bob.delete(f"{groups_url(org)}/{tree['payments']['id']}/members/{bob_id}")

    assert response.status_code == 204
    again = await bob.delete(f"{groups_url(org)}/{tree['payments']['id']}/members/{bob_id}")
    assert again.status_code == 404
    assert code(again) == "not_in_group"


async def test_taking_someone_else_out_needs_a_manager(alice, org, tree, person):
    bob, bob_id = await person(org, "Bob")
    _, carol_id = await person(org, "Carol")
    await put_member(alice, org, tree["payments"], bob_id)
    await put_member(alice, org, tree["payments"], carol_id)
    url = f"{groups_url(org)}/{tree['payments']['id']}/members/{carol_id}"

    assert (await bob.delete(url)).status_code == 403
    assert (await alice.delete(url)).status_code == 204


async def test_leaving_the_organization_leaves_its_groups(alice, org, tree, person):
    bob, bob_id = await person(org, "Bob")
    other = (await alice.post(f"{API}/orgs", json={"name": "Other"})).json()
    other_group = await group(alice, other, "Theirs")
    invitation = await alice.post(f"{API}/orgs/{other['id']}/invitations", json={})
    await bob.post(f"{API}/invitations/{invitation.json()['token']}/accept")
    await put_member(alice, org, tree["payments"], bob_id)
    await put_member(alice, other, other_group, bob_id)

    await bob.delete(f"{API}/orgs/{org['id']}/members/{bob_id}")

    members = (await alice.get(f"{groups_url(org)}/{tree['payments']['id']}/members")).json()
    assert members == []
    # Groups in other organizations are untouched.
    theirs = (await alice.get(f"{groups_url(other)}/{other_group['id']}/members")).json()
    assert [m["user"]["display_name"] for m in theirs] == ["Bob"]
