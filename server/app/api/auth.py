from fastapi import APIRouter, Request, Response, status

from app.auth import (
    COOKIE,
    CurrentUser,
    SignedInDep,
    clear_session_cookie,
    set_session_cookie,
)
from app.db import SessionDep
from app.errors import SIGNED_IN_RESPONSES, ErrorResponse
from app.schemas.auth import (
    AuthStatus,
    LoginRequest,
    PasswordChange,
    ProfileUpdate,
    SetupRequest,
    UserOut,
)
from app.services import auth

router = APIRouter(prefix="/auth", tags=["auth"])

_THROTTLED = {
    429: {"model": ErrorResponse, "description": "Too many wrong passwords in a row"},
}


@router.get("/status", response_model=AuthStatus)
async def auth_status(session: SessionDep):
    return AuthStatus(needs_setup=await auth.needs_setup(session))


@router.post(
    "/setup",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
)
async def set_up(body: SetupRequest, response: Response, session: SessionDep):
    """Creates the first account on this Nestboard, as instance admin, and
    signs it in. Only works while there are no accounts at all (409
    `already_set_up` after that)."""
    user, token, expires_at = await auth.set_up(
        session, body.email, body.display_name, body.password
    )
    set_session_cookie(response, token, expires_at)
    return user


@router.post(
    "/login",
    response_model=UserOut,
    responses={
        401: {"model": ErrorResponse, "description": "Wrong email or password"},
        **_THROTTLED,
    },
)
async def log_in(body: LoginRequest, response: Response, session: SessionDep):
    """Signs in and sets the session cookie. After 5 wrong passwords in a row
    for an email, each further try must wait: 429 `too_many_attempts`, with
    `details.retry_after` in seconds."""
    user, token, expires_at = await auth.sign_in(session, body.email, body.password)
    set_session_cookie(response, token, expires_at)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def log_out(request: Request, session: SessionDep) -> Response:
    """Ends this session. Succeeds even if it had already ended."""
    token = request.cookies.get(COOKIE)
    if token:
        await auth.sign_out(session, token)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookie(response)
    return response


@router.get("/me", response_model=UserOut, responses=SIGNED_IN_RESPONSES)
async def get_me(user: CurrentUser):
    return user


@router.patch("/me", response_model=UserOut, responses=SIGNED_IN_RESPONSES)
async def update_me(body: ProfileUpdate, user: CurrentUser, session: SessionDep):
    return await auth.update_profile(session, user, body.display_name)


@router.post(
    "/me/password",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={**SIGNED_IN_RESPONSES, **_THROTTLED},
)
async def change_password(body: PasswordChange, signed: SignedInDep, session: SessionDep):
    """Needs the current password (422 `wrong_password`). Every other session
    of this account is signed out; this one stays."""
    await auth.change_password(
        session, signed.user, signed.token, body.current_password, body.new_password
    )
