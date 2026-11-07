"""adr scopes

ADRs move from diagrams to projects. Existing ADRs keep their content and
become about the whole project, renumbered within it (oldest diagram first);
their links name the diagram they point into. Revisions gain who made them.

Revision ID: 92c75bd83cc6
Revises: eedbf5481124
Create Date: 2026-11-01 19:51:58.484385
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "92c75bd83cc6"
down_revision: str | None = "eedbf5481124"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ACTIONS = (
    "'created', 'edited', 'linked', 'related', 'accepted', 'rejected', 'deprecated', 'superseded'"
)


def upgrade() -> None:
    # Links name their diagram (still the ADR's own one here).
    op.add_column("adr_links", sa.Column("diagram_id", sa.UUID(), nullable=True))
    op.execute("UPDATE adr_links l SET diagram_id = a.diagram_id FROM adrs a WHERE a.id = l.adr_id")
    op.alter_column("adr_links", "diagram_id", nullable=False)
    op.drop_constraint("pk_adr_links", "adr_links", type_="primary")
    op.create_primary_key(
        "pk_adr_links", "adr_links", ["adr_id", "diagram_id", "kind", "target_id"]
    )
    op.drop_index(op.f("ix_adr_links_target_id"), table_name="adr_links")
    op.create_index("ix_adr_links_target", "adr_links", ["diagram_id", "target_id"], unique=False)

    # ADRs belong to the project, numbered in it; the old ones are about all of it.
    op.add_column(
        "projects",
        sa.Column("last_adr_number", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column("adrs", sa.Column("project_id", sa.UUID(), nullable=True))
    op.add_column("adrs", sa.Column("box_id", sa.Text(), nullable=True))
    op.add_column("adrs", sa.Column("box_title", sa.Text(), nullable=True))
    op.drop_constraint(op.f("uq_adrs_diagram_number"), "adrs", type_="unique")
    op.drop_constraint(op.f("fk_adrs_diagram_id_diagrams"), "adrs", type_="foreignkey")
    op.alter_column("adrs", "diagram_id", existing_type=sa.UUID(), nullable=True)
    op.execute(
        """
        UPDATE adrs a SET project_id = n.project_id, number = n.number, diagram_id = NULL
        FROM (
            SELECT a.id, d.project_id,
                   row_number() OVER (
                       PARTITION BY d.project_id ORDER BY d.created_at, d.id, a.number
                   ) AS number
            FROM adrs a JOIN diagrams d ON d.id = a.diagram_id
        ) n
        WHERE n.id = a.id
        """
    )
    op.execute(
        """
        UPDATE projects p SET last_adr_number = m.number
        FROM (SELECT project_id, max(number) AS number FROM adrs GROUP BY project_id) m
        WHERE m.project_id = p.id
        """
    )
    op.alter_column("adrs", "project_id", nullable=False)
    op.create_foreign_key(
        op.f("fk_adrs_project_id_projects"),
        "adrs",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint("uq_adrs_project_number", "adrs", ["project_id", "number"])
    op.create_index(op.f("ix_adrs_project_id"), "adrs", ["project_id"], unique=False)
    op.create_index("ix_adrs_scope", "adrs", ["diagram_id", "box_id"], unique=False)
    op.create_check_constraint(
        op.f("ck_adrs_scope_box_in_diagram"), "adrs", "(diagram_id IS NULL) = (box_id IS NULL)"
    )
    op.drop_column("diagrams", "last_adr_number")

    # Revisions say what they did and who did it (unknown for the old ones).
    op.add_column("adr_revisions", sa.Column("action", sa.String(length=20), nullable=True))
    op.execute(
        """
        UPDATE adr_revisions SET action = CASE
            WHEN revision = 1 THEN 'created'
            WHEN snapshot->>'status' = 'proposed' THEN 'edited'
            ELSE snapshot->>'status'
        END
        """
    )
    op.alter_column("adr_revisions", "action", nullable=False)
    op.create_check_constraint(
        op.f("ck_adr_revisions_action_known"), "adr_revisions", f"action IN ({_ACTIONS})"
    )
    op.add_column("adr_revisions", sa.Column("author_id", sa.UUID(), nullable=True))
    op.add_column("adr_revisions", sa.Column("author_name", sa.Text(), nullable=True))
    op.add_column("adr_revisions", sa.Column("author_title", sa.Text(), nullable=True))
    op.create_foreign_key(
        op.f("fk_adr_revisions_author_id_users"),
        "adr_revisions",
        "users",
        ["author_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    # ADRs cannot go back into single diagrams: they are deleted.
    op.execute("DELETE FROM adrs")

    op.drop_constraint(
        op.f("fk_adr_revisions_author_id_users"), "adr_revisions", type_="foreignkey"
    )
    op.drop_column("adr_revisions", "author_title")
    op.drop_column("adr_revisions", "author_name")
    op.drop_column("adr_revisions", "author_id")
    op.drop_constraint(op.f("ck_adr_revisions_action_known"), "adr_revisions", type_="check")
    op.drop_column("adr_revisions", "action")

    op.add_column(
        "diagrams",
        sa.Column("last_adr_number", sa.Integer(), server_default="0", nullable=False),
    )
    op.drop_constraint(op.f("ck_adrs_scope_box_in_diagram"), "adrs", type_="check")
    op.drop_index("ix_adrs_scope", table_name="adrs")
    op.drop_index(op.f("ix_adrs_project_id"), table_name="adrs")
    op.drop_constraint("uq_adrs_project_number", "adrs", type_="unique")
    op.drop_constraint(op.f("fk_adrs_project_id_projects"), "adrs", type_="foreignkey")
    op.alter_column("adrs", "diagram_id", existing_type=sa.UUID(), nullable=False)
    op.create_foreign_key(
        op.f("fk_adrs_diagram_id_diagrams"),
        "adrs",
        "diagrams",
        ["diagram_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint(op.f("uq_adrs_diagram_number"), "adrs", ["diagram_id", "number"])
    op.drop_column("adrs", "box_title")
    op.drop_column("adrs", "box_id")
    op.drop_column("adrs", "project_id")
    op.drop_column("projects", "last_adr_number")

    op.drop_index("ix_adr_links_target", table_name="adr_links")
    op.create_index(op.f("ix_adr_links_target_id"), "adr_links", ["target_id"], unique=False)
    op.drop_constraint("pk_adr_links", "adr_links", type_="primary")
    op.create_primary_key("pk_adr_links", "adr_links", ["adr_id", "kind", "target_id"])
    op.drop_column("adr_links", "diagram_id")
