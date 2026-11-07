import io
import zipfile
from urllib.parse import unquote

import pytest
from conftest import diagrams_path, save_document

from app.adr_markdown import filename
from app.diagram_format import SCHEMA_VERSION

pytestmark = pytest.mark.usefixtures("project")

DOC = {
    "schemaVersion": SCHEMA_VERSION,
    "root": {
        "id": "root",
        "title": "Root",
        "position": {"x": 0, "y": 0},
        "children": [
            {
                "id": "db",
                "title": "Database",
                "position": {"x": 0, "y": 0},
                "children": [],
                "edges": [],
            },
            {
                "id": "api",
                "title": "API",
                "position": {"x": 300, "y": 0},
                "children": [],
                "edges": [],
            },
        ],
        "edges": [],
    },
}


@pytest.fixture
async def diagram(client):
    response = await client.post(diagrams_path(), json={"name": "Shop", "document": DOC})
    return response.json()


async def create_adr(client, diagram, **body):
    response = await client.post(f"/api/v1/projects/{diagram['project_id']}/adrs", json=body)
    assert response.status_code == 201, response.text
    return response.json()


async def call(client, method, url, **json):
    response = await client.request(method, url, json=json)
    assert response.status_code in (200, 201), response.text
    return response.json()


@pytest.mark.parametrize(
    ("number", "title", "expected"),
    [
        (1, "Record architecture decisions", "0001-record-architecture-decisions.md"),
        (12, "Use PostgreSQL 18 (not MySQL)!", "0012-use-postgresql-18-not-mysql.md"),
        (3, "使用 PostgreSQL 存储图表", "0003-使用-postgresql-存储图表.md"),
        (4, "a/b\\c:d*e?f", "0004-a-b-c-d-e-f.md"),
        (5, "!!!", "0005-decision.md"),
        (6, "x" * 100, "0006-" + "x" * 60 + ".md"),
    ],
)
def test_filenames(number, title, expected):
    assert filename(number, title) == expected


async def test_markdown_of_a_proposed_adr(client, diagram):
    adr = await create_adr(
        client,
        diagram,
        title="Use PostgreSQL",
        context="We need durable storage.\n",
        decisions=["We will use **PostgreSQL 18**.", "One database per service."],
        negative_consequences=["Migrating the old data\ntakes a weekend."],
    )

    response = await client.get(f"/api/v1/adrs/{adr['id']}/markdown")

    assert response.status_code == 200
    assert response.headers["content-type"] == "text/markdown; charset=utf-8"
    assert 'filename="0001-use-postgresql.md"' in response.headers["content-disposition"]
    assert response.text == (
        "# 1. Use PostgreSQL\n\n"
        f"Date: {adr['created_at'][:10]}\n\n"
        "## Status\n\n"
        "Proposed\n\n"
        "Proposed by Owner.\n\n"
        "## Context\n\n"
        "We need durable storage.\n\n"
        "## Decision\n\n"
        "- We will use **PostgreSQL 18**.\n"
        "- One database per service.\n\n"
        "## Consequences\n\n"
        # Only kinds that have items get a heading; later lines stay inside their item.
        "### Negative\n\n"
        "- Migrating the old data\n"
        "  takes a weekend.\n"
    )


async def test_markdown_of_an_empty_adr_keeps_every_section(client, diagram):
    adr = await create_adr(client, diagram, title="Empty")
    text = (await client.get(f"/api/v1/adrs/{adr['id']}/markdown")).text
    assert text.endswith("## Context\n\n## Decision\n\n## Consequences\n")


async def test_markdown_lists_positive_before_negative(client, diagram):
    adr = await create_adr(
        client,
        diagram,
        title="Both",
        positive_consequences=["Fast"],
        negative_consequences=["Costly"],
    )
    text = (await client.get(f"/api/v1/adrs/{adr['id']}/markdown")).text
    assert text.endswith("## Consequences\n\n### Positive\n\n- Fast\n\n### Negative\n\n- Costly\n")


