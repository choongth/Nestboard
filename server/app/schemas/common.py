"""Field types and rules shared by several request formats."""

import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator


def one_line(max_length: int, *, min_length: int = 1) -> StringConstraints:
    """A name or title: one line (no control characters such as line breaks),
    without spaces around it."""
    return StringConstraints(
        strip_whitespace=True,
        min_length=min_length,
        max_length=max_length,
        pattern=r"^[^\x00-\x1f\x7f]*$",
    )


Version = Annotated[int, Field(description="The version this change is based on.", ge=1)]
# A box (or connection) id in a diagram.
BoxId = Annotated[str, StringConstraints(min_length=1, max_length=200)]


class BoxScope(BaseModel):
    """Without diagram_id and box_id: the whole project. With both: that box
    of the diagram, and everything inside it."""

    model_config = ConfigDict(extra="forbid")

    diagram_id: uuid.UUID | None = None
    box_id: BoxId | None = None

    @model_validator(mode="after")
    def _box_in_a_diagram(self) -> "BoxScope":
        if (self.diagram_id is None) != (self.box_id is None):
            raise ValueError("Give both diagram_id and box_id, or neither.")
        return self
