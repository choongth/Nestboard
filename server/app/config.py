from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Read from NESTBOARD_* environment variables, then from server/.env."""

    model_config = SettingsConfigDict(env_prefix="NESTBOARD_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://nestboard:nestboard@localhost:5432/nestboard"
    test_database_url: str = (
        "postgresql+asyncpg://nestboard:nestboard@localhost:5432/nestboard_test"
    )
    cors_origins: list[str] = ["http://localhost:5173"]
    # Largest request body accepted. A diagram this big would hold tens of
    # thousands of boxes.
    max_request_bytes: int = 5_000_000
    # Pooled connections are tied to the event loop that opened them; turn
    # pooling off for callers that start a new loop per task.
    db_pool: bool = True
    # A session ends after this many days without use.
    session_days: int = 30
    # Send the session cookie over HTTPS only. Turn on whenever the server is
    # reached over HTTPS; off by default so http://localhost works.
    cookie_secure: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
