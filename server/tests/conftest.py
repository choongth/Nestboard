import os
from collections.abc import AsyncIterator, Callable
from pathlib import Path

# Point the app at the test database before anything imports app.db.
from app.config import get_settings

_settings = get_settings()
os.environ["NESTBOARD_DATABASE_URL"] = _settings.test_database_url
get_settings.cache_clear()

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import engine  # noqa: E402
from app.diagram_format import normalize_document, to_document, to_rows  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Box, Edge, ExternalSpot  # noqa: E402

SERVER_DIR = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> None:
    """Bring the test database to the latest schema once per run."""
    config = Config(str(SERVER_DIR / "alembic.ini"))
    config.attributes["database_url"] = _settings.test_database_url
    config.attributes["configure_logger"] = False
    command.upgrade(config, "head")


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def other_client() -> AsyncIterator[AsyncClient]:
    """A second browser, with its own cookies."""
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def new_client() -> AsyncIterator[Callable[[], AsyncClient]]:
    """Makes more browsers, each with its own cookies (one per person)."""
    clients: list[AsyncClient] = []

    def make() -> AsyncClient:
        client = AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test")
        clients.append(client)
        return client

    yield make
    for client in clients:
        await client.aclose()


API = "/api/v1"
PASSWORD = "correct horse"


def code(response) -> str:
    """The error code of a failed request."""
    return response.json()["error"]["code"]


async def sql(statement: str, **params):
    """Runs SQL on the test database directly, around the API."""
    async with engine.begin() as conn:
        return await conn.execute(text(statement), params)


# ---- People and access ----


@pytest.fixture
async def alice(client) -> AsyncClient:
    """Signs `client` in as Alice, the instance admin (the first account)."""
    response = await client.post(
        f"{API}/auth/setup",
        json={"email": "alice@example.com", "display_name": "Alice", "password": PASSWORD},
    )
    assert response.status_code == 201, response.text
    return client


@pytest.fixture
async def org(alice) -> dict:
    """Acme, owned by Alice."""
    return (await alice.post(f"{API}/orgs", json={"name": "Acme"})).json()


@pytest.fixture
def person(alice, new_client):
    """Brings someone into an organization through an invitation from Alice,
    with the invitation's `role`, `title` or `can_create_projects` if given.
    Returns their browser and user id."""

    async def person(org, name, **invitation):
        created = await alice.post(f"{API}/orgs/{org['id']}/invitations", json=invitation)
        browser = new_client()
        response = await browser.post(
            f"{API}/invitations/{created.json()['token']}/sign-up",
            json={
                "email": f"{name.lower()}@example.com",
                "display_name": name,
                "password": PASSWORD,
            },
        )
        assert response.status_code == 201, response.text
        return browser, response.json()["user"]["id"]

    return person


async def grant(client, project, role, box_id=None, *, user_id=None, group_id=None):
    """Gives a user or group a role in `project`; with `box_id`, on that box
    of the project's `diagram`."""
    body = {"role": role, **({"user_id": user_id} if user_id else {"group_id": group_id})}
    if box_id:
        body |= {"diagram_id": project["diagram"]["id"], "box_id": box_id}
    return await client.put(f"{API}/projects/{project['id']}/grants", json=body)


async def grants(client, project) -> list:
    return (await client.get(f"{API}/projects/{project['id']}/grants")).json()


# ---- Diagrams ----


def box(id, title, children=(), edges=()) -> dict:
    """A box in the editor's file format."""
    return {
        "id": id,
        "title": title,
        "position": {"x": 0, "y": 0},
        "children": list(children),
        "edges": list(edges),
    }


_project: dict = {}


@pytest.fixture
async def project(client) -> dict:
    """Signs `client` in as the instance admin, owner of the "Shop" project in
    the "Acme" organization: somewhere to keep diagrams, for tests that are
    not about access."""
    await client.post(
        "/api/v1/auth/setup",
        json={"email": "owner@example.com", "display_name": "Owner", "password": "correct horse"},
    )
    org = (await client.post("/api/v1/orgs", json={"name": "Acme"})).json()
    created = await client.post(f"/api/v1/orgs/{org['id']}/projects", json={"name": "Shop"})
    assert created.status_code == 201, created.text
    _project.clear()
    _project.update(created.json())
    return _project


