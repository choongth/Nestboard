"""What is inside what in a diagram: its outline, and the editor's rule for
which boxes a connection may join. Used when reading files
(app.diagram_format), checking saves (app.diagram_changes) and rights
(app.box_rights), and naming boxes and connections for ADRs and grants."""

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Flat:
    """A diagram's outline by id: each box's parent and title, and each
    connection's ends and label. Enough to tell what is inside what, and to
    name things."""

    root_id: str
    parent: dict[str, str | None] = field(default_factory=dict)
    title: dict[str, str] = field(default_factory=dict)
    children: dict[str, list[str]] = field(default_factory=dict)
    # {"from", "to", "label"} by connection id.
    edges: dict[str, dict[str, Any]] = field(default_factory=dict)

    @classmethod
    def of(
        cls,
        boxes: Iterable[tuple[str, str | None, str]],
        edges: Iterable[tuple[str, str, str, str | None]] = (),
    ) -> "Flat":
        """From (id, parent_id, title) of every box and (id, from, to, label)
        of every connection."""
        flat = cls("")
        for box_id, parent_id, title in boxes:
            flat.add(box_id, parent_id, title)
        for edge_id, source, target, label in edges:
            flat.edges[edge_id] = {"from": source, "to": target, "label": label}
        return flat

    def add(self, box_id: str, parent_id: str | None, title: str) -> None:
        if parent_id is None:
            self.root_id = box_id
        else:
            self.children.setdefault(parent_id, []).append(box_id)
        self.parent[box_id] = parent_id
        self.title[box_id] = title
        self.children.setdefault(box_id, [])

    def ancestors(self, node_id: str) -> list[str]:
        """Nearest first, up to the root; not including the box itself."""
        found = []
        current = self.parent.get(node_id)
        while current is not None:
            found.append(current)
            current = self.parent.get(current)
        return found

    def descendants(self, node_id: str) -> list[str]:
        found, stack = [], list(self.children.get(node_id, []))
        while stack:
            current = stack.pop()
            found.append(current)
            stack.extend(self.children.get(current, []))
        return found

    def lowest_common_ancestor(self, a: str, b: str) -> str | None:
        """The deepest box holding both, not counting either itself: the
        canvas a connection between them is on."""
        above_b = set(self.ancestors(b))
        return next((box for box in self.ancestors(a) if box in above_b), None)


def connection_problem(flat: Flat, source: str, target: str) -> str | None:
    """Why the editor would not connect the two boxes, or None. As
    connectionProblem in frontend/src/model/queries.ts."""
    if source == target:
        return "a box cannot connect to itself"
    if source in flat.ancestors(target) or target in flat.ancestors(source):
        return "a box cannot connect to a box nested inside it"
    return None
