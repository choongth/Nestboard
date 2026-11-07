import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
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


class Group(Base):
    """A team in an organization, e.g. Engineering ▸ Platform ▸ Payments.
    Groups nest: each has at most one parent, at most 10 levels deep. Being in
    a group also counts as being in every group above it."""

    __tablename__ = "groups"
    __table_args__ = (
        CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint("parent_id <> id", name="not_own_parent"),
        CheckConstraint("version > 0", name="version_positive"),
        # Names are unique among siblings (top-level groups are siblings too).
        Index(
            "uq_groups_sibling_name",
            "org_id",
            text("coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid)"),
            text("lower(name)"),
            unique=True,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    # A group with subgroups cannot be deleted; the database refuses too.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("groups.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GroupMember(Base):
    """Someone placed directly in a group. Leads manage the group and every
    group below it."""

    __tablename__ = "group_members"

    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    is_lead: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
