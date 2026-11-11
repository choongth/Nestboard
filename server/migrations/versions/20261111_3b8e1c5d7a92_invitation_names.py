"""invitation names

Invitations may carry the invitee's name (from a CSV import), which fills in
the sign-up form. Existing invitations have none.

Revision ID: 3b8e1c5d7a92
Revises: f0dd0d25f319
Create Date: 2026-11-11 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "3b8e1c5d7a92"
down_revision: str | None = "f0dd0d25f319"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("org_invitations", sa.Column("name", sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column("org_invitations", "name")
