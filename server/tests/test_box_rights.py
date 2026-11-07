"""What a save may change, given someone's roles (app.box_rights)."""

import copy

import pytest

from app.box_rights import BoxChange, OutsideYourPart, Rights, check_changes
from app.diagram_tree import Flat
from app.models import ProjectRole

VIEWER, EDITOR, OWNER = ProjectRole.VIEWER, ProjectRole.EDITOR, ProjectRole.OWNER

# Shop ▸ Payments ▸ Ledger, Shop ▸ Orders, and Web; Web → Payments, Orders → Ledger.
BEFORE = Flat.of(
    [
        ("root", None, "Root"),
        ("shop", "root", "Shop"),
        ("payments", "shop", "Payments"),
        ("ledger", "payments", "Ledger"),
        ("orders", "shop", "Orders"),
        ("web", "root", "Web"),
    ],
    [("e1", "web", "payments", None), ("e2", "orders", "ledger", None)],
)


def allowed(rights, change, granted=()):
    try:
        check(rights, change, granted)
    except OutsideYourPart:
        return False
    return True


def check(rights, change, granted=()):
    check_changes(
        rights,
        granted,
        BEFORE,
        change.get("after", BEFORE),
        change.get("removed", ()),
        change.get("boxes", ()),
        change.get("edges", ()),
    )


# Bob may edit Payments (and Ledger inside it), and only look at the rest.
BOB = Rights(VIEWER, {"payments": EDITOR})


def add_to(parent):
    after = copy.deepcopy(BEFORE)
    after.add("new", parent, "New")
    return {"after": after, "boxes": [BoxChange("new", added=True)]}


def rename(box_id):
    return {"boxes": [BoxChange(box_id, edited=True)]}


def drag(box_id):
    return {"boxes": [BoxChange(box_id, moved=True)]}


def delete(box_id):
    return {"removed": [box_id, *BEFORE.descendants(box_id)]}


def arrange(box_id):
    """Moves an external box on `box_id`'s canvas."""
    return {"boxes": [BoxChange(box_id, arranged=True)]}


def connect(src, dst):
    return {"edges": [(None, (src, dst))]}


@pytest.mark.parametrize(
    ("change", "ok"),
    [
        (add_to("payments"), True),
        (add_to("ledger"), True),
        (add_to("orders"), False),
        (add_to("root"), False),
        (rename("payments"), True),  # whoever looks after a box names it
        (rename("ledger"), True),
        (rename("orders"), False),
        (rename("root"), False),
        (drag("ledger"), True),  # inside Payments
        (drag("payments"), False),  # on Shop's canvas
        (delete("ledger"), True),
        (delete("payments"), False),  # changes Shop
        (delete("orders"), False),
    ],
)
def test_an_editor_of_a_box_changes_only_inside_it(change, ok):
    assert allowed(BOB, change) is ok


def test_a_connection_needs_one_end_you_may_edit():
    retarget = {"edges": [(("payments", "orders"), ("payments", "shop"))]}

    assert allowed(BOB, connect("orders", "payments"))  # both in Shop
    assert not allowed(BOB, connect("orders", "web"))
    # It may be changed from what Payments' editor may touch, but not into
    # something they may not.
    assert not allowed(BOB, retarget)


def test_a_connection_between_levels_needs_an_editor_of_the_box_an_end_sits_in():
    relabel = {"edges": [(("orders", "ledger"), ("orders", "ledger"))]}
    disconnect = {"edges": [(("web", "payments"), None)]}

    # Ledger sits in Payments, which Bob edits.
    assert allowed(BOB, connect("ledger", "orders"))
    assert allowed(BOB, relabel)
    # Payments sits in Shop, Web at the top level: Bob edits neither.
    assert not allowed(BOB, connect("payments", "web"))
    assert not allowed(BOB, disconnect)
    # Editing Ledger itself is not enough to connect it outside Payments…
    ledger_only = Rights(VIEWER, {"ledger": EDITOR})
    assert not allowed(ledger_only, connect("ledger", "orders"))
    assert not allowed(ledger_only, relabel)
    # …but editing one end is enough on a single level: Orders and Payments are both in Shop.
    assert allowed(Rights(VIEWER, {"orders": EDITOR}), connect("orders", "payments"))
    # An editor of Shop connects anything in it to anything outside it.
    assert allowed(Rights(VIEWER, {"shop": EDITOR}), connect("payments", "web"))


def test_a_refused_connection_between_levels_says_who_may_make_it():
    with pytest.raises(OutsideYourPart) as refused:
        check(BOB, connect("payments", "web"))

    assert '"Shop"' in refused.value.message and "the top level" in refused.value.message


def test_viewers_change_nothing():
    viewer = Rights(VIEWER, {})
    assert not allowed(viewer, add_to("payments"))
    assert allowed(viewer, {})


def test_a_box_with_access_of_its_own_needs_an_owner_above_it():
    granted = {"ledger"}
    assert not allowed(BOB, delete("ledger"), granted)
    assert allowed(Rights(VIEWER, {"payments": OWNER}), delete("ledger"), granted)
    # Leading Ledger is not enough to delete Ledger.
    assert not allowed(Rights(VIEWER, {"ledger": OWNER}), delete("ledger"), granted)


def test_project_editors_change_anything_without_access_of_its_own():
    editor = Rights(EDITOR, {})
    for change in (add_to("root"), rename("root"), delete("shop"), drag("web")):
        assert allowed(editor, change)
    # Ledger, inside Shop, has a grant.
    assert not allowed(editor, delete("shop"), {"ledger"})


def test_project_owners_change_anything():
    assert allowed(Rights(OWNER, {}), delete("shop"), {"ledger"})


def test_the_refusal_names_the_box():
    with pytest.raises(OutsideYourPart) as refused:
        check(BOB, rename("orders"))

    assert refused.value.details == {"box_id": "orders", "needs": "editor"}
    assert '"Orders"' in refused.value.message


def test_external_boxes_inside_a_box_are_moved_by_its_editors():
    # Inside Payments, Orders is an external box (Orders → Ledger leaves it).
    assert allowed(BOB, arrange("payments"))
    assert allowed(BOB, arrange("ledger"))
    assert not allowed(BOB, arrange("shop"))
    assert not allowed(Rights(VIEWER, {}), arrange("payments"))
