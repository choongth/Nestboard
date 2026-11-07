import uuid
from datetime import datetime
from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
)

from app.schemas.common import one_line


def _normalize_email(value: object) -> object:
    return value.strip().lower() if isinstance(value, str) else value


# A light check only: whether the address really exists is up to whoever
# invites it. Lower-cased, so emails are case-insensitive.
Email = Annotated[
    str,
    BeforeValidator(_normalize_email),
    StringConstraints(max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"),
    Field(examples=["alice@example.com"]),
]
# Signing in does not re-check the format: an address that could never have
# been registered simply does not match.
LoginEmail = Annotated[str, BeforeValidator(_normalize_email), StringConstraints(max_length=320)]

DisplayName = Annotated[str, one_line(100)]


def _not_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("A password cannot be only spaces.")
    return value


# Never stripped: spaces are part of the password.
NewPassword = Annotated[
    str,
    StringConstraints(min_length=8, max_length=200),
    AfterValidator(_not_blank),
    Field(description="8 to 200 characters."),
]
Password = Annotated[str, StringConstraints(max_length=200)]


class AuthStatus(BaseModel):
    needs_setup: bool = Field(
        description="True while nobody has signed up yet: the first account becomes the "
        "instance admin (POST /auth/setup)."
    )


class SetupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: Email
    display_name: DisplayName
    password: NewPassword


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: LoginEmail
    password: Password


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: DisplayName


class PasswordChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: Password
    new_password: NewPassword


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    is_instance_admin: bool
    created_at: datetime


class UserPage(BaseModel):
    items: list[UserOut]
    total: int
    limit: int
    offset: int


class PasswordResetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expires_in_hours: int = Field(default=24, ge=1, le=72)


class CreatedPasswordReset(BaseModel):
    user: UserOut
    expires_at: datetime
    token: str = Field(
        description="Goes into the link the admin hands over (/reset-password/<token>). "
        "Shown only now: only a hash is kept."
    )


class PasswordResetPreview(BaseModel):
    email: str
    display_name: str
    expires_at: datetime


class PasswordResetUse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    new_password: NewPassword
