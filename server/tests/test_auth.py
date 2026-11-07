import asyncio
import hashlib

from conftest import code, sql

from app.auth import COOKIE

ALICE = {"email": "alice@example.com", "display_name": "Alice", "password": "correct horse"}


async def set_up(client, **overrides):
    return await client.post("/api/v1/auth/setup", json={**ALICE, **overrides})


async def log_in(client, email=ALICE["email"], password=ALICE["password"]):
    return await client.post("/api/v1/auth/login", json={"email": email, "password": password})


async def me(client):
    return await client.get("/api/v1/auth/me")


# ---- First sign-up ----


async def test_a_new_nestboard_needs_setting_up(client):
    response = await client.get("/api/v1/auth/status")
    assert response.json() == {"needs_setup": True}


async def test_the_first_account_is_the_instance_admin_and_is_signed_in(client):
    response = await set_up(client)

    assert response.status_code == 201
    user = response.json()
    assert user["email"] == "alice@example.com"
    assert user["display_name"] == "Alice"
    assert user["is_instance_admin"] is True
    assert "password" not in str(user)
    assert (await me(client)).json()["id"] == user["id"]
    assert (await client.get("/api/v1/auth/status")).json() == {"needs_setup": False}


async def test_setting_up_works_only_once(client, other_client):
    await set_up(client)

    response = await set_up(other_client, email="mallory@example.com")

    assert response.status_code == 409
    assert code(response) == "already_set_up"


async def test_two_setups_at_once_make_one_admin(client, other_client):
    responses = await asyncio.gather(set_up(client), set_up(other_client, email="bob@example.com"))

    assert sorted(r.status_code for r in responses) == [201, 409]
    count = (await sql("SELECT count(*) FROM users")).scalar_one()
    assert count == 1


async def test_emails_are_stored_lower_cased(client):
    response = await set_up(client, email="  Alice@Example.COM ")

    assert response.json()["email"] == "alice@example.com"


async def test_setup_checks_its_input(client):
    for overrides in (
        {"password": "short"},
        {"password": "        "},
        {"email": "not-an-email"},
        {"display_name": "   "},
    ):
        response = await set_up(client, **overrides)
        assert response.status_code == 422, overrides
        assert code(response) == "validation_failed"


async def test_spaces_in_a_password_are_kept(client, other_client):
    await set_up(client, password="  padded password  ")

    assert (await log_in(other_client, password="padded password")).status_code == 401
    assert (await log_in(other_client, password="  padded password  ")).status_code == 200


# ---- What is stored ----


async def test_passwords_are_stored_as_argon2_hashes(client):
    await set_up(client)

    stored = (await sql("SELECT password_hash FROM users")).scalar_one()
    assert stored.startswith("$argon2id$")
    assert ALICE["password"] not in stored


async def test_only_a_hash_of_the_session_token_is_stored(client):
    await set_up(client)

    token = client.cookies[COOKIE]
    stored = (await sql("SELECT token_hash FROM user_sessions")).scalar_one()
    assert stored == hashlib.sha256(token.encode()).hexdigest()
    assert stored != token


async def test_the_session_cookie_is_out_of_reach_of_scripts(client):
    response = await set_up(client)

    cookie = response.headers["set-cookie"].lower()
    assert cookie.startswith(f"{COOKIE}=")
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    assert "path=/api" in cookie
    assert "max-age=2592000" in cookie  # 30 days


# ---- Signing in and out ----


async def test_signing_in(client, other_client):
    await set_up(client)

    response = await log_in(other_client, email=" ALICE@example.com")

    assert response.status_code == 200
    assert response.json()["email"] == "alice@example.com"
    assert (await me(other_client)).status_code == 200


async def test_a_wrong_password_and_an_unknown_email_look_the_same(client, other_client):
    await set_up(client)

    wrong_password = await log_in(other_client, password="wrong password")
    unknown_email = await log_in(other_client, email="nobody@example.com")

    for response in (wrong_password, unknown_email):
        assert response.status_code == 401
        assert response.json() == {
            "error": {"code": "invalid_credentials", "message": "The email or password is wrong."}
        }
    assert COOKIE not in other_client.cookies


async def test_without_a_session_you_are_not_signed_in(client):
    response = await me(client)

    assert response.status_code == 401
    assert code(response) == "not_signed_in"


async def test_a_made_up_token_is_not_a_session(client):
    await set_up(client)
    client.cookies.set(COOKIE, "made-up", path="/api")

    assert (await me(client)).status_code == 401


async def test_signing_out_ends_the_session(client):
    await set_up(client)
    token = client.cookies[COOKIE]

    response = await client.post("/api/v1/auth/logout")

    assert response.status_code == 204
    assert COOKIE not in client.cookies
    # The old token no longer works, even if a copy of the cookie survived.
    client.cookies.set(COOKIE, token, path="/api")
    assert (await me(client)).status_code == 401


async def test_signing_out_leaves_other_sessions_alone(client, other_client):
    await set_up(client)
    await log_in(other_client)

    await other_client.post("/api/v1/auth/logout")

    assert (await me(client)).status_code == 200
    assert (await me(other_client)).status_code == 401


async def test_signing_out_without_a_session_is_fine(client):
    assert (await client.post("/api/v1/auth/logout")).status_code == 204


