"""Inviting many people at once from a CSV file: one invitation per row, each
locked to the row's email. Free of HTTP concerns.

The file needs a header row naming its columns: `email` (required), and
optionally `name`, `job title` and `role`. A row that cannot be invited (a
bad email, someone already in the organization, ...) is reported with the
reason and skipped; the others are invited together, in one transaction. A
problem with the whole file (no email column, an unknown column, too many
rows) refuses it. A dry run reports the same without inviting anyone, for the
preview the inviter checks first.
"""

import csv
import io
import secrets
import uuid
from dataclasses import dataclass
from datetime import timedelta

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import Invalid
from app.models import OrgInvitation, OrgMembership, OrgRole, User
from app.schemas.auth import DisplayName, Email
from app.schemas.organizations import Title
from app.services import organizations
from app.services.auth import hash_token, utc_now

# Enough for a team; small enough that one request cannot create invitations
# by the thousand.
MAX_ROWS = 100

BYTE_ORDER_MARK = chr(0xFEFF)

# Column names as people write them (compared lower-cased, with "_" and "-"
# read as spaces) → the field they fill.
COLUMNS = {
    "email": "email",
    "email address": "email",
    "e mail": "email",
    "name": "name",
    "full name": "name",
    "job title": "title",
    "title": "title",
    "role": "role",
}
COLUMN_NAMES = "email, name, job title and role"

_email = TypeAdapter(Email)
_name = TypeAdapter(DisplayName)
_title = TypeAdapter(Title)


_TOO_LONG = "longer than 100 characters, or not on one line."


class CsvInvalid(Invalid):
    code = "csv_invalid"


@dataclass
class Problem:
    code: str
    message: str


@dataclass
class Row:
    """One person from the file, as written (an email is lower-cased once it
    is known to be valid)."""

    line: int
    email: str
    name: str | None
    title: str
    role: str
    problem: Problem | None = None
    invitation: OrgInvitation | None = None
    token: str | None = None


def parse(text: str) -> list[Row]:
    """The file's rows, each checked on its own (whether the organization can
    take them is checked later). Raises CsvInvalid for a file that cannot be
    read as a whole."""
    text = text.removeprefix(BYTE_ORDER_MARK)  # Excel's "CSV UTF-8" starts with a byte-order mark.
    lines = text.splitlines()
    first = next((line for line in lines if line.strip()), None)
    if first is None:
        raise CsvInvalid("The file is empty.")
    # Excel writes ";" or tabs in some regions instead of commas.
    delimiter = max(",;\t", key=first.count)
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    try:
        records = [(reader.line_num, cells) for cells in reader if any(c.strip() for c in cells)]
    except csv.Error as e:
        raise CsvInvalid(f"The file is not a readable CSV file: {e}.") from e

    if not records:
        raise CsvInvalid("The file is empty.")
    (_, header), *body = records
    fields = _columns(header)
    if not body:
        raise CsvInvalid("The file has a header row but no one in it.")
    if len(body) > MAX_ROWS:
        raise CsvInvalid(
            f"The file has {len(body)} rows; up to {MAX_ROWS} people can be invited at once. "
            "Split it into smaller files.",
            {"rows": len(body), "max_rows": MAX_ROWS},
        )
    return [_row(line, cells, fields) for line, cells in body]


def _columns(header: list[str]) -> list[str]:
    fields = []
    for cell in header:
        key = " ".join(cell.strip().lower().replace("_", " ").replace("-", " ").split())
        field = COLUMNS.get(key)
        if field is None:
            raise CsvInvalid(
                f'The column "{cell.strip()}" is not one Nestboard knows: use {COLUMN_NAMES}.'
            )
        if field in fields:
            raise CsvInvalid(f'The file has two "{cell.strip()}" columns.')
        fields.append(field)
    if "email" not in fields:
        raise CsvInvalid(
            "The file needs an email column: every invitation is for one address. "
            f"The first row names the columns ({COLUMN_NAMES})."
        )
    return fields


