import asyncio
import hashlib

import pytest
from conftest import API, PASSWORD, code, sql


async def create_org(client, name="Acme"):
    response = await client.post(f"{API}/orgs", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


async def invite(client, org, **body):
    response = await client.post(f"{API}/orgs/{org['id']}/invitations", json=body)
    assert response.status_code == 201, response.text
    return response.json()


async def sign_up(client, token, name, email=None):
    return await client.post(
        f"{API}/invitations/{token}/sign-up",
        json={
            "email": email or f"{name.lower()}@example.com",
            "display_name": name,
            "password": PASSWORD,
        },
    )


@pytest.fixture
def join(new_client):
    """Brings a new person into `org` through an invitation from `inviter`.
    Returns their browser and their user id."""

    async def join(inviter, org, name, **invitation):
        token = (await invite(inviter, org, **invitation))["token"]
        browser = new_client()
        response = await sign_up(browser, token, name)
        assert response.status_code == 201, response.text
        return browser, response.json()["user"]["id"]

    return join


async def members(client, org):
    response = await client.get(f"{API}/orgs/{org['id']}/members")
    return {m["user"]["display_name"]: m for m in response.json()}


async def patch_member(client, org, user_id, **body):
    return await client.patch(f"{API}/orgs/{org['id']}/members/{user_id}", json=body)


async def remove(client, org, user_id):
    return await client.delete(f"{API}/orgs/{org['id']}/members/{user_id}")


async def my_id(client):
    return (await client.get(f"{API}/auth/me")).json()["id"]


# ---- Organizations ----


async def test_the_instance_admin_creates_an_organization_and_owns_it(alice):
    org = await create_org(alice, name="Acme Corp")

    assert org["name"] == "Acme Corp"
    assert org["version"] == 1
    assert org["membership"] == {"role": "owner", "title": "", "can_create_projects": True}
    listed = (await alice.get(f"{API}/orgs")).json()
    assert [o["id"] for o in listed] == [org["id"]]


async def test_only_the_instance_admin_creates_organizations(alice, join):
    org = await create_org(alice)
    bob, _ = await join(alice, org, "Bob", role="owner")

    response = await bob.post(f"{API}/orgs", json={"name": "Bob Co"})

    assert response.status_code == 403
    assert code(response) == "not_allowed"


async def test_organizations_need_a_session(client):
    assert (await client.get(f"{API}/orgs")).status_code == 401


async def test_names_need_not_be_unique(alice):
    first = await create_org(alice)
    second = await create_org(alice)

    assert first["id"] != second["id"]
    assert "slug" not in first  # addressed by id: /organizations/<id>


async def test_outsiders_cannot_tell_an_organization_exists(alice, join):
    acme = await create_org(alice)
    other = await create_org(alice, name="Other")
    outsider, _ = await join(alice, other, "Olga")
    base = f"{API}/orgs/{acme['id']}"

    responses = [
        await outsider.get(base),
        await outsider.patch(base, json={"version": 1, "name": "Mine"}),
        await outsider.delete(base),
        await outsider.get(f"{base}/members"),
        await outsider.get(f"{base}/invitations"),
        await outsider.post(f"{base}/invitations", json={}),
    ]

    assert {r.status_code for r in responses} == {404}
    assert {code(r) for r in responses} == {"organization_not_found"}
    assert [o["name"] for o in (await outsider.get(f"{API}/orgs")).json()] == ["Other"]


async def test_owners_rename_an_organization(alice):
    org = await create_org(alice)

    response = await alice.patch(f"{API}/orgs/{org['id']}", json={"version": 1, "name": "Acme Ltd"})

    assert response.status_code == 200
    assert response.json()["name"] == "Acme Ltd"
    assert response.json()["version"] == 2
    stale = await alice.patch(f"{API}/orgs/{org['id']}", json={"version": 1, "name": "X"})
    assert stale.status_code == 409
    assert code(stale) == "version_conflict"
    assert stale.json()["error"]["details"] == {"current_version": 2}


async def test_renaming_needs_a_name(alice):
    org = await create_org(alice)

    response = await alice.patch(f"{API}/orgs/{org['id']}", json={"version": 1})

    assert response.status_code == 422


async def test_admins_cannot_rename_or_delete_an_organization(alice, join):
    org = await create_org(alice)
    ann, _ = await join(alice, org, "Ann", role="admin")

    rename = await ann.patch(f"{API}/orgs/{org['id']}", json={"version": 1, "name": "X"})
    delete = await ann.delete(f"{API}/orgs/{org['id']}")

    assert [rename.status_code, delete.status_code] == [403, 403]
    assert rename.json()["error"]["details"] == {"role": "admin"}


async def test_owners_delete_an_organization(alice, join):
    org = await create_org(alice)
    bob, _ = await join(alice, org, "Bob")

    response = await alice.delete(f"{API}/orgs/{org['id']}")

    assert response.status_code == 204
    assert (await bob.get(f"{API}/orgs/{org['id']}")).status_code == 404
    assert (await sql("SELECT count(*) FROM org_memberships")).scalar_one() == 0


async def test_a_user_can_belong_to_several_organizations(alice, join, new_client):
    acme = await create_org(alice)
    other = await create_org(alice, name="Beta")
    bob, _ = await join(alice, acme, "Bob")
    token = (await invite(alice, other, title="Consultant"))["token"]

    response = await bob.post(f"{API}/invitations/{token}/accept")

    assert response.status_code == 200
    assert response.json()["membership"]["title"] == "Consultant"
    listed = (await bob.get(f"{API}/orgs")).json()
    assert [o["name"] for o in listed] == ["Acme", "Beta"]


# ---- Members ----


async def test_every_member_sees_who_is_in_the_organization(alice, join):
    org = await create_org(alice)
    bob, _ = await join(alice, org, "Bob", title="Developer")

    people = await members(bob, org)

    assert list(people) == ["Alice", "Bob"]
    assert people["Alice"]["role"] == "owner"
    assert people["Bob"]["title"] == "Developer"
    assert people["Bob"]["user"]["email"] == "bob@example.com"
    assert people["Bob"]["can_create_projects"] is False


async def test_admins_set_titles_and_who_may_create_projects(alice, join):
    org = await create_org(alice)
    ann, _ = await join(alice, org, "Ann", role="admin")
    _, bob_id = await join(alice, org, "Bob")

    response = await patch_member(
        ann, org, bob_id, title="  Senior Architect ", can_create_projects=True
    )

    assert response.status_code == 200
    assert response.json()["title"] == "Senior Architect"
    assert response.json()["can_create_projects"] is True
    cleared = await patch_member(ann, org, bob_id, title="")
    assert cleared.json()["title"] == ""


async def test_members_cannot_change_anyone(alice, join):
    org = await create_org(alice)
    bob, bob_id = await join(alice, org, "Bob")
    alice_id = await my_id(alice)

    responses = [
        await patch_member(bob, org, bob_id, title="CTO"),
        await patch_member(bob, org, bob_id, can_create_projects=True),
        await patch_member(bob, org, alice_id, role="member"),
        await remove(bob, org, alice_id),
    ]

    assert [r.status_code for r in responses] == [403, 403, 403, 403]
    assert {code(r) for r in responses} == {"not_allowed"}


async def test_owners_and_admins_can_always_create_projects(alice, join):
    org = await create_org(alice)
    _, ann_id = await join(alice, org, "Ann", role="admin", can_create_projects=False)

    assert (await members(alice, org))["Ann"]["can_create_projects"] is True


async def test_only_owners_change_roles(alice, join):
    org = await create_org(alice)
    ann, _ = await join(alice, org, "Ann", role="admin")
    _, bob_id = await join(alice, org, "Bob")

    by_admin = await patch_member(ann, org, bob_id, role="admin")
    by_owner = await patch_member(alice, org, bob_id, role="admin")

    assert by_admin.status_code == 403
    assert by_owner.status_code == 200
    assert by_owner.json()["role"] == "admin"


async def test_the_last_owner_cannot_step_down_or_leave(alice, join):
    org = await create_org(alice)
    alice_id = await my_id(alice)

    demote = await patch_member(alice, org, alice_id, role="admin")
    leave = await remove(alice, org, alice_id)

    assert [demote.status_code, leave.status_code] == [409, 409]
    assert {code(demote), code(leave)} == {"last_owner"}
    # Nothing else in the request was applied either.
    both = await patch_member(alice, org, alice_id, role="admin", title="CEO")
    assert both.status_code == 409
    assert (await members(alice, org))["Alice"]["title"] == ""


async def test_an_owner_steps_down_once_there_is_another(alice, join):
    org = await create_org(alice)
    bob, bob_id = await join(alice, org, "Bob", role="owner")
    alice_id = await my_id(alice)

    assert (await patch_member(alice, org, alice_id, role="member")).status_code == 200
    # Now Bob is the only owner.
    assert code(await remove(bob, org, bob_id)) == "last_owner"


async def test_two_owners_stepping_down_at_once_leave_one(alice, join):
    org = await create_org(alice)
    bob, bob_id = await join(alice, org, "Bob", role="owner")
    alice_id = await my_id(alice)

    responses = await asyncio.gather(
        patch_member(alice, org, alice_id, role="member"),
        patch_member(bob, org, bob_id, role="member"),
    )

    assert sorted(r.status_code for r in responses) == [200, 409]
    owners = [p for p in (await members(alice, org)).values() if p["role"] == "owner"]
    assert len(owners) == 1


async def test_admins_remove_members_but_not_admins(alice, join):
    org = await create_org(alice)
    ann, _ = await join(alice, org, "Ann", role="admin")
    _, ada_id = await join(alice, org, "Ada", role="admin")
    bob, bob_id = await join(alice, org, "Bob")

    assert (await remove(ann, org, bob_id)).status_code == 204
    assert (await remove(ann, org, ada_id)).status_code == 403
    assert (await remove(alice, org, ada_id)).status_code == 204
    assert list(await members(alice, org)) == ["Alice", "Ann"]
    # Bob is out: the organization no longer exists for him.
    assert (await bob.get(f"{API}/orgs/{org['id']}")).status_code == 404


async def test_anyone_can_leave(alice, join):
    org = await create_org(alice)
    bob, bob_id = await join(alice, org, "Bob")

    assert (await remove(bob, org, bob_id)).status_code == 204
    assert (await bob.get(f"{API}/orgs")).json() == []


async def test_changing_someone_not_in_the_organization(alice, join):
    org = await create_org(alice)
    other = await create_org(alice, name="Other")
    _, olga_id = await join(alice, other, "Olga")

    response = await patch_member(alice, org, olga_id, title="Spy")

    assert response.status_code == 404
    assert code(response) == "member_not_found"


async def test_a_member_change_must_change_something(alice):
    org = await create_org(alice)

    response = await patch_member(alice, org, await my_id(alice))

    assert response.status_code == 422


# ---- Invitations ----


async def test_an_invitation_hands_out_its_token_once(alice):
    org = await create_org(alice)

    created = await invite(alice, org, title="Developer", email="Bob@Example.com")

    assert created["status"] == "pending"
    assert created["role"] == "member"
    assert created["email"] == "bob@example.com"
    assert created["invited_by"]["display_name"] == "Alice"
    listed = (await alice.get(f"{API}/orgs/{org['id']}/invitations")).json()
    assert [i["id"] for i in listed] == [created["id"]]
    assert "token" not in listed[0]
    stored = (await sql("SELECT token_hash FROM org_invitations")).scalar_one()
    assert stored == hashlib.sha256(created["token"].encode()).hexdigest()


async def test_admins_invite_members_and_owners_invite_anyone(alice, join):
    org = await create_org(alice)
    ann, _ = await join(alice, org, "Ann", role="admin")

    by_admin = [
        await ann.post(f"{API}/orgs/{org['id']}/invitations", json={"role": role})
        for role in ("member", "admin", "owner")
    ]

    assert [r.status_code for r in by_admin] == [201, 403, 403]
    await invite(alice, org, role="owner")


async def test_members_cannot_invite_or_see_invitations(alice, join):
    org = await create_org(alice)
    bob, _ = await join(alice, org, "Bob")

    create = await bob.post(f"{API}/orgs/{org['id']}/invitations", json={})
    listing = await bob.get(f"{API}/orgs/{org['id']}/invitations")

    assert [create.status_code, listing.status_code] == [403, 403]


async def test_invitations_last_between_one_and_thirty_days(alice):
    org = await create_org(alice)
    for days in (0, 31):
        response = await alice.post(
            f"{API}/orgs/{org['id']}/invitations", json={"expires_in_days": days}
        )
        assert response.status_code == 422


async def test_inviting_someone_already_in_the_organization(alice):
    org = await create_org(alice)

    response = await alice.post(
        f"{API}/orgs/{org['id']}/invitations", json={"email": "alice@example.com"}
    )

    assert response.status_code == 409
    assert code(response) == "already_member"


async def test_anyone_with_the_link_sees_what_it_offers(alice, client, new_client):
    org = await create_org(alice, name="Acme Corp")
    token = (await invite(alice, org, role="admin", title="CTO"))["token"]

    response = await new_client().get(f"{API}/invitations/{token}")

    assert response.status_code == 200
    preview = response.json()
    assert preview["organization"] == {"id": org["id"], "name": "Acme Corp"}
    assert preview["role"] == "admin"
    assert preview["title"] == "CTO"
    assert preview["invited_by"] == "Alice"
    assert preview["email"] is None


async def test_a_made_up_link_is_not_an_invitation(client):
    response = await client.get(f"{API}/invitations/made-up")

    assert response.status_code == 404
    assert code(response) == "invitation_not_found"


async def test_signing_up_through_a_link(alice, new_client):
    org = await create_org(alice)
    token = (await invite(alice, org, title="Developer", can_create_projects=True))["token"]
    bob = new_client()

    response = await sign_up(bob, token, "Bob")

    assert response.status_code == 201
    body = response.json()
    assert body["user"]["email"] == "bob@example.com"
    assert body["user"]["is_instance_admin"] is False
    assert body["organization"]["membership"] == {
        "role": "member",
        "title": "Developer",
        "can_create_projects": True,
    }
    # Signed in straight away.
    assert (await bob.get(f"{API}/auth/me")).json()["display_name"] == "Bob"
    listed = (await alice.get(f"{API}/orgs/{org['id']}/invitations")).json()
    assert listed[0]["status"] == "accepted"
    assert listed[0]["accepted_by"]["display_name"] == "Bob"


async def test_a_link_works_once(alice, new_client):
    org = await create_org(alice)
    token = (await invite(alice, org))["token"]
    await sign_up(new_client(), token, "Bob")

    responses = [
        await new_client().get(f"{API}/invitations/{token}"),
        await sign_up(new_client(), token, "Carol"),
        await alice.post(f"{API}/invitations/{token}/accept"),
    ]

    assert {r.status_code for r in responses} == {410}
    assert {code(r) for r in responses} == {"invitation_used"}


async def test_two_people_using_one_link_at_once(alice, new_client):
    org = await create_org(alice)
    token = (await invite(alice, org))["token"]

    responses = await asyncio.gather(
        sign_up(new_client(), token, "Bob"), sign_up(new_client(), token, "Carol")
    )

    assert sorted(r.status_code for r in responses) == [201, 410]
    assert len(await members(alice, org)) == 2


async def test_an_email_with_an_account_signs_in_instead(alice, new_client):
    org = await create_org(alice)
    token = (await invite(alice, org))["token"]

    response = await sign_up(new_client(), token, "Alice")

    assert response.status_code == 409
    assert code(response) == "email_taken"
    # The link is still good.
    assert (await new_client().get(f"{API}/invitations/{token}")).status_code == 200


async def test_a_link_for_one_email_works_only_for_it(alice, join, new_client):
    org = await create_org(alice)
    other = await create_org(alice, name="Other")
    carol, _ = await join(alice, other, "Carol")
    token = (await invite(alice, org, email="bob@example.com"))["token"]

    wrong_sign_up = await sign_up(new_client(), token, "Mallory")
    wrong_accept = await carol.post(f"{API}/invitations/{token}/accept")
    right = await sign_up(new_client(), token, "Bob")

    assert [wrong_sign_up.status_code, wrong_accept.status_code] == [403, 403]
    assert code(wrong_accept) == "invitation_for_another_email"
    assert right.status_code == 201


async def test_accepting_when_already_a_member_leaves_the_link_unused(alice):
    org = await create_org(alice)
    token = (await invite(alice, org))["token"]

    response = await alice.post(f"{API}/invitations/{token}/accept")

    assert response.status_code == 409
    assert code(response) == "already_member"
    assert (await members(alice, org))["Alice"]["role"] == "owner"
    assert (await alice.get(f"{API}/invitations/{token}")).status_code == 200


async def test_accepting_needs_a_session(alice, new_client):
    org = await create_org(alice)
    token = (await invite(alice, org))["token"]

    response = await new_client().post(f"{API}/invitations/{token}/accept")

    assert response.status_code == 401


async def test_an_expired_link_no_longer_works(alice, new_client):
    org = await create_org(alice)
    token = (await invite(alice, org))["token"]
    await sql("UPDATE org_invitations SET expires_at = now() - interval '1 second'")

    response = await sign_up(new_client(), token, "Bob")

    assert response.status_code == 410
    assert code(response) == "invitation_expired"
    listed = (await alice.get(f"{API}/orgs/{org['id']}/invitations")).json()
    assert listed[0]["status"] == "expired"


async def test_a_revoked_link_no_longer_works(alice, new_client):
    org = await create_org(alice)
    created = await invite(alice, org)
    url = f"{API}/orgs/{org['id']}/invitations/{created['id']}"

    assert (await alice.delete(url)).status_code == 204
    assert (await alice.delete(url)).status_code == 204  # twice is fine

    response = await sign_up(new_client(), created["token"], "Bob")
    assert response.status_code == 410
    assert code(response) == "invitation_revoked"


async def test_a_used_link_cannot_be_revoked(alice, new_client):
    org = await create_org(alice)
    created = await invite(alice, org)
    await sign_up(new_client(), created["token"], "Bob")

    response = await alice.delete(f"{API}/orgs/{org['id']}/invitations/{created['id']}")

    assert response.status_code == 410
    assert code(response) == "invitation_used"


async def test_revoking_another_organizations_invitation(alice):
    acme = await create_org(alice)
    other = await create_org(alice, name="Other")
    created = await invite(alice, other)

    response = await alice.delete(f"{API}/orgs/{acme['id']}/invitations/{created['id']}")

    assert response.status_code == 404
    assert code(response) == "invitation_not_found"


async def test_signing_up_through_a_link_checks_the_password(alice, new_client):
    org = await create_org(alice)
    token = (await invite(alice, org))["token"]

    response = await new_client().post(
        f"{API}/invitations/{token}/sign-up",
        json={"email": "bob@example.com", "display_name": "Bob", "password": "short"},
    )

    assert response.status_code == 422