async def test_an_expired_session_is_not_signed_in(client):
    await set_up(client)
    await sql("UPDATE user_sessions SET expires_at = now() - interval '1 second'")

    response = await me(client)

    assert response.status_code == 401
    assert code(response) == "not_signed_in"


async def test_using_a_session_keeps_it_alive(client):
    await set_up(client)
    await sql("UPDATE user_sessions SET expires_at = now() + interval '2 days'")

    response = await me(client)

    assert response.status_code == 200
    days_left = (
        await sql("SELECT extract(epoch FROM expires_at - now()) / 86400 FROM user_sessions")
    ).scalar_one()
    assert 29.9 < days_left <= 30
    assert "max-age=259" in response.headers["set-cookie"].lower()  # ~30 days again


async def test_signing_in_tidies_up_ended_sessions(client, other_client):
    await set_up(client)
    await sql("UPDATE user_sessions SET expires_at = now() - interval '1 second'")

    await log_in(other_client)

    assert (await sql("SELECT count(*) FROM user_sessions")).scalar_one() == 1


# ---- Wrong passwords in a row ----


async def fail(client, times, email=ALICE["email"]):
    for _ in range(times):
        assert (await log_in(client, email=email, password="wrong password")).status_code == 401


async def test_after_five_wrong_passwords_the_next_try_must_wait(client, other_client):
    await set_up(client)
    await fail(other_client, 5)

    # Even the right password: the wait comes first.
    response = await log_in(other_client)

    assert response.status_code == 429
    assert code(response) == "too_many_attempts"
    assert 0 < response.json()["error"]["details"]["retry_after"] <= 30
    assert response.headers["retry-after"] == str(
        response.json()["error"]["details"]["retry_after"]
    )


async def test_after_the_wait_the_right_password_works_and_resets_the_count(client, other_client):
    await set_up(client)
    await fail(other_client, 5)
    await sql("UPDATE login_throttles SET last_failure_at = now() - interval '31 seconds'")

    assert (await log_in(other_client)).status_code == 200
    assert (await sql("SELECT count(*) FROM login_throttles")).scalar_one() == 0


async def test_each_further_wrong_password_doubles_the_wait(client, other_client):
    await set_up(client)
    await fail(other_client, 5)
    await sql("UPDATE login_throttles SET last_failure_at = now() - interval '31 seconds'")
    await fail(other_client, 1)

    response = await log_in(other_client)

    assert response.status_code == 429
    assert 30 < response.json()["error"]["details"]["retry_after"] <= 60


async def test_the_wait_is_capped_at_fifteen_minutes(client, other_client):
    await set_up(client)
    await sql("INSERT INTO login_throttles VALUES (:email, 500, now())", email=ALICE["email"])

    response = await log_in(other_client)

    assert response.json()["error"]["details"]["retry_after"] == 900


async def test_unknown_emails_are_throttled_too(client):
    await fail(client, 5, email="nobody@example.com")

    response = await log_in(client, email="nobody@example.com")

    assert response.status_code == 429


async def test_wrong_passwords_for_one_email_do_not_slow_down_another(client, other_client):
    await set_up(client)
    await fail(other_client, 5, email="nobody@example.com")

    assert (await log_in(other_client)).status_code == 200


# ---- Your own account ----


async def test_changing_your_display_name(client):
    await set_up(client)

    response = await client.patch("/api/v1/auth/me", json={"display_name": "  Alice Tan "})

    assert response.json()["display_name"] == "Alice Tan"
    assert (await me(client)).json()["display_name"] == "Alice Tan"
    blank = await client.patch("/api/v1/auth/me", json={"display_name": " "})
    assert blank.status_code == 422


async def test_changing_your_password(client, other_client):
    await set_up(client)
    await log_in(other_client)

    response = await client.post(
        "/api/v1/auth/me/password",
        json={"current_password": ALICE["password"], "new_password": "battery staple"},
    )

    assert response.status_code == 204
    # This session stays; every other one is signed out.
    assert (await me(client)).status_code == 200
    assert (await me(other_client)).status_code == 401
    assert (await log_in(other_client)).status_code == 401
    assert (await log_in(other_client, password="battery staple")).status_code == 200


async def test_changing_your_password_needs_the_current_one(client):
    await set_up(client)

    response = await client.post(
        "/api/v1/auth/me/password",
        json={"current_password": "a guess", "new_password": "battery staple"},
    )

    assert response.status_code == 422
    assert code(response) == "wrong_password"
    assert (await me(client)).status_code == 200


async def test_guessing_the_current_password_is_throttled(client):
    await set_up(client)
    for _ in range(5):
        await client.post(
            "/api/v1/auth/me/password",
            json={"current_password": "a guess", "new_password": "battery staple"},
        )

    response = await client.post(
        "/api/v1/auth/me/password",
        json={"current_password": ALICE["password"], "new_password": "battery staple"},
    )

    assert response.status_code == 429


async def test_your_account_needs_a_session(client):
    responses = [
        await client.patch("/api/v1/auth/me", json={"display_name": "X"}),
        await client.post(
            "/api/v1/auth/me/password",
            json={"current_password": "x", "new_password": "battery staple"},
        ),
    ]
    assert [r.status_code for r in responses] == [401, 401]
