import asyncio

import pytest
from conftest import API, code, grant, grants


async def new_project(client, org, name="Checkout"):
    return await client.post(f"{API}/orgs/{org['id']}/projects", json={"name": name})


@pytest.fixture
async def project(alice, org):
    """Checkout, owned by Alice, with a diagram and a proposed ADR."""
    created = (await new_project(alice, org)).json()
    diagram = (
        await alice.post(f"{API}/projects/{created['id']}/diagrams", json={"name": "Shop"})
    ).json()
    adr = (
        await alice.post(
            f"{API}/projects/{diagram['project_id']}/adrs", json={"title": "Use Postgres"}
        )
    ).json()
    return {**created, "diagram": diagram, "adr": adr}


async def roles_seen(client, org):
    listed = (await client.get(f"{API}/orgs/{org['id']}/projects")).json()
    return {p["name"]: p["role"] for p in listed}


# ---- Projects ----


async def test_creating_a_project_makes_you_its_owner(alice, org):
    response = await new_project(alice, org)

    assert response.status_code == 201
    created = response.json()
    assert created["role"] == "owner"
    assert created["organization"] == {"id": org["id"], "name": "Acme"}
    assert await roles_seen(alice, org) == {"Checkout": "owner"}
    activity = (await alice.get(f"{API}/projects/{created['id']}/activity")).json()
    assert [(a["kind"], a["actor"]["display_name"]) for a in activity] == [("created", "Alice")]


async def test_creating_projects_needs_the_switch(org, person):
    bob, _ = await person(org, "Bob")
    carol, _ = await person(org, "Carol", can_create_projects=True)

    refused = await new_project(bob, org)
    allowed = await new_project(carol, org)

    assert refused.status_code == 403
    assert code(refused) == "not_allowed"
    assert allowed.status_code == 201


async def test_project_names_need_not_be_unique(alice, org):
    first = await new_project(alice, org)
    again = await new_project(alice, org)

    assert again.status_code == 201
    assert again.json()["id"] != first.json()["id"]


async def test_without_a_grant_a_project_does_not_exist(org, project, person):
    bob, _ = await person(org, "Bob")

    responses = {
        "project": await bob.get(f"{API}/projects/{project['id']}"),
        "diagrams": await bob.get(f"{API}/projects/{project['id']}/diagrams"),
        "diagram": await bob.get(f"{API}/diagrams/{project['diagram']['id']}"),
        "adrs": await bob.get(f"{API}/projects/{project['id']}/adrs"),
        "adr": await bob.get(f"{API}/adrs/{project['adr']['id']}"),
        "grants": await bob.get(f"{API}/projects/{project['id']}/grants"),
    }

    assert {k: r.status_code for k, r in responses.items()} == dict.fromkeys(responses, 404)
    assert code(responses["project"]) == "project_not_found"
    assert code(responses["diagram"]) == "diagram_not_found"
    assert code(responses["adr"]) == "adr_not_found"
    assert await roles_seen(bob, org) == {}


async def test_diagrams_and_adrs_need_a_session(client, project):
    responses = [
        await client.get(f"{API}/diagrams/{project['diagram']['id']}"),
        await client.get(f"{API}/projects/{project['id']}/adrs"),
        await client.get(f"{API}/adrs/{project['adr']['id']}"),
    ]
    client.cookies.clear()
    responses += [
        await client.get(f"{API}/diagrams/{project['diagram']['id']}"),
        await client.get(f"{API}/adrs/{project['adr']['id']}"),
    ]

    assert [r.status_code for r in responses] == [200, 200, 200, 401, 401]


async def test_org_admins_see_every_project_name_but_not_its_content(org, project, person):
    ann, _ = await person(org, "Ann", role="admin")

    assert await roles_seen(ann, org) == {"Checkout": None}
    assert (await ann.get(f"{API}/projects/{project['id']}")).status_code == 404
    assert (await ann.get(f"{API}/diagrams/{project['diagram']['id']}")).status_code == 404


