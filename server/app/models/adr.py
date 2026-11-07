import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class AdrStatus(StrEnum):
    PROPOSED = "proposed"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    DEPRECATED = "deprecated"
    SUPERSEDED = "superseded"


class LinkKind(StrEnum):
    BOX = "box"
    CONNECTION = "connection"


class RelationKind(StrEnum):
    # This ADR replaces the target; the target becomes superseded once this
    # one is accepted.
    SUPERSEDES = "supersedes"
    # This ADR changes part of the target, which stays in force.
    AMENDS = "amends"
    RELATES_TO = "relates_to"


def _sql_in(values: type[StrEnum]) -> str:
    return ", ".join(f"'{v.value}'" for v in values)


_STATUSES = _sql_in(AdrStatus)


class Adr(Base):
    """An architecture decision record after Michael Nygard's format: a title,
    a status, the context (Markdown), the decisions taken (a list), and their
    consequences, split into positive and negative (two lists). List items are
    short Markdown texts.

    Each ADR is about the whole project, or one box of one of its diagrams
    (its scope), which decides who may propose and decide it."""

    __tablename__ = "adrs"
    __table_args__ = (
        UniqueConstraint("project_id", "number", name="uq_adrs_project_number"),
        CheckConstraint("char_length(btrim(title)) > 0", name="title_not_blank"),
        CheckConstraint(f"status IN ({_STATUSES})", name="status_known"),
        CheckConstraint("number > 0", name="number_positive"),
        CheckConstraint("version > 0", name="version_positive"),
        CheckConstraint("(diagram_id IS NULL) = (box_id IS NULL)", name="scope_box_in_diagram"),
        Index("ix_adrs_scope", "diagram_id", "box_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    # The scope. Both empty: the whole project. Both set: one box of a
    # diagram and everything inside it. Not a foreign key: the ADR outlives
    # the diagram, and its scope then reads as deleted.
    diagram_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    box_id: Mapped[str | None] = mapped_column(Text)
    # The box's name when the ADR was written, shown if it is deleted later.
    box_title: Mapped[str | None] = mapped_column(Text)
    # 1, 2, 3... within the project; shown as ADR-0001.
    number: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default=AdrStatus.PROPOSED)
    context: Mapped[str] = mapped_column(Text, default="", server_default="")
    decisions: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")
    positive_consequences: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default="[]"
    )
    negative_consequences: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default="[]"
    )
    # Bumped on every change; equals the number of the latest revision.
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # When it was accepted or rejected.
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AdrLink(Base):
    """Ties an ADR to a box or connection in one of its project's diagrams.
    The target (or the whole diagram) may later be deleted; the link stays
    and reads as orphaned."""

    __tablename__ = "adr_links"
    __table_args__ = (
        CheckConstraint(f"kind IN ({_sql_in(LinkKind)})", name="kind_known"),
        Index("ix_adr_links_target", "diagram_id", "target_id"),
    )

    adr_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("adrs.id", ondelete="CASCADE"), primary_key=True
    )
    # Not a foreign key, like the ADR's scope: the link outlives the diagram.
    diagram_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), primary_key=True)
    # A box or connection id from the diagram document.
    target_id: Mapped[str] = mapped_column(Text, primary_key=True)
    # The target's name when it was linked, shown if it is deleted later.
    title: Mapped[str] = mapped_column(Text)


class AdrRelation(Base):
    """A directed relation from one ADR to another in the same project. At most
    one relation per pair."""

    __tablename__ = "adr_relations"
    __table_args__ = (
        CheckConstraint(f"kind IN ({_sql_in(RelationKind)})", name="kind_known"),
        CheckConstraint("source_id <> target_id", name="not_self"),
    )

    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("adrs.id", ondelete="CASCADE"), primary_key=True
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("adrs.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(20))


class RevisionAction(StrEnum):
    """What a revision did."""

    CREATED = "created"
    EDITED = "edited"
    LINKED = "linked"
    # Moved to another scope (while proposed).
    SCOPED = "scoped"
    RELATED = "related"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    DEPRECATED = "deprecated"
    # Made superseded by accepting a newer ADR.
    SUPERSEDED = "superseded"


class AdrRevision(Base):
    """An append-only snapshot of an ADR after each change (revision 1 is the
    ADR as created), with who made the change."""

    __tablename__ = "adr_revisions"
    __table_args__ = (
        CheckConstraint(f"action IN ({_sql_in(RevisionAction)})", name="action_known"),
    )

    adr_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("adrs.id", ondelete="CASCADE"), primary_key=True
    )
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    # {title, status, context, decisions, positive_consequences,
    #  negative_consequences, links, relations}
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB)
    action: Mapped[str] = mapped_column(String(20))
    # Who did it. Their name and job title are copied as they were then, so
    # the record reads the same after someone renames or leaves.
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    author_name: Mapped[str | None] = mapped_column(Text)
    author_title: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
