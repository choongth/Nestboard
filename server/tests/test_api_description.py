import json
from pathlib import Path

import pytest
from conftest import diagrams_path
from openapi_spec_validator import validate

from app.config import get_settings
from app.schemas.document import DiagramDocument

pytestmark = pytest.mark.usefixtures("project")

EXAMPLES = Path(__file__).resolve().parents[2] / "examples"


async def openapi(client):
    return (await client.get("/api/v1/openapi.json")).json()


async def test_the_api_description_is_valid_openapi(client):
    validate(await openapi(client))


async def test_operation_ids_are_readable(client):
    spec = await openapi(client)
    ids = {op["operationId"] for path in spec["paths"].values() for op in path.values()}
    assert {
        "create_diagram",
        "create_adr",
        "transition_adr",
        "supersede_adr",
        "export_adrs",
        "export_pdf",
        "log_in",
        "get_me",
    } <= ids


async def test_the_diagram_document_is_described(client):
    spec = await openapi(client)
    schemas = spec["components"]["schemas"]

    create = schemas["DiagramCreate"]["properties"]["document"]
    assert {"$ref": "#/components/schemas/DiagramDocument"} in create["anyOf"]
    assert set(schemas["DiagramDocument"]["required"]) == {"schemaVersion", "root"}
    assert "from" in schemas["DiagramEdge"]["properties"]
    assert schemas["DiagramNode"]["properties"]["children"]["items"] == {
        "$ref": "#/components/schemas/DiagramNode"
    }


async def test_boxes_and_connections_are_described(client):
    spec = await openapi(client)
    schemas = spec["components"]["schemas"]

    assert schemas["DiagramOut"]["properties"]["boxes"]["items"] == {
        "$ref": "#/components/schemas/Box"
    }
    changes = schemas["DiagramChanges"]["properties"]
    lists = {
        f"{done}_{kind}" for done in ("added", "changed", "removed") for kind in ("boxes", "edges")
    }
    assert set(changes) == {"version", *lists}
    assert changes["changed_boxes"]["items"] == {"$ref": "#/components/schemas/BoxPatch"}
    assert {"from", "to", "type_id", "label"} <= set(schemas["Edge"]["properties"])
    assert {"type_id", "technology"} <= set(schemas["Box"]["properties"])
    assert "parent_id" not in schemas["BoxPatch"]["properties"]
    assert "/api/v1/diagrams/{diagram_id}/changes" in spec["paths"]


async def test_errors_are_described_with_the_shared_shape(client):
    spec = await openapi(client)
    responses = spec["paths"]["/api/v1/adrs/{adr_id}/transition"]["post"]["responses"]
    for status in ("404", "409", "422"):
        schema = responses[status]["content"]["application/json"]["schema"]
        assert schema == {"$ref": "#/components/schemas/ErrorResponse"}
    assert "HTTPValidationError" not in spec["components"]["schemas"]


def test_the_described_shape_accepts_real_files():
    """The documentation models must not drift from the real format."""
    gallery = json.loads((EXAMPLES / "box-types-gallery.json").read_text(encoding="utf-8"))
    DiagramDocument.model_validate(gallery)


async def test_docs_page_is_served(client):
    response = await client.get("/api/v1/docs")
    assert response.status_code == 200


# ---- Request size limit ----


async def test_a_body_over_the_declared_limit_is_refused(client):
    limit = get_settings().max_request_bytes
    response = await client.post(
        diagrams_path(),
        content=b"x" * (limit + 1),
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "request_too_large"


async def test_a_streamed_body_over_the_limit_is_refused(client):
    limit = get_settings().max_request_bytes

    async def chunks():
        for _ in range(limit // 100_000 + 2):
            yield b"x" * 100_000

    # No Content-Length: the size is only known while reading.
    response = await client.post(
        diagrams_path(), content=chunks(), headers={"content-type": "application/json"}
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "request_too_large"


async def test_a_large_body_under_the_limit_is_accepted(client):
    boxes = [
        {
            "id": f"b{i}",
            "title": "x" * 100,
            "position": {"x": i, "y": 0},
            "children": [],
            "edges": [],
        }
        for i in range(10_000)
    ]
    document = {
        "schemaVersion": 4,
        "root": {
            "id": "r",
            "title": "Root",
            "position": {"x": 0, "y": 0},
            "children": boxes,
            "edges": [],
        },
    }
    response = await client.post(diagrams_path(), json={"name": "Big", "document": document})
    assert response.status_code == 201


async def test_a_413_carries_cors_headers(client):
    response = await client.post(
        diagrams_path(),
        content=b"x" * (get_settings().max_request_bytes + 1),
        headers={"content-type": "application/json", "origin": "http://localhost:5173"},
    )
    assert response.status_code == 413
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