async def test_org_admins_take_over_a_project_and_everyone_sees_it(alice, org, project, person):
    ann, _ = await person(org, "Ann", role="admin")

    response = await ann.post(f"{API}/projects/{project['id']}/take-over")

    assert response.status_code == 200
    assert response.json()["role"] == "owner"
    assert (await ann.get(f"{API}/diagrams/{project['diagram']['id']}")).status_code == 200
    activity = (await alice.get(f"{API}/projects/{project['id']}/activity")).json()
    assert activity[0]["kind"] == "taken_over"
    assert activity[0]["actor"]["display_name"] == "Ann"


async def test_members_cannot_take_over_a_project(org, project, person):
    bob, _ = await person(org, "Bob")

    response = await bob.post(f"{API}/projects/{project['id']}/take-over")

    assert response.status_code == 403


async def test_owners_rename_a_project(alice, org, project, person):
    bob, bob_id = await person(org, "Bob")
    await grant(alice, project, "editor", user_id=bob_id)
    url = f"{API}/projects/{project['id']}"

    by_editor = await bob.patch(url, json={"version": 1, "name": "Mine"})
    by_owner = await alice.patch(url, json={"version": 1, "name": "Checkout 2"})
    stale = await alice.patch(url, json={"version": 1, "name": "Again"})

    assert by_editor.status_code == 403
    assert by_owner.status_code == 200
    assert by_owner.json()["name"] == "Checkout 2"
    assert stale.status_code == 409
    assert code(stale) == "version_conflict"


async def test_owners_delete_a_project_with_everything_in_it(alice, org, project, person):
    bob, bob_id = await person(org, "Bob")
    await grant(alice, project, "editor", user_id=bob_id)

    assert (await bob.delete(f"{API}/projects/{project['id']}")).status_code == 403
    assert (await alice.delete(f"{API}/projects/{project['id']}")).status_code == 204
    assert (await alice.get(f"{API}/diagrams/{project['diagram']['id']}")).status_code == 404
    assert await roles_seen(alice, org) == {}


async def test_diagrams_belong_to_their_project(alice, org, project):
    other = (await new_project(alice, org, name="Other")).json()
    await alice.post(f"{API}/projects/{other['id']}/diagrams", json={"name": "Elsewhere"})

    listed = (await alice.get(f"{API}/projects/{project['id']}/diagrams")).json()

    assert [d["name"] for d in listed["items"]] == ["Shop"]
    assert listed["items"][0]["project_id"] == project["id"]


# ---- What each role may do ----


async def try_everything(client, project):
    """Status codes for one request of each kind."""
    diagram, adr = project["diagram"], project["adr"]
    current = (await client.get(f"{API}/diagrams/{diagram['id']}")).json()
    adr_now = await client.get(f"{API}/adrs/{adr['id']}")
    version = adr_now.json().get("version", 1)
    return {
        "read diagram": (await client.get(f"{API}/diagrams/{diagram['id']}")).status_code,
        "read adrs": (await client.get(f"{API}/projects/{diagram['project_id']}/adrs")).status_code,
        "save diagram": (
            await client.patch(
                f"{API}/diagrams/{diagram['id']}",
                json={"version": current.get("version", 1), "name": "Renamed"},
            )
        ).status_code,
        "propose adr": (
            await client.post(f"{API}/projects/{diagram['project_id']}/adrs", json={"title": "New"})
        ).status_code,
        "edit adr": (
            await client.patch(
                f"{API}/adrs/{adr['id']}", json={"version": version, "context": "Why"}
            )
        ).status_code,
        "create diagram": (
            await client.post(f"{API}/projects/{project['id']}/diagrams", json={"name": "X"})
        ).status_code,
        "decide adr": (
            await client.post(
                f"{API}/adrs/{adr['id']}/transition",
                json={"version": version + 1, "to": "accepted"},
            )
        ).status_code,
        "give access": (
            await client.put(
                f"{API}/projects/{project['id']}/grants",
                json={"user_id": current.get("id", adr["id"]), "role": "viewer"},
            )
        ).status_code,
    }


async def test_viewers_only_read(alice, org, project, person):
    bob, bob_id = await person(org, "Bob")
    await grant(alice, project, "viewer", user_id=bob_id)

    results = await try_everything(bob, project)

    assert results == {
        "read diagram": 200,
        "read adrs": 200,
        "save diagram": 403,
        "propose adr": 403,
        "edit adr": 403,
        "create diagram": 403,
        "decide adr": 403,
        "give access": 403,
    }


