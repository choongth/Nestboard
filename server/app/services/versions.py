"""Optimistic locking: every change names the version it is based on, and
fails with VersionConflict if someone else changed the record in between."""

import uuid
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import NotFound, VersionConflict
from app.models import Diagram, Group, Organization, Project


def conflict(what: str, current: int, version: int) -> VersionConflict:
    """`what` starts the message, e.g. "The diagram" or "ADR-0007"."""
    return VersionConflict(
        f"{what} was changed elsewhere (now at version {current}, this change was based on "
        f"version {version}). Reload it and try again.",
        {"current_version": current},
    )


async def bump[M: (Diagram, Group, Organization, Project)](
    session: AsyncSession,
    model: type[M],
    row_id: uuid.UUID,
    version: int | None,
    what: str,
    missing: NotFound,
    **values: Any,
) -> M:
    """Sets `values` and moves the row on to the next version, only if it is
    still at `version` (None: whatever version it is at). The check and the
    write are one statement, so of two changes based on the same version only
    one succeeds; the other gets VersionConflict. `missing` is raised when
    there is no such row."""
    statement = update(model).where(model.id == row_id)
    if version is not None:
        statement = statement.where(model.version == version)
    result = await session.execute(
        statement.values(version=model.version + 1, updated_at=func.now(), **values)
        .returning(model)
        .execution_options(synchronize_session=False)
    )
    row = result.scalar_one_or_none()
    if row is None:
        current = await session.scalar(select(model.version).where(model.id == row_id))
        if current is None or version is None:
            raise missing
        raise conflict(what, current, version)
    return row
