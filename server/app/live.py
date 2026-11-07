"""Live diagrams: everyone with a diagram open hears about each change as it
is saved, and sees who else is there (presence). The connections are in
this process's memory (app.api.live opens them); every write to a diagram,
from a live connection or from the API, goes through `hub.writing` and then
`hub.publish`, so the connections hear changes in the order they were saved.

One process only: with several, each would need to hear the others' changes
(e.g. through Postgres LISTEN / NOTIFY).

No database here, so services can publish without importing the API.
"""

import asyncio
import itertools
import json
import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)

# Presence colours: the frontend has a palette this long.
COLORS = 12
# Messages waiting for a connection that does not keep up; past this it is
# closed, and its client reconnects and starts from the diagram as it is.
BACKLOG = 1000

# Close codes (4000-4999 are the application's own), as the browser sees them.
SIGNED_OUT = 4401
NOT_ALLOWED = 4403
GONE = 4404
BEHIND = 4408


@dataclass(frozen=True)
class Sender:
    """Who made a change: a user, over a live connection (with the id its
    client gave the change) or not."""

    user_id: uuid.UUID
    name: str
    connection: str | None = None
    change_id: str | None = None

    def described(self) -> dict[str, Any]:
        return {"user_id": str(self.user_id), "name": self.name, "connection": self.connection}


@dataclass(frozen=True)
class Close:
    code: int
    reason: str


_ids = itertools.count(1)


class Connection:
    """One open diagram in one browser tab. Messages for it wait in order
    until app.api.live sends them (`next`)."""

    def __init__(
        self,
        user_id: uuid.UUID,
        name: str,
        token: str,
        recheck: Callable[["Connection"], Awaitable[None]],
    ) -> None:
        self.id = f"c{next(_ids)}"
        self.user_id = user_id
        self.name = name
        # The session it signed in with, to check it is still on.
        self.token = token
        self.color = 0
        # What the user is doing, as their client last said (see schemas.live.Presence).
        self.state: dict[str, Any] = {}
        # Checks again what the user may do here (see Hub.access_changed).
        self.recheck = recheck
        self._outbox: asyncio.Queue[str | Close] = asyncio.Queue()
        self.closing = False

    def send(self, message: str | dict[str, Any]) -> None:
        if self.closing:
            return
        if self._outbox.qsize() >= BACKLOG:
            self.close(BEHIND, "Too far behind: reconnect to catch up.")
            return
        self._outbox.put_nowait(message if isinstance(message, str) else json.dumps(message))

    def close(self, code: int, reason: str) -> None:
        """Closes it once what is waiting has been sent."""
        if not self.closing:
            self.closing = True
            self._outbox.put_nowait(Close(code, reason))

    async def next(self) -> str | Close:
        """The next message to send, or how to close."""
        return await self._outbox.get()

    def presence(self) -> dict[str, Any]:
        return {
            "type": "presence",
            "connection": self.id,
            "user_id": str(self.user_id),
            "name": self.name,
            "color": self.color,
            "level": None,
            "selection": None,
            "cursor": None,
            "dragging": None,
            **self.state,
        }


@dataclass
class Room:
    """The connections to one diagram."""

    diagram_id: uuid.UUID
    project_id: uuid.UUID | None = None
    org_id: uuid.UUID | None = None
    connections: dict[str, Connection] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    # Writers holding or waiting for the lock.
    writers: int = 0


class Hub:
    def __init__(self) -> None:
        self._rooms: dict[uuid.UUID, Room] = {}
        self._tasks: set[asyncio.Task[None]] = set()

    @asynccontextmanager
    async def writing(self, diagram_id: uuid.UUID) -> AsyncIterator[Room]:
        """Holds the diagram for one write (or a connection joining), from
        reading it to publishing what changed: writes to one diagram happen
        one after another."""
        room = self._rooms.get(diagram_id)
        if room is None:
            room = self._rooms[diagram_id] = Room(diagram_id)
        room.writers += 1
        try:
            async with room.lock:
                yield room
        finally:
            room.writers -= 1
            self._forget_if_empty(room)

    def join(
        self, room: Room, connection: Connection, project_id: uuid.UUID, org_id: uuid.UUID
    ) -> list[dict[str, Any]]:
        """Adds a connection (inside `writing`); returns who else is there.
        Each person keeps one colour across their tabs."""
        room.project_id, room.org_id = project_id, org_id
        others = list(room.connections.values())
        same = next((c for c in others if c.user_id == connection.user_id), None)
        if same is not None:
            connection.color = same.color
        else:
            taken = {c.color for c in others}
            free = (i for i in range(COLORS) if i not in taken)
            connection.color = next(free, len(others) % COLORS)
        room.connections[connection.id] = connection
        self._send(room, connection.presence(), but=connection)
        return [c.presence() for c in others]

    def leave(self, diagram_id: uuid.UUID, connection: Connection) -> None:
        room = self._rooms.get(diagram_id)
        if room is None or room.connections.pop(connection.id, None) is None:
            return
        self._send(room, {"type": "left", "connection": connection.id})
        self._forget_if_empty(room)

    def publish(self, diagram_id: uuid.UUID, message: dict[str, Any]) -> None:
        """Tells everyone with the diagram open (inside `writing`)."""
        room = self._rooms.get(diagram_id)
        if room is not None:
            self._send(room, message)

    def present(self, diagram_id: uuid.UUID, connection: Connection, state: dict[str, Any]) -> None:
        """What a user is doing now: tells the others."""
        connection.state = state
        room = self._rooms.get(diagram_id)
        if room is not None:
            self._send(room, connection.presence(), but=connection)

    def close_diagram(self, diagram_id: uuid.UUID, code: int, reason: str) -> None:
        room = self._rooms.get(diagram_id)
        for connection in room.connections.values() if room else ():
            connection.close(code, reason)

    def access_changed(
        self,
        *,
        org_id: uuid.UUID | None = None,
        project_id: uuid.UUID | None = None,
        user_id: uuid.UUID | None = None,
    ) -> None:
        """Who may see or change what may have changed, in an organization, a
        project or for one person: each connection there checks again (and
        is told the user's roles, or closed)."""
        for room in list(self._rooms.values()):
            if org_id is not None and room.org_id != org_id:
                continue
            if project_id is not None and room.project_id != project_id:
                continue
            for connection in list(room.connections.values()):
                if user_id is None or connection.user_id == user_id:
                    self._spawn(connection.recheck(connection))

    def session_ended(self, token: str) -> None:
        """Signed out: the connections opened with that session close."""
        for room in self._rooms.values():
            for connection in room.connections.values():
                if connection.token == token:
                    connection.close(SIGNED_OUT, "You signed out.")

    def connections(self, diagram_id: uuid.UUID) -> list[Connection]:
        room = self._rooms.get(diagram_id)
        return list(room.connections.values()) if room else []

    async def settled(self) -> None:
        """Waits for the checks `access_changed` started (for tests)."""
        while self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)

    def _send(self, room: Room, message: dict[str, Any], but: Connection | None = None) -> None:
        text = json.dumps(message)
        for connection in room.connections.values():
            if connection is not but:
                connection.send(text)

    def _spawn(self, work: Awaitable[None]) -> None:
        async def run() -> None:
            try:
                await work
            except Exception:
                log.exception("Checking a live connection again failed")

        task = asyncio.get_running_loop().create_task(run())
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def _forget_if_empty(self, room: Room) -> None:
        if not room.connections and room.writers == 0 and self._rooms.get(room.diagram_id) is room:
            del self._rooms[room.diagram_id]


hub = Hub()
