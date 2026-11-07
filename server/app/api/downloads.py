from urllib.parse import quote


def attachment(name: str) -> dict[str, str]:
    """A download header that survives non-ASCII names (RFC 6266 / 5987)."""
    fallback = name.encode("ascii", "replace").decode().replace('"', "'").replace("?", "_")
    return {
        "Content-Disposition": f'attachment; filename="{fallback}"; '
        f"filename*=UTF-8''{quote(name, safe='')}"
    }
