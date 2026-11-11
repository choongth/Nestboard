from fastapi import APIRouter, Response, status

from app.auth import CurrentUser, set_session_cookie
from app.db import SessionDep
from app.errors import ROLE_RESPONSES, ErrorResponse
from app.schemas.auth import UserOut
from app.schemas.organizations import (
    InvitationPreview,
    InvitationSignUp,
    InvitedOrganization,
    OrgOut,
    SignedUp,
)
from app.services import invitations

# The link's token is the only key: whoever holds the link may use it.
router = APIRouter(
    prefix="/invitations/{token}",
    tags=["invitations"],
    responses={410: {"model": ErrorResponse, "description": "Used, withdrawn or expired"}},
)


@router.get("", response_model=InvitationPreview)
async def get_invitation(token: str, session: SessionDep):
    """What the link offers. No sign-in needed. 410 with `invitation_used`,
    `invitation_revoked` or `invitation_expired` once it no longer works."""
    invitation, org, inviter = await invitations.preview(session, token)
    return InvitationPreview(
        organization=InvitedOrganization(id=org.id, name=org.name),
        role=invitation.role,
        title=invitation.title,
        email=invitation.email,
        name=invitation.name,
        invited_by=inviter.display_name if inviter else None,
        expires_at=invitation.expires_at,
    )


@router.post("/accept", response_model=OrgOut, responses=ROLE_RESPONSES)
async def accept_invitation(token: str, user: CurrentUser, session: SessionDep):
    """Joins the signed-in user to the organization. 409 `already_member` if
    you are in it already; 403 `invitation_for_another_email` if the link was
    made for a different address."""
    return OrgOut.of(*await invitations.accept(session, token, user))


@router.post(
    "/sign-up",
    response_model=SignedUp,
    status_code=status.HTTP_201_CREATED,
    responses={403: {"model": ErrorResponse, "description": "The link is for another email"}},
)
async def sign_up_with_invitation(
    token: str, body: InvitationSignUp, response: Response, session: SessionDep
):
    """Creates an account, joins the organization and signs in. 409
    `email_taken` if the address already has an account: sign in and accept
    instead."""
    user, org, membership, session_token, expires_at = await invitations.sign_up(
        session, token, body.email, body.display_name, body.password
    )
    set_session_cookie(response, session_token, expires_at)
    return SignedUp(user=UserOut.model_validate(user), organization=OrgOut.of(org, membership))