async def test_editors_edit_but_do_not_decide(alice, org, project, person):
    bob, bob_id = await person(org, "Bob")
    await grant(alice, project, "editor", user_id=bob_id)

    results = await try_everything(bob, project)

    assert results == {
        "read diagram": 200,
        "read adrs": 200,
        "save diagram": 200,
        "propose adr": 201,
        "edit adr": 200,
        "create diagram": 201,
        "decide adr": 403,
        "give access": 403,
    }


async def test_editors_create_diagrams_but_only_owners_delete_them(alice, org, project, person):
    bob, bob_id = await person(org, "Bob")
    await grant(alice, project, "editor", user_id=bob_id)
    mine = await bob.post(f"{API}/projects/{project['id']}/diagrams", json={"name": "Mine"})

    by_bob = await bob.delete(f"{API}/diagrams/{mine.json()['id']}")
    by_alice = await alice.delete(f"{API}/diagrams/{mine.json()['id']}")

    assert mine.status_code == 201
    assert by_bob.status_code == 403
    assert by_alice.status_code == 204


async def test_owners_decide(alice, project):
    adr = project["adr"]

    response = await alice.post(
        f"{API}/adrs/{adr['id']}/transition", json={"version": adr["version"], "to": "accepted"}
    )

    assert response.status_code == 200


async def test_superseding_needs_an_owner(alice, org, project, person):
    bob, bob_id = await person(org, "Bob")
    await grant(alice, project, "editor", user_id=bob_id)
    adr = project["adr"]
    await alice.post(
        f"{API}/adrs/{adr['id']}/transition", json={"version": adr["version"], "to": "accepted"}
    )
    mine = (await bob.post(f"{API}/projects/{project['id']}/adrs", json={"title": "Mine"})).json()

    supersede = await bob.post(f"{API}/adrs/{adr['id']}/supersede", json={})
    relation = await bob.put(
        f"{API}/adrs/{mine['id']}/relations",
        json={
            "version": mine["version"],
            "relations": [{"kind": "supersedes", "adr_id": adr["id"]}],
        },
    )
    amends = await bob.put(
        f"{API}/adrs/{mine['id']}/relations",
        json={"version": mine["version"], "relations": [{"kind": "amends", "adr_id": adr["id"]}]},
    )

    assert [supersede.status_code, relation.status_code, amends.status_code] == [403, 403, 200]


# ---- Grants ----


async def test_a_grant_to_a_group_covers_its_subgroups(alice, org, project, person):
    bob, bob_id = await person(org, "Bob")
    engineering = (await alice.post(f"{API}/orgs/{org['id']}/groups", json={"name": "Eng"})).json()
    payments = (
        await alice.post(
            f"{API}/orgs/{org['id']}/groups",
            json={"name": "Payments", "parent_id": engineering["id"]},
        )
    ).json()
    await alice.put(f"{API}/orgs/{org['id']}/groups/{payments['id']}/members/{bob_id}", json={})

    response = await grant(alice, project, "editor", group_id=engineering["id"])

    assert response.status_code == 200
    assert response.json()["group"]["name"] == "Eng"
    assert await roles_seen(bob, org) == {"Checkout": "editor"}


async def test_the_highest_grant_wins(alice, org, project, person):
    bob, bob_id = await person(org, "Bob")
    team = (await alice.post(f"{API}/orgs/{org['id']}/groups", json={"name": "Team"})).json()
    await alice.put(f"{API}/orgs/{org['id']}/groups/{team['id']}/members/{bob_id}", json={})
    await grant(alice, project, "viewer", user_id=bob_id)
    await grant(alice, project, "editor", group_id=team["id"])

    assert await roles_seen(bob, org) == {"Checkout": "editor"}


