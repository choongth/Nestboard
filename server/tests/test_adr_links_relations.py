import asyncio
import copy
import uuid

import conftest
import pytest
from conftest import box, diagrams_path

from app.diagram_format import SCHEMA_VERSION

pytestmark = pytest.mark.usefixtures("project")

# root > web, api > handler. "e1" is labelled, "e2" is not and crosses levels.
DOC = {
    "schemaVersion": SCHEMA_VERSION,
    "root": box(
        "root",
        "Root",
        children=[box("web", "Web app"), box("api", "API", children=[box("handler", "Handler")])],
        edges=[
            {"id": "e1", "from": "web", "to": "api", "label": "calls"},
            {"id": "e2", "from": "web", "to": "handler"},
        ],
    ),
}


@pytest.fixture
async def diagram(client):
    response = await client.post(diagrams_path(), json={"name": "Shop", "document": DOC})
    return response.json()


async def create_adr(client, diagram, title="Use PostgreSQL", **sections):
    response = await client.post(
        f"/api/v1/projects/{diagram['project_id']}/adrs", json={"title": title, **sections}
    )
    assert response.status_code == 201, response.text
    return response.json()


async def get_adr(client, adr):
    return (await client.get(f"/api/v1/adrs/{adr['id']}")).json()


async def put_links(client, adr, links, version=None):
    """`links`: (kind, id) pairs in the project's (only) diagram."""
    version = adr["version"] if version is None else version
    diagram_id = (await client.get(diagrams_path())).json()["items"][0]["id"]
    return await client.put(
        f"/api/v1/adrs/{adr['id']}/links",
        json={
            "version": version,
            "links": [{"diagram_id": diagram_id, "kind": k, "id": i} for k, i in links],
        },
    )


async def linked(client, adr, links):
    response = await put_links(client, adr, links)
    assert response.status_code == 200, response.text
    return response.json()


async def put_relations(client, adr, relations, version=None):
    version = adr["version"] if version is None else version
    return await client.put(
        f"/api/v1/adrs/{adr['id']}/relations",
        json={
            "version": version,
            "relations": [{"kind": k, "adr_id": other["id"]} for k, other in relations],
        },
    )


async def related(client, adr, relations):
    response = await put_relations(client, adr, relations)
    assert response.status_code == 200, response.text
    return response.json()


async def move(client, adr, to):
    return await client.post(
        f"/api/v1/adrs/{adr['id']}/transition", json={"version": adr["version"], "to": to}
    )


async def moved(client, adr, to):
    response = await move(client, adr, to)
    assert response.status_code == 200, response.text
    return response.json()


async def accepted_adr(client, diagram, title="Old decision"):
    return await moved(client, await create_adr(client, diagram, title=title), "accepted")


async def save_document(client, diagram, document):
    response = await conftest.save_document(client, diagram["id"], document)
    assert response.status_code == 200, response.text


def error(response):
    return response.json()["error"]


# ---- Links ----


async def test_a_new_adr_has_no_links_or_relations(client, diagram):
    adr = await create_adr(client, diagram)
    assert (adr["links"], adr["relations"], adr["referenced_by"]) == ([], [], [])


async def test_link_boxes_and_connections(client, diagram):
    adr = await create_adr(client, diagram)

    result = await linked(
        client,
        adr,
        [("box", "web"), ("connection", "e2"), ("box", "handler"), ("connection", "e1")],
    )

    assert result["version"] == 2
    # Boxes first, then connections, each by name. An unlabelled connection
    # is named after its ends.
    d = diagram["id"]
    assert result["links"] == [
        {"diagram_id": d, "kind": "box", "id": "handler", "title": "Handler", "orphaned": False},
        {"diagram_id": d, "kind": "box", "id": "web", "title": "Web app", "orphaned": False},
        {"diagram_id": d, "kind": "connection", "id": "e1", "title": "calls", "orphaned": False},
        {
            "diagram_id": d,
            "kind": "connection",
            "id": "e2",
            "title": "Web app → Handler",
            "orphaned": False,
        },
    ]
    assert (await get_adr(client, adr))["links"] == result["links"]


