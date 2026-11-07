"""One error shape for every failure the API reports:

    {"error": {"code": "diagram_not_found", "message": "...", "details": {...}}}

`code` is stable and meant for programs (the frontend, the AI integration);
`message` is a readable English sentence.
"""

from collections.abc import Sequence
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    status_code = status.HTTP_400_BAD_REQUEST
    code = "bad_request"

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details


class NotFound(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"


class Conflict(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "conflict"


class VersionConflict(Conflict):
    """A write named a version that is no longer current: someone else changed
    the record in between. The client should reload and retry."""

    code = "version_conflict"


class Invalid(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    code = "invalid"


class Unauthorized(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "unauthorized"


class Forbidden(AppError):
    """Signed in and allowed to see the thing, but not to do this to it."""

    status_code = status.HTTP_403_FORBIDDEN
    code = "forbidden"


class Gone(AppError):
    status_code = status.HTTP_410_GONE
    code = "gone"


class TooManyRequests(AppError):
    """Try again in `retry_after` seconds (also sent as the Retry-After header)."""

    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "too_many_requests"

    def __init__(self, message: str, retry_after: int) -> None:
        super().__init__(message, {"retry_after": retry_after})
        self.headers = {"Retry-After": str(retry_after)}


class ErrorDetail(BaseModel):
    code: str = Field(description="Stable, for programs, e.g. `version_conflict`.")
    message: str = Field(description="A readable English sentence.")
    details: Any = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


# For the API description: the error responses every route can give.
ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse, "description": "Not found"},
    409: {"model": ErrorResponse, "description": "Conflict with the current state"},
    413: {"model": ErrorResponse, "description": "Request body too large"},
    422: {"model": ErrorResponse, "description": "Invalid request"},
}
# Added by the routes that need a signed-in user.
SIGNED_IN_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse, "description": "Not signed in, or the session has ended"},
}
# ...and those that also depend on the user's role.
ROLE_RESPONSES: dict[int | str, dict[str, Any]] = {
    **SIGNED_IN_RESPONSES,
    403: {"model": ErrorResponse, "description": "Your role does not allow this"},
}


def error_body(code: str, message: str, details: Any = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    return {"error": error}


def issues(errors: Sequence[Any]) -> dict[str, Any]:
    """`details` for validation_failed: where each problem is, and what."""
    return {
        "issues": [
            {"location": ".".join(str(part) for part in e["loc"]), "message": e["msg"]}
            for e in errors
        ]
    }


async def _app_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)
    return JSONResponse(
        error_body(exc.code, exc.message, exc.details),
        status_code=exc.status_code,
        headers=getattr(exc, "headers", None),
    )


async def _validation_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    return JSONResponse(
        error_body("validation_failed", "The request is not valid.", issues(exc.errors())),
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
    )


async def _http_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
    return JSONResponse(
        error_body(code, str(exc.detail)), status_code=exc.status_code, headers=exc.headers
    )


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)
