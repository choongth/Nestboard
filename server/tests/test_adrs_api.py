import asyncio
import uuid

import pytest
from conftest import diagrams_path

pytestmark = pytest.mark.usefixtures("project")


@pytest.fixture
async def diagram(client):
    response = await client.post(diagrams_path(), json={"name": "Shop"})
    return response.json()


async def create_adr(client, diagram, title="Use PostgreSQL", **sections):
    response = await client.post(
        f"/api/v1/projects/{diagram['project_id']}/adrs", json={"title": title, **sections}
    )
    assert response.status_code == 201, response.text
    return response.json()


async def edit(client, adr, version=None, **changes):
    version = adr["version"] if version is None else version
    return await client.patch(f"/api/v1/adrs/{adr['id']}", json={"version": version, **changes})


async def move(client, adr, to, version=None):
    version = adr["version"] if version is None else version
    return await client.post(
        f"/api/v1/adrs/{adr['id']}/transition", json={"version": version, "to": to}
    )


async def moved(client, adr, to):
    response = await move(client, adr, to)
    assert response.status_code == 200, response.text
    return response.json()


def error(response):
    return response.json()["error"]


# ---- Creating and reading ----


async def test_create_starts_proposed_with_the_first_number(client, diagram):
    adr = await create_adr(client, diagram, title="  Use PostgreSQL  ", context="We need a DB.")

    assert adr["project_id"] == diagram["project_id"]
    assert adr["scope"] is None  # about the whole project
    assert (adr["number"], adr["ref"]) == (1, "ADR-0001")
    assert adr["title"] == "Use PostgreSQL"
    assert adr["status"] == "proposed"
    assert adr["context"] == "We need a DB."
    assert (adr["decisions"], adr["positive_consequences"], adr["negative_consequences"]) == (
        [],
        [],
        [],
    )
    assert adr["version"] == 1
    assert adr["decided_at"] is None


async def test_context_is_kept_exactly_as_written(client, diagram):
    markdown = "  - indented list\n\n```sql\nSELECT 1;\n```\n"
    adr = await create_adr(client, diagram, context=markdown)
    assert adr["context"] == markdown


async def test_decisions_and_consequences_are_lists_of_items(client, diagram):
    adr = await create_adr(
        client,
        diagram,
        decisions=["Use PostgreSQL 18", "  One database per service  "],
        positive_consequences=["Transactions", "**JSONB** for documents"],
        negative_consequences=["Migrate the old MySQL data\nwith a one-off script"],
    )

    assert adr["decisions"] == ["Use PostgreSQL 18", "One database per service"]  # trimmed
    assert adr["positive_consequences"] == ["Transactions", "**JSONB** for documents"]
    assert adr["negative_consequences"] == ["Migrate the old MySQL data\nwith a one-off script"]


async def test_list_items_cannot_be_blank_and_lists_are_capped(client, diagram):
    url = f"/api/v1/projects/{diagram['project_id']}/adrs"
    blank = await client.post(url, json={"title": "x", "decisions": ["ok", "   "]})
    not_text = await client.post(url, json={"title": "x", "positive_consequences": [1]})
    too_many = await client.post(url, json={"title": "x", "decisions": ["d"] * 101})
    too_long = await client.post(url, json={"title": "x", "decisions": ["d" * 10_001]})

    for response in (blank, not_text, too_many, too_long):
        assert response.status_code == 422
        assert error(response)["code"] == "validation_failed"


async def test_numbers_count_up_per_project(client, diagram):
    other = (await client.post(diagrams_path(), json={"name": "Other"})).json()
    org_id = (await client.get("/api/v1/orgs")).json()[0]["id"]
    elsewhere = (await client.post(f"/api/v1/orgs/{org_id}/projects", json={"name": "B"})).json()

    a = await create_adr(client, diagram)
    b = await create_adr(client, other)  # same project
    c = await create_adr(client, {"project_id": elsewhere["id"]})

    assert [a["ref"], b["ref"], c["ref"]] == ["ADR-0001", "ADR-0002", "ADR-0001"]


async def test_numbers_are_never_reused(client, diagram):
    await create_adr(client, diagram)
    second = await create_adr(client, diagram)
    await client.delete(f"/api/v1/adrs/{second['id']}")

    third = await create_adr(client, diagram)

    assert third["number"] == 3