async def test_links_replace_the_previous_set_and_ignore_duplicates(client, diagram):
    adr = await linked(client, await create_adr(client, diagram), [("box", "web"), ("box", "api")])

    result = await linked(client, adr, [("box", "api"), ("box", "api")])

    assert [link["id"] for link in result["links"]] == ["api"]


async def test_links_can_be_cleared(client, diagram):
    adr = await linked(client, await create_adr(client, diagram), [("box", "web")])
    assert (await linked(client, adr, []))["links"] == []


@pytest.mark.parametrize(
    ("kind", "target", "message"),
    [
        ("box", "ghost", 'There is no box with id "ghost" in this diagram.'),
        ("box", "e1", 'There is no box with id "e1" in this diagram.'),
        ("connection", "web", 'There is no connection with id "web" in this diagram.'),
        (
            "box",
            "root",
            "The top level of a diagram is not a box; an ADR about the whole project "
            "needs no link.",
        ),
    ],
)
async def test_links_must_point_at_something_in_the_diagram(client, diagram, kind, target, message):
    adr = await create_adr(client, diagram)

    response = await put_links(client, adr, [("box", "web"), (kind, target)])

    assert response.status_code == 422
    assert error(response) == {
        "code": "unknown_link_target",
        "message": message,
        "details": {"diagram_id": diagram["id"], "kind": kind, "id": target},
    }
    assert await get_adr(client, adr) == adr


async def test_link_validation(client, diagram):
    adr = await create_adr(client, diagram)
    url = f"/api/v1/adrs/{adr['id']}/links"

    d = diagram["id"]
    bad_kind = await client.put(
        url, json={"version": 1, "links": [{"diagram_id": d, "kind": "node", "id": "web"}]}
    )
    empty_id = await client.put(
        url, json={"version": 1, "links": [{"diagram_id": d, "kind": "box", "id": ""}]}
    )
    no_diagram = await client.put(url, json={"version": 1, "links": [{"kind": "box", "id": "web"}]})
    too_many = await client.put(
        url, json={"version": 1, "links": [{"diagram_id": d, "kind": "box", "id": "web"}] * 201}
    )
    no_version = await client.put(url, json={"links": []})

    for response in (bad_kind, empty_id, no_diagram, too_many, no_version):
        assert response.status_code == 422
        assert error(response)["code"] == "validation_failed"


async def test_links_check_the_version(client, diagram):
    adr = await linked(client, await create_adr(client, diagram), [("box", "web")])

    response = await put_links(client, adr, [("box", "api")], version=1)

    assert response.status_code == 409
    assert error(response)["code"] == "version_conflict"


async def test_decided_adrs_can_still_change_their_links(client, diagram):
    adr = await accepted_adr(client, diagram)
    adr = await linked(client, adr, [("box", "api")])
    adr = await moved(client, adr, "deprecated")

    assert (await linked(client, adr, [("box", "web")]))["links"][0]["id"] == "web"


async def test_a_renamed_box_shows_its_new_name(client, diagram):
    adr = await linked(client, await create_adr(client, diagram), [("box", "web")])
    renamed = copy.deepcopy(DOC)
    renamed["root"]["children"][0]["title"] = "Storefront"

    await save_document(client, diagram, renamed)

    assert (await get_adr(client, adr))["links"][0]["title"] == "Storefront"


async def test_a_deleted_box_leaves_an_orphaned_link_with_its_last_name(client, diagram):
    adr = await linked(
        client, await create_adr(client, diagram), [("box", "handler"), ("box", "web")]
    )
    without_handler = copy.deepcopy(DOC)
    without_handler["root"]["children"][1]["children"] = []
    without_handler["root"]["edges"] = without_handler["root"]["edges"][:1]

    await save_document(client, diagram, without_handler)

    d = diagram["id"]
    assert (await get_adr(client, adr))["links"] == [
        {"diagram_id": d, "kind": "box", "id": "handler", "title": "Handler", "orphaned": True},
        {"diagram_id": d, "kind": "box", "id": "web", "title": "Web app", "orphaned": False},
    ]


