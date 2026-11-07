import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.auth import CurrentUser
from app.db import SessionDep
from app.errors import ROLE_RESPONSES
from app.schemas.groups import (
    GroupCreate,
    GroupDetail,
    GroupMemberOut,
    GroupMemberSet,
    GroupOut,
    GroupRef,
    GroupUpdate,
    MemberGroupOut,
)
from app.services import groups

router = APIRouter(prefix="/orgs/{org_id}", tags=["groups"], responses=ROLE_RESPONSES)


@router.get("/groups", response_model=list[GroupOut])
async def list_groups(org_id: uuid.UUID, user: CurrentUser, session: SessionDep):
    """Every group in the organization, by name, flat: build the tree from
    `parent_id`. Any member may look."""
    return [GroupOut.of(*row) for row in await groups.list_groups(session, org_id, user)]


@router.post("/groups", response_model=GroupOut, status_code=status.HTTP_201_CREATED)
async def create_group(
    org_id: uuid.UUID, body: GroupCreate, user: CurrentUser, session: SessionDep
):
    """Top-level groups need an org admin; a subgroup needs someone who
    manages its parent. At most 10 levels deep (422 `group_too_deep`). Names
    differ between groups with the same parent (409 `group_name_taken`)."""
    return GroupOut.of(
        *await groups.create_group(
            session, org_id, user, body.name, body.description, body.parent_id
        )
    )


@router.get("/groups/{group_id}", response_model=GroupDetail)
async def get_group(org_id: uuid.UUID, group_id: uuid.UUID, user: CurrentUser, session: SessionDep):
    group, count, can_manage, path = await groups.get_group(session, org_id, user, group_id)
    return GroupDetail(
        **GroupOut.of(group, count, can_manage).model_dump(),
        path=[GroupRef.model_validate(g) for g in path],
    )


@router.patch("/groups/{group_id}", response_model=GroupOut)
async def update_group(
    org_id: uuid.UUID,
    group_id: uuid.UUID,
    body: GroupUpdate,
    user: CurrentUser,
    session: SessionDep,
):
    """Renames, describes and/or moves the group. Moving needs the right to
    manage both where it leaves and where it goes; it cannot go inside
    itself (422 `group_loop`) or deeper than 10 levels."""
    extra = {"parent_id": body.parent_id} if "parent_id" in body.model_fields_set else {}
    updated = await groups.update_group(
        session,
        org_id,
        user,
        group_id,
        body.version,
        name=body.name,
        description=body.description,
        **extra,
    )
    group, count, can_manage, _ = await groups.get_group(session, org_id, user, updated.id)
    return GroupOut.of(group, count, can_manage)


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    org_id: uuid.UUID, group_id: uuid.UUID, user: CurrentUser, session: SessionDep
):
    """Needs the right to manage the level above it. A group with subgroups
    cannot be deleted (409 `group_has_subgroups`)."""
    await groups.delete_group(session, org_id, user, group_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- Members ----


@router.get("/groups/{group_id}/members", response_model=list[GroupMemberOut])
async def list_group_members(
    org_id: uuid.UUID,
    group_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
    include_subgroups: Annotated[
        bool, Query(description="Also everyone in its subgroups, who count as members too.")
    ] = False,
):
    people = await groups.list_members(
        session, org_id, user, group_id, include_subgroups=include_subgroups
    )
    return [GroupMemberOut.of(p) for p in people]


@router.put("/groups/{group_id}/members/{user_id}", response_model=GroupMemberOut)
async def set_group_member(
    org_id: uuid.UUID,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
    body: GroupMemberSet,
    user: CurrentUser,
    session: SessionDep,
):
    """Puts an organization member in the group, or changes whether they lead
    it. Needs someone who manages the group."""
    return GroupMemberOut.of(
        await groups.set_member(session, org_id, user, group_id, user_id, body.is_lead)
    )


@router.delete("/groups/{group_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_group_member(
    org_id: uuid.UUID,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
):
    """Your own id leaves the group; anyone else needs someone who manages it."""
    await groups.remove_member(session, org_id, user, group_id, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/members/{user_id}/groups", response_model=list[MemberGroupOut])
async def list_member_groups(
    org_id: uuid.UUID, user_id: uuid.UUID, user: CurrentUser, session: SessionDep
):
    """Every group the person counts as being in, including the groups above
    the ones they are in directly."""
    return [
        MemberGroupOut(
            group=GroupRef.model_validate(group),
            parent_id=group.parent_id,
            direct=direct,
            is_lead=is_lead,
        )
        for group, direct, is_lead in await groups.groups_of(session, org_id, user, user_id)
    ]
