"""boxes and edges

A diagram's boxes, connections and the spots of external boxes become rows of
their own instead of one JSON document, so a save writes only what changed.
Existing diagrams are deleted (the user chose to start over); grants on their
boxes go with them, ADRs stay and read their scope and links as deleted.

Revision ID: f0dd0d25f319
Revises: 7de5d50117e6
Create Date: 2026-11-03 10:02:36.394008
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f0dd0d25f319"
down_revision: str | None = "7de5d50117e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _in_diagram(column: str, name: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["diagram_id", column], ["boxes.diagram_id", "boxes.id"], name=name, ondelete="CASCADE"
    )


def _diagram(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["diagram_id"],
        ["diagrams.id"],
        name=op.f(f"fk_{table}_diagram_id_diagrams"),
        ondelete="CASCADE",
    )


def upgrade() -> None:
    op.execute("DELETE FROM diagrams")
    op.drop_column("diagrams", "document")

    op.create_table(
        "boxes",
        sa.Column("diagram_id", sa.UUID(), nullable=False),
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("parent_id", sa.Text(), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("type_id", sa.Text(), nullable=True),
        sa.Column("technology", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("x", sa.Double(), nullable=False),
        sa.Column("y", sa.Double(), nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.CheckConstraint("type_id <> ''", name=op.f("ck_boxes_type_not_empty")),
        _in_diagram("parent_id", "fk_boxes_parent"),
        _diagram("boxes"),
        sa.PrimaryKeyConstraint("diagram_id", "id", name=op.f("pk_boxes")),
    )
    op.create_index("ix_boxes_parent", "boxes", ["diagram_id", "parent_id"])
    op.create_index(
        "uq_boxes_root",
        "boxes",
        ["diagram_id"],
        unique=True,
        postgresql_where=sa.text("parent_id IS NULL"),
    )

    op.create_table(
        "edges",
        sa.Column("diagram_id", sa.UUID(), nullable=False),
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("from_id", sa.Text(), nullable=False),
        sa.Column("to_id", sa.Text(), nullable=False),
        sa.Column("type_id", sa.Text(), nullable=True),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.CheckConstraint("type_id <> ''", name=op.f("ck_edges_type_not_empty")),
        sa.CheckConstraint("from_id <> to_id", name=op.f("ck_edges_two_ends")),
        _in_diagram("from_id", "fk_edges_from"),
        _in_diagram("to_id", "fk_edges_to"),
        _diagram("edges"),
        sa.PrimaryKeyConstraint("diagram_id", "id", name=op.f("pk_edges")),
    )
    op.create_index("ix_edges_from", "edges", ["diagram_id", "from_id"])
    op.create_index("ix_edges_to", "edges", ["diagram_id", "to_id"])

    op.create_table(
        "external_spots",
        sa.Column("diagram_id", sa.UUID(), nullable=False),
        sa.Column("canvas_id", sa.Text(), nullable=False),
        sa.Column("box_id", sa.Text(), nullable=False),
        sa.Column("x", sa.Double(), nullable=False),
        sa.Column("y", sa.Double(), nullable=False),
        _in_diagram("canvas_id", "fk_external_spots_canvas"),
        _in_diagram("box_id", "fk_external_spots_box"),
        _diagram("external_spots"),
        sa.PrimaryKeyConstraint(
            "diagram_id", "canvas_id", "box_id", name=op.f("pk_external_spots")
        ),
    )
    op.create_index("ix_external_spots_box", "external_spots", ["diagram_id", "box_id"])


def downgrade() -> None:
    # Rows are not put back together into documents: diagrams are deleted again.
    op.drop_table("external_spots")
    op.drop_table("edges")
    op.drop_table("boxes")
    op.execute("DELETE FROM diagrams")
    op.add_column(
        "diagrams",
        sa.Column("document", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    )
