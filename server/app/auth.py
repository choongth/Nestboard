"""The session cookie, and the `CurrentUser` dependency for routes that need
someone signed in."""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Request, Response

from app.config import get_settings
from app.db import SessionDep
from app.models import User
from app.services import auth

COOKIE = "nestboard_session"
# Only the API reads it; the pages themselves never need it.
COOKIE_PATH = "/api"


def set_session_cookie(response: Response, token: str, expires_at: datetime) -> None:
    response.set_cookie(
        COOKIE,
        token,
        max_age=max(0, round((expires_at - datetime.now(UTC)).total_seconds())),
        path=COOKIE_PATH,
        # Out of reach of page scripts; not sent along with requests from
        # other sites, which keeps other sites from acting as the user.
        httponly=True,
        samesite="lax",
        secure=get_settings().cookie_secure,
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        COOKIE,
        path=COOKIE_PATH,
        httponly=True,
        samesite="lax",
        secure=get_settings().cookie_secure,
    )


@dataclass
class SignedIn:
    user: User
    token: str


async def signed_in(request: Request, response: Response, session: SessionDep) -> SignedIn:
    token = request.cookies.get(COOKIE)
    found = await auth.user_for_token(session, token) if token else None
    if token is None or found is None:
        raise auth.NotSignedIn("Sign in first. (Your session may have ended.)")
    user, expires_at = found
    # The session's expiry moves as it is used; the cookie's follows it.
    set_session_cookie(response, token, expires_at)
    return SignedIn(user, token)


async def current_user(signed: Annotated[SignedIn, Depends(signed_in)]) -> User:
    return signed.user


SignedInDep = Annotated[SignedIn, Depends(signed_in)]
CurrentUser = Annotated[User, Depends(current_user)]
