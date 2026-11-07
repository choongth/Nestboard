import asyncio
import hashlib

import pytest
from conftest import API, PASSWORD, code, sql

NEW_PASSWORD = "battery staple"


@pytest.fixture
def person(person, org):
    """Brings someone into Acme, with the role given."""
    return lambda name, role="member": person(org, name, role=role)


async def make_reset(client, user_id, **body):
    return await client.post(f"{API}/admin/users/{user_id}/password-resets", json=body)


async def use(client, token, password=NEW_PASSWORD):
    return await client.post(f"{API}/password-resets/{token}", json={"new_password": password})


async def log_in(client, email, password):
    return await client.post(f"{API}/auth/login", json={"email": email, "password": password})


# ---- The instance admin's list of accounts ----


async def test_the_instance_admin_lists_every_account(alice, person):
    await person("Bob")

    response = await alice.get(f"{API}/admin/users")

    assert response.status_code == 200
    page = response.json()
    assert page["total"] == 2
    assert [u["email"] for u in page["items"]] == ["alice@example.com", "bob@example.com"]


async def test_nobody_else_lists_accounts(person):
    bob, _ = await person("Bob", role="owner")

    response = await bob.get(f"{API}/admin/users")

    assert response.status_code == 403
    assert code(response) == "not_allowed"


# ---- Making a link ----


async def test_the_instance_admin_makes_a_reset_link(alice, person):
    _, bob_id = await person("Bob")

    response = await make_reset(alice, bob_id)

    assert response.status_code == 201
    created = response.json()
    assert created["user"]["email"] == "bob@example.com"
    stored = (await sql("SELECT token_hash FROM password_resets")).scalar_one()
    assert stored == hashlib.sha256(created["token"].encode()).hexdigest()
    hours = (
        await sql("SELECT extract(epoch FROM expires_at - now()) / 3600 FROM password_resets")
    ).scalar_one()
    assert 23.9 < hours <= 24


async def test_organization_owners_cannot_make_reset_links(person):
    """Bob owns an organization, but Carol may belong to others too."""
    bob, _ = await person("Bob", role="owner")
    _, carol_id = await person("Carol")

    response = await make_reset(bob, carol_id)

    assert response.status_code == 403
    assert code(response) == "not_allowed"


async def test_making_a_link_for_an_unknown_account(alice):
    response = await make_reset(alice, "00000000-0000-0000-0000-000000000000")

    assert response.status_code == 404
    assert code(response) == "user_not_found"


async def test_links_last_between_one_and_seventy_two_hours(alice, person):
    _, bob_id = await person("Bob")
    for hours in (0, 73):
        assert (await make_reset(alice, bob_id, expires_in_hours=hours)).status_code == 422


# ---- Using a link ----


async def test_the_link_shows_whose_password_it_resets(alice, person, new_client):
    _, bob_id = await person("Bob")
    token = (await make_reset(alice, bob_id)).json()["token"]

    response = await new_client().get(f"{API}/password-resets/{token}")

    assert response.status_code == 200
    assert response.json()["email"] == "bob@example.com"
    assert response.json()["display_name"] == "Bob"


async def test_resetting_a_password(alice, person, new_client):
    bob, bob_id = await person("Bob")
    token = (await make_reset(alice, bob_id)).json()["token"]
    browser = new_client()

    response = await use(browser, token)

    assert response.status_code == 200
    assert response.json()["email"] == "bob@example.com"
    # This browser is signed in; every earlier session is signed out.
    assert (await browser.get(f"{API}/auth/me")).status_code == 200
    assert (await bob.get(f"{API}/auth/me")).status_code == 401
    assert (await log_in(new_client(), "bob@example.com", PASSWORD)).status_code == 401
    assert (await log_in(new_client(), "bob@example.com", NEW_PASSWORD)).status_code == 200


async def test_a_reset_clears_the_wait_after_wrong_passwords(alice, person, new_client):
    _, bob_id = await person("Bob")
    for _ in range(5):
        await log_in(new_client(), "bob@example.com", "a guess")
    token = (await make_reset(alice, bob_id)).json()["token"]

    await use(new_client(), token)

    assert (await log_in(new_client(), "bob@example.com", NEW_PASSWORD)).status_code == 200


async def test_a_link_works_once(alice, person, new_client):
    _, bob_id = await person("Bob")
    token = (await make_reset(alice, bob_id)).json()["token"]
    await use(new_client(), token)

    responses = [
        await new_client().get(f"{API}/password-resets/{token}"),
        await use(new_client(), token, "another password"),
    ]

    assert {r.status_code for r in responses} == {410}
    assert {code(r) for r in responses} == {"password_reset_used"}


async def test_using_one_link_twice_at_once(alice, person, new_client):
    _, bob_id = await person("Bob")
    token = (await make_reset(alice, bob_id)).json()["token"]

    responses = await asyncio.gather(
        use(new_client(), token, "first password"), use(new_client(), token, "second password")
    )

    assert sorted(r.status_code for r in responses) == [200, 410]


async def test_a_newer_link_retires_the_older_one(alice, person, new_client):
    _, bob_id = await person("Bob")
    old = (await make_reset(alice, bob_id)).json()["token"]
    new = (await make_reset(alice, bob_id)).json()["token"]

    response = await use(new_client(), old)

    assert response.status_code == 410
    assert code(response) == "password_reset_replaced"
    assert (await use(new_client(), new)).status_code == 200


async def test_an_expired_link_no_longer_works(alice, person, new_client):
    _, bob_id = await person("Bob")
    token = (await make_reset(alice, bob_id)).json()["token"]
    await sql("UPDATE password_resets SET expires_at = now() - interval '1 second'")

    response = await use(new_client(), token)

    assert response.status_code == 410
    assert code(response) == "password_reset_expired"


async def test_a_made_up_link_is_not_a_reset(client):
    response = await client.get(f"{API}/password-resets/made-up")

    assert response.status_code == 404
    assert code(response) == "password_reset_not_found"


async def test_the_new_password_is_checked(alice, person, new_client):
    _, bob_id = await person("Bob")
    token = (await make_reset(alice, bob_id)).json()["token"]

    response = await use(new_client(), token, "short")

    assert response.status_code == 422
    # The link is still good.
    assert (await new_client().get(f"{API}/password-resets/{token}")).status_code == 200
