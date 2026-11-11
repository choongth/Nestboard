import uuid

from fastapi import APIRouter, Response, status

from app.auth import CurrentUser
from app.db import SessionDep
from app.errors import ROLE_RESPONSES
from app.schemas.organizations import (
    CreatedInvitation,
    ImportedRow,
    ImportProblem,
    InvitationCreate,
    InvitationImport,
    InvitationImportRequest,
    InvitationOut,
    MemberOut,
    MemberUpdate,
    OrgCreate,
    OrgOut,
    OrgUpdate,
)
from app.services import invitation_import, invitations, organizations

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


@router.post("/{org_id}/invitations/import", response_model=InvitationImport)
async def import_invitations(
    org_id: uuid.UUID, body: InvitationImportRequest, user: CurrentUser, session: SessionDep
):
    """Admins invite up to 100 people at once from a CSV file: one invitation
    per row, locked to the row's email, with its name, job title and role
    (admins and owners need an owner). Rows with a problem are skipped and
    say why; the rest are invited together. Each token is shown only in this
    response. With `dry_run`, nobody is invited: the rows are only checked.
    A file that cannot be used as a whole (no email column, an unknown
    column, more than 100 rows) is refused with 422 `csv_invalid`."""
    rows = await invitation_import.run(
        session, org_id, user, body.csv, dry_run=body.dry_run, days=body.expires_in_days
    )
    return InvitationImport(
        rows=[
            ImportedRow(
                line=row.line,
                email=row.email,
                name=row.name,
                title=row.title,
                role=row.role,
                problem=ImportProblem(code=row.problem.code, message=row.problem.message)
                if row.problem
                else None,
                invitation=CreatedInvitation(
                    **InvitationOut.of(row.invitation, user, None).model_dump(), token=row.token
                )
                if row.invitation is not None and row.token is not None
                else None,
            )
            for row in rows
        ],
        invited=sum(row.invitation is not None for row in rows),
        skipped=sum(row.problem is not None for row in rows),
    )


@router.delete("/{org_id}/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invitation(
    org_id: uuid.UUID, invitation_id: uuid.UUID, user: CurrentUser, session: SessionDep
):
    """Admins only. The link stops working."""
    await invitations.revoke(session, org_id, user, invitation_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
