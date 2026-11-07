"""Accounts, sign-in and sessions. Free of HTTP concerns: callers get the
session token back and decide how to hand it to the client."""

import hashlib
import math
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, exists, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import live
from app.config import get_settings
from app.errors import Conflict, Invalid, TooManyRequests, Unauthorized
from app.models import LoginThrottle, User, UserSession
from app.passwords import hash_password, needs_rehash, verify_password

# Failed sign-ins in a row that cost nothing. After that each attempt waits
# 30 s, then 1 min, 2 min... up to 15 min, until one succeeds.
FREE_FAILURES = 5
FIRST_DELAY = timedelta(seconds=30)
MAX_DELAY = timedelta(minutes=15)
# A session's expiry moves forward at most this often, not on every request.
REFRESH_EVERY = timedelta(days=1)
# Serializes the first sign-up, so two at once cannot both become admin.
_SETUP_LOCK = 0x4E455354  # "NEST"


class AlreadySetUp(Conflict):
    code = "already_set_up"


class InvalidCredentials(Unauthorized):
    code = "invalid_credentials"


class NotSignedIn(Unauthorized):
    code = "not_signed_in"


class TooManyAttempts(TooManyRequests):
    code = "too_many_attempts"


class WrongPassword(Invalid):
    code = "wrong_password"


def utc_now() -> datetime:
    return datetime.now(UTC)


def _lifetime() -> timedelta:
    return timedelta(days=get_settings().session_days)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def start_session(session: AsyncSession, user_id: uuid.UUID) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    expires_at = utc_now() + _lifetime()
    session.add(UserSession(token_hash=hash_token(token), user_id=user_id, expires_at=expires_at))
    return token, expires_at


# ---- First sign-up ----


async def needs_setup(session: AsyncSession) -> bool:
    return not await session.scalar(select(exists().select_from(User)))


async def set_up(
    session: AsyncSession, email: str, display_name: str, password: str
) -> tuple[User, str, datetime]:
    """Creates the first account, as instance admin, and signs it in. Refused
    once any account exists: everyone else joins through an invitation."""
    password_hash = await hash_password(password)
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _SETUP_LOCK})
    if not await needs_setup(session):
        raise AlreadySetUp("This Nestboard is already set up. Ask an admin for an invitation.")
    user = User(
        email=email,
        display_name=display_name,
        password_hash=password_hash,
        is_instance_admin=True,
    )
    session.add(user)
    await session.flush()
    token, expires_at = start_session(session, user.id)
    await session.commit()
    await session.refresh(user)
    return user, token, expires_at


# ---- Signing in and out ----


def _wait_left(throttle: LoginThrottle | None, now: datetime) -> timedelta:
    if throttle is None or throttle.failures < FREE_FAILURES:
        return timedelta(0)
    # Capped exponent: past 2^5 the delay is at MAX_DELAY anyway.
    delay = min(MAX_DELAY, FIRST_DELAY * 2 ** min(throttle.failures - FREE_FAILURES, 10))
    return max(timedelta(0), throttle.last_failure_at + delay - now)


async def _check_throttle(session: AsyncSession, email: str) -> None:
    wait = _wait_left(await session.get(LoginThrottle, email), utc_now())
    if wait > timedelta(0):
        seconds = math.ceil(wait.total_seconds())
        raise TooManyAttempts(
            f"Too many wrong passwords in a row. Try again in {seconds} seconds.",
            retry_after=seconds,
        )


async def _record_failure(session: AsyncSession, email: str) -> None:
    # One statement, so failures sent at the same moment all count.
    await session.execute(
        insert(LoginThrottle)
        .values(email=email, failures=1, last_failure_at=utc_now())
        .on_conflict_do_update(
            index_elements=[LoginThrottle.email],
            set_={"failures": LoginThrottle.failures + 1, "last_failure_at": utc_now()},
        )
    )
    await session.commit()


async def _check_password(session: AsyncSession, email: str, password: str) -> User | None:
    """The account if `password` is right; counts the failure otherwise. The
    same answer, and the same time taken, whether or not the email exists."""
    await _check_throttle(session, email)
    user = await session.scalar(select(User).where(User.email == email))
    if not await verify_password(user.password_hash if user else None, password):
        await _record_failure(session, email)
        return None
    await session.execute(delete(LoginThrottle).where(LoginThrottle.email == email))
    if user is not None and needs_rehash(user.password_hash):
        user.password_hash = await hash_password(password)
    return user


async def sign_in(session: AsyncSession, email: str, password: str) -> tuple[User, str, datetime]:
    user = await _check_password(session, email, password)
    if user is None:
        raise InvalidCredentials("The email or password is wrong.")
    # Tidy up this user's ended sessions while we are here.
    await session.execute(
        delete(UserSession).where(
            UserSession.user_id == user.id, UserSession.expires_at <= utc_now()
        )
    )
    token, expires_at = start_session(session, user.id)
    await session.commit()
    return user, token, expires_at


async def sign_out(session: AsyncSession, token: str) -> None:
    await session.execute(delete(UserSession).where(UserSession.token_hash == hash_token(token)))
    await session.commit()
    live.hub.session_ended(token)


async def user_for_token(session: AsyncSession, token: str) -> tuple[User, datetime] | None:
    """The signed-in user and when the session now expires; None if the token
    is unknown or the session has ended. Using a session keeps it alive."""
    now = utc_now()
    row = (
        await session.execute(
            select(User, UserSession)
            .join(UserSession, UserSession.user_id == User.id)
            .where(UserSession.token_hash == hash_token(token), UserSession.expires_at > now)
        )
    ).one_or_none()
    if row is None:
        return None
    user, user_session = row
    expires_at = user_session.expires_at
    if expires_at - now < _lifetime() - REFRESH_EVERY:
        expires_at = now + _lifetime()
        await session.execute(
            update(UserSession)
            .where(UserSession.token_hash == user_session.token_hash)
            .values(expires_at=expires_at)
        )
        await session.commit()
    return user, expires_at


# ---- The signed-in user's own account ----


async def update_profile(session: AsyncSession, user: User, display_name: str) -> User:
    user.display_name = display_name
    user.updated_at = utc_now()
    await session.commit()
    return user


async def change_password(
    session: AsyncSession, user: User, token: str, current_password: str, new_password: str
) -> None:
    """Needs the current password. Signs out every other session of the user,
    so a stolen session stops working once the password is changed."""
    if await _check_password(session, user.email, current_password) is None:
        raise WrongPassword("The current password is wrong.")
    user.password_hash = await hash_password(new_password)
    user.updated_at = utc_now()
    await session.execute(
        delete(UserSession).where(
            UserSession.user_id == user.id, UserSession.token_hash != hash_token(token)
        )
    )
    await session.commit()
    live.hub.access_changed(user_id=user.id)