async def test_orphaned_links_can_be_sent_back_but_not_added(client, diagram):
    adr = await create_adr(client, diagram)
    adr = await linked(client, adr, [("box", "handler")])
    without_handler = copy.deepcopy(DOC)
    without_handler["root"]["children"][1]["children"] = []
    without_handler["root"]["edges"] = without_handler["root"]["edges"][:1]
    await save_document(client, diagram, without_handler)
    other = await create_adr(client, diagram, title="Other")

    # The client sends back what it read, plus one more link.
    kept = await linked(client, adr, [("box", "handler"), ("box", "web")])
    added = await put_links(client, other, [("box", "handler")])

    assert [(link["id"], link["orphaned"]) for link in kept["links"]] == [
        ("handler", True),
        ("web", False),
    ]
    assert error(added)["code"] == "unknown_link_target"


async def test_list_adrs_linked_to_a_box_or_connection(client, diagram):
    about_web = await create_adr(client, diagram, title="Web")
    about_both = await create_adr(client, diagram, title="Both")
    await create_adr(client, diagram, title="Neither")
    await linked(client, about_web, [("box", "web")])
    await linked(client, about_both, [("box", "web"), ("connection", "e1")])
    url = f"/api/v1/projects/{diagram['project_id']}/adrs"

    d = diagram["id"]
    by_box = (await client.get(url, params={"diagram_id": d, "box_id": "web"})).json()
    by_connection = (await client.get(url, params={"diagram_id": d, "connection_id": "e1"})).json()
    by_diagram = (await client.get(url, params={"diagram_id": d})).json()
    # A box id is not a connection id.
    mismatched = (await client.get(url, params={"diagram_id": d, "connection_id": "web"})).json()

    assert [a["title"] for a in by_box] == ["Web", "Both"]
    assert [a["title"] for a in by_connection] == ["Both"]
    assert [a["title"] for a in by_diagram] == ["Web", "Both"]
    assert mismatched == []


async def test_link_changes_are_kept_in_the_history(client, diagram):
    adr = await linked(client, await create_adr(client, diagram), [("box", "web")])

    revisions = (await client.get(f"/api/v1/adrs/{adr['id']}/revisions")).json()

    assert revisions[0]["snapshot"]["links"] == []
    assert revisions[1]["snapshot"]["links"] == [
        {"diagram_id": diagram["id"], "kind": "box", "id": "web"}
    ]
    assert revisions[1]["action"] == "linked"


# ---- Relations ----


async def test_relates_to_shows_on_both_sides(client, diagram):
    first = await create_adr(client, diagram, title="First")
    second = await create_adr(client, diagram, title="Second")

    result = await related(client, second, [("relates_to", first)])

    assert result["version"] == 2
    assert result["relations"] == [
        {
            "kind": "relates_to",
            "adr_id": first["id"],
            "ref": "ADR-0001",
            "title": "First",
            "status": "proposed",
        }
    ]
    assert (await get_adr(client, first))["referenced_by"] == [
        {
            "kind": "relates_to",
            "adr_id": second["id"],
            "ref": "ADR-0002",
            "title": "Second",
            "status": "proposed",
        }
    ]


async def test_relations_replace_the_previous_set(client, diagram):
    a = await create_adr(client, diagram, title="A")
    b = await create_adr(client, diagram, title="B")
    c = await create_adr(client, diagram, title="C")
    c = await related(client, c, [("relates_to", a), ("relates_to", b)])

    c = await related(client, c, [("relates_to", b)])
    cleared = await related(client, c, [])

    assert c["relations"][0]["ref"] == "ADR-0002"
    assert cleared["relations"] == []
    assert (await get_adr(client, a))["referenced_by"] == []