def diagrams_path() -> str:
    """Where the `project` fixture's diagrams are listed and created."""
    return f"/api/v1/projects/{_project['id']}/diagrams"


def as_document(diagram: dict) -> dict:
    """A diagram as GET /diagrams/{id} gives it, in the editor's file format."""
    boxes = [
        Box(
            id=b["id"],
            parent_id=b["parent_id"],
            title=b["title"],
            type_id=b["type_id"],
            technology=b["technology"],
            description=b["description"],
            x=b["position"]["x"],
            y=b["position"]["y"],
        )
        for b in diagram["boxes"]
    ]
    edges = [
        Edge(id=e["id"], from_id=e["from"], to_id=e["to"], type_id=e["type_id"], label=e["label"])
        for e in diagram["edges"]
    ]
    spots = [
        ExternalSpot(canvas_id=b["id"], box_id=k, x=p["x"], y=p["y"])
        for b in diagram["boxes"]
        for k, p in b["externals"].items()
    ]
    return to_document(boxes, edges, spots)


def changes_to(diagram: dict, document: dict) -> dict:
    """The body of POST /diagrams/{id}/changes that turns `diagram` (as GET
    gives it) into `document` (the file format): what an editor's save sends."""
    rows = to_rows(normalize_document(document))
    spots: dict[str, dict] = {}
    for spot in rows.spots:
        spots.setdefault(spot["canvas_id"], {})[spot["box_id"]] = {"x": spot["x"], "y": spot["y"]}
    boxes = [
        {
            **{
                k: r[k]
                for k in ("id", "parent_id", "title", "type_id", "technology", "description")
            },
            "position": {"x": r["x"], "y": r["y"]},
            "externals": spots.get(r["id"], {}),
        }
        for r in rows.boxes
    ]
    edges = [
        {
            "id": r["id"],
            "from": r["from_id"],
            "to": r["to_id"],
            "type_id": r["type_id"],
            "label": r["label"],
        }
        for r in rows.edges
    ]
    old_boxes = {b["id"]: b for b in diagram["boxes"]}
    old_edges = {e["id"]: e for e in diagram["edges"]}
    box_patches = [patch(old_boxes[b["id"]], b) for b in boxes if b["id"] in old_boxes]
    edge_patches = [patch(old_edges[e["id"]], e) for e in edges if e["id"] in old_edges]
    return {
        "version": diagram["version"],
        "added_boxes": [b for b in boxes if b["id"] not in old_boxes],
        "changed_boxes": [p for p in box_patches if len(p) > 1],
        "removed_boxes": [i for i in old_boxes if i not in {b["id"] for b in boxes}],
        "added_edges": [e for e in edges if e["id"] not in old_edges],
        "changed_edges": [p for p in edge_patches if len(p) > 1],
        "removed_edges": [i for i in old_edges if i not in {e["id"] for e in edges}],
    }


def patch(old: dict, new: dict) -> dict:
    """What changes from `old` to `new` (a box or connection as the API gives
    them): the id and the fields that differ, spots one by one."""
    found = {"id": new["id"]}
    found |= {
        k: v for k, v in new.items() if k not in ("id", "parent_id", "externals") and old[k] != v
    }
    if "externals" in new:
        spots = {k: p for k, p in new["externals"].items() if old["externals"].get(k) != p}
        spots |= {k: None for k in old["externals"] if k not in new["externals"]}
        if spots:
            found["externals"] = spots
    return found


async def save_document(client: AsyncClient, diagram_id: str, document: dict):
    """Saves `document` (the file format) as the diagram's new content,
    sending only what changed. Returns the response."""
    url = f"/api/v1/diagrams/{diagram_id}"
    current = (await client.get(url)).json()
    return await client.post(f"{url}/changes", json=changes_to(current, document))


_TRUNCATE = text("TRUNCATE diagrams, projects, organizations, users, login_throttles CASCADE")


@pytest.fixture(autouse=True)
async def clean_tables() -> AsyncIterator[None]:
    """Every test starts from empty tables, whatever ran before (the frontend's
    end-to-end tests use this database too)."""
    async with engine.begin() as conn:
        await conn.execute(_TRUNCATE)
    yield
    async with engine.begin() as conn:
        await conn.execute(_TRUNCATE)
