"""Inviting many people at once from a CSV file (POST /orgs/{id}/invitations/import)."""

from conftest import API, PASSWORD, code, sql


async def import_csv(client, org, text, **body):
    return await client.post(
        f"{API}/orgs/{org['id']}/invitations/import", json={"csv": text, **body}
    )


def by_email(response):
    return {row["email"]: row for row in response.json()["rows"]}


async def test_everyone_in_the_file_gets_their_own_link(alice, org, new_client):
    response = await import_csv(
        alice,
        org,
        "email,name,job title,role\n"
        "Bob@Example.com,Bob Lee,Developer,member\n"
        "carol@example.com,Carol Tan,Architect,admin\n"
        "dan@example.com,,,\n",
    )

    assert response.status_code == 200, response.text
    result = response.json()
    assert (result["invited"], result["skipped"]) == (3, 0)
    rows = by_email(response)
    bob = rows["bob@example.com"]
    assert (bob["line"], bob["problem"]) == (2, None)
    assert bob["invitation"]["email"] == "bob@example.com"
    assert bob["invitation"]["name"] == "Bob Lee"
    assert bob["invitation"]["title"] == "Developer"
    assert bob["invitation"]["role"] == "member"
    assert bob["invitation"]["can_create_projects"] is False
    assert rows["carol@example.com"]["invitation"]["role"] == "admin"
    dan = rows["dan@example.com"]["invitation"]
    assert (dan["name"], dan["title"], dan["role"]) == (None, "", "member")
    tokens = {row["invitation"]["token"] for row in rows.values()}
    assert len(tokens) == 3

    # The link shows the name, for the sign-up form, and works only for its email.
    preview = (await new_client().get(f"{API}/invitations/{bob['invitation']['token']}")).json()
    assert (preview["name"], preview["email"]) == ("Bob Lee", "bob@example.com")
    wrong = await new_client().post(
        f"{API}/invitations/{bob['invitation']['token']}/sign-up",
        json={"email": "eve@example.com", "display_name": "Eve", "password": PASSWORD},
    )
    assert code(wrong) == "invitation_for_another_email"
    signed_up = await new_client().post(
        f"{API}/invitations/{bob['invitation']['token']}/sign-up",
        json={"email": "bob@example.com", "display_name": "Bob", "password": PASSWORD},
    )
    assert signed_up.status_code == 201, signed_up.text

    # Tokens are handed out only in the import's response.
    listed = (await alice.get(f"{API}/orgs/{org['id']}/invitations")).json()
    assert len(listed) == 3
    assert all("token" not in i for i in listed)
    assert {i["name"] for i in listed} == {"Bob Lee", "Carol Tan", None}


async def test_a_dry_run_checks_the_file_without_inviting_anyone(alice, org):
    response = await import_csv(
        alice, org, "email,role\nbob@example.com,member\nnot-an-email,member\n", dry_run=True
    )

    assert response.status_code == 200, response.text
    result = response.json()
    assert (result["invited"], result["skipped"]) == (0, 1)
    rows = by_email(response)
    assert rows["bob@example.com"] == {
        "line": 2,
        "email": "bob@example.com",
        "name": None,
        "title": "",
        "role": "member",
        "problem": None,
        "invitation": None,
    }
    assert rows["not-an-email"]["problem"]["code"] == "invalid_email"
    assert (await sql("SELECT count(*) FROM org_invitations")).scalar_one() == 0


async def test_rows_that_cannot_be_invited_are_skipped_and_say_why(alice, org):
    await alice.post(f"{API}/orgs/{org['id']}/invitations", json={"email": "pending@example.com"})

    response = await import_csv(
        alice,
        org,
        "email,name,job title,role\n"
        "ok@example.com,Ok,,\n"
        ",No Email,,\n"
        "nope,Bad,,\n"
        "OK@example.com,Twice,,\n"
        "alice@example.com,Alice,,\n"
        "pending@example.com,Pending,,\n"
        "role@example.com,Role,,boss\n"
        f"title@example.com,Title,{'x' * 101},\n"
        "cells@example.com,Cells,,,extra\n",
    )

    assert response.status_code == 200, response.text
    result = response.json()
    assert (result["invited"], result["skipped"]) == (1, 8)
    problems = [(row["line"], (row["problem"] or {}).get("code")) for row in result["rows"]]
    assert problems == [
        (2, None),
        (3, "missing_email"),
        (4, "invalid_email"),
        (5, "duplicate_email"),
        (6, "already_member"),
        (7, "already_invited"),
        (8, "unknown_role"),
        (9, "invalid_title"),
        (10, "too_many_cells"),
    ]
    assert all(row["problem"]["message"] for row in result["rows"][1:])
    emails = (await sql("SELECT email FROM org_invitations ORDER BY email")).scalars().all()
    assert emails == ["ok@example.com", "pending@example.com"]


