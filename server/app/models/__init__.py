from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

# Predictable constraint names, so Alembic migrations can refer to them.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


# Imported last so every table registers on Base.metadata (Alembic reads it).
from app.models.adr import (  # noqa: E402
    Adr,
    AdrLink,
    AdrRelation,
    AdrRevision,
    AdrStatus,
    LinkKind,
    RelationKind,
    RevisionAction,
)
from app.models.diagram import Box, Diagram, Edge, ExternalSpot  # noqa: E402
from app.models.group import Group, GroupMember  # noqa: E402
from app.models.organization import (  # noqa: E402
    Organization,
    OrgInvitation,
    OrgMembership,
    OrgRole,
)
from app.models.project import (  # noqa: E402
    Project,
    ProjectActivity,
    ProjectGrant,
    ProjectRole,
)
from app.models.user import LoginThrottle, PasswordReset, User, UserSession  # noqa: E402

__all__ = [
    "Adr",
    "AdrLink",
    "AdrRelation",
    "AdrRevision",
    "AdrStatus",
    "Base",
    "Box",
    "Diagram",
    "Edge",
    "ExternalSpot",
    "Group",
    "GroupMember",
    "LinkKind",
    "LoginThrottle",
    "OrgInvitation",
    "OrgMembership",
    "OrgRole",
    "PasswordReset",
    "Project",
    "ProjectActivity",
    "ProjectGrant",
    "ProjectRole",
    "Organization",
    "RelationKind",
    "RevisionAction",
    "User",
    "UserSession",
]
