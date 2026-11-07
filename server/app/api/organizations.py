import uuid

from fastapi import APIRouter, Response, status

from app.auth import CurrentUser
from app.db import SessionDep
from app.errors import ROLE_RESPONSES
from app.schemas.organizations import (
    CreatedInvitation,
    InvitationCreate,
    InvitationOut,
    MemberOut,
    MemberUpdate,
    OrgCreate,
    OrgOut,
    OrgUpdate,
)
from app.services import invitations, organizations

router = APIRouter(prefix="/orgs", tags=["organizations"], responses=ROLE_RESPONSES)


@router.post("", response_model=OrgOut, status_code=status.HTTP_201_CREATED)
async def create_organization(body: OrgCreate, user: CurrentUser, session: SessionDep):
    """Instance admin only. The creator becomes the first owner; to hand the
    organization over, invite its real owner and then leave."""
    return OrgOut.of(*await organizations.create(session, user, body.name))


@router.get("", response_model=list[OrgOut])
async def list_organizations(user: CurrentUser, session: SessionDep):
    """The organizations you belong to, by name."""
    return [OrgOut.of(org, m) for org, m in await organizations.list_mine(session, user)]


@router.get("/{org_id}", response_model=OrgOut)
async def get_organization(org_id: uuid.UUID, user: CurrentUser, session: SessionDep):
    """404 unless you are a member: outsiders cannot tell it exists."""
    return OrgOut.of(*await organizations.get(session, org_id, user))


@router.patch("/{org_id}", response_model=OrgOut)
async def update_organization(
    org_id: uuid.UUID, body: OrgUpdate, user: CurrentUser, session: SessionDep
):
    """Owners only. Renames it."""
    return OrgOut.of(
        *await organizations.update_org(session, org_id, user, body.version, body.name)
    )


@router.delete("/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_organization(org_id: uuid.UUID, user: CurrentUser, session: SessionDep):
    """Owners only. Deletes it with everything in it."""
    await organizations.delete_org(session, org_id, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- Members ----


@router.get("/{org_id}/members", response_model=list[MemberOut])
async def list_members(org_id: uuid.UUID, user: CurrentUser, session: SessionDep):
    return [MemberOut.of(*row) for row in await organizations.list_members(session, org_id, user)]


@router.patch("/{org_id}/members/{user_id}", response_model=MemberOut)
async def update_member(
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    body: MemberUpdate,
    user: CurrentUser,
    session: SessionDep,
):
    """Changing a role needs an owner, and the last owner cannot step down
    (409 `last_owner`). Titles and `can_create_projects` need an admin."""
    return MemberOut.of(
        *await organizations.update_member(
            session,
            org_id,
            user,
            user_id,
            role=body.role,
            title=body.title,
            can_create=body.can_create_projects,
        )
    )


@router.delete("/{org_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    org_id: uuid.UUID, user_id: uuid.UUID, user: CurrentUser, session: SessionDep
):
    """Your own id leaves the organization. Admins remove members; only owners
    remove admins and owners. The last owner cannot go (409 `last_owner`)."""
    await organizations.remove_member(session, org_id, user, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- Invitations ----


@router.get("/{org_id}/invitations", response_model=list[InvitationOut])
async def list_invitations(org_id: uuid.UUID, user: CurrentUser, session: SessionDep):
    """Admins only. Newest first, whatever their status."""
    return [InvitationOut.of(*row) for row in await invitations.list_for_org(session, org_id, user)]


@router.post(
    "/{org_id}/invitations",
    response_model=CreatedInvitation,
    status_code=status.HTTP_201_CREATED,
)
async def create_invitation(
    org_id: uuid.UUID, body: InvitationCreate, user: CurrentUser, session: SessionDep
):
    """Admins invite members; inviting admins or owners needs an owner. The
    response's `token` goes into the link (/invite/<token>) and is shown only
    this once. The link works once, for `expires_in_days` days."""
    invitation, token = await invitations.create(
        session,
        org_id,
        user,
        role=body.role,
        title=body.title,
        can_create=body.can_create_projects,
        email=body.email,
        days=body.expires_in_days,
    )
    return CreatedInvitation(**InvitationOut.of(invitation, user, None).model_dump(), token=token)


@router.delete("/{org_id}/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invitation(
    org_id: uuid.UUID, invitation_id: uuid.UUID, user: CurrentUser, session: SessionDep
):
    """Admins only. The link stops working."""
    await invitations.revoke(session, org_id, user, invitation_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
