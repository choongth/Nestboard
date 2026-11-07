"""Who may change which part of a diagram, and whether a save stays inside
what its sender may change. No database here: callers pass in the grants.

A grant on a box covers the box and everything inside it. Someone's role at
a box is the highest of their project-wide role and the grants on the box
and on every box above it. The root canvas is not a box: there only the
project-wide role counts.

A save names what it changes (app.diagram_changes works that out), and each
change is checked:

- adding or deleting a box changes the box it sits in: Editor there;
- dragging a box around on its canvas: Editor of the box it sits in;
- renaming a box, or changing its type, technology or description: Editor
  of the box itself (so whoever looks after a box can name it);
- moving the external boxes shown inside a box (its spots): Editor of the
  box itself, as it is that box's canvas; spots dropped because their box was
  deleted do not count;
- a box that has grants of its own is deleted only by an Owner of the box
  above it, so nobody can remove the box they were given;
- adding, changing or deleting a connection: Editor of either end; for one
  between boxes on different levels, Editor of the box either end sits in
  (so whoever may only edit Cart, inside Shop, cannot connect it to anything
  outside Shop: that is for an editor of Shop).

Boxes never move into another box (see app.models.Box.parent_id), so there
is no rule for that.
"""

from collections.abc import Iterable
from dataclasses import dataclass

from app.diagram_tree import Flat
from app.models import ProjectRole
from app.services.organizations import NotAllowed

RANK = {ProjectRole.VIEWER: 0, ProjectRole.EDITOR: 1, ProjectRole.OWNER: 2}


def at_least(role: ProjectRole, needed: ProjectRole) -> bool:
    return RANK[role] >= RANK[needed]


class OutsideYourPart(NotAllowed):
    code = "outside_your_part"


@dataclass
class Rights:
    """One user's roles in one diagram."""

    project_role: ProjectRole
    # Roles from grants on boxes that apply to the user, by box id.
    box_roles: dict[str, ProjectRole]

    def role_at(self, flat: Flat, node_id: str | None) -> ProjectRole:
        """The role at a box (None or the root: the canvas outside every box)."""
        role = self.project_role
        if node_id is None:
            return role
        for box in [node_id, *flat.ancestors(node_id)]:
            granted = self.box_roles.get(box)
            if granted is not None and RANK[granted] > RANK[role]:
                role = granted
        return role

    def can(self, flat: Flat, node_id: str | None, role: ProjectRole) -> bool:
        return at_least(self.role_at(flat, node_id), role)


@dataclass(frozen=True)
class BoxChange:
    """What a save changes about one box that is still there afterwards."""

    id: str
    added: bool = False
    # Dragged around on its canvas.
    moved: bool = False
    # Its title, type, technology or description.
    edited: bool = False
    # Where external boxes sit on its canvas.
    arranged: bool = False


# A connection's (from, to), before or after a save; None where it does not exist.
Ends = tuple[str, str] | None


def _name(flat: Flat, node_id: str | None) -> str:
    if node_id is None or node_id == flat.root_id:
        return "the top level"
    return f'"{flat.title.get(node_id, node_id)}"'


def _refuse(message: str, box_id: str, need: ProjectRole) -> OutsideYourPart:
    return OutsideYourPart(message, {"box_id": box_id, "needs": need.value})


def check_changes(
    rights: Rights,
    granted: Iterable[str],
    before: Flat,
    after: Flat,
    removed: Iterable[str],
    boxes: Iterable[BoxChange],
    edges: Iterable[tuple[Ends, Ends]],
) -> None:
    """Raises OutsideYourPart at the first change the user may not make.

    `granted`: the boxes of this diagram that have any grant at all.
    `removed`: every box the save deletes, those inside deleted boxes too.
    `edges`: each connection the save adds, changes or deletes, as it was
    and as it is (connections deleted with their boxes need not be listed).
    """
    if rights.project_role == ProjectRole.OWNER:
        return  # an owner of the project may change anything
    has_grants = set(granted)
    editor, owner = ProjectRole.EDITOR, ProjectRole.OWNER

    for box in removed:
        parent = before.parent[box]
        if not rights.can(before, parent, editor):
            raise _refuse(f"You may not delete {_name(before, box)}.", box, editor)
        if box in has_grants and not rights.can(before, parent, owner):
            raise _refuse(
                f"{_name(before, box)} has access of its own: only an owner of "
                f"{_name(before, parent)} may delete it.",
                box,
                owner,
            )

    for change in boxes:
        box, parent = change.id, after.parent[change.id]
        if change.added:
            if not rights.can(after, parent, editor):
                raise _refuse(f"You may not add boxes to {_name(after, parent)}.", box, editor)
            continue
        if change.moved and not rights.can(after, parent, editor):
            raise _refuse(
                f"You may not move {_name(after, box)} around in {_name(after, parent)}.",
                box,
                editor,
            )
        if change.edited and not rights.can(after, box, editor):
            raise _refuse(f"You may not change {_name(before, box)}.", box, editor)
        if change.arranged and not rights.can(after, box, editor):
            raise _refuse(
                f"You may not move the boxes from other levels inside {_name(before, box)}.",
                box,
                editor,
            )

    for was, now in edges:
        # The connection as it was and as it is now each need an end the
        # user may edit.
        for ends, flat in ((was, before), (now, after)):
            if ends is None:
                continue
            source, target = ends
            levels = flat.parent[source], flat.parent[target]
            if levels[0] != levels[1]:
                if not (rights.can(flat, levels[0], editor) or rights.can(flat, levels[1], editor)):
                    raise _refuse(
                        f"The connection between {_name(flat, source)} and {_name(flat, target)} "
                        f"crosses levels: it needs an editor of {_name(flat, levels[0])} "
                        f"or of {_name(flat, levels[1])}.",
                        source,
                        editor,
                    )
            elif not (rights.can(flat, source, editor) or rights.can(flat, target, editor)):
                raise _refuse(
                    "You may not change the connection between "
                    f"{_name(flat, source)} and {_name(flat, target)}: "
                    "you can edit neither end.",
                    source,
                    editor,
                )
