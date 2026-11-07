import io
from urllib.parse import unquote

import pytest
from conftest import API, diagrams_path
from pypdf import PdfReader

from app.diagram_format import SCHEMA_VERSION

pytestmark = pytest.mark.usefixtures("project")


def box(id, title, children=(), x=0):
    return {
        "id": id,
        "title": title,
        "position": {"x": x, "y": 0},
        "children": list(children),
        "edges": [],
    }


DOC = {
    "schemaVersion": SCHEMA_VERSION,
    "root": box(
        "root",
        "Root",
        [
            box("pay", "Payments", [box("ledger", "Ledger"), box("fraud", "Fraud", x=320)]),
            box("shop", "Shop", [box("cart", "Cart")], x=320),
        ],
    ),
}


@pytest.fixture
async def diagram(client):
    response = await client.post(diagrams_path(), json={"name": "Checkout", "document": DOC})
    assert response.status_code == 201, response.text
    return response.json()


def export_path(diagram):
    return f"{API}/diagrams/{diagram['id']}/export.pdf"


def bookmark_titles(pdf):
    reader = PdfReader(io.BytesIO(pdf))
    return [item.title for item in reader.outline if not isinstance(item, list)]


def filename(response):
    disposition = response.headers["content-disposition"]
    return unquote(disposition.split("filename*=UTF-8''")[1])


async def test_a_diagram_downloads_as_a_pdf(client, diagram):
    response = await client.get(export_path(diagram))

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert filename(response) == "Checkout.pdf"
    assert response.content.startswith(b"%PDF")
    assert bookmark_titles(response.content) == ["Root level", "Payments", "Shop"]
    cover = PdfReader(io.BytesIO(response.content)).pages[0].extract_text()
    assert "Checkout" in cover
    assert "Owner" not in cover  # who exported it is left out


async def test_the_inside_of_one_box(client, diagram):
    response = await client.get(export_path(diagram), params={"box": "pay"})

    assert response.status_code == 200
    assert filename(response) == "Checkout - Payments.pdf"
    assert bookmark_titles(response.content) == ["Payments"]


async def test_an_unknown_box_is_not_found(client, diagram):
    response = await client.get(export_path(diagram), params={"box": "nope"})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "box_not_found"
    assert response.json()["error"]["details"] == {"box": "nope"}


async def test_letter_paper(client, diagram):
    response = await client.get(export_path(diagram), params={"paper": "letter"})

    page = PdfReader(io.BytesIO(response.content)).pages[0].mediabox
    assert (round(float(page.width)), round(float(page.height))) == (612, 792)
    unknown = await client.get(export_path(diagram), params={"paper": "a3"})
    assert unknown.status_code == 422


async def test_names_in_any_script_survive_the_download(client):
    created = await client.post(diagrams_path(), json={"name": "支付 / Pay", "document": DOC})
    response = await client.get(export_path(created.json()))

    assert filename(response) == "支付 / Pay.pdf"


async def test_viewers_may_export(client, diagram, project, new_client):
    invitation = await client.post(f"{API}/orgs/{project['org_id']}/invitations", json={})
    bob = new_client()
    signed_up = await bob.post(
        f"{API}/invitations/{invitation.json()['token']}/sign-up",
        json={"email": "bob@example.com", "display_name": "Bob", "password": "correct horse"},
    )
    bob_id = signed_up.json()["user"]["id"]

    # Not in the project yet: the diagram does not exist for him.
    outsider = await bob.get(export_path(diagram))
    assert outsider.status_code == 404
    assert outsider.json()["error"]["code"] == "diagram_not_found"

    await client.put(
        f"{API}/projects/{project['id']}/grants", json={"user_id": bob_id, "role": "viewer"}
    )
    assert (await bob.get(export_path(diagram))).status_code == 200


async def test_signing_in_is_required(diagram, new_client):
    response = await new_client().get(export_path(diagram))

    assert response.status_code == 401