@pytest.mark.parametrize("kind", ["supersedes", "amends"])
async def test_supersedes_and_amends_need_an_accepted_target(client, diagram, kind):
    proposed = await create_adr(client, diagram, title="Still proposed")
    accepted = await accepted_adr(client, diagram)
    adr = await create_adr(client, diagram, title="New")

    refused = await put_relations(client, adr, [(kind, proposed)])
    allowed = await put_relations(client, adr, [(kind, accepted)])

    assert refused.status_code == 422
    verb, participle = {"supersedes": ("supersede", "superseded"), "amends": ("amend", "amended")}[
        kind
    ]
    assert error(refused) == {
        "code": "invalid_relation",
        "message": f"ADR-0003 cannot {verb} ADR-0001, which is proposed; "
        f"only an accepted ADR can be {participle}.",
        "details": {"adr_id": proposed["id"], "status": "proposed"},
    }
    assert allowed.status_code == 200


async def test_invalid_relations(client, diagram):
    adr = await create_adr(client, diagram)
    other = await create_adr(client, diagram, title="Other")
    org_id = (await client.get("/api/v1/orgs")).json()[0]["id"]
    elsewhere = (await client.post(f"/api/v1/orgs/{org_id}/projects", json={"name": "B"})).json()
    foreign = await create_adr(client, {"project_id": elsewhere["id"]})

    to_self = await put_relations(client, adr, [("relates_to", adr)])
    twice = await put_relations(client, adr, [("relates_to", other), ("amends", other)])
    across = await put_relations(client, adr, [("relates_to", foreign)])
    missing = await put_relations(client, adr, [("relates_to", {"id": str(uuid.uuid4())})])

    assert error(to_self)["message"] == "ADR-0001 cannot relate to itself."
    assert error(twice)["message"] == "Give at most one relation per ADR."
    assert "in this project" in error(across)["message"]
    assert "in this project" in error(missing)["message"]
    for response in (to_self, twice, across, missing):
        assert response.status_code == 422
        assert error(response)["code"] == "invalid_relation"
    assert await get_adr(client, adr) == adr


async def test_relation_validation(client, diagram):
    adr = await create_adr(client, diagram)
    url = f"/api/v1/adrs/{adr['id']}/relations"

    bad_kind = await client.put(
        url, json={"version": 1, "relations": [{"kind": "replaces", "adr_id": adr["id"]}]}
    )
    bad_id = await client.put(
        url, json={"version": 1, "relations": [{"kind": "relates_to", "adr_id": "x"}]}
    )

    assert bad_kind.status_code == bad_id.status_code == 422


async def test_relations_are_locked_once_decided(client, diagram):
    other = await create_adr(client, diagram, title="Other")
    adr = await accepted_adr(client, diagram)

    response = await put_relations(client, adr, [("relates_to", other)])

    assert response.status_code == 409
    assert error(response)["code"] == "adr_locked"


async def test_relations_check_the_version(client, diagram):
    other = await create_adr(client, diagram, title="Other")
    adr = await related(client, await create_adr(client, diagram), [("relates_to", other)])

    response = await put_relations(client, adr, [], version=1)

    assert error(response)["code"] == "version_conflict"


async def test_relation_changes_are_kept_in_the_history(client, diagram):
    other = await create_adr(client, diagram, title="Other")
    adr = await related(client, await create_adr(client, diagram), [("relates_to", other)])

    revisions = (await client.get(f"/api/v1/adrs/{adr['id']}/revisions")).json()

    assert revisions[-1]["snapshot"]["relations"] == [{"kind": "relates_to", "adr_id": other["id"]}]


# ---- Superseding ----


