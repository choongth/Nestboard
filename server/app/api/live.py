"""The live connection to an open diagram: a WebSocket at
/api/v1/diagrams/{diagram_id}/live, signed in with the session cookie. It
starts with the whole diagram, then carries every change as it is saved
(from here or anywhere else), changes this browser makes, and who else is
there and what they are doing (app.live). The messages are described in
server/README.md."""

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, live
from app.api.diagrams import save
from app.auth import COOKIE
from app.config import get_settings
from app.db import SessionFactory
from app.errors import AppError, NotFound, error_body, issues
from app.models import User
from app.schemas.diagrams import DiagramAccess, DiagramOut
from app.schemas.live import ClientMessage, LiveChange, Presence
from app.services import auth, diagrams, projects

log = logging.getLogger(__name__)

router = APIRouter(tags=["diagrams"])

# The close code for a message over the size limit (as for a request body).
TOO_BIG = 1009


@router.websocket("/diagrams/{diagram_id}/live")
async def live_diagram(websocket: WebSocket, diagram_id: uuid.UUID) -> None:
    if not _from_this_site(websocket):
        # Refused before it opens: another site's page must not act as the user.
        await websocket.close(live.NOT_ALLOWED)
        return
    await websocket.accept()
    token = websocket.cookies.get(COOKIE, "")
    async with SessionFactory() as session:
        user = await _signed_in(session, token)
        if user is None:
            await websocket.close(live.SIGNED_OUT, "Sign in first. (Your session may have ended.)")
            return
        try:
            found = await access.for_diagram(session, diagram_id, user)
        except NotFound as e:
            await websocket.close(live.GONE, e.message)
            return
        connection = live.Connection(user.id, user.display_name, token, _recheck(diagram_id))
        async with live.hub.writing(diagram_id) as room:
            # Read while nothing can be saved, so the connection hears of
            # every change after this version.
            diagram = DiagramOut.model_validate(await diagrams.read(session, diagram_id))
            others = live.hub.join(room, connection, found.project.id, found.org.id)
            connection.send(
                {
                    "type": "hello",
                    "connection": connection.id,
                    "color": connection.color,
                    "diagram": diagram.model_dump(mode="json", by_alias=True),
                    "access": await _access(session, found, user, diagram_id),
                    "people": others,
                }
            )

    receiving = asyncio.create_task(_receive(websocket, connection, diagram_id))
    sending = asyncio.create_task(_send(websocket, connection))
    try:
        await asyncio.wait([receiving, sending], return_when=asyncio.FIRST_COMPLETED)
        # Closed from this side: let what is waiting go out first.
        if connection.closing and not sending.done():
            await asyncio.wait([sending], timeout=5)
    finally:
        live.hub.leave(diagram_id, connection)
        for task in (receiving, sending):
            task.cancel()
        for result in await asyncio.gather(receiving, sending, return_exceptions=True):
            if isinstance(result, Exception) and not isinstance(result, WebSocketDisconnect):
                log.error("Live connection to diagram %s failed", diagram_id, exc_info=result)


async def _send(websocket: WebSocket, connection: live.Connection) -> None:
    while True:
        message = await connection.next()
        if isinstance(message, live.Close):
            await websocket.close(message.code, message.reason)
            return
        await websocket.send_text(message)


async def _receive(
    websocket: WebSocket, connection: live.Connection, diagram_id: uuid.UUID
) -> None:
    limit = get_settings().max_request_bytes
    while not connection.closing:
        received = await websocket.receive()
        if received["type"] == "websocket.disconnect":
            return
        text = received.get("text")
        if text is None:
            connection.send(_refused(None, "validation_failed", "Send JSON text messages."))
            continue
        if len(text) > limit:
            connection.close(TOO_BIG, f"Messages are limited to {limit} bytes.")
            return
        try:
            message = ClientMessage.validate_json(text)
        except ValidationError as e:
            problems = issues(e.errors())
            connection.send(
                _refused(None, "validation_failed", "The message is not valid.", problems)
            )
            continue
        if isinstance(message, Presence):
            state = message.model_dump(mode="json", exclude={"type"})
            live.hub.present(diagram_id, connection, state)
        else:
            await _change(connection, diagram_id, message)


async def _change(connection: live.Connection, diagram_id: uuid.UUID, change: LiveChange) -> None:
    """Saves the changes: everyone (this connection too) hears of them in a
    `change` message, or only this one in `refused`."""
    async with SessionFactory() as session:
        user = await _signed_in(session, connection.token)
        if user is None:
            connection.close(live.SIGNED_OUT, "Your session has ended.")
            return
        sender = live.Sender(user.id, user.display_name, connection.id, change.id)
        try:
            await save(session, diagram_id, change, user, sender=sender)
        except NotFound as e:
            # Deleted, or the user may no longer see it.
            connection.close(live.GONE, e.message)
        except AppError as e:
            connection.send(_refused(change.id, e.code, e.message, e.details))
        except Exception:
            log.exception("Saving a live change to diagram %s failed", diagram_id)
            connection.send(_refused(change.id, "server_error", "The change could not be saved."))


def _refused(change_id: str | None, code: str, message: str, details: Any = None) -> dict[str, Any]:
    """Only to the sender: `id` is the change's, or null for a message that is not one."""
    return {"type": "refused", "id": change_id, **error_body(code, message, details)}


def _recheck(diagram_id: uuid.UUID) -> Callable[[live.Connection], Awaitable[None]]:
    async def recheck(connection: live.Connection) -> None:
        """After access changed: the user's roles now, or closed."""
        async with SessionFactory() as session:
            user = await _signed_in(session, connection.token)
            if user is None:
                connection.close(live.SIGNED_OUT, "Your session has ended.")
                return
            try:
                found = await access.for_diagram(session, diagram_id, user)
            except NotFound:
                connection.close(live.GONE, "You no longer have access to this diagram.")
                return
            connection.send({"type": "access", **await _access(session, found, user, diagram_id)})

    return recheck


async def _access(
    session: AsyncSession, found: projects.Access, user: User, diagram_id: uuid.UUID
) -> dict[str, Any]:
    """The user's roles, as GET /diagrams/{id}/access gives them."""
    return DiagramAccess(
        project_role=found.role,
        box_roles=await projects.box_roles(session, found.project, user.id, diagram_id),
    ).model_dump(mode="json")


async def _signed_in(session: AsyncSession, token: str) -> User | None:
    found = await auth.user_for_token(session, token) if token else None
    return found[0] if found else None


def _from_this_site(websocket: WebSocket) -> bool:
    """Opened by this site's pages (or not by a browser at all, which sends
    no Origin): a page of another site has no business with the session."""
    origin = websocket.headers.get("origin")
    if origin is None:
        return True
    if origin in get_settings().cors_origins:
        return True
    return urlsplit(origin).netloc == websocket.headers.get("host")
