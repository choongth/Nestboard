import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Double,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class Diagram(Base):
    __tablename__ = "diagrams"
    __table_args__ = (
        CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint("version > 0", name="version_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Who may see and change it comes from the project.
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    # Bumped on every change; a write must name the version it was based on.
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


def _in_diagram(column: str, name: str) -> ForeignKeyConstraint:
    """`column` names a box of the same diagram; deleting the box deletes the row."""
    return ForeignKeyConstraint(
        ["diagram_id", column],
        ["boxes.diagram_id", "boxes.id"],
        ondelete="CASCADE",
        name=name,
    )


class Box(Base):
    """A box of a diagram. Every box is also a canvas holding the boxes whose
    `parent_id` it is. The root canvas is the one box without a parent."""

    __tablename__ = "boxes"
    __table_args__ = (
        # Deleting a box deletes everything inside it.
        _in_diagram("parent_id", "fk_boxes_parent"),
        Index("ix_boxes_parent", "diagram_id", "parent_id"),
        Index(
            "uq_boxes_root", "diagram_id", unique=True, postgresql_where=text("parent_id IS NULL")
        ),
        CheckConstraint("type_id <> ''", name="type_not_empty"),
    )

    diagram_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("diagrams.id", ondelete="CASCADE"), primary_key=True
    )
    # Made by the editor; unique only within the diagram (a copy keeps them).
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    # Never changes: a box is not moved into another box (the editor copies
    # it there instead), so what is inside what only changes by adding and
    # deleting boxes.
    parent_id: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    # The box's type, e.g. "database"; none is the generic type. Any text is
    # kept as written, known to this version or not.
    type_id: Mapped[str | None] = mapped_column(Text)
    # One technology, e.g. "PostgreSQL".
    technology: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    # Where it sits on its parent's canvas.
    x: Mapped[float] = mapped_column(Double)
    y: Mapped[float] = mapped_column(Double)
    # The order boxes were added in, which the editor keeps them in.
    seq: Mapped[int] = mapped_column(BigInteger, Identity(always=True))


class Edge(Base):
    """A connection between two boxes of a diagram. Which canvas shows it (the
    deepest box holding both ends) follows from the boxes, so it is not stored."""

    __tablename__ = "edges"
    __table_args__ = (
        # Deleting either end deletes the connection.
        _in_diagram("from_id", "fk_edges_from"),
        _in_diagram("to_id", "fk_edges_to"),
        Index("ix_edges_from", "diagram_id", "from_id"),
        Index("ix_edges_to", "diagram_id", "to_id"),
        CheckConstraint("from_id <> to_id", name="two_ends"),
        CheckConstraint("type_id <> ''", name="type_not_empty"),
    )

    diagram_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("diagrams.id", ondelete="CASCADE"), primary_key=True
    )
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    from_id: Mapped[str] = mapped_column(Text)
    to_id: Mapped[str] = mapped_column(Text)
    # The connection's type, e.g. "request"; none is the generic type. Like
    # box types, any text is kept as written.
    type_id: Mapped[str | None] = mapped_column(Text)
    label: Mapped[str | None] = mapped_column(Text)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(always=True))


class ExternalSpot(Base):
    """Where the user put an external box (the far end of a connection leaving
    `canvas_id`) on `canvas_id`'s canvas. External boxes without a spot rest in
    a column on the right."""

    __tablename__ = "external_spots"
    __table_args__ = (
        _in_diagram("canvas_id", "fk_external_spots_canvas"),
        _in_diagram("box_id", "fk_external_spots_box"),
        Index("ix_external_spots_box", "diagram_id", "box_id"),
    )

    diagram_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("diagrams.id", ondelete="CASCADE"), primary_key=True
    )
    canvas_id: Mapped[str] = mapped_column(Text, primary_key=True)
    box_id: Mapped[str] = mapped_column(Text, primary_key=True)
    x: Mapped[float] = mapped_column(Double)
    y: Mapped[float] = mapped_column(Double)
