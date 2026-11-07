"""Writing Python values as Typst code. Strings always become Typst string
literals, never markup, so a title like "#set *x*" is shown as it is."""

from typing import Any


class Code(str):
    """Typst code, written as it is."""


def value(v: Any) -> str:
    """A Python value as a Typst value."""
    if isinstance(v, Code):
        return str(v)
    if v is None:
        return "none"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int | float):
        return num(v)
    if isinstance(v, str):
        escaped = v.replace("\\", "\\\\").replace('"', '\\"')
        escaped = escaped.replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
        return f'"{escaped}"'
    if isinstance(v, dict):
        if not v:
            return "(:)"
        return "(" + ", ".join(f"{k}: {value(item)}" for k, item in v.items()) + ")"
    if isinstance(v, list | tuple):
        items = [value(item) for item in v]
        return "(" + ", ".join(items) + ("," if len(items) == 1 else "") + ")"
    raise TypeError(f"Cannot write {v!r} as Typst")


def call(name: str, *args: Any, **options: Any) -> str:
    """A function call; option names are written with dashes (max_width → max-width)."""
    parts = [value(a) for a in args] + [
        f"{key.replace('_', '-')}: {value(v)}" for key, v in options.items()
    ]
    return f"{name}({', '.join(parts)})"


def block(lines: list[str]) -> str:
    """A code block: its lines' results joined."""
    return "{\n" + "".join(f"  {line}\n" for line in lines) + "}"


def pt(v: float) -> Code:
    return Code(f"{num(v)}pt")


def num(v: float) -> str:
    if isinstance(v, int) or float(v).is_integer():
        return str(int(v))
    return f"{v:.3f}".rstrip("0").rstrip(".")