async def test_accepting_a_superseding_adr_supersedes_the_old_one(client, diagram):
    old = await accepted_adr(client, diagram)
    new = await related(
        client, await create_adr(client, diagram, title="New"), [("supersedes", old)]
    )
    assert (await get_adr(client, old))["status"] == "accepted"  # not until the new one is accepted

    new = await moved(client, new, "accepted")

    old_now = await get_adr(client, old)
    assert new["status"] == "accepted"
    assert new["relations"][0]["status"] == "superseded"
    assert old_now["status"] == "superseded"
    assert old_now["version"] == old["version"] + 1
    assert old_now["decided_at"] == old["decided_at"]
    assert old_now["referenced_by"][0] == {
        "kind": "supersedes",
        "adr_id": new["id"],
        "ref": "ADR-0002",
        "title": "New",
        "status": "accepted",
    }
    history = (await client.get(f"/api/v1/adrs/{old['id']}/revisions")).json()
    assert [r["snapshot"]["status"] for r in history] == ["proposed", "accepted", "superseded"]


async def test_rejecting_a_superseding_adr_leaves_the_old_one_in_force(client, diagram):
    old = await accepted_adr(client, diagram)
    new = await related(client, await create_adr(client, diagram), [("supersedes", old)])

    await moved(client, new, "rejected")

    assert (await get_adr(client, old))["status"] == "accepted"


async def test_amending_leaves_the_old_one_in_force(client, diagram):
    old = await accepted_adr(client, diagram)
    new = await related(client, await create_adr(client, diagram), [("amends", old)])

    await moved(client, new, "accepted")

    assert (await get_adr(client, old))["status"] == "accepted"


async def test_one_adr_can_supersede_several(client, diagram):
    a = await accepted_adr(client, diagram, title="A")
    b = await accepted_adr(client, diagram, title="B")
    new = await related(
        client, await create_adr(client, diagram), [("supersedes", a), ("supersedes", b)]
    )

    await moved(client, new, "accepted")

    assert (await get_adr(client, a))["status"] == "superseded"
    assert (await get_adr(client, b))["status"] == "superseded"


async def test_accepting_is_refused_if_a_superseded_target_is_no_longer_accepted(client, diagram):
    old = await accepted_adr(client, diagram)
    first = await related(
        client, await create_adr(client, diagram, title="First"), [("supersedes", old)]
    )
    second = await related(
        client, await create_adr(client, diagram, title="Second"), [("supersedes", old)]
    )
    await moved(client, first, "accepted")

    response = await move(client, second, "accepted")

    assert response.status_code == 409
    assert error(response) == {
        "code": "invalid_transition",
        "message": "ADR-0003 cannot be accepted: it supersedes ADRs that are no longer accepted: "
        "ADR-0001 (superseded). Remove those relations first.",
        "details": {"blocking": [{"adr_id": old["id"], "status": "superseded"}]},
    }
    assert (await get_adr(client, second))["status"] == "proposed"


async def test_an_existing_relation_survives_its_target_changing(client, diagram):
    old = await accepted_adr(client, diagram)
    new = await related(client, await create_adr(client, diagram), [("supersedes", old)])
    await moved(client, old, "deprecated")

    # Sending back the relations it read still works...
    new = await related(client, new, [("supersedes", old)])
    # ...but it cannot be accepted until that relation goes.
    assert error(await move(client, new, "accepted"))["code"] == "invalid_transition"
    new = await related(client, new, [("relates_to", old)])
    assert (await moved(client, new, "accepted"))["status"] == "accepted"


async def test_concurrent_acceptances_of_rival_superseders_let_exactly_one_win(client, diagram):
    old = await accepted_adr(client, diagram)
    rivals = [
        await related(
            client, await create_adr(client, diagram, title=f"R{i}"), [("supersedes", old)]
        )
        for i in range(4)
    ]

    responses = await asyncio.gather(*(move(client, r, "accepted") for r in rivals))

    assert sorted(r.status_code for r in responses) == [200, 409, 409, 409]
    old_now = await get_adr(client, old)
    assert old_now["status"] == "superseded"
    assert old_now["version"] == old["version"] + 1


