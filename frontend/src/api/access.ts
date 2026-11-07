// Who may do what in a project: grants, the activity log, and your own roles
// in a diagram (see server/README.md, "项目与权限").

import { request } from "./client";
import type { ProjectRole } from "./orgs";
import type { Person } from "./people";

export interface Grant {
  id: string;
  role: ProjectRole;
  /** Exactly one of `user` and `group`. */
  user: Person | null;
  /** Covers everyone in it and its subgroups. */
  group: { id: string; name: string } | null;
  /** Set, with `box_id`, for a grant on a box (and everything inside it). */
  diagram_id: string | null;
  box_id: string | null;
  /** The box's current name; if orphaned, its name when the grant was given. */
  box_title: string | null;
  /** The box has been deleted from the diagram since. */
  orphaned: boolean;
  created_at: string;
}

/** Who a grant is for: a person or a group. */
export type Subject = { user_id: string } | { group_id: string };

const project = (id: string) => `/projects/${encodeURIComponent(id)}`;

/** Project-wide grants first, then grants on boxes. */
export const listGrants = (projectId: string) => request<Grant[]>("GET", `${project(projectId)}/grants`);

/** Gives a role, or changes it: on the whole project, or with `box` on one box. */
export const setGrant = (
  projectId: string,
  subject: Subject,
  role: ProjectRole,
  box?: { diagram_id: string; box_id: string },
) => request<Grant>("PUT", `${project(projectId)}/grants`, { ...subject, role, ...box });

export const removeGrant = (projectId: string, grantId: string) =>
  request<void>("DELETE", `${project(projectId)}/grants/${encodeURIComponent(grantId)}`);

/** An org admin makes themselves an owner; the activity log records it. */
export const takeOver = (projectId: string) => request<unknown>("POST", `${project(projectId)}/take-over`);

export interface Activity {
  id: string;
  kind: "created" | "taken_over" | "grant_set" | "grant_removed";
  /** For grants: role, name, user_id or group_id, and box (its name) for a grant on a box. */
  details: { role?: ProjectRole; name?: string; box?: string; [key: string]: unknown };
  actor: Person | null;
  created_at: string;
}

/** Newest first. */
export const listActivity = (projectId: string) => request<Activity[]>("GET", `${project(projectId)}/activity`);

/** Your roles in one diagram. */
export interface DiagramAccess {
  project_role: ProjectRole;
  /** Grants on boxes that apply to you, the highest per box. */
  box_roles: Record<string, ProjectRole>;
}

export const getDiagramAccess = (diagramId: string) =>
  request<DiagramAccess>("GET", `/diagrams/${encodeURIComponent(diagramId)}/access`);
