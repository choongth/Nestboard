import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import Project, ProjectActivity, ProjectRole, User
from app.schemas.common import BoxScope, Version
from app.schemas.groups import GroupRef
from app.schemas.organizations import InvitedOrganization, OrgName, Person
from app.services.projects import Access, GrantView


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: OrgName


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Version
    name: OrgName


class ProjectOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    name: str
    version: int
    created_at: datetime
    updated_at: datetime
    role: ProjectRole | None = Field(
        description="Your role in it. None only for org admins without a grant: they see the "
        "project's name, and may take it over, but not its content."
    )

    @classmethod
    def of(cls, project: Project, role: ProjectRole | None) -> "ProjectOut":
        return cls(
            id=project.id,
            org_id=project.org_id,
            name=project.name,
            version=project.version,
            created_at=project.created_at,
            updated_at=project.updated_at,
            role=role,
        )


class ProjectDetail(ProjectOut):
    organization: InvitedOrganization

    @classmethod
    def of_access(cls, found: Access) -> "ProjectDetail":
        return cls(
            **ProjectOut.of(found.project, found.role).model_dump(),
            organization=InvitedOrganization(id=found.org.id, name=found.org.name),
        )


class GrantSet(BoxScope):
    """Exactly one of `user_id` and `group_id`. With `diagram_id` and
    `box_id`, the grant covers that box and everything inside it; without,
    the whole project."""

    user_id: uuid.UUID | None = None
    group_id: uuid.UUID | None = None
    role: ProjectRole

    @model_validator(mode="after")
    def _one_subject(self) -> "GrantSet":
        if (self.user_id is None) == (self.group_id is None):
            raise ValueError("Give either a user_id or a group_id.")
        return self


class GrantOut(BaseModel):
    id: uuid.UUID
    role: ProjectRole
    user: Person | None
    group: GroupRef | None = Field(description="Covers everyone in it and its subgroups.")
    diagram_id: uuid.UUID | None = Field(description="Set, with box_id, for a grant on a box.")
    box_id: str | None
    box_title: str | None = Field(
        description="The box's name; if it has been deleted, its name when the grant was given."
    )
    orphaned: bool = Field(description="The box has been deleted from the diagram since.")
    created_at: datetime

    @classmethod
    def of(cls, view: GrantView) -> "GrantOut":
        return cls(
            id=view.grant.id,
            role=ProjectRole(view.grant.role),
            user=Person.model_validate(view.user) if view.user else None,
            group=GroupRef.model_validate(view.group) if view.group else None,
            diagram_id=view.grant.diagram_id,
            box_id=view.grant.box_id,
            box_title=view.box_title,
            orphaned=view.orphaned,
            created_at=view.grant.created_at,
        )


class ActivityOut(BaseModel):
    id: uuid.UUID
    kind: str = Field(description="created | taken_over | grant_set | grant_removed")
    details: dict[str, Any]
    actor: Person | None = Field(description="None if that account was deleted.")
    created_at: datetime

    @classmethod
    def of(cls, entry: ProjectActivity, actor: User | None) -> "ActivityOut":
        return cls(
            id=entry.id,
            kind=entry.kind,
            details=entry.details,
            actor=Person.model_validate(actor) if actor else None,
            created_at=entry.created_at,
        )
