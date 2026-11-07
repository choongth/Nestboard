import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status

from app.auth import CurrentUser
from app.db import SessionDep
from app.errors import ROLE_RESPONSES
from app.schemas.auth import CreatedPasswordReset, PasswordResetCreate, UserOut, UserPage
from app.services import password_resets

# The instance admin's tools. Everyone else gets 403.
router = APIRouter(prefix="/admin", tags=["instance admin"], responses=ROLE_RESPONSES)


@router.get("/users", response_model=UserPage)
async def list_users(
    user: CurrentUser,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """Every account on this Nestboard, by email."""
    items, total = await password_resets.list_users(session, user, limit, offset)
    return UserPage(
        items=[UserOut.model_validate(u) for u in items], total=total, limit=limit, offset=offset
    )


@router.post(
    "/users/{user_id}/password-resets",
    response_model=CreatedPasswordReset,
    status_code=status.HTTP_201_CREATED,
)
async def create_password_reset(
    user_id: uuid.UUID, body: PasswordResetCreate, user: CurrentUser, session: SessionDep
):
    """A one-time link that lets the person choose a new password, for
    `expires_in_hours` hours. Hand it over yourself; the `token` is shown only
    this once. Any older unused link for the same person stops working."""
    reset, target, token = await password_resets.create(
        session, user, user_id, body.expires_in_hours
    )
    return CreatedPasswordReset(
        user=UserOut.model_validate(target), expires_at=reset.expires_at, token=token
    )
