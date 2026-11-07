"""Groups in an organization: teams that nest. Free of HTTP concerns.

- Each group has at most one parent, at most MAX_DEPTH levels deep, and
  never sits inside itself.
- Being in a group also counts as being in every group above it, so later
  a grant to Engineering covers everyone in Engineering ▸ Platform.
- Org admins manage every group. A group's leads manage it and every group
  below it: its members and leads, its name, and its subgroups. Creating,
  moving or deleting a group changes the level above it, so that needs
  someone who manages that level (an org admin, for top-level groups).
- A group with subgroups cannot be deleted.

Every member of the organization can see all of its groups and who is in
them. Changes to the shape of the tree lock the organization's row, so two
moves at once cannot build a loop.
"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import live
from app.errors import Conflict, Invalid, NotFound
from app.models import Group, GroupMember, OrgMembership, OrgRole, User
from app.services import organizations, versions
from app.services.organizations import MemberNotFound, NotAllowed

MAX_DEPTH = 10


class GroupNotFound(NotFound):
    code = "group_not_found"


class NotInGroup(NotFound):
    code = "not_in_group"


class GroupNameTaken(Conflict):
    code = "group_name_taken"


class GroupHasSubgroups(Conflict):
    code = "group_has_subgroups"


class GroupLoop(Invalid):
    code = "group_loop"


class GroupTooDeep(Invalid):
    code = "group_too_deep"


@dataclass
class Tree:
    """The organization's groups as parent links, for walking up and down."""

    parent: dict[uuid.UUID, uuid.UUID | None]
    children: dict[uuid.UUID, list[uuid.UUID]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for group_id, parent_id in self.parent.items():
            if parent_id is not None:
                self.children.setdefault(parent_id, []).append(group_id)

    def __contains__(self, group_id: uuid.UUID) -> bool:
        return group_id in self.parent

    def ancestors(self, group_id: uuid.UUID) -> list[uuid.UUID]:
        """Nearest first; not including the group itself."""
        found: list[uuid.UUID] = []
        current = self.parent.get(group_id)
        while current is not None and current not in found:
            found.append(current)
            current = self.parent.get(current)
        return found

    def descendants(self, group_id: uuid.UUID) -> set[uuid.UUID]:
        found: set[uuid.UUID] = set()
        stack = list(self.children.get(group_id, []))
        while stack:
            current = stack.pop()
            if current not in found:
                found.add(current)
                stack.extend(self.children.get(current, []))
        return found

    def depth(self, group_id: uuid.UUID) -> int:
        """1 for a top-level group."""
        return len(self.ancestors(group_id)) + 1

    def height(self, group_id: uuid.UUID) -> int:
        """Levels from the group down to its deepest subgroup; 1 if it has none."""
        return 1 + max((self.height(c) for c in self.children.get(group_id, [])), default=0)

    def with_ancestors(self, group_ids: Iterable[uuid.UUID]) -> set[uuid.UUID]:
        found: set[uuid.UUID] = set()
        for group_id in group_ids:
            found.add(group_id)
            found.update(self.ancestors(group_id))
        return found


async def load_tree(session: AsyncSession, org_id: uuid.UUID) -> Tree:
    rows = await session.execute(select(Group.id, Group.parent_id).where(Group.org_id == org_id))
    return Tree({group_id: parent_id for group_id, parent_id in rows})


async def effective_group_ids(
    session: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID
) -> set[uuid.UUID]:
    """Every group the user counts as a member of: the ones they are in, and
    all the groups above those."""
    direct = await session.scalars(
        select(GroupMember.group_id)
        .join(Group, Group.id == GroupMember.group_id)
        .where(Group.org_id == org_id, GroupMember.user_id == user_id)
    )
    return (await load_tree(session, org_id)).with_ancestors(direct)


@dataclass
class _Context:
    membership: OrgMembership
    tree: Tree
    # Groups the user leads directly.
    leads: set[uuid.UUID]

    def can_manage(self, group_id: uuid.UUID) -> bool:
        if organizations.at_least(self.membership, OrgRole.ADMIN):
            return True
        return any(g in self.leads for g in [group_id, *self.tree.ancestors(group_id)])

    def can_manage_level(self, parent_id: uuid.UUID | None) -> bool:
        """May add or take away groups directly under `parent_id` (None: the
        top level)."""
        if parent_id is None:
            return organizations.at_least(self.membership, OrgRole.ADMIN)
        return self.can_manage(parent_id)

    def require(self, allowed: bool, doing: str) -> None:
        if not allowed:
            raise NotAllowed(
                f"Only org admins and leads of this group or a group above it can {doing}.",
                {"role": self.membership.role},
            )

    def check(self, group_id: uuid.UUID) -> None:
        if group_id not in self.tree:
            raise GroupNotFound(f"Group {group_id} does not exist in this organization.")


async def _context(
    session: AsyncSession, org_id: uuid.UUID, user: User, *, lock: bool = False
) -> _Context:
    _, membership = await organizations.get(session, org_id, user, lock=lock)
    leads = await session.scalars(
        select(GroupMember.group_id)
        .join(Group, Group.id == GroupMember.group_id)
        .where(Group.org_id == org_id, GroupMember.user_id == user.id, GroupMember.is_lead)
    )
    return _Context(membership, await load_tree(session, org_id), set(leads))


async def _group(session: AsyncSession, ctx: _Context, group_id: uuid.UUID) -> Group:
    ctx.check(group_id)
    group = await session.get(Group, group_id)
    assert group is not None
    return group


def _name_taken(name: str) -> GroupNameTaken:
    return GroupNameTaken(
        f'There is already a group called "{name}" here. Names must differ between '
        "groups with the same parent.",
        {"name": name},
    )


# ---- Groups ----


GroupRow = tuple[Group, int, bool]


async def list_groups(session: AsyncSession, org_id: uuid.UUID, user: User) -> list[GroupRow]:
    """Every group in the organization by name, each with its number of
    direct members and whether the user may manage it."""
    ctx = await _context(session, org_id, user)
    counts = (
        select(GroupMember.group_id, func.count().label("n"))
        .group_by(GroupMember.group_id)
        .subquery()
    )
    rows = await session.execute(
        select(Group, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.group_id == Group.id)
        .where(Group.org_id == org_id)
        .order_by(func.lower(Group.name), Group.id)
    )
    return [(group, count, ctx.can_manage(group.id)) for group, count in rows]


async def get_group(
    session: AsyncSession, org_id: uuid.UUID, user: User, group_id: uuid.UUID
) -> tuple[Group, int, bool, list[Group]]:
    """The group, its direct member count, whether the user may manage it,
    and the groups above it (top first)."""
    ctx = await _context(session, org_id, user)
    group = await _group(session, ctx, group_id)
    count = await session.scalar(
        select(func.count()).select_from(GroupMember).where(GroupMember.group_id == group_id)
    )
    above = list(reversed(ctx.tree.ancestors(group_id)))
    path = {g.id: g for g in await session.scalars(select(Group).where(Group.id.in_(above)))}
    return group, count or 0, ctx.can_manage(group_id), [path[g] for g in above]


async def create_group(
    session: AsyncSession,
    org_id: uuid.UUID,
    user: User,
    name: str,
    description: str,
    parent_id: uuid.UUID | None,
) -> GroupRow:
    ctx = await _context(session, org_id, user, lock=True)
    if parent_id is not None:
        ctx.check(parent_id)
        if ctx.tree.depth(parent_id) >= MAX_DEPTH:
            raise GroupTooDeep(f"Groups can be nested at most {MAX_DEPTH} levels deep.")
    ctx.require(ctx.can_manage_level(parent_id), "add groups here")
    group = Group(org_id=org_id, parent_id=parent_id, name=name, description=description)
    session.add(group)
    try:
        await session.flush()
    except IntegrityError as e:
        await session.rollback()
        raise _name_taken(name) from e
    await session.commit()
    await session.refresh(group)
    return group, 0, True


_UNCHANGED = object()


async def update_group(
    session: AsyncSession,
    org_id: uuid.UUID,
    user: User,
    group_id: uuid.UUID,
    version: int,
    *,
    name: str | None = None,
    description: str | None = None,
    parent_id: uuid.UUID | None | object = _UNCHANGED,
) -> Group:
    """Renames, describes and/or moves the group (`parent_id` None moves it
    to the top level). Moving needs the right to manage both the level it
    leaves and the level it joins."""
    ctx = await _context(session, org_id, user, lock=True)
    group = await _group(session, ctx, group_id)
    ctx.require(ctx.can_manage(group_id), "change this group")
    values: dict[str, object] = {}
    if name is not None:
        values["name"] = name
    if description is not None:
        values["description"] = description
    if parent_id is not _UNCHANGED and parent_id != group.parent_id:
        assert parent_id is None or isinstance(parent_id, uuid.UUID)
        _check_move(ctx, group, parent_id)
        values["parent_id"] = parent_id
    missing = GroupNotFound(f"Group {group_id} does not exist in this organization.")
    try:
        updated = await versions.bump(
            session, Group, group_id, version, "The group", missing, **values
        )
    except IntegrityError as e:
        await session.rollback()
        raise _name_taken(name or group.name) from e
    await session.commit()
    if "parent_id" in values:
        # Its members are now also in the groups above its new place.
        live.hub.access_changed(org_id=org_id)
    await session.refresh(updated)
    return updated


def _check_move(ctx: _Context, group: Group, parent_id: uuid.UUID | None) -> None:
    if parent_id is not None:
        ctx.check(parent_id)
        if parent_id == group.id or parent_id in ctx.tree.descendants(group.id):
            raise GroupLoop("A group cannot be moved into itself or one of its subgroups.")
        if ctx.tree.depth(parent_id) + ctx.tree.height(group.id) > MAX_DEPTH:
            raise GroupTooDeep(
                f"Groups can be nested at most {MAX_DEPTH} levels deep, counting the "
                "subgroups that move along."
            )
    ctx.require(
        ctx.can_manage_level(group.parent_id) and ctx.can_manage_level(parent_id),
        "move this group",
    )


async def delete_group(
    session: AsyncSession, org_id: uuid.UUID, user: User, group_id: uuid.UUID
) -> None:
    """Needs the right to manage the level above it. Its members stay in the
    organization."""
    ctx = await _context(session, org_id, user, lock=True)
    group = await _group(session, ctx, group_id)
    ctx.require(ctx.can_manage_level(group.parent_id), "delete this group")
    if ctx.tree.children.get(group_id):
        raise GroupHasSubgroups(
            "This group has subgroups. Move or delete them first.",
            {"subgroups": len(ctx.tree.children[group_id])},
        )
    await session.delete(group)
    await session.commit()
    live.hub.access_changed(org_id=org_id)


# ---- Members ----


@dataclass
class GroupPerson:
    user: User
    title: str
    is_lead: bool
    # In the group itself, not only through a subgroup.
    direct: bool
    # The subgroups through which they count.
    via: list[Group]


async def list_members(
    session: AsyncSession,
    org_id: uuid.UUID,
    user: User,
    group_id: uuid.UUID,
    *,
    include_subgroups: bool = False,
) -> list[GroupPerson]:
    """The group's members by name. With `include_subgroups`, everyone who
    counts as a member, including through its subgroups."""
    ctx = await _context(session, org_id, user)
    ctx.check(group_id)
    groups = {group_id} | (ctx.tree.descendants(group_id) if include_subgroups else set())
    rows = await session.execute(
        select(GroupMember, User, OrgMembership.title, Group)
        .join(User, User.id == GroupMember.user_id)
        .join(Group, Group.id == GroupMember.group_id)
        .join(
            OrgMembership,
            (OrgMembership.user_id == GroupMember.user_id) & (OrgMembership.org_id == org_id),
        )
        .where(GroupMember.group_id.in_(groups))
        .order_by(func.lower(Group.name), Group.id)
    )
    people: dict[uuid.UUID, GroupPerson] = {}
    for member, person_user, title, group in rows:
        person = people.setdefault(
            person_user.id, GroupPerson(person_user, title, False, False, [])
        )
        if group.id == group_id:
            person.direct = True
            person.is_lead = member.is_lead
        else:
            person.via.append(group)
    return sorted(people.values(), key=lambda p: (p.user.display_name.lower(), p.user.id))


async def set_member(
    session: AsyncSession,
    org_id: uuid.UUID,
    user: User,
    group_id: uuid.UUID,
    target_id: uuid.UUID,
    is_lead: bool,
) -> GroupPerson:
    """Puts an organization member in the group, or changes whether they
    lead it."""
    ctx = await _context(session, org_id, user)
    ctx.check(group_id)
    ctx.require(ctx.can_manage(group_id), "change who is in this group")
    target = await session.get(OrgMembership, (org_id, target_id))
    if target is None:
        raise MemberNotFound(f"User {target_id} is not a member of this organization.")
    await session.execute(
        insert(GroupMember)
        .values(group_id=group_id, user_id=target_id, is_lead=is_lead)
        .on_conflict_do_update(
            index_elements=[GroupMember.group_id, GroupMember.user_id], set_={"is_lead": is_lead}
        )
    )
    await session.commit()
    live.hub.access_changed(org_id=org_id, user_id=target_id)
    person_user = await session.get(User, target_id)
    assert person_user is not None
    return GroupPerson(person_user, target.title, is_lead, True, [])


async def remove_member(
    session: AsyncSession,
    org_id: uuid.UUID,
    user: User,
    group_id: uuid.UUID,
    target_id: uuid.UUID,
) -> None:
    """Takes someone out of the group (not out of its subgroups). Anyone may
    leave a group themselves."""
    ctx = await _context(session, org_id, user)
    ctx.check(group_id)
    if target_id != user.id:
        ctx.require(ctx.can_manage(group_id), "change who is in this group")
    result = await session.execute(
        delete(GroupMember).where(
            GroupMember.group_id == group_id, GroupMember.user_id == target_id
        )
    )
    if result.rowcount == 0:  # type: ignore[attr-defined]
        raise NotInGroup(f"User {target_id} is not directly in this group.")
    await session.commit()
    live.hub.access_changed(org_id=org_id, user_id=target_id)


async def groups_of(
    session: AsyncSession, org_id: uuid.UUID, user: User, target_id: uuid.UUID
) -> list[tuple[Group, bool, bool]]:
    """Every group an organization member counts as being in, by name: with
    whether they are in it directly, and whether they lead it."""
    ctx = await _context(session, org_id, user)
    if await session.get(OrgMembership, (org_id, target_id)) is None:
        raise MemberNotFound(f"User {target_id} is not a member of this organization.")
    direct = {
        group_id: is_lead
        for group_id, is_lead in await session.execute(
            select(GroupMember.group_id, GroupMember.is_lead)
            .join(Group, Group.id == GroupMember.group_id)
            .where(Group.org_id == org_id, GroupMember.user_id == target_id)
        )
    }
    groups = await session.scalars(
        select(Group)
        .where(Group.id.in_(ctx.tree.with_ancestors(direct)))
        .order_by(func.lower(Group.name), Group.id)
    )
    return [(g, g.id in direct, direct.get(g.id, False)) for g in groups]
