"""The diagram document's shape, for the API description only.

Documents are checked by app.diagram_format (which matches the editor's own
reader and its error messages), not by these models. They exist so OpenAPI
clients, such as a future AI integration, see the real structure instead of
an untyped object. Keep them in step with frontend/src/model/types.ts.
"""

from pydantic import BaseModel, ConfigDict, Field

from app.diagram_format import SCHEMA_VERSION
from app.schemas.diagrams import Position


class DiagramEdge(BaseModel):
    """A connection. It is stored on the deepest box containing both ends."""

    model_config = ConfigDict(title="DiagramEdge")

    id: str = Field(min_length=1)
    from_: str = Field(alias="from", description="Box id.")
    to: str = Field(description="Box id.")
    typeId: str | None = Field(  # noqa: N815 (file format field name)
        default=None, min_length=1, description='Connection type, e.g. "request". Omit for none.'
    )
    label: str | None = None


class DiagramNode(BaseModel):
    """A box. Every box is also a canvas holding its children."""

    model_config = ConfigDict(title="DiagramNode")

    id: str = Field(min_length=1)
    title: str
    typeId: str | None = Field(  # noqa: N815 (file format field name)
        default=None, min_length=1, description='Box type, e.g. "database". Omit for generic.'
    )
    technology: str | None = None
    description: str | None = None
    position: Position
    externals: dict[str, Position] | None = Field(
        default=None,
        description="Where the user put external boxes on this box's canvas (the far ends "
        "of connections leaving it), by box id. Others rest in a column on the right.",
    )
    children: list["DiagramNode"]
    edges: list[DiagramEdge]


class DiagramDocument(BaseModel):
    """Nestboard's nested file format: exactly what the editor saves to disk."""

    model_config = ConfigDict(title="DiagramDocument")

    schemaVersion: int = Field(  # noqa: N815 (file format field name)
        ge=1,
        le=SCHEMA_VERSION,
        description=f"Format version; {SCHEMA_VERSION} is current. "
        "Older versions are accepted and stored as the current one.",
    )
    root: DiagramNode
