"""Messages a browser sends on a live connection to a diagram (app.api.live).
What the server sends is described in server/README.md."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter

from app.schemas.diagrams import Changes, ItemId, Position

# Plenty for a selection or a drag of every box on a canvas.
_MANY = 10_000


class LiveChange(Changes):
    """Changes to save, as for POST /diagrams/{id}/changes without `version`:
    made on top of whatever is there. `id` is the client's own; the `change`
    message that tells everyone about it carries it back."""

    type: Literal["change"]
    id: Annotated[str, StringConstraints(min_length=1, max_length=100)]


class BoxesSelected(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["boxes"]
    ids: Annotated[list[ItemId], Field(max_length=_MANY)]


class ConnectionSelected(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["connection"]
    id: ItemId


class Presence(BaseModel):
    """What the user is doing, all of it each time it changes: passed on to
    the others, never saved."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["presence"]
    # The box whose inside they are looking at (the root at the top level).
    level: ItemId | None = None
    selection: Annotated[BoxesSelected | ConnectionSelected, Field(discriminator="type")] | None = (
        None
    )
    # Where their pointer is on that canvas.
    cursor: Position | None = None
    # Boxes being dragged on that canvas, where they are now (saved on drop).
    dragging: Annotated[dict[ItemId, Position], Field(max_length=_MANY)] | None = None


ClientMessage: TypeAdapter[LiveChange | Presence] = TypeAdapter(
    Annotated[LiveChange | Presence, Field(discriminator="type")]
)