async def test_concurrent_creates_get_distinct_numbers(client, diagram):
    created = await asyncio.gather(*(create_adr(client, diagram, title=f"T{i}") for i in range(10)))
    assert sorted(a["number"] for a in created) == list(range(1, 11))


async def test_creating_does_not_change_the_diagram(client, diagram):
    await create_adr(client, diagram)
    after = (await client.get(f"/api/v1/diagrams/{diagram['id']}")).json()
    assert after == diagram


async def test_create_validation(client, diagram):
    url = f"/api/v1/projects/{diagram['project_id']}/adrs"
    blank = await client.post(url, json={"title": " "})
    unknown_field = await client.post(url, json={"title": "x", "status": "accepted"})
    too_long = await client.post(url, json={"title": "x", "context": "a" * 100_001})
    no_project = await client.post(f"/api/v1/projects/{uuid.uuid4()}/adrs", json={"title": "x"})

    for response in (blank, unknown_field, too_long):
        assert response.status_code == 422
        assert error(response)["code"] == "validation_failed"
    assert no_project.status_code == 404
    assert error(no_project)["code"] == "project_not_found"


async def test_get_by_id_and_by_number(client, diagram):
    adr = await create_adr(client, diagram)

    by_id = await client.get(f"/api/v1/adrs/{adr['id']}")
    by_number = await client.get(f"/api/v1/projects/{diagram['project_id']}/adrs/1")

    assert by_id.json() == adr
    assert by_number.json() == adr


async def test_get_unknown(client, diagram):
    unknown_id = await client.get(f"/api/v1/adrs/{uuid.uuid4()}")
    unknown_number = await client.get(f"/api/v1/projects/{diagram['project_id']}/adrs/9")
    unknown_project = await client.get(f"/api/v1/projects/{uuid.uuid4()}/adrs/1")
    zero = await client.get(f"/api/v1/projects/{diagram['project_id']}/adrs/0")

    assert error(unknown_id)["code"] == "adr_not_found"
    assert error(unknown_number) == {
        "code": "adr_not_found",
        "message": "ADR-0009 does not exist in this project.",
    }
    assert error(unknown_project)["code"] == "project_not_found"
    assert zero.status_code == 422


async def test_list_in_number_order_with_status_filter(client, diagram):
    first = await create_adr(client, diagram, title="First")
    second = await create_adr(client, diagram, title="Second")
    third = await create_adr(client, diagram, title="Third")
    await moved(client, first, "accepted")
    await moved(client, third, "rejected")
    url = f"/api/v1/projects/{diagram['project_id']}/adrs"

    everything = (await client.get(url)).json()
    proposed = (await client.get(url, params={"status": "proposed"})).json()
    decided = (
        await client.get(url, params=[("status", "accepted"), ("status", "rejected")])
    ).json()

    assert [a["title"] for a in everything] == ["First", "Second", "Third"]
    assert [a["id"] for a in proposed] == [second["id"]]
    assert [a["title"] for a in decided] == ["First", "Third"]


async def test_list_errors(client, diagram):
    bad_status = await client.get(
        f"/api/v1/projects/{diagram['project_id']}/adrs", params={"status": "maybe"}
    )
    no_project = await client.get(f"/api/v1/projects/{uuid.uuid4()}/adrs")
    box_without_diagram = await client.get(
        f"/api/v1/projects/{diagram['project_id']}/adrs", params={"box_id": "web"}
    )

    assert bad_status.status_code == 422
    assert error(no_project)["code"] == "project_not_found"
    assert box_without_diagram.status_code == 422


async def test_an_empty_diagram_has_no_adrs(client, diagram):
    assert (await client.get(f"/api/v1/projects/{diagram['project_id']}/adrs")).json() == []


# ---- Editing ----


async def test_edit_a_proposed_adr(client, diagram):
    adr = await create_adr(client, diagram, context="Old")

    response = await edit(client, adr, title="Use Postgres 18", decisions=["We will."])

    updated = response.json()
    assert response.status_code == 200
    assert updated["title"] == "Use Postgres 18"
    assert (updated["context"], updated["decisions"]) == ("Old", ["We will."])
    assert updated["version"] == 2
    assert updated["updated_at"] > adr["updated_at"]


