from fastapi import APIRouter, Response

from app.auth import set_session_cookie
from app.db import SessionDep
from app.errors import ErrorResponse
from app.schemas.auth import PasswordResetPreview, PasswordResetUse, UserOut
from app.services import password_resets

# The link's token is the only key: whoever holds the link may use it.
router = APIRouter(
    prefix="/password-resets/{token}",
    tags=["auth"],
    responses={410: {"model": ErrorResponse, "description": "Used, replaced or expired"}},
)


@router.get("", response_model=PasswordResetPreview)
async def get_password_reset(token: str, session: SessionDep):
    """Whose password the link resets. No sign-in needed. 410 with
    `password_reset_used`, `password_reset_replaced` or `password_reset_expired`
    once it no longer works."""
    reset, user = await password_resets.preview(session, token)
    return PasswordResetPreview(
        email=user.email, display_name=user.display_name, expires_at=reset.expires_at
    )


@router.post("", response_model=UserOut)
async def reset_password(
    token: str, body: PasswordResetUse, response: Response, session: SessionDep
):
    """Sets the new password. Every session of the account is signed out, and
    this browser is signed in."""
    user, session_token, expires_at = await password_resets.use(session, token, body.new_password)
    set_session_cookie(response, session_token, expires_at)
    return user
