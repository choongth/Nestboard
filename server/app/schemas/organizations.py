import uuid
from datetime import datetime
from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    model_validator,
)

from app.models import Organization, OrgInvitation, OrgMembership, OrgRole, User
from app.schemas.auth import DisplayName, Email, NewPassword, UserOut
from app.schemas.common import Version, one_line
from app.services.invitations import InvitationStatus, status_of
from app.services.organizations import can_create_projects

OrgName = Annotated[str, one_line(100)]


# Empty means no title.
Title = Annotated[
    str,
    one_line(100, min_length=0),
    Field(description="Job title, for display only (Developer, Architect, CTO...).", examples=[""]),
]


class OrgCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: OrgName


class OrgUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Version
    name: OrgName


class MyMembership(BaseModel):
    role: OrgRole
    title: str
    can_create_projects: bool = Field(description="Always true for owners and admins.")


class OrgOut(BaseModel):
    id: uuid.UUID
    name: str
    version: int
    created_at: datetime
    updated_at: datetime
    membership: MyMembership = Field(description="The signed-in user's place in it.")

    @classmethod
    def of(cls, org: Organization, membership: OrgMembership) -> "OrgOut":
        return cls(
            id=org.id,
            name=org.name,
            version=org.version,
            created_at=org.created_at,
            updated_at=org.updated_at,
            membership=MyMembership(
                role=OrgRole(membership.role),
                title=membership.title,
                can_create_projects=can_create_projects(membership),
            ),
        )


class Person(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str


class MemberOut(BaseModel):
    user: Person
    role: OrgRole
    title: str
    can_create_projects: bool = Field(description="Always true for owners and admins.")
    joined_at: datetime

    @classmethod
    def of(cls, membership: OrgMembership, user: User) -> "MemberOut":
        return cls(
            user=Person.model_validate(user),
            role=OrgRole(membership.role),
            title=membership.title,
            can_create_projects=can_create_projects(membership),
            joined_at=membership.joined_at,
        )


class MemberUpdate(BaseModel):
    """Give only what changes. `role` needs an owner; `title` and
    `can_create_projects` an admin."""

    model_config = ConfigDict(extra="forbid")

    role: OrgRole | None = None
    title: Title | None = None
    can_create_projects: bool | None = Field(
        default=None, description="Matters for members only: owners and admins always can."
    )

    @model_validator(mode="after")
    def _changes_something(self) -> "MemberUpdate":
        if self.role is None and self.title is None and self.can_create_projects is None:
            raise ValueError("Give a role, a title, can_create_projects, or several.")
        return self


class InvitationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: OrgRole = Field(
        default=OrgRole.MEMBER, description="Inviting admins or owners needs an owner."
    )
    title: Title = ""
    can_create_projects: bool = False
    email: Email | None = Field(
        default=None, description="If given, only this address can use the link."
    )
    expires_in_days: int = Field(default=7, ge=1, le=30)


class InvitationOut(BaseModel):
    id: uuid.UUID
    status: InvitationStatus
    role: OrgRole
    title: str
    can_create_projects: bool
    email: str | None
    name: str | None = Field(description="The invitee's name, if the inviter gave one.")
    invited_by: Person | None = Field(description="None if that account was deleted.")
    created_at: datetime
    expires_at: datetime
    accepted_by: Person | None
    accepted_at: datetime | None

    @classmethod
    def of(
        cls, invitation: OrgInvitation, inviter: User | None, acceptor: User | None
    ) -> "InvitationOut":
        return cls(
            id=invitation.id,
            status=status_of(invitation),
            role=OrgRole(invitation.role),
            title=invitation.title,
            can_create_projects=invitation.can_create_projects,
            email=invitation.email,
            name=invitation.name,
            invited_by=Person.model_validate(inviter) if inviter else None,
            created_at=invitation.created_at,
            expires_at=invitation.expires_at,
            accepted_by=Person.model_validate(acceptor) if acceptor else None,
            accepted_at=invitation.accepted_at,
        )


class CreatedInvitation(InvitationOut):
    token: str = Field(
        description="Goes into the link the inviter sends. Shown only now: only a hash is kept."
    )


class InvitationImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    csv: str = Field(
        max_length=100_000,
        description="The CSV file's text. The first row names the columns: `email` (required), "
        "and optionally `name`, `job title` and `role` (member, admin or owner; member if empty). "
        "Commas, semicolons or tabs. At most 100 people.",
        examples=["email,name,job title,role\nbob@example.com,Bob Lee,Developer,member"],
    )
    dry_run: bool = Field(
        default=False, description="Check the file and report every row, without inviting anyone."
    )
    expires_in_days: int = Field(default=7, ge=1, le=30)


class ImportProblem(BaseModel):
    code: str = Field(
        description="`missing_email`, `invalid_email`, `invalid_name`, `invalid_title`, "
        "`unknown_role`, `too_many_cells`, `duplicate_email`, `already_member`, "
        "`already_invited` or `role_needs_owner`."
    )
    message: str


class ImportedRow(BaseModel):
    line: int = Field(description="Where the row is in the file (1 is the header).")
    email: str
    name: str | None
    title: str
    role: str
    problem: ImportProblem | None = Field(description="Why this row is skipped; None if it is not.")
    invitation: CreatedInvitation | None = Field(
        description="The row's invitation, with its token (shown only now); None in a dry run "
        "or when the row is skipped."
    )


class InvitationImport(BaseModel):
    rows: list[ImportedRow]
    invited: int = Field(description="Invitations created (0 in a dry run).")
    skipped: int = Field(description="Rows with a problem, which are not invited.")


class InvitedOrganization(BaseModel):
    id: uuid.UUID
    name: str


class InvitationPreview(BaseModel):
    """What someone holding the link may see before accepting it."""

    organization: InvitedOrganization
    role: OrgRole
    title: str
    email: str | None = Field(description="If set, only this address can use the link.")
    name: str | None = Field(
        description="The invitee's name as the inviter wrote it, to fill in the sign-up form."
    )
    invited_by: str | None = Field(description="The inviter's display name.")
    expires_at: datetime


class InvitationSignUp(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: Email
    display_name: DisplayName
    password: NewPassword


class SignedUp(BaseModel):
    user: UserOut
    organization: OrgOut