async def test_supersede_starts_a_proposed_copy(client, diagram):
    old = await create_adr(
        client,
        diagram,
        title="Use MySQL",
        context="Ctx",
        decisions=["MySQL"],
        positive_consequences=["Known"],
        negative_consequences=["No JSONB"],
    )
    old = await linked(client, old, [("box", "api")])
    old = await moved(client, old, "accepted")

    response = await client.post(f"/api/v1/adrs/{old['id']}/supersede", json={})

    new = response.json()
    assert response.status_code == 201
    assert (new["ref"], new["status"], new["version"]) == ("ADR-0002", "proposed", 1)
    copied = ("title", "context", "decisions", "positive_consequences", "negative_consequences")
    assert [new[f] for f in copied] == ["Use MySQL", "Ctx", ["MySQL"], ["Known"], ["No JSONB"]]
    assert new["links"] == old["links"]
    assert [(r["kind"], r["adr_id"]) for r in new["relations"]] == [("supersedes", old["id"])]
    assert (await get_adr(client, old))["status"] == "accepted"
    history = (await client.get(f"/api/v1/adrs/{new['id']}/revisions")).json()
    assert history[0]["snapshot"]["relations"] == [{"kind": "supersedes", "adr_id": old["id"]}]


async def test_supersede_with_a_new_title_then_accept(client, diagram):
    old = await accepted_adr(client, diagram, title="Use MySQL")

    new = (
        await client.post(f"/api/v1/adrs/{old['id']}/supersede", json={"title": "Use Postgres"})
    ).json()
    await moved(client, new, "accepted")

    assert new["title"] == "Use Postgres"
    assert (await get_adr(client, old))["status"] == "superseded"


@pytest.mark.parametrize("path", [[], ["rejected"], ["accepted", "deprecated"]])
async def test_only_accepted_adrs_can_be_superseded(client, diagram, path):
    adr = await create_adr(client, diagram)
    for step in path:
        adr = await moved(client, adr, step)

    response = await client.post(f"/api/v1/adrs/{adr['id']}/supersede", json={})

    assert response.status_code == 409
    assert error(response)["code"] == "not_supersedable"
    assert (await client.get(f"/api/v1/projects/{diagram['project_id']}/adrs")).json() == [
        await get_adr(client, adr)
    ]


async def test_supersede_unknown_adr(client):
    response = await client.post(f"/api/v1/adrs/{uuid.uuid4()}/supersede", json={})
    assert error(response)["code"] == "adr_not_found"


# ---- Deleting ----


async def test_an_adr_others_refer_to_cannot_be_deleted(client, diagram):
    target = await create_adr(client, diagram, title="Target")
    referrer = await related(client, await create_adr(client, diagram), [("relates_to", target)])

    refused = await client.delete(f"/api/v1/adrs/{target['id']}")
    await related(client, referrer, [])
    allowed = await client.delete(f"/api/v1/adrs/{target['id']}")

    assert refused.status_code == 409
    assert error(refused) == {
        "code": "adr_referenced",
        "message": "ADR-0001 cannot be deleted while other ADRs refer to it (ADR-0002).",
        "details": {"referenced_by": [referrer["id"]]},
    }
    assert allowed.status_code == 204


async def test_deleting_an_adr_removes_its_own_links_and_relations(client, diagram):
    target = await create_adr(client, diagram, title="Target")
    adr = await related(client, await create_adr(client, diagram), [("relates_to", target)])
    await linked(client, adr, [("box", "web")])

    assert (await client.delete(f"/api/v1/adrs/{adr['id']}")).status_code == 204

    assert (await get_adr(client, target))["referenced_by"] == []
    by_box = await client.get(
        f"/api/v1/projects/{diagram['project_id']}/adrs",
        params={"diagram_id": diagram["id"], "box_id": "web"},
    )
    assert by_box.json() == []
