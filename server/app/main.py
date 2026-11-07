from importlib.metadata import version
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi

from app.api import router
from app.body_limit import BodySizeLimit
from app.config import get_settings
from app.errors import install_error_handlers
from app.schemas.diagrams import DOCUMENT_PLACEHOLDER
from app.schemas.document import DiagramDocument

DESCRIPTION = """\
Stores Nestboard projects: their diagrams and architecture decision records (ADRs).

Every change names the `version` it is based on; if someone else changed the
record in between, it fails with 409 `version_conflict` and the client should
reload. Errors share one shape: `{"error": {"code", "message", "details"?}}`.
"""


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Nestboard API",
        version=version("nestboard-server"),
        description=DESCRIPTION,
        openapi_url="/api/v1/openapi.json",
        docs_url="/api/v1/docs",
        redoc_url=None,
        # Operation ids are the function names (create_adr, list_diagrams...),
        # so generated clients and AI tool definitions read naturally.
        generate_unique_id_function=lambda route: route.name,
    )
    app.add_middleware(BodySizeLimit, max_bytes=settings.max_request_bytes)
    # Added last so it wraps everything: even a 413 from the size limit
    # carries CORS headers, and the browser sees the real error.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)
    app.include_router(router)
    app.openapi = lambda: _openapi(app)  # type: ignore[method-assign]
    return app


def _openapi(app: FastAPI) -> dict[str, Any]:
    """FastAPI's description, with every diagram document field pointing at
    the DiagramDocument schema (see schemas.diagrams.Document)."""
    if app.openapi_schema is None:
        schema = get_openapi(
            title=app.title,
            version=app.version,
            description=app.description,
            routes=app.routes,
        )
        components = schema.setdefault("components", {}).setdefault("schemas", {})
        document = DiagramDocument.model_json_schema(
            by_alias=True, ref_template="#/components/schemas/{model}"
        )
        components.update(document.pop("$defs"))
        components["DiagramDocument"] = document
        app.openapi_schema = _point_at_document(schema)
    return app.openapi_schema


def _point_at_document(node: Any) -> Any:
    if isinstance(node, dict):
        if node.get(DOCUMENT_PLACEHOLDER):
            return {"$ref": "#/components/schemas/DiagramDocument"}
        return {key: _point_at_document(value) for key, value in node.items()}
    if isinstance(node, list):
        return [_point_at_document(item) for item in node]
    return node


app = create_app()
