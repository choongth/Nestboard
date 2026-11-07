"""adr scope changes

A proposed ADR can move to another scope; its history records that as
"scoped".

Revision ID: 7d254f23fa81
Revises: 92c75bd83cc6
Create Date: 2026-11-01
"""

from collections.abc import Sequence

from alembic import op

revision: str = "7d254f23fa81"
down_revision: str | None = "92c75bd83cc6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_BEFORE = (
    "'created', 'edited', 'linked', 'related', 'accepted', 'rejected', 'deprecated', 'superseded'"
)
_AFTER = (
    "'created', 'edited', 'linked', 'scoped', 'related', 'accepted', 'rejected', 'deprecated', "
    "'superseded'"
)


def _actions(values: str) -> None:
    op.drop_constraint(op.f("ck_adr_revisions_action_known"), "adr_revisions", type_="check")
    op.create_check_constraint(
        op.f("ck_adr_revisions_action_known"), "adr_revisions", f"action IN ({values})"
    )


def upgrade() -> None:
    _actions(_AFTER)


def downgrade() -> None:
    op.execute("UPDATE adr_revisions SET action = 'edited' WHERE action = 'scoped'")
    _actions(_BEFORE)
