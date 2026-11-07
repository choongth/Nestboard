// Organizations, invitations and projects (see server/README.md, "组织").

import type { User } from "./auth";
import { request } from "./client";

export type OrgRole = "owner" | "admin" | "member";
export type ProjectRole = "viewer" | "editor" | "owner";

export interface Organization {
  id: string;
  name: string;
  version: number;
  /** The signed-in user's place in it. */
  membership: { role: OrgRole; title: string; can_create_projects: boolean };
}

export interface Project {
  id: string;
  org_id: string;
  name: string;
  version: number;
  updated_at: string;
  /** `null` only for org admins without a grant: they see the name, not the content. */
  role: ProjectRole | null;
}

export interface ProjectDetail extends Project {
  role: ProjectRole;
  organization: { id: string; name: string };
}

export const listOrgs = () => request<Organization[]>("GET", "/orgs");

/** Instance admin only. */
export const createOrg = (name: string) => request<Organization>("POST", "/orgs", { name });

export const listProjects = (orgId: string) =>
  request<Project[]>("GET", `/orgs/${encodeURIComponent(orgId)}/projects`);

export const createProject = (orgId: string, name: string) =>
  request<ProjectDetail>("POST", `/orgs/${encodeURIComponent(orgId)}/projects`, { name });

export const getProject = (id: string) => request<ProjectDetail>("GET", `/projects/${encodeURIComponent(id)}`);

/** Project owners only. */
export const renameProject = (id: string, version: number, name: string) =>
  request<ProjectDetail>("PATCH", `/projects/${encodeURIComponent(id)}`, { version, name });

/** Project owners only: its diagrams and ADRs go with it. */
export const deleteProject = (id: string) => request<void>("DELETE", `/projects/${encodeURIComponent(id)}`);

/** Organization owners only. */
export const renameOrg = (id: string, version: number, name: string) =>
  request<Organization>("PATCH", `/orgs/${encodeURIComponent(id)}`, { version, name });

/** Organization owners only: everything in it goes. */
export const deleteOrg = (id: string) => request<void>("DELETE", `/orgs/${encodeURIComponent(id)}`);

export interface InvitationPreview {
  organization: { id: string; name: string };
  role: OrgRole;
  title: string;
  /** If set, only this address can use the link. */
  email: string | null;
  invited_by: string | null;
  expires_at: string;
}

const invitation = (token: string) => `/invitations/${encodeURIComponent(token)}`;

export const previewInvitation = (token: string) => request<InvitationPreview>("GET", invitation(token));

export const acceptInvitation = (token: string) => request<Organization>("POST", `${invitation(token)}/accept`);

export const signUpWithInvitation = (token: string, email: string, displayName: string, password: string) =>
  request<{ user: User; organization: Organization }>("POST", `${invitation(token)}/sign-up`, {
    email,
    display_name: displayName,
    password,
  });