async def test_markdown_shows_relations_and_diagram_elements(client, diagram):
    old = await create_adr(client, diagram, title="Use MySQL")
    old = await call(
        client,
        "PUT",
        f"/api/v1/adrs/{old['id']}/links",
        version=1,
        links=[{"diagram_id": diagram["id"], "kind": "box", "id": "db"}],
    )
    old = await call(
        client, "POST", f"/api/v1/adrs/{old['id']}/transition", version=2, to="accepted"
    )
    new = await call(client, "POST", f"/api/v1/adrs/{old['id']}/supersede", title="Use PostgreSQL")
    await call(client, "POST", f"/api/v1/adrs/{new['id']}/transition", version=1, to="accepted")
    # The box is then removed from the diagram.
    trimmed = {**DOC, "root": {**DOC["root"], "children": DOC["root"]["children"][1:]}}
    saved = await save_document(client, diagram["id"], trimmed)
    assert saved.status_code == 200, saved.text

    old_md = (await client.get(f"/api/v1/adrs/{old['id']}/markdown")).text
    new_md = (await client.get(f"/api/v1/adrs/{new['id']}/markdown")).text

    assert (
        "## Status\n\nSuperseded\n\nProposed by Owner. Accepted by Owner.\n\n"
        "Superseded by [2. Use PostgreSQL](0002-use-postgresql.md)\n" in old_md
    )
    assert (
        "## Status\n\nAccepted\n\nProposed by Owner. Accepted by Owner.\n\n"
        "Supersedes [1. Use MySQL](0001-use-mysql.md)\n" in new_md
    )
    assert new_md.endswith("## Diagram elements\n\n- Box: Database (no longer in the diagram)\n")
    # A decided ADR is dated by its decision.
    assert f"Date: {old['decided_at'][:10]}" in old_md


async def test_markdown_keeps_titles_on_one_line_and_escapes_link_text(client, diagram):
    target = await create_adr(client, diagram, title="Use [brackets]")
    adr = await create_adr(client, diagram, title="Other")
    await call(
        client,
        "PUT",
        f"/api/v1/adrs/{adr['id']}/relations",
        version=1,
        relations=[{"kind": "relates_to", "adr_id": target["id"]}],
    )

    md = (await client.get(f"/api/v1/adrs/{adr['id']}/markdown")).text

    assert r"Relates to [1. Use \[brackets\]](0001-use-brackets.md)" in md


async def test_titles_cannot_contain_line_breaks(client, diagram):
    response = await client.post(
        f"/api/v1/projects/{diagram['project_id']}/adrs", json={"title": "Two\nlines"}
    )
    assert response.status_code == 422


async def test_non_ascii_download_names(client, diagram):
    adr = await create_adr(client, diagram, title="使用 PostgreSQL")

    disposition = (await client.get(f"/api/v1/adrs/{adr['id']}/markdown")).headers[
        "content-disposition"
    ]

    assert disposition.startswith('attachment; filename="0001-__-postgresql.md"; ')
    encoded = disposition.split("filename*=UTF-8''")[1]
    assert unquote(encoded) == "0001-使用-postgresql.md"


async def test_export_all_adrs_as_a_zip(client, diagram):
    await create_adr(client, diagram, title="Use MySQL")
    await create_adr(client, diagram, title="使用 Redis")

    response = await client.get(f"/api/v1/projects/{diagram['project_id']}/adrs/export.zip")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert 'filename="Shop ADRs.zip"' in response.headers["content-disposition"]
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    assert archive.namelist() == ["0001-use-mysql.md", "0002-使用-redis.md"]
    assert archive.read("0002-使用-redis.md").decode().startswith("# 2. 使用 Redis\n")


async def test_export_of_a_diagram_without_adrs_is_an_empty_zip(client, diagram):
    response = await client.get(f"/api/v1/projects/{diagram['project_id']}/adrs/export.zip")
    assert zipfile.ZipFile(io.BytesIO(response.content)).namelist() == []


async def test_export_unknown(client):
    zero = "00000000-0000-0000-0000-000000000000"
    assert (await client.get(f"/api/v1/adrs/{zero}/markdown")).status_code == 404
    assert (await client.get(f"/api/v1/diagrams/{zero}/adrs/export.zip")).status_code == 404
