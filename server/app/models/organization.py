import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class OrgRole(StrEnum):
    # Everything an admin can do, plus deleting the organization and changing
    # roles. An organization always keeps at least one owner.
    OWNER = "owner"
    # Invites and removes members, sets titles and who may create projects.
    ADMIN = "admin"
    MEMBER = "member"


_ROLES = ", ".join(f"'{r.value}'" for r in OrgRole)


class Organization(Base):
    """A company or team using this Nestboard. Its people, groups and projects
    are invisible to everyone outside it."""

    __tablename__ = "organizations"
    __table_args__ = (
        CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint("version > 0", name="version_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OrgMembership(Base):
    __tablename__ = "org_memberships"
    __table_args__ = (CheckConstraint(f"role IN ({_ROLES})", name="role_known"),)

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    role: Mapped[str] = mapped_column(String(20), default=OrgRole.MEMBER)
    # Job title in this organization (Developer, Architect, CTO...). For
    # display only; never decides what someone may do.
    title: Mapped[str] = mapped_column(String(100), default="", server_default="")
    # Set by admins, for members. Owners and admins can always create projects.
    can_create_projects: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OrgInvitation(Base):
    """A one-time link that lets someone join the organization, signing up
    first if they have no account. Only a hash of the link's token is kept."""

    __tablename__ = "org_invitations"
    __table_args__ = (CheckConstraint(f"role IN ({_ROLES})", name="role_known"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    # What the new member gets.
    role: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(100), default="", server_default="")
    can_create_projects: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    # If set, only this address can use the link.
    email: Mapped[str | None] = mapped_column(String(320))
    # Kept if the inviter's account is deleted.
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