async def test_an_expired_or_revoked_invitation_does_not_block_a_new_one(alice, org):
    for email in ("old@example.com", "gone@example.com"):
        await alice.post(f"{API}/orgs/{org['id']}/invitations", json={"email": email})
    await sql("UPDATE org_invitations SET expires_at = now() WHERE email = 'old@example.com'")
    await sql("UPDATE org_invitations SET revoked_at = now() WHERE email = 'gone@example.com'")

    response = await import_csv(alice, org, "email\nold@example.com\ngone@example.com\n")

    assert response.json()["invited"] == 2


async def test_admins_import_members_but_only_owners_import_admins_and_owners(alice, org, person):
    ann, _ = await person(org, "Ann", role="admin")

    response = await import_csv(
        ann,
        org,
        "email,role\nm@example.com,member\na@example.com,admin\no@example.com,Owner\n",
    )

    assert response.status_code == 200, response.text
    rows = by_email(response)
    assert rows["m@example.com"]["invitation"] is not None
    assert rows["a@example.com"]["problem"]["code"] == "role_needs_owner"
    assert rows["o@example.com"]["problem"]["code"] == "role_needs_owner"


async def test_members_and_signed_out_people_cannot_import(alice, org, person, new_client):
    bob, _ = await person(org, "Bob")

    by_member = await import_csv(bob, org, "email\nx@example.com\n")
    signed_out = await import_csv(new_client(), org, "email\nx@example.com\n")

    assert by_member.status_code == 403
    assert code(by_member) == "not_allowed"
    assert signed_out.status_code == 401


async def test_spreadsheet_exports_are_read_as_written(alice, org):
    # Excel's "CSV UTF-8" adds a byte-order mark, and some regions use ";".
    text = (
        chr(0xFEFF)
        + 'Email Address;Full_Name;JOB-TITLE;Role\r\nbob@example.com;"Lee; Bob";"Dev, Ops";\r\n\r\n'
    )

    response = await import_csv(alice, org, text)

    assert response.status_code == 200, response.text
    row = response.json()["rows"][0]
    assert (row["email"], row["name"], row["title"], row["role"]) == (
        "bob@example.com",
        "Lee; Bob",
        "Dev, Ops",
        "member",
    )
    assert row["invitation"] is not None


async def test_a_file_that_cannot_be_used_is_refused_as_a_whole(alice, org):
    many = "email\n" + "".join(f"p{i}@example.com\n" for i in range(101))
    cases = {
        "": "empty",
        "\n  \n": "empty",
        "name,role\nBob,member\n": "email column",
        "email,department\nbob@example.com,Sales\n": '"department"',
        "email,Email\nbob@example.com,bob@example.com\n": "two",
        "email\n": "no one",
        many: "101 rows",
    }
    for text, says in cases.items():
        response = await import_csv(alice, org, text)
        assert response.status_code == 422, (text[:40], response.text)
        assert code(response) == "csv_invalid"
        assert says in response.json()["error"]["message"], response.json()
    assert (await sql("SELECT count(*) FROM org_invitations")).scalar_one() == 0


async def test_up_to_a_hundred_people_at_once(alice, org):
    text = "email\n" + "".join(f"p{i}@example.com\n" for i in range(100))

    response = await import_csv(alice, org, text)

    assert response.json()["invited"] == 100


async def test_import_links_last_between_one_and_thirty_days(alice, org):
    for days in (0, 31):
        response = await import_csv(alice, org, "email\nbob@example.com\n", expires_in_days=days)
        assert response.status_code == 422

    response = await import_csv(alice, org, "email\nbob@example.com\n", expires_in_days=30)
    invitation = response.json()["rows"][0]["invitation"]
    assert invitation["expires_at"] > invitation["created_at"]
