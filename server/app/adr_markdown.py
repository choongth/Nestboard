"""Renders ADRs as Markdown files in Michael Nygard's format, following the
conventions of adr-tools (https://github.com/npryce/adr-tools), so an exported
folder of ADRs can live in a Git repository next to the code.

    # 2. Use PostgreSQL

    Date: 2026-10-26

    ## Status

    Accepted

    Proposed by Bob (Developer). Accepted by Alice (Architect).

    Supersedes [1. Use MySQL](0001-use-mysql.md)

    ## Context
    ...
"""

import re
from datetime import UTC, datetime
from typing import Any

from app.models import RelationKind

# How each relation reads from the ADR that has it, and from its target.
_OUTGOING = {
    RelationKind.SUPERSEDES: "Supersedes",
    RelationKind.AMENDS: "Amends",
    RelationKind.RELATES_TO: "Relates to",
}
_INCOMING = {
    RelationKind.SUPERSEDES: "Superseded by",
    RelationKind.AMENDS: "Amended by",
    RelationKind.RELATES_TO: "Relates to",
}
_LINK_KINDS = {"box": "Box", "connection": "Connection"}


def filename(number: int, title: str) -> str:
    """e.g. 0007-use-postgresql.md. Letters of any script are kept, so a
    Chinese title still gives a readable name."""
    slug = re.sub(r"[\W_]+", "-", title.lower()).strip("-")[:60].rstrip("-")
    return f"{number:04d}-{slug or 'decision'}.md"


def render(adr: dict[str, Any]) -> str:
    """`adr` is the full view from services.adrs.describe."""
    date: datetime = adr["decided_at"] or adr["created_at"]
    parts = [
        f"# {adr['number']}. {_one_line(adr['title'])}",
        f"Date: {date.astimezone(UTC).date().isoformat()}",
        "## Status",
        str(adr["status"]).capitalize(),
    ]
    people = _people(adr)
    if people:
        parts.append(people)
    relation_lines = [
        f"{_OUTGOING[RelationKind(r['kind'])]} {_link(r)}" for r in adr["relations"]
    ] + [f"{_INCOMING[RelationKind(r['kind'])]} {_link(r)}" for r in adr["referenced_by"]]
    if relation_lines:
        parts.append("\n\n".join(relation_lines))
    parts.append("## Context")
    if adr["context"].strip():
        parts.append(adr["context"].strip("\n"))
    parts.append("## Decision")
    if adr["decisions"]:
        parts.append(_bullets(adr["decisions"]))
    parts.append("## Consequences")
    for heading, key in (
        ("Positive", "positive_consequences"),
        ("Negative", "negative_consequences"),
    ):
        if adr[key]:
            parts.append(f"### {heading}")
            parts.append(_bullets(adr[key]))
    if adr["links"]:
        parts.append("## Diagram elements")
        parts.append("\n".join(_element(link) for link in adr["links"]))
    return "\n\n".join(parts) + "\n"


def _people(adr: dict[str, Any]) -> str:
    """Who proposed and who decided it, e.g. "Proposed by Bob (Developer).
    Accepted by Alice (Architect)." Empty if not known."""
    sentences = []
    if adr.get("proposed_by"):
        sentences.append(f"Proposed by {_person(adr['proposed_by'])}.")
    if adr.get("decided_by"):
        verb = "Rejected" if adr["status"] == "rejected" else "Accepted"
        sentences.append(f"{verb} by {_person(adr['decided_by'])}.")
    return " ".join(sentences)


def _person(author: dict[str, Any]) -> str:
    name = _one_line(author["name"])
    return f"{name} ({_one_line(author['title'])})" if author.get("title") else name


def _bullets(items: list[str]) -> str:
    """A Markdown list; an item's later lines are indented to stay inside it."""
    return "\n".join("- " + item.strip().replace("\n", "\n  ") for item in items)


def _link(related: dict[str, Any]) -> str:
    number = int(related["ref"].removeprefix("ADR-"))
    text = f"{number}. {_one_line(related['title'])}".replace("[", r"\[").replace("]", r"\]")
    return f"[{text}]({filename(number, related['title'])})"


def _element(link: dict[str, Any]) -> str:
    line = f"- {_LINK_KINDS[link['kind']]}: {_one_line(link['title'])}"
    return line + (" (no longer in the diagram)" if link["orphaned"] else "")


def _one_line(text: str) -> str:
    return " ".join(text.split())
