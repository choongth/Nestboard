import json
from dataclasses import asdict
from pathlib import Path

import pytest

from app.pdf_export import visuals
from app.pdf_export.visuals import (
    ColorLogo,
    Logo,
    Monogram,
    box_type,
    edge_type,
    monogram,
    technology_mark,
)

# Written by the editor's own code: frontend/src/serverFiles.test.ts.
EDITOR = json.loads(
    (Path(__file__).parent / "fixtures" / "editor_layout.json").read_text(encoding="utf-8")
)


def as_editor(mark):
    """A mark in the editor's shape: {"kind": "logo" | "color" | "monogram", ...}."""
    if mark is None:
        return None
    if isinstance(mark, ColorLogo):
        # The editor names the drawing by its key; the server holds the drawing itself.
        return {"kind": "color", "title": mark.title, "key": mark.key, "backing": mark.backing}
    kind = "logo" if isinstance(mark, Logo) else "monogram"
    return {"kind": kind, **asdict(mark)}


@pytest.mark.parametrize("case", EDITOR["technologies"], ids=lambda c: repr(c["text"]))
def test_technology_marks_match_the_editor(case):
    assert as_editor(technology_mark(case["text"])) == case["onBox"]
    assert as_editor(technology_mark(case["text"], on_note=True)) == case["onNote"]


def test_monograms_match_the_editor():
    assert {text: monogram(text) for text in EDITOR["monograms"]} == EDITOR["monograms"]


def test_no_technology_shows_nothing():
    assert technology_mark(None) is None
    assert isinstance(technology_mark("HAProxy"), Monogram)


def test_box_types_resolve_like_the_editor():
    db = box_type("relational-db")
    assert (db.type.label, db.known) == ("Relational Database", True)
    assert db.type.category.color.startswith("#")

    missing = box_type(None)
    assert (missing.type.id, missing.known) == ("generic", True)

    unknown = box_type("made-up-type")
    assert (unknown.type.id, unknown.known, unknown.stored_id) == ("generic", False, "made-up-type")


def test_edge_types_carry_their_line_style():
    read = edge_type("read")
    assert read.type.verb == "Reads from"
    assert (read.type.style.stroke, read.type.style.start, read.type.style.end) == (
        "dotted",
        "arrow",
        "none",
    )
    assert edge_type(None).type.id == "generic"
    assert edge_type("nope").known is False


def test_every_type_has_an_icon():
    keys = [box_type(t).type.icon for t in visuals._BOX_TYPES] + [
        edge_type(t).type.icon for t in visuals._EDGE_TYPES
    ]
    for key in keys:
        assert visuals.icon(key) != visuals.icon("not-an-icon") or key == "box", key
    assert "<path" in visuals.icon("not-an-icon")
    assert visuals.icon("layers")


def test_theme_colours_are_there():
    for name in ("canvas", "surface", "surface-raised", "line", "fg", "connection", "note"):
        assert visuals.COLORS[name].startswith(("#", "rgb")), name
