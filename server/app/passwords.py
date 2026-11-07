"""Password hashing (argon2id). Hashing is slow on purpose, so the async
helpers run it in a worker thread instead of blocking the event loop."""

import asyncio

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

# argon2-cffi's defaults follow RFC 9106's low-memory recommendation.
_hasher = PasswordHasher()

# Checked against when the email is unknown, so a wrong email takes as long
# as a wrong password and the timing does not reveal which accounts exist.
_DUMMY_HASH = _hasher.hash("nestboard-dummy-password")


async def hash_password(password: str) -> str:
    return await asyncio.to_thread(_hasher.hash, password)


async def verify_password(password_hash: str | None, password: str) -> bool:
    """`password_hash` None means no such account: does the same work, and
    always fails."""
    try:
        matches = await asyncio.to_thread(_hasher.verify, password_hash or _DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        return False
    return matches and password_hash is not None


def needs_rehash(password_hash: str) -> bool:
    """True once the hash was made with older, weaker parameters."""
    return _hasher.check_needs_rehash(password_hash)