def _row(line: int, cells: list[str], fields: list[str]) -> Row:
    values = {field: (cells[i].strip() if i < len(cells) else "") for i, field in enumerate(fields)}
    row = Row(
        line=line,
        email=values["email"],
        name=values.get("name") or None,
        title=values.get("title", ""),
        role=values.get("role", "").lower() or OrgRole.MEMBER,
    )
    row.problem = _check(row, extra_cells=len(cells) > len(fields))
    return row


def _check(row: Row, *, extra_cells: bool) -> Problem | None:
    if extra_cells:
        return Problem("too_many_cells", "This row has more cells than the header has columns.")
    if not row.email:
        return Problem("missing_email", "No email.")
    try:
        row.email = _email.validate_python(row.email)
    except ValidationError:
        return Problem("invalid_email", f'"{row.email}" is not an email address.')
    if row.name is not None:
        try:
            row.name = _name.validate_python(row.name)
        except ValidationError:
            return Problem("invalid_name", f"The name is {_TOO_LONG}")
    try:
        row.title = _title.validate_python(row.title)
    except ValidationError:
        return Problem("invalid_title", f"The job title is {_TOO_LONG}")
    if row.role not in set(OrgRole):
        return Problem("unknown_role", f'"{row.role}" is not a role: use member, admin or owner.')
    return None


async def run(
    session: AsyncSession,
    org_id: uuid.UUID,
    user: User,
    text: str,
    *,
    dry_run: bool,
    days: int,
) -> list[Row]:
    """Every row of the file, each either invited (with its token, shown only
    now) or skipped with its problem. With `dry_run`, nobody is invited."""
    _, mine = await organizations.get(session, org_id, user)
    organizations.require(mine, OrgRole.ADMIN, "invite people")
    rows = parse(text)

    seen: set[str] = set()
    for row in rows:
        if row.problem is None and row.email in seen:
            row.problem = Problem("duplicate_email", "The same email is on an earlier row.")
        seen.add(row.email)
    emails = [row.email for row in rows if row.problem is None]
    members = set(
        await session.scalars(
            select(User.email)
            .join(OrgMembership, OrgMembership.user_id == User.id)
            .where(OrgMembership.org_id == org_id, User.email.in_(emails))
        )
    )
    invited = set(
        await session.scalars(
            select(OrgInvitation.email).where(
                OrgInvitation.org_id == org_id,
                OrgInvitation.email.in_(emails),
                OrgInvitation.accepted_at.is_(None),
                OrgInvitation.revoked_at.is_(None),
                OrgInvitation.expires_at > utc_now(),
            )
        )
    )
    may_invite_admins = organizations.at_least(mine, OrgRole.OWNER)
    for row in rows:
        if row.problem is not None:
            continue
        if row.email in members:
            row.problem = Problem("already_member", "Already a member of this organization.")
        elif row.email in invited:
            row.problem = Problem(
                "already_invited",
                "Already has an invitation that is still open: revoke it to invite again.",
            )
        elif row.role != OrgRole.MEMBER and not may_invite_admins:
            row.problem = Problem(
                "role_needs_owner", "Only the organization's owners can invite admins and owners."
            )

    if dry_run:
        return rows
    expires_at = utc_now() + timedelta(days=days)
    for row in rows:
        if row.problem is not None:
            continue
        row.token = secrets.token_urlsafe(32)
        row.invitation = OrgInvitation(
            org_id=org_id,
            token_hash=hash_token(row.token),
            role=row.role,
            title=row.title,
            can_create_projects=False,
            email=row.email,
            name=row.name,
            created_by=user.id,
            expires_at=expires_at,
        )
        session.add(row.invitation)
    await session.commit()
    for row in rows:
        if row.invitation is not None:
            await session.refresh(row.invitation)
    return rows
