from fastapi import APIRouter

from app.api import (
    admin,
    adrs,
    auth,
    diagrams,
    groups,
    health,
    invitations,
    live,
    organizations,
    password_resets,
    projects,
)
from app.errors import ERROR_RESPONSES

router = APIRouter(prefix="/api/v1", responses=ERROR_RESPONSES)
router.include_router(health.router)
router.include_router(auth.router)
router.include_router(password_resets.router)
router.include_router(admin.router)
router.include_router(organizations.router)
router.include_router(groups.router)
router.include_router(projects.router)
router.include_router(invitations.router)
router.include_router(diagrams.router)
router.include_router(live.router)
router.include_router(adrs.router)
