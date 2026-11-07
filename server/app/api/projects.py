import uuid

from fastapi import APIRouter, Response, status

from app.auth import CurrentUser
from app.db import SessionDep
from app.errors import ROLE_RESPONSES
from app.schemas.projects import (
    ActivityOut,
    GrantOut,
    GrantSet,
    ProjectCreate,
    ProjectDetail,
    ProjectOut,
    ProjectUpdate,
)
from app.services import projects

router = APIRouter(tags=["projects"], responses=ROLE_RESPONSES)


@router.get("/orgs/{org_id}/projects", response_model=list[ProjectOut])
async def list_projects(org_id: uuid.UUID, user: CurrentUser, session: SessionDep):
    """The projects you have a role in, by name. Org admins see every
    project's name (with `role` null where they have none)."""
    return [ProjectOut.of(*row) for row in await projects.list_for_org(session, org_id, user)]


@router.post(
    "/orgs/{org_id}/projects", response_model=ProjectDetail, status_code=status.HTTP_201_CREATED
)
async def create_project(
    org_id: uuid.UUID, body: ProjectCreate, user: CurrentUser, session: SessionDep
):
    """Needs "can create projects" in the organization. You become its owner."""
    return ProjectDetail.of_access(await projects.create(session, org_id, user, body.name))


@router.get("/projects/{project_id}", response_model=ProjectDetail)
async def get_project(project_id: uuid.UUID, user: CurrentUser, session: SessionDep):
    """404 without a role in it, as if it did not exist."""
    return ProjectDetail.of_access(await projects.access(session, project_id, user))


@router.patch("/projects/{project_id}", response_model=ProjectDetail)
async def update_project(
    project_id: uuid.UUID, body: ProjectUpdate, user: CurrentUser, session: SessionDep
):
    """Owners only. Renames it."""
    return ProjectDetail.of_access(
        await projects.update_project(session, project_id, user, body.version, body.name)
    )


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: uuid.UUID, user: CurrentUser, session: SessionDep):
    """Owners only. Its diagrams and their ADRs go with it."""
    await projects.delete_project(session, project_id, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/projects/{project_id}/take-over", response_model=ProjectDetail)
async def take_over_project(project_id: uuid.UUID, user: CurrentUser, session: SessionDep):
    """Org admins only: makes you an owner of the project. Everyone in the
    project sees this in its activity."""
    return ProjectDetail.of_access(await projects.take_over(session, project_id, user))


# ---- Access ----


@router.get("/projects/{project_id}/grants", response_model=list[GrantOut])
async def list_grants(project_id: uuid.UUID, user: CurrentUser, session: SessionDep):
    """Who has which role: project-wide grants first, then grants on boxes
    (an owner grant on a box is whoever is in charge of it)."""
    return [GrantOut.of(v) for v in await projects.list_grants(session, project_id, user)]


@router.put("/projects/{project_id}/grants", response_model=GrantOut)
async def set_grant(project_id: uuid.UUID, body: GrantSet, user: CurrentUser, session: SessionDep):
    """Gives an organization member or group a role, or changes it.
    Project-wide: project owners only, and the last owner cannot be demoted
    (409 `last_owner`). On a box: owners of the box, a box above it, or the
    project; the box must be in the diagram (422 `unknown_box`)."""
    return GrantOut.of(
        await projects.set_grant(
            session,
            project_id,
            user,
            user_id=body.user_id,
            group_id=body.group_id,
            role=body.role,
            diagram_id=body.diagram_id,
            box_id=body.box_id,
        )
    )


@router.delete("/projects/{project_id}/grants/{grant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_grant(
    project_id: uuid.UUID, grant_id: uuid.UUID, user: CurrentUser, session: SessionDep
):
    """Who may give a grant may take it away (a grant on a deleted box needs
    a project owner). The last project-wide owner cannot be removed (409
    `last_owner`)."""
    await projects.remove_grant(session, project_id, user, grant_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/projects/{project_id}/activity", response_model=list[ActivityOut])
async def list_activity(project_id: uuid.UUID, user: CurrentUser, session: SessionDep):
    """Changes to the project's access, newest first."""
    return [ActivityOut.of(*row) for row in await projects.activity(session, project_id, user)]
