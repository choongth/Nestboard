"""Password-reset links, and the instance admin's list of accounts. Free of
HTTP concerns.

Only the instance admin makes reset links. An organization admin could
otherwise reset someone who also belongs to another organization, sign in as
them, and get into that organization too.

There is no email yet, so the admin hands the link over themselves. A link
works once, for a few hours; making a new one for the same person retires
the old. Using it signs out every session of the account, then signs in
the browser that used it.
"""

import secrets
import uuid
from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import live
from app.errors import Gone, NotFound
from app.models import LoginThrottle, PasswordReset, User, UserSession
from app.passwords import hash_password
from app.services.auth import hash_token, start_session, utc_now
from app.services.organizations import NotAllowed

ResetStatus = Literal["pending", "used", "replaced", "expired"]


class UserNotFound(NotFound):
    code = "user_not_found"


class ResetNotFound(NotFound):
    code = "password_reset_not_found"


class ResetUsed(Gone):
    code = "password_reset_used"


class ResetReplaced(Gone):
    code = "password_reset_replaced"


class ResetExpired(Gone):
    code = "password_reset_expired"


def _require_instance_admin(user: User, doing: str) -> None:
    if not user.is_instance_admin:
        raise NotAllowed(f"Only the instance admin can {doing}.")


# ---- The instance admin ----


async def list_users(
    session: AsyncSession, user: User, limit: int, offset: int
) -> tuple[Sequence[User], int]:
    """Every account on this Nestboard, by email."""
    _require_instance_admin(user, "list every account")
    total = await session.scalar(select(func.count()).select_from(User))
    rows = await session.scalars(select(User).order_by(User.email).limit(limit).offset(offset))
    return list(rows), total or 0


async def create(
    session: AsyncSession, admin: User, user_id: uuid.UUID, hours: int
) -> tuple[PasswordReset, User, str]:
    """The link and its token (shown only now)."""
    _require_instance_admin(admin, "make password-reset links")
    target = await session.get(User, user_id)
    if target is None:
        raise UserNotFound(f"User {user_id} does not exist.")
    now = utc_now()
    await session.execute(
        update(PasswordReset)
        .where(
            PasswordReset.user_id == user_id,
            PasswordReset.used_at.is_(None),
            PasswordReset.replaced_at.is_(None),
        )
        .values(replaced_at=now)
    )
    token = secrets.token_urlsafe(32)
    reset = PasswordReset(
        user_id=user_id,
        token_hash=hash_token(token),
        created_by=admin.id,
        expires_at=now + timedelta(hours=hours),
    )
    session.add(reset)
    await session.commit()
    await session.refresh(reset)
    return reset, target, token


# ---- Using a link ----


def _check_usable(reset: PasswordReset) -> None:
    if reset.used_at is not None:
        raise ResetUsed("This link has already been used. Ask the admin for a new one.")
    if reset.replaced_at is not None:
        raise ResetReplaced("A newer link was made for this account. Use that one instead.")
    if reset.expires_at <= utc_now():
        raise ResetExpired("This link has expired. Ask the admin for a new one.")


async def _by_token(
    session: AsyncSession, token: str, *, lock: bool = False
) -> tuple[PasswordReset, User]:
    query = (
        select(PasswordReset, User)
        .join(User, User.id == PasswordReset.user_id)
        .where(PasswordReset.token_hash == hash_token(token))
    )
    if lock:
        query = query.with_for_update(of=PasswordReset)
    row = (await session.execute(query)).one_or_none()
    if row is None:
        raise ResetNotFound("This password-reset link is not valid. Check that it is complete.")
    reset, user = row[0], row[1]
    _check_usable(reset)
    return reset, user


async def preview(session: AsyncSession, token: str) -> tuple[PasswordReset, User]:
    """Whose password the link resets, for the page that asks for a new one."""
    return await _by_token(session, token)


async def use(session: AsyncSession, token: str, new_password: str) -> tuple[User, str, datetime]:
    """Sets the new password, signs out every session of the account, and
    signs in this one."""
    password_hash = await hash_password(new_password)
    reset, user = await _by_token(session, token, lock=True)
    now = utc_now()
    reset.used_at = now
    user.password_hash = password_hash
    user.updated_at = now
    await session.execute(delete(UserSession).where(UserSession.user_id == user.id))
    # Wrong guesses before the reset should not keep the owner waiting.
    await session.execute(delete(LoginThrottle).where(LoginThrottle.email == user.email))
    session_token, expires_at = start_session(session, user.id)
    await session.commit()
    live.hub.access_changed(user_id=user.id)
    return user, session_token, expires_at