async def test_edit_can_clear_a_section(client, diagram):
    adr = await create_adr(client, diagram, context="Old")
    assert (await edit(client, adr, context="")).json()["context"] == ""


async def test_a_list_given_replaces_the_whole_list_others_stay(client, diagram):
    adr = await create_adr(
        client,
        diagram,
        decisions=["A", "B"],
        positive_consequences=["Good"],
        negative_consequences=["Bad"],
    )

    updated = (await edit(client, adr, decisions=["B", "C"], negative_consequences=[])).json()

    assert updated["decisions"] == ["B", "C"]
    assert updated["positive_consequences"] == ["Good"]
    assert updated["negative_consequences"] == []


async def test_edit_needs_a_change_and_a_non_blank_title(client, diagram):
    adr = await create_adr(client, diagram)

    nothing = await edit(client, adr)
    blank = await edit(client, adr, title="  ")

    assert nothing.status_code == 422
    assert blank.status_code == 422


async def test_edit_based_on_an_old_version_conflicts(client, diagram):
    adr = await create_adr(client, diagram)
    await edit(client, adr, context="Mine")

    response = await edit(client, adr, context="Theirs")

    assert response.status_code == 409
    assert error(response)["code"] == "version_conflict"
    assert error(response)["details"] == {"current_version": 2}


async def test_concurrent_edits_from_the_same_version_let_exactly_one_win(client, diagram):
    adr = await create_adr(client, diagram)

    responses = await asyncio.gather(*(edit(client, adr, context=f"Writer {i}") for i in range(5)))

    assert sorted(r.status_code for r in responses) == [200, 409, 409, 409, 409]
    revisions = (await client.get(f"/api/v1/adrs/{adr['id']}/revisions")).json()
    assert len(revisions) == 2


@pytest.mark.parametrize("final", ["accepted", "rejected"])
async def test_decided_adrs_cannot_be_edited(client, diagram, final):
    adr = await moved(client, await create_adr(client, diagram), final)

    response = await edit(client, adr, context="Changed my mind")

    assert response.status_code == 409
    assert error(response)["code"] == "adr_locked"
    assert error(response)["details"] == {"status": final}
    assert "write a new ADR" in error(response)["message"]


async def test_edit_unknown_adr(client):
    response = await client.patch(f"/api/v1/adrs/{uuid.uuid4()}", json={"version": 1, "title": "x"})
    assert error(response)["code"] == "adr_not_found"


# ---- Status workflow ----


async def test_accepting_records_when_it_was_decided(client, diagram):
    adr = await create_adr(client, diagram)

    accepted = await moved(client, adr, "accepted")

    assert accepted["status"] == "accepted"
    assert accepted["version"] == 2
    assert accepted["decided_at"] is not None
    assert accepted["decided_at"] == accepted["updated_at"]


async def test_rejecting_records_when_it_was_decided(client, diagram):
    rejected = await moved(client, await create_adr(client, diagram), "rejected")
    assert rejected["decided_at"] is not None


async def test_deprecating_keeps_the_decision_date(client, diagram):
    accepted = await moved(client, await create_adr(client, diagram), "accepted")

    deprecated = await moved(client, accepted, "deprecated")

    assert deprecated["status"] == "deprecated"
    assert deprecated["decided_at"] == accepted["decided_at"]


@pytest.mark.parametrize(
    ("path", "to", "allowed", "reason"),
    [
        (
            [],
            "deprecated",
            ["accepted", "rejected"],
            "A proposed ADR can only become accepted or rejected.",
        ),
        (
            [],
            "proposed",
            ["accepted", "rejected"],
            "A proposed ADR can only become accepted or rejected.",
        ),
        (["accepted"], "rejected", ["deprecated"], "An accepted ADR can only become deprecated."),
        (["accepted"], "accepted", ["deprecated"], "An accepted ADR can only become deprecated."),
        (["rejected"], "accepted", [], "ADR-0001 is rejected, which is final."),
        (["accepted", "deprecated"], "accepted", [], "ADR-0001 is deprecated, which is final."),
        ([], "superseded", ["accepted", "rejected"], "only when a newer ADR replaces it."),
        (["accepted"], "superseded", ["deprecated"], "only when a newer ADR replaces it."),
    ],
)
async def test_invalid_transitions(client, diagram, path, to, allowed, reason):
    adr = await create_adr(client, diagram)
    for step in path:
        adr = await moved(client, adr, step)

    response = await move(client, adr, to)

    assert response.status_code == 409
    body = error(response)
    assert body["code"] == "invalid_transition"
    assert body["details"] == {"from": adr["status"], "to": to, "allowed": allowed}
    assert body["message"].endswith(reason)
    # Nothing changed.
    assert (await client.get(f"/api/v1/adrs/{adr['id']}")).json() == adr


