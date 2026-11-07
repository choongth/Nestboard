"""drop slugs

Organizations and projects are addressed by their ids (/organizations/<id>,
.../projects/<id>), so their slugs go. Their format checks go with the
columns.

Revision ID: 7de5d50117e6
Revises: 7d254f23fa81
Create Date: 2026-11-02 12:42:36.147822
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7de5d50117e6"
down_revision: str | None = "7d254f23fa81"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_FORMAT = "slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'"


def upgrade() -> None:
    op.drop_constraint(op.f("uq_organizations_slug"), "organizations", type_="unique")
    op.drop_column("organizations", "slug")
    op.drop_index(op.f("uq_projects_org_slug"), table_name="projects")
    op.drop_column("projects", "slug")


def downgrade() -> None:
    # Slugs come back made from the ids, which are unique and fit the format.
    for table in ("organizations", "projects"):
        op.add_column(table, sa.Column("slug", sa.String(length=40), nullable=True))
        op.execute(f"UPDATE {table} SET slug = id::text")
        op.alter_column(table, "slug", nullable=False)
        op.create_check_constraint(op.f(f"ck_{table}_slug_format"), table, _FORMAT)
    op.create_unique_constraint(op.f("uq_organizations_slug"), "organizations", ["slug"])
    op.create_index(op.f("uq_projects_org_slug"), "projects", ["org_id", "slug"], unique=True)
