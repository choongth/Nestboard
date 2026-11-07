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
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class ProjectRole(StrEnum):
    VIEWER = "viewer"
    EDITOR = "editor"
    OWNER = "owner"


class Project(Base):
    """Diagrams, their decisions, and the people working on them, inside one
    organization."""

    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint("version > 0", name="version_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    # The highest ADR number handed out in this project. Numbers are never
    # reused, even after an ADR is deleted. Internal; not part of the API.
    last_adr_number: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


_ROLES = ", ".join(f"'{r.value}'" for r in ProjectRole)
# The predicate of the unique indexes on project-wide grants; ON CONFLICT
# clauses must repeat it.
PROJECT_SCOPE = "box_id IS NULL"


class ProjectGrant(Base):
    """Gives a user, or everyone in a group (and its subgroups), a role in a
    project. Someone's role is the highest of the grants that apply to them."""

    __tablename__ = "project_grants"
    __table_args__ = (
        CheckConstraint(f"role IN ({_ROLES})", name="role_known"),
        CheckConstraint("(user_id IS NULL) <> (group_id IS NULL)", name="one_subject"),
        CheckConstraint("(diagram_id IS NULL) = (box_id IS NULL)", name="box_in_diagram"),
        # One grant per subject and scope (the project, or one box).
        Index(
            "uq_project_grants_user",
            "project_id",
            "user_id",
            unique=True,
            postgresql_where=text(f"user_id IS NOT NULL AND {PROJECT_SCOPE}"),
        ),
        Index(
            "uq_project_grants_group",
            "project_id",
            "group_id",
            unique=True,
            postgresql_where=text(f"group_id IS NOT NULL AND {PROJECT_SCOPE}"),
        ),
        Index(
            "uq_project_grants_box_user",
            "diagram_id",
            "box_id",
            "user_id",
            unique=True,
            postgresql_where=text("user_id IS NOT NULL AND box_id IS NOT NULL"),
        ),
        Index(
            "uq_project_grants_box_group",
            "diagram_id",
            "box_id",
            "group_id",
            unique=True,
            postgresql_where=text("group_id IS NOT NULL AND box_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    # Exactly one of user_id and group_id.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    group_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(20))
    # Both set: the grant covers one box of a diagram and everything inside
    # it. Both empty: the whole project.
    diagram_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("diagrams.id", ondelete="CASCADE"), index=True
    )
    box_id: Mapped[str | None] = mapped_column(Text)
    # The box's name when the grant was given, shown if it is deleted later.
    box_title: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProjectActivity(Base):
    """Who did what to the project's access: created it, took it over,
    changed a grant. Visible to everyone in the project."""

    __tablename__ = "project_activity"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    # Kept if the account is deleted.
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    # created | taken_over | grant_set | grant_removed
    kind: Mapped[str] = mapped_column(String(30))
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
