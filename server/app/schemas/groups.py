import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.models import Group
from app.schemas.common import Version, one_line
from app.schemas.organizations import Person
from app.services.groups import GroupPerson

GroupName = Annotated[str, one_line(100)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


class GroupCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: GroupName
    description: Description = ""
    parent_id: uuid.UUID | None = Field(default=None, description="Omit for a top-level group.")


class GroupUpdate(BaseModel):
    """Give only what changes. `parent_id: null` moves the group to the top
    level; leaving `parent_id` out keeps it where it is."""

    model_config = ConfigDict(extra="forbid")

    version: Version
    name: GroupName | None = None
    description: Description | None = None
    parent_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _changes_something(self) -> "GroupUpdate":
        if not {"name", "description", "parent_id"} & self.model_fields_set:
            raise ValueError("Give a name, a description, a parent_id, or several.")
        return self


class GroupRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class GroupOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    parent_id: uuid.UUID | None
    version: int
    created_at: datetime
    updated_at: datetime
    member_count: int = Field(description="People directly in the group (not its subgroups).")
    can_manage: bool = Field(
        description="Whether you may change it: you are an org admin, or lead it or a group "
        "above it."
    )

    @classmethod
    def of(cls, group: Group, member_count: int, can_manage: bool) -> "GroupOut":
        return cls(
            id=group.id,
            name=group.name,
            description=group.description,
            parent_id=group.parent_id,
            version=group.version,
            created_at=group.created_at,
            updated_at=group.updated_at,
            member_count=member_count,
            can_manage=can_manage,
        )


class GroupDetail(GroupOut):
    path: list[GroupRef] = Field(description="The groups above it, top first.")


class GroupMemberOut(BaseModel):
    user: Person
    title: str = Field(description="Their job title in the organization.")
    is_lead: bool = Field(description="Leads this group (directly).")
    direct: bool = Field(description="In this group itself, not only through a subgroup.")
    via: list[GroupRef] = Field(description="The subgroups through which they count.")

    @classmethod
    def of(cls, person: GroupPerson) -> "GroupMemberOut":
        return cls(
            user=Person.model_validate(person.user),
            title=person.title,
            is_lead=person.is_lead,
            direct=person.direct,
            via=[GroupRef.model_validate(g) for g in person.via],
        )


class GroupMemberSet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_lead: bool = False


class MemberGroupOut(BaseModel):
    group: GroupRef
    parent_id: uuid.UUID | None
    direct: bool = Field(description="False: they count as a member through a subgroup.")
    is_lead: bool
