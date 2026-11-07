import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    WithJsonSchema,
    model_validator,
)

from app.models import ProjectRole
from app.schemas.common import Version, one_line

Name = Annotated[str, one_line(200)]

# Checked by app.diagram_format, which reports errors the way the editor does.
# In the API description, app.main swaps this placeholder for a reference to
# the DiagramDocument schema (app.schemas.document).
DOCUMENT_PLACEHOLDER = "x-nestboard-document"
Document = Annotated[
    dict[str, Any],
    WithJsonSchema({"type": "object", DOCUMENT_PLACEHOLDER: True}),
]

# Box and connection ids are made by the editor: any non-empty text.
ItemId = Annotated[str, StringConstraints(min_length=1)]
# Box and connection types: any non-empty text, known to this version or not,
# kept exactly as written.
TypeId = Annotated[str, StringConstraints(min_length=1)]
Coordinate = Annotated[float, Field(allow_inf_nan=False)]


class Position(BaseModel):
    x: Coordinate
    y: Coordinate


class Box(BaseModel):
    """A box. Every box is also a canvas holding the boxes inside it."""

    model_config = ConfigDict(extra="forbid")

    id: ItemId
    parent_id: ItemId | None = Field(
        description="The box it sits in; null only for the root canvas. It never changes: "
        "to put a box somewhere else, delete it and add a new one there."
    )
    title: str
    type_id: TypeId | None = Field(
        default=None, description='The box type, e.g. "database"; null for the generic type.'
    )
    technology: str | None = Field(default=None, description='One technology, e.g. "PostgreSQL".')
    description: str | None = None
    position: Position = Field(description="Where it sits on its parent's canvas.")
    externals: dict[ItemId, Position] = Field(
        default_factory=dict,
        description="Where the user put external boxes on this box's canvas (the far ends "
        "of connections leaving it), by box id. Others rest in a column on the right. Spots "
        "for boxes that are not in the diagram are dropped.",
    )


class Edge(BaseModel):
    """A connection between two boxes. The canvas showing it is the deepest box
    holding both ends."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: ItemId
    from_: ItemId = Field(alias="from", description="Box id.")
    to: ItemId = Field(description="Box id.")
    type_id: TypeId | None = Field(
        default=None, description='The connection type, e.g. "request"; null for the generic type.'
    )
    label: str | None = None


def _not_null(model: BaseModel, *names: str) -> None:
    """Fields that may be left out of a change but, when given, not be null."""
    for name in names:
        if name in model.model_fields_set and getattr(model, name) is None:
            raise ValueError(f"{name.rstrip('_')} cannot be null.")


class BoxPatch(BaseModel):
    """A change to a box: its id and the fields that change, as they are now.
    Fields left out stay as they are; title, position and externals cannot be
    null. A box never moves into another box, so there is no parent_id."""

    model_config = ConfigDict(extra="forbid")

    id: ItemId
    title: str | None = None
    type_id: TypeId | None = None
    technology: str | None = None
    description: str | None = None
    position: Position | None = None
    externals: dict[ItemId, Position | None] | None = Field(
        default=None,
        description="Spots of external boxes on this box's canvas that change, by box id; "
        "null forgets one (it goes back to the column on the right). Others stay.",
    )

    @model_validator(mode="after")
    def _required_fields_not_null(self) -> "BoxPatch":
        _not_null(self, "title", "position", "externals")
        return self


class EdgePatch(BaseModel):
    """A change to a connection: its id and the fields that change. Fields
    left out stay as they are; from and to cannot be null."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: ItemId
    from_: ItemId | None = Field(default=None, alias="from")
    to: ItemId | None = None
    type_id: TypeId | None = None
    label: str | None = None

    @model_validator(mode="after")
    def _ends_not_null(self) -> "EdgePatch":
        _not_null(self, "from_", "to")
        return self


class DiagramCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    document: Document | None = Field(
        default=None,
        description="What to start from, in the editor's file format (e.g. an imported "
        "file). Omit to start from an empty diagram.",
    )


class DiagramUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Version | None = Field(
        default=None,
        description="Only rename if the diagram is still at this version (409 "
        "`version_conflict` otherwise). Leave out to rename whatever version it is at: "
        "while people edit it, the version moves on with every change.",
    )
    name: Name


class Changes(BaseModel):
    """Boxes and connections added, changed or deleted, made on top of the
    diagram as it is now: for each field, the later change wins. Anything not
    mentioned stays as it is.

    So that several people can change a diagram at once, a change to a box or
    connection that is no longer there (deleted meanwhile), or a connection
    or box added to one, is skipped, and deleting one already gone does
    nothing. Adding one that is already there replaces it, so changes sent
    twice do no harm."""

    model_config = ConfigDict(extra="forbid")

    added_boxes: list[Box] = Field(default_factory=list, description="New boxes, whole.")
    changed_boxes: list[BoxPatch] = Field(default_factory=list)
    removed_boxes: list[ItemId] = Field(
        default_factory=list,
        description="Boxes deleted, with everything inside them and every connection "
        "touching them.",
    )
    added_edges: list[Edge] = Field(default_factory=list, description="New connections, whole.")
    changed_edges: list[EdgePatch] = Field(default_factory=list)
    removed_edges: list[ItemId] = Field(default_factory=list, description="Connections deleted.")

    @model_validator(mode="after")
    def _changes_something(self) -> "Changes":
        if not any(getattr(self, name) for name in Changes.model_fields):
            raise ValueError("Add, change or delete at least one box or connection.")
        return self


class DiagramChanges(Changes):
    version: Version | None = Field(
        default=None,
        description="Only save if the diagram is still at this version (409 "
        "`version_conflict` otherwise), e.g. to be sure nobody changed it since it was read. "
        "Leave out to make the changes on top of whatever is there now.",
    )


class DiagramSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    version: int
    created_at: datetime
    updated_at: datetime


class DiagramSaved(DiagramSummary):
    skipped_boxes: list[str] = Field(
        description="Boxes the save names but left alone: not in the diagram (deleted "
        "meanwhile), or added inside one that is not."
    )
    skipped_edges: list[str] = Field(
        description="Likewise for connections, also those with an end that is not there."
    )


class DiagramOut(DiagramSummary):
    root_id: str = Field(description="The root canvas: the one box without a parent.")
    boxes: list[Box] = Field(description="In the order they were added, the root first.")
    edges: list[Edge] = Field(description="In the order they were added.")


class DiagramPage(BaseModel):
    items: list[DiagramSummary]
    total: int
    limit: int
    offset: int


class DiagramAccess(BaseModel):
    project_role: ProjectRole = Field(description="Your role across the whole project.")
    box_roles: dict[str, ProjectRole] = Field(
        description="Your grants on boxes of this diagram, by box id. They cover each box and "
        "everything inside it."
    )
