"""Invitation links: the only way into an organization, and (after the very
first account) the only way to sign up. Free of HTTP concerns.

A link works once, until it expires or is revoked. Using it locks the
invitation's row, so two people opening the same link at once cannot both
get in. Only a hash of the link's token is stored; the token itself is
handed out once, when the invitation is created.
"""

import secrets
import uuid
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.errors import Conflict, Forbidden, Gone, NotFound
from app.models import Organization, OrgInvitation, OrgMembership, OrgRole, User
from app.passwords import hash_password
from app.services import organizations
from app.services.auth import hash_token, start_session, utc_now

InvitationStatus = Literal["pending", "accepted", "revoked", "expired"]


class InvitationNotFound(NotFound):
    code = "invitation_not_found"


class InvitationUsed(Gone):
    code = "invitation_used"


class InvitationRevoked(Gone):
    code = "invitation_revoked"


class InvitationExpired(Gone):
    code = "invitation_expired"


class AlreadyMember(Conflict):
    code = "already_member"


class EmailTaken(Conflict):
    code = "email_taken"


class InvitationForAnotherEmail(Forbidden):
    code = "invitation_for_another_email"


def status_of(invitation: OrgInvitation, now: datetime | None = None) -> InvitationStatus:
    if invitation.accepted_at is not None:
        return "accepted"
    if invitation.revoked_at is not None:
        return "revoked"
    if invitation.expires_at <= (now or utc_now()):
        return "expired"
    return "pending"


def _check_usable(invitation: OrgInvitation) -> None:
    match status_of(invitation):
        case "accepted":
            raise InvitationUsed("This invitation has already been used. Ask for a new one.")
        case "revoked":
            raise InvitationRevoked("This invitation was withdrawn. Ask for a new one.")
        case "expired":
            raise InvitationExpired("This invitation has expired. Ask for a new one.")


# ---- Managing invitations (admins) ----


async def create(
    session: AsyncSession,
    org_id: uuid.UUID,
    user: User,
    *,
    role: OrgRole,
    title: str,
    can_create: bool,
    email: str | None,
    days: int,
) -> tuple[OrgInvitation, str]:
    """The invitation and its token (shown only now). Admins invite members;
    only owners invite admins and owners."""
    _, mine = await organizations.get(session, org_id, user)
    organizations.require(mine, OrgRole.ADMIN, "invite people")
    if role != OrgRole.MEMBER:
        organizations.require(mine, OrgRole.OWNER, "invite admins and owners")
    if email is not None and await _is_member(session, org_id, email):
        raise AlreadyMember(f"{email} is already a member of this organization.")
    token = secrets.token_urlsafe(32)
    invitation = OrgInvitation(
        org_id=org_id,
        token_hash=hash_token(token),
        role=role,
        title=title,
        can_create_projects=can_create,
        email=email,
        created_by=user.id,
        expires_at=utc_now() + timedelta(days=days),
    )
    session.add(invitation)
    await session.commit()
    await session.refresh(invitation)
    return invitation, token


async def _is_member(session: AsyncSession, org_id: uuid.UUID, email: str) -> bool:
    found = await session.scalar(
        select(OrgMembership.user_id)
        .join(User, User.id == OrgMembership.user_id)
        .where(OrgMembership.org_id == org_id, User.email == email)
    )
    return found is not None


InvitationRow = tuple[OrgInvitation, User | None, User | None]


async def list_for_org(session: AsyncSession, org_id: uuid.UUID, user: User) -> list[InvitationRow]:
    """Every invitation, newest first, with who sent it and who used it."""
    _, mine = await organizations.get(session, org_id, user)
    organizations.require(mine, OrgRole.ADMIN, "see invitations")
    inviter, acceptor = aliased(User), aliased(User)
    rows = await session.execute(
        select(OrgInvitation, inviter, acceptor)
        .outerjoin(inviter, inviter.id == OrgInvitation.created_by)
        .outerjoin(acceptor, acceptor.id == OrgInvitation.accepted_by)
        .where(OrgInvitation.org_id == org_id)
        .order_by(OrgInvitation.created_at.desc(), OrgInvitation.id)
    )
    return [tuple(row) for row in rows]