async def test_transition_based_on_an_old_version_conflicts(client, diagram):
    adr = await create_adr(client, diagram)
    await edit(client, adr, context="Changed")

    response = await move(client, adr, "accepted")

    assert response.status_code == 409
    assert error(response)["code"] == "version_conflict"


async def test_transition_to_an_unknown_status(client, diagram):
    adr = await create_adr(client, diagram)
    response = await move(client, adr, "approved")
    assert response.status_code == 422


# ---- Deleting ----


async def test_delete_a_proposed_adr(client, diagram):
    adr = await create_adr(client, diagram)

    first = await client.delete(f"/api/v1/adrs/{adr['id']}")
    second = await client.delete(f"/api/v1/adrs/{adr['id']}")

    assert first.status_code == 204
    assert error(second)["code"] == "adr_not_found"
    assert (await client.get(f"/api/v1/adrs/{adr['id']}/revisions")).status_code == 404


async def test_decided_adrs_cannot_be_deleted(client, diagram):
    adr = await moved(client, await create_adr(client, diagram), "accepted")

    response = await client.delete(f"/api/v1/adrs/{adr['id']}")

    assert response.status_code == 409
    assert error(response)["code"] == "adr_locked"
    assert (await client.get(f"/api/v1/adrs/{adr['id']}")).status_code == 200


async def test_deleting_a_diagram_keeps_the_projects_adrs(client, diagram):
    adr = await moved(client, await create_adr(client, diagram), "accepted")

    await client.delete(f"/api/v1/diagrams/{diagram['id']}")

    assert (await client.get(f"/api/v1/adrs/{adr['id']}")).status_code == 200


async def test_deleting_the_project_deletes_its_adrs(client, diagram):
    adr = await create_adr(client, diagram)

    await client.delete(f"/api/v1/projects/{diagram['project_id']}")

    assert (await client.get(f"/api/v1/adrs/{adr['id']}")).status_code == 404


# ---- History ----


async def test_every_change_is_kept_as_a_revision(client, diagram):
    adr = await create_adr(client, diagram, context="Draft")
    adr = (
        await edit(
            client, adr, context="Final", decisions=["Postgres"], negative_consequences=["Ops"]
        )
    ).json()
    adr = await moved(client, adr, "accepted")

    revisions = (await client.get(f"/api/v1/adrs/{adr['id']}/revisions")).json()

    assert [r["revision"] for r in revisions] == [1, 2, 3]
    unlinked = {"links": [], "relations": [], "scope": None}
    written = {
        "context": "Final",
        "decisions": ["Postgres"],
        "positive_consequences": [],
        "negative_consequences": ["Ops"],
    }
    assert [r["snapshot"] for r in revisions] == [
        {
            "title": "Use PostgreSQL",
            "status": "proposed",
            "context": "Draft",
            "decisions": [],
            "positive_consequences": [],
            "negative_consequences": [],
            **unlinked,
        },
        {"title": "Use PostgreSQL", "status": "proposed", **written, **unlinked},
        {"title": "Use PostgreSQL", "status": "accepted", **written, **unlinked},
    ]
    assert revisions[-1]["created_at"] == adr["updated_at"]


async def test_failed_changes_leave_no_revision(client, diagram):
    adr = await moved(client, await create_adr(client, diagram), "accepted")
    await edit(client, adr, context="nope")
    await move(client, adr, "rejected")

    revisions = (await client.get(f"/api/v1/adrs/{adr['id']}/revisions")).json()
    assert len(revisions) == 2


async def test_revisions_of_unknown_adr(client):
    response = await client.get(f"/api/v1/adrs/{uuid.uuid4()}/revisions")
    assert error(response)["code"] == "adr_not_found"
