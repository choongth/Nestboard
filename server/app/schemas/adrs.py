import uuid
from datetime import datetime
from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    computed_field,
    model_validator,
)

from app.models import AdrStatus, LinkKind, ProjectRole, RelationKind, RevisionAction
from app.schemas.common import BoxId, BoxScope, Version, one_line

# One line: titles become Markdown headings and file names.
Title = Annotated[str, one_line(200)]
# Markdown, kept exactly as written. An empty string means "not written yet".
Section = Annotated[str, StringConstraints(max_length=100_000)]
# One decision or consequence: a short Markdown text, never blank.
Item = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10_000)]
MAX_ITEMS = 100
Items = Annotated[list[Item], Field(max_length=MAX_ITEMS)]

MAX_LINKS = 200
MAX_RELATIONS = 50
# What an ADR says: editable while proposed, copied when superseded, kept in
# every revision. Context is Markdown; the other three are lists of items.
CONTENT_FIELDS = (
    "title",
    "context",
    "decisions",
    "positive_consequences",
    "negative_consequences",
)


def adr_ref(number: int) -> str:
    return f"ADR-{number:04d}"


class AdrCreate(BoxScope):
    """Without diagram_id and box_id the ADR is about the whole project; with
    both, about that box and everything inside it."""

    title: Title
    context: Section = ""
    decisions: Items = []
    positive_consequences: Items = []
    negative_consequences: Items = []


class AdrUpdate(BaseModel):
    """Only a proposed ADR can be edited. Omitted fields stay as they are; a
    list given replaces the whole list."""

    model_config = ConfigDict(extra="forbid")

    version: Version
    title: Title | None = None
    context: Section | None = None
    decisions: Items | None = None
    positive_consequences: Items | None = None
    negative_consequences: Items | None = None

    @model_validator(mode="after")
    def _changes_something(self) -> "AdrUpdate":
        if all(getattr(self, field) is None for field in CONTENT_FIELDS):
            raise ValueError(
                "Give at least one of title, context, decisions, positive_consequences "
                "or negative_consequences."
            )
        return self


class AdrTransition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Version
    to: AdrStatus


class AdrSupersede(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Title | None = Field(
        default=None, description="Defaults to the title of the ADR being superseded."
    )


class LinkIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    diagram_id: uuid.UUID = Field(description="A diagram of the ADR's project.")
    kind: LinkKind
    id: BoxId = Field(description="A box or connection id in that diagram.")


class AdrScopeUpdate(BoxScope):
    """Moves a proposed ADR: without diagram_id and box_id to the whole
    project, with both to that box."""

    version: Version


class AdrLinksUpdate(BaseModel):
    """Replaces all of the ADR's links. Allowed in any status."""

    model_config = ConfigDict(extra="forbid")

    version: Version
    links: list[LinkIn] = Field(max_length=MAX_LINKS)


class RelationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: RelationKind
    adr_id: uuid.UUID


class AdrRelationsUpdate(BaseModel):
    """Replaces all of the ADR's relations. Only while it is proposed."""

    model_config = ConfigDict(extra="forbid")

    version: Version
    relations: list[RelationIn] = Field(max_length=MAX_RELATIONS)


class LinkOut(BaseModel):
    diagram_id: uuid.UUID
    kind: LinkKind
    id: str
    title: str = Field(
        description="The target's current name; if orphaned, its name when it was linked."
    )
    orphaned: bool = Field(description="The target (or its diagram) has been deleted.")


class ScopeOut(BaseModel):
    """The box an ADR is about."""

    diagram_id: uuid.UUID
    box_id: str
    title: str = Field(description="The box's current name; if orphaned, its name then.")
    orphaned: bool = Field(description="The box (or its diagram) has been deleted.")


class AuthorOut(BaseModel):
    user_id: uuid.UUID | None = Field(description="None if the account is gone.")
    name: str
    title: str | None = Field(description="Their job title in the organization then.")


class RelatedAdr(BaseModel):
    kind: RelationKind
    adr_id: uuid.UUID
    ref: str
    title: str
    status: AdrStatus


class AdrOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    scope: ScopeOut | None = Field(description="None: about the whole project.")
    number: int
    title: str
    status: AdrStatus
    context: str = Field(description="Markdown.")
    decisions: list[str] = Field(description="What was decided, one item each (Markdown).")
    positive_consequences: list[str]
    negative_consequences: list[str]
    version: int
    created_at: datetime
    updated_at: datetime
    decided_at: datetime | None
    links: list[LinkOut]
    relations: list[RelatedAdr] = Field(description="Relations from this ADR to others.")
    referenced_by: list[RelatedAdr] = Field(
        description="Relations from other ADRs to this one, e.g. the ADR that superseded it."
    )
    proposed_by: AuthorOut | None
    decided_by: AuthorOut | None = Field(description="Who accepted or rejected it.")
    my_role: ProjectRole = Field(
        description="The signed-in user's role at the ADR's scope: viewers read, editors "
        "propose, edit, link and move it, owners decide."
    )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def ref(self) -> str:
        """How people refer to it, e.g. ADR-0007."""
        return adr_ref(self.number)


class LinkRef(BaseModel):
    diagram_id: uuid.UUID | None = None
    kind: LinkKind
    id: str


class RelationRef(BaseModel):
    kind: RelationKind
    adr_id: uuid.UUID


class ScopeRef(BaseModel):
    diagram_id: uuid.UUID
    box_id: str


class AdrSnapshot(BaseModel):
    title: str
    status: AdrStatus
    context: str
    decisions: list[str] = []
    positive_consequences: list[str] = []
    negative_consequences: list[str] = []
    links: list[LinkRef] = []
    relations: list[RelationRef] = []
    scope: ScopeRef | None = Field(default=None, description="None: the whole project.")


class AdrRevisionOut(BaseModel):
    revision: int
    action: RevisionAction
    author: AuthorOut | None = Field(description="None if not known (older revisions).")
    snapshot: AdrSnapshot
    created_at: datetime