async def revoke(
    session: AsyncSession, org_id: uuid.UUID, user: User, invitation_id: uuid.UUID
) -> None:
    """Stops the link from working. Revoking twice is fine; a link that was
    already used cannot be revoked (remove the member instead)."""
    _, mine = await organizations.get(session, org_id, user)
    organizations.require(mine, OrgRole.ADMIN, "withdraw invitations")
    invitation = await session.scalar(
        select(OrgInvitation)
        .where(OrgInvitation.id == invitation_id, OrgInvitation.org_id == org_id)
        .with_for_update()
    )
    if invitation is None:
        raise InvitationNotFound(f"Invitation {invitation_id} does not exist.")
    if invitation.accepted_at is not None:
        raise InvitationUsed(
            "This invitation has already been used. To undo it, remove the member."
        )
    if invitation.revoked_at is None:
        invitation.revoked_at = utc_now()
    await session.commit()


# ---- Using a link (the invited person) ----


async def _by_token(
    session: AsyncSession, token: str, *, lock: bool = False
) -> tuple[OrgInvitation, Organization]:
    query = (
        select(OrgInvitation, Organization)
        .join(Organization, Organization.id == OrgInvitation.org_id)
        .where(OrgInvitation.token_hash == hash_token(token))
    )
    if lock:
        query = query.with_for_update(of=OrgInvitation)
    row = (await session.execute(query)).one_or_none()
    if row is None:
        raise InvitationNotFound("This invitation link is not valid. Check that it is complete.")
    return row[0], row[1]


async def preview(
    session: AsyncSession, token: str
) -> tuple[OrgInvitation, Organization, User | None]:
    """What the link offers, for the page that asks to accept it. Anyone with
    the link may look; it shows the organization's name and nothing else."""
    invitation, org = await _by_token(session, token)
    _check_usable(invitation)
    inviter = await session.get(User, invitation.created_by) if invitation.created_by else None
    return invitation, org, inviter


async def _claim(
    session: AsyncSession, token: str, email: str
) -> tuple[OrgInvitation, Organization]:
    invitation, org = await _by_token(session, token, lock=True)
    _check_usable(invitation)
    if invitation.email is not None and invitation.email != email:
        raise InvitationForAnotherEmail(
            f"This invitation is for {invitation.email}. Sign in with that address, "
            "or ask for an invitation for yours."
        )
    return invitation, org


def _join(session: AsyncSession, invitation: OrgInvitation, user_id: uuid.UUID) -> OrgMembership:
    membership = OrgMembership(
        org_id=invitation.org_id,
        user_id=user_id,
        role=invitation.role,
        title=invitation.title,
        can_create_projects=invitation.can_create_projects,
    )
    session.add(membership)
    invitation.accepted_by = user_id
    invitation.accepted_at = utc_now()
    return membership


async def accept(
    session: AsyncSession, token: str, user: User
) -> tuple[Organization, OrgMembership]:
    """Joins the signed-in user to the organization. Someone already in it
    keeps their role, and the link stays unused."""
    invitation, org = await _claim(session, token, user.email)
    already = await session.get(OrgMembership, (invitation.org_id, user.id))
    if already is not None:
        raise AlreadyMember(f"You are already a member of {org.name}.")
    membership = _join(session, invitation, user.id)
    await session.commit()
    await session.refresh(membership)
    return org, membership


async def sign_up(
    session: AsyncSession, token: str, email: str, display_name: str, password: str
) -> tuple[User, Organization, OrgMembership, str, datetime]:
    """Creates an account through the link, joins it to the organization and
    signs it in. An email that already has an account must sign in and accept
    instead."""
    password_hash = await hash_password(password)
    invitation, org = await _claim(session, token, email)
    if await session.scalar(select(User.id).where(User.email == email)) is not None:
        raise _email_taken(email)
    user = User(email=email, display_name=display_name, password_hash=password_hash)
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as e:
        await session.rollback()
        raise _email_taken(email) from e
    membership = _join(session, invitation, user.id)
    session_token, expires_at = start_session(session, user.id)
    await session.commit()
    await session.refresh(user)
    await session.refresh(membership)
    return user, org, membership, session_token, expires_at


def _email_taken(email: str) -> EmailTaken:
    return EmailTaken(
        f"{email} already has an account. Sign in, then open the invitation again.",
        {"email": email},
    )
