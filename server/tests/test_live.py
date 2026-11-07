"""The live connection to a diagram (app.api.live, app.live): what opening
it gives, changes told to everyone in order, presence, and what closes it."""

import asyncio
import contextlib

import pytest
from conftest import API, box, grant
from httpx import AsyncClient
from httpx_ws import WebSocketDisconnect, aconnect_ws
from httpx_ws.transport import ASGIWebSocketTransport

from app import live
from app.main import create_app

# Shop ▸ Payments, and Web.
DOC = {
    "schemaVersion": 5,
    "root": box(
        "root", "Root", [box("shop", "Shop", [box("payments", "Payments")]), box("web", "Web")]
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
async def bob(person, org, alice, project):
    """Bob, a viewer of the project: his browser and user id."""
    browser, user_id = await person(org, "Bob")
    await grant(alice, project, "viewer", user_id=user_id)
    return browser, user_id


class Connections(contextlib.AsyncExitStack):
    """`async with Connections() as connect`: opens live connections to
    diagrams from browsers (with their cookies), all closed at the end. Inside
    the test itself, as each runs in a task group that must end in the task
    it began in."""

    async def __aenter__(self):
        await super().__aenter__()
        return self.open

    async def __aexit__(self, *exc):
        try:
            return await super().__aexit__(*exc)
        finally:
            await live.hub.settled()

    async def open(self, browser, diagram_id, headers=None):
        client = AsyncClient(
            transport=ASGIWebSocketTransport(create_app()),
            base_url="http://test",
            cookies=browser.cookies,
        )
        await self.enter_async_context(client)
        url = f"{API}/diagrams/{diagram_id}/live"
        return await self.enter_async_context(aconnect_ws(url, client, headers=headers or {}))


async def next_message(ws, kind=None):
    """The next message (of that type, skipping others)."""
    while True:
        message = await ws.receive_json(timeout=5)
        if kind is None or message["type"] == kind:
            return message


async def closed(ws) -> WebSocketDisconnect:
    with pytest.raises(WebSocketDisconnect) as info:
        while True:
            await ws.receive_json(timeout=5)
    return info.value


def change(change_id, **changes):
    return {"type": "change", "id": change_id, **changes}


# ---- Opening ----


async def test_opening_gives_the_diagram_your_roles_and_who_is_there(alice, bob, project):
    async with Connections() as connect:
        diagram_id = project["diagram"]["id"]

        mine = await connect(alice, diagram_id)
        hello = await next_message(mine)
        theirs = await connect(bob[0], diagram_id)
        their_hello = await next_message(theirs)
        joined = await next_message(mine)

        assert hello["type"] == "hello"
        assert hello["diagram"]["version"] == 1
        assert [b["id"] for b in hello["diagram"]["boxes"]] == ["root", "shop", "payments", "web"]
        assert hello["access"] == {"project_role": "owner", "box_roles": {}}
        assert (hello["color"], hello["people"]) == (0, [])
        assert their_hello["access"]["project_role"] == "viewer"
        assert [(p["name"], p["color"], p["connection"]) for p in their_hello["people"]] == [
            ("Alice", 0, hello["connection"])
        ]
        assert joined == {
            "type": "presence",
            "connection": their_hello["connection"],
            "user_id": bob[1],
            "name": "Bob",
            "color": 1,
            "level": None,
            "selection": None,
            "cursor": None,
            "dragging": None,
        }


async def test_two_tabs_of_one_person_share_a_colour(alice, bob, project):
    async with Connections() as connect:
        diagram_id = project["diagram"]["id"]

        first = await next_message(await connect(alice, diagram_id))
        second = await next_message(await connect(alice, diagram_id))
        third = await next_message(await connect(bob[0], diagram_id))

        assert (first["color"], second["color"], third["color"]) == (0, 0, 1)


async def test_opening_needs_someone_signed_in_who_may_see_the_diagram(
    alice, person, org, project, new_client
):
    async with Connections() as connect:
        diagram_id = project["diagram"]["id"]
        outsider, _ = await person(org, "Carol")

        nobody = await connect(new_client(), diagram_id)
        stranger = await connect(outsider, diagram_id)

        assert (await closed(nobody)).code == live.SIGNED_OUT
        assert (await closed(stranger)).code == live.GONE


async def test_only_this_sites_pages_may_open_it(alice, project):
    async with Connections() as connect:
        diagram_id = project["diagram"]["id"]

        # Refused before it opens (over HTTP: 403).
        with pytest.raises(WebSocketDisconnect) as refused:
            await connect(alice, diagram_id, {"origin": "https://elsewhere.example"})
        assert refused.value.code == live.NOT_ALLOWED
        same_site = await connect(alice, diagram_id, {"origin": "http://test"})
        listed = await connect(alice, diagram_id, {"origin": "http://localhost:5173"})

        assert (await next_message(same_site))["type"] == "hello"
        assert (await next_message(listed))["type"] == "hello"


# ---- Changes ----


async def test_a_change_is_told_to_everyone_with_the_boxes_as_they_now_are(alice, bob, project):
    async with Connections() as connect:
        diagram_id = project["diagram"]["id"]
        mine = await connect(alice, diagram_id)
        me = (await next_message(mine))["connection"]
        theirs = await connect(bob[0], diagram_id)
        await next_message(theirs, "hello")

        await mine.send_json(change("a1", changed_boxes=[{"id": "web", "title": "Storefront"}]))
        told = await next_message(theirs, "change")
        echoed = await next_message(mine, "change")

        assert told == echoed
        assert told["version"] == 2
        assert told["change_id"] == "a1"
        assert told["by"] == {"user_id": told["by"]["user_id"], "name": "Alice", "connection": me}
        assert told["boxes"] == [
            {
                "id": "web",
                "parent_id": "root",
                "title": "Storefront",
                "type_id": None,
                "technology": None,
                "description": None,
                "position": {"x": 0, "y": 0},
                "externals": {},
            }
        ]
        assert (told["edges"], told["removed_boxes"], told["removed_edges"]) == ([], [], [])
        saved = await alice.get(f"{API}/diagrams/{diagram_id}")
        assert saved.json()["version"] == 2


async def test_changes_saved_through_the_api_are_told_too(alice, project):
    async with Connections() as connect:
        diagram_id = project["diagram"]["id"]
        mine = await connect(alice, diagram_id)
        await next_message(mine, "hello")
        url = f"{API}/diagrams/{diagram_id}"

        await alice.post(f"{url}/changes", json={"removed_boxes": ["shop"]})
        removed = await next_message(mine)
        await alice.patch(url, json={"version": 2, "name": "Shop v2"})
        renamed = await next_message(mine)

        assert (removed["type"], removed["version"], removed["change_id"]) == ("change", 2, None)
        assert removed["by"]["connection"] is None
        # Everything that went: Shop with Payments inside it.
        assert removed["removed_boxes"] == ["payments", "shop"]
        assert renamed == {"type": "renamed", "version": 3, "name": "Shop v2", "by": renamed["by"]}


async def test_skipped_changes_are_told_back(alice, project):
    async with Connections() as connect:
        diagram_id = project["diagram"]["id"]
        mine = await connect(alice, diagram_id)
        await next_message(mine, "hello")

        await mine.send_json(change("a1", changed_boxes=[{"id": "gone", "title": "?"}]))
        told = await next_message(mine)

        assert (told["type"], told["change_id"], told["skipped_boxes"]) == (
            "change",
            "a1",
            ["gone"],
        )


async def test_a_refused_change_goes_back_only_to_its_sender(alice, bob, project):
    async with Connections() as connect:
        diagram_id = project["diagram"]["id"]
        mine = await connect(alice, diagram_id)
        await next_message(mine, "hello")
        theirs = await connect(bob[0], diagram_id)
        await next_message(theirs, "hello")
        await next_message(mine, "presence")  # Bob arrives

        await theirs.send_json(change("b1", changed_boxes=[{"id": "web", "title": "Mine now"}]))
        not_allowed = await next_message(theirs)
        await mine.send_json(change("a1", added_edges=[{"id": "e", "from": "web", "to": "web"}]))
        invalid = await next_message(mine)
        await mine.send_json({"type": "change", "id": "a2"})
        malformed = await next_message(mine)
        await mine.send_text("not json")
        not_json = await next_message(mine)
        # Bob hears nothing of Alice's refused changes, only her next presence.
        await mine.send_json({"type": "presence", "level": "root"})
        after = await next_message(theirs)

        assert not_allowed["type"] == "refused"
        assert (not_allowed["id"], not_allowed["error"]["code"]) == ("b1", "outside_your_part")
        assert (invalid["id"], invalid["error"]["code"]) == ("a1", "invalid_change")
        assert (malformed["id"], malformed["error"]["code"]) == (None, "validation_failed")
        assert not_json["error"]["code"] == "validation_failed"
        assert (after["type"], after["name"], after["level"]) == ("presence", "Alice", "root")
        saved = await alice.get(f"{API}/diagrams/{diagram_id}")
        assert saved.json()["version"] == 1


async def test_everyone_hears_every_version_once_and_in_order(alice, project):
    """Saves keep coming while someone opens the diagram: what they open is
    one version, and they hear of every later one."""
    diagram_id = project["diagram"]["id"]
    url = f"{API}/diagrams/{diagram_id}/changes"

    async def save(i):
        new_box = {"id": f"b{i}", "parent_id": "root", "title": "", "position": {"x": 0, "y": 0}}
        await alice.post(url, json={"added_boxes": [new_box]})

    async def open_and_listen():
        async with Connections() as connect:
            ws = await connect(alice, diagram_id)
            hello = await next_message(ws, "hello")
            versions = [hello["diagram"]["version"]]
            while versions[-1] < 21:
                versions.append((await next_message(ws, "change"))["version"])
            return versions

    listening = asyncio.create_task(open_and_listen())
    await asyncio.gather(*(save(i) for i in range(20)))
    versions = await asyncio.wait_for(listening, 10)

    assert versions == list(range(versions[0], 22))


# ---- Presence ----


async def test_what_someone_does_is_passed_on_and_their_leaving(alice, bob, project):
    async with Connections() as connect:
        diagram_id = project["diagram"]["id"]
        mine = await connect(alice, diagram_id)
        await next_message(mine, "hello")
        async with Connections() as connect_bob:
            theirs = await connect_bob(bob[0], diagram_id)
            who = (await next_message(theirs, "hello"))["connection"]
            await next_message(mine, "presence")  # Bob arrives

            await theirs.send_json(
                {
                    "type": "presence",
                    "level": "shop",
                    "selection": {"type": "boxes", "ids": ["payments"]},
                    "cursor": {"x": 10, "y": 20.5},
                    "dragging": {"payments": {"x": 40, "y": 50}},
                }
            )
            doing = await next_message(mine)
        # Bob closes the tab.
        left = await next_message(mine)

        assert doing["name"] == "Bob"
        assert (doing["level"], doing["selection"]) == (
            "shop",
            {"type": "boxes", "ids": ["payments"]},
        )
        assert (doing["cursor"], doing["dragging"]) == (
            {"x": 10, "y": 20.5},
            {"payments": {"x": 40, "y": 50}},
        )
        assert left == {"type": "left", "connection": who}
        # Never saved.
        assert (await alice.get(f"{API}/diagrams/{diagram_id}")).json()["version"] == 1


# ---- What closes it ----


async def test_deleting_the_diagram_tells_everyone_and_closes(alice, project):
    async with Connections() as connect:
        diagram_id = project["diagram"]["id"]
        mine = await connect(alice, diagram_id)
        await next_message(mine, "hello")

        await alice.delete(f"{API}/diagrams/{diagram_id}")

        assert (await next_message(mine))["type"] == "deleted"
        assert (await closed(mine)).code == live.GONE


async def test_new_roles_are_told_and_losing_access_closes(alice, bob, project):
    async with Connections() as connect:
        browser, bob_id = bob
        theirs = await connect(browser, project["diagram"]["id"])
        await next_message(theirs, "hello")

        await grant(alice, project, "editor", "shop", user_id=bob_id)
        await live.hub.settled()
        roles = await next_message(theirs)
        for g in (await alice.get(f"{API}/projects/{project['id']}/grants")).json():
            if g["user"] and g["user"]["id"] == bob_id:
                await alice.delete(f"{API}/projects/{project['id']}/grants/{g['id']}")
        await live.hub.settled()

        assert roles == {
            "type": "access",
            "project_role": "viewer",
            "box_roles": {"shop": "editor"},
        }
        assert (await closed(theirs)).code == live.GONE


async def test_signing_out_closes_the_connections_of_that_session(alice, bob, project):
    async with Connections() as connect:
        browser, _ = bob
        theirs = await connect(browser, project["diagram"]["id"])
        mine = await connect(alice, project["diagram"]["id"])
        await next_message(theirs, "hello")
        await next_message(mine, "hello")

        await browser.post(f"{API}/auth/logout")

        assert (await closed(theirs)).code == live.SIGNED_OUT
        await mine.send_json({"type": "presence", "level": "root"})
        await mine.send_json(change("a1", changed_boxes=[{"id": "web", "title": "Still here"}]))
        assert (await next_message(mine, "change"))["change_id"] == "a1"