async def test_giving_a_grant_again_changes_the_role(alice, org, project, person):
    _, bob_id = await person(org, "Bob")
    await grant(alice, project, "viewer", user_id=bob_id)

    response = await grant(alice, project, "editor", user_id=bob_id)

    assert response.json()["role"] == "editor"
    listed = await grants(alice, project)
    assert [(g["user"]["display_name"], g["role"]) for g in listed] == [
        ("Alice", "owner"),
        ("Bob", "editor"),
    ]


async def test_grants_go_only_to_the_organization(alice, org, project, person):
    other = (await alice.post(f"{API}/orgs", json={"name": "Other"})).json()
    _, olga_id = await person(other, "Olga")
    theirs = (await alice.post(f"{API}/orgs/{other['id']}/groups", json={"name": "T"})).json()

    to_outsider = await grant(alice, project, "viewer", user_id=olga_id)
    to_their_group = await grant(alice, project, "viewer", group_id=theirs["id"])
    to_both = await alice.put(
        f"{API}/projects/{project['id']}/grants",
        json={"user_id": olga_id, "group_id": theirs["id"], "role": "viewer"},
    )

    assert [to_outsider.status_code, to_their_group.status_code, to_both.status_code] == [
        404,
        404,
        422,
    ]
    assert code(to_outsider) == "member_not_found"
    assert code(to_their_group) == "group_not_found"


async def test_the_last_owner_cannot_be_demoted_or_removed(alice, project):
    mine = (await grants(alice, project))[0]

    demote = await grant(alice, project, "editor", user_id=mine["user"]["id"])
    remove = await alice.delete(f"{API}/projects/{project['id']}/grants/{mine['id']}")

    assert [demote.status_code, remove.status_code] == [409, 409]
    assert {code(demote), code(remove)} == {"last_owner"}


async def test_an_owner_grant_to_a_group_counts_as_an_owner(alice, org, project):
    team = (await alice.post(f"{API}/orgs/{org['id']}/groups", json={"name": "Leads"})).json()
    await grant(alice, project, "owner", group_id=team["id"])
    mine = next(g for g in await grants(alice, project) if g["user"])

    response = await alice.delete(f"{API}/projects/{project['id']}/grants/{mine['id']}")

    assert response.status_code == 204


async def test_two_owners_removing_each_other_at_once_leave_one(alice, org, project, person):
    bob, bob_id = await person(org, "Bob")
    await grant(alice, project, "owner", user_id=bob_id)
    by_name = {g["user"]["display_name"]: g["id"] for g in await grants(alice, project)}

    responses = await asyncio.gather(
        alice.delete(f"{API}/projects/{project['id']}/grants/{by_name['Bob']}"),
        bob.delete(f"{API}/projects/{project['id']}/grants/{by_name['Alice']}"),
    )

    # The first removal wins; by the time the second runs, its sender is no
    # longer in the project at all.
    assert sorted(r.status_code for r in responses) == [204, 404]
    winner = [alice, bob][[r.status_code for r in responses].index(204)]
    assert len(await grants(winner, project)) == 1


async def test_viewers_see_who_has_access(alice, org, project, person):
    bob, bob_id = await person(org, "Bob")
    await grant(alice, project, "viewer", user_id=bob_id)

    listed = await grants(bob, project)

    assert [g["role"] for g in listed] == ["owner", "viewer"]


async def test_leaving_the_organization_removes_your_grants(alice, org, project, person):
    bob, bob_id = await person(org, "Bob")
    await grant(alice, project, "editor", user_id=bob_id)

    await bob.delete(f"{API}/orgs/{org['id']}/members/{bob_id}")

    assert [g["user"]["display_name"] for g in await grants(alice, project)] == ["Alice"]


async def test_access_changes_are_in_the_activity(alice, org, project, person):
    _, bob_id = await person(org, "Bob")
    await grant(alice, project, "editor", user_id=bob_id)
    bob_grant = next(g for g in await grants(alice, project) if g["user"]["id"] == bob_id)
    await alice.delete(f"{API}/projects/{project['id']}/grants/{bob_grant['id']}")

    activity = (await alice.get(f"{API}/projects/{project['id']}/activity")).json()

    assert [a["kind"] for a in activity] == ["grant_removed", "grant_set", "created"]
    assert activity[1]["details"] == {"role": "editor", "user_id": bob_id, "name": "Bob"}
