// An organization's people: members, invitation links and groups (see
// server/README.md, "组织" and "组").

import { request } from "./client";
import type { OrgRole } from "./orgs";

export interface Person {
  id: string;
  email: string;
  display_name: string;
}

export interface Member {
  user: Person;
  role: OrgRole;
  /** Job title, for show only. */
  title: string;
  /** Always true for owners and admins. */
  can_create_projects: boolean;
  joined_at: string;
}

const org = (id: string) => `/orgs/${encodeURIComponent(id)}`;

export const listMembers = (orgId: string) => request<Member[]>("GET", `${org(orgId)}/members`);

/** `role` needs an owner; `title` and `can_create_projects` an admin. */
export const updateMember = (
  orgId: string,
  userId: string,
  change: { role?: OrgRole; title?: string; can_create_projects?: boolean },
) => request<Member>("PATCH", `${org(orgId)}/members/${encodeURIComponent(userId)}`, change);

/** Your own id leaves the organization. */
export const removeMember = (orgId: string, userId: string) =>
  request<void>("DELETE", `${org(orgId)}/members/${encodeURIComponent(userId)}`);

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface Invitation {
  id: string;
  status: InvitationStatus;
  role: OrgRole;
  title: string;
  can_create_projects: boolean;
  /** If set, only this address can use the link. */
  email: string | null;
  invited_by: Person | null;
  created_at: string;
  expires_at: string;
  accepted_by: Person | null;
  accepted_at: string | null;
}

export const listInvitations = (orgId: string) => request<Invitation[]>("GET", `${org(orgId)}/invitations`);

/** The `token` comes back only here: the link is /invite/<token>. */
export const createInvitation = (
  orgId: string,
  invite: { role?: OrgRole; title?: string; can_create_projects?: boolean; email?: string; expires_in_days?: number },
) => request<Invitation & { token: string }>("POST", `${org(orgId)}/invitations`, invite);

export const revokeInvitation = (orgId: string, id: string) =>
  request<void>("DELETE", `${org(orgId)}/invitations/${encodeURIComponent(id)}`);

export interface Group {
  id: string;
  name: string;
  description: string;
  /** `null` for a top-level group. */
  parent_id: string | null;
  version: number;
  /** People directly in it (not its subgroups). */
  member_count: number;
  /** You may change it, its members and its subgroups. */
  can_manage: boolean;
}

export interface GroupMember {
  user: Person;
  /** Their job title in the organization. */
  title: string;
  is_lead: boolean;
  /** In this group itself, not only through a subgroup. */
  direct: boolean;
  /** The subgroups through which they count. */
  via: { id: string; name: string }[];
}

const group = (orgId: string, id: string) => `${org(orgId)}/groups/${encodeURIComponent(id)}`;

/** Every group of the organization, flat: `parent_id` makes the tree. */
export const listGroups = (orgId: string) => request<Group[]>("GET", `${org(orgId)}/groups`);

export const createGroup = (orgId: string, name: string, parentId: string | null, description = "") =>
  request<Group>("POST", `${org(orgId)}/groups`, { name, description, parent_id: parentId });

/** `parent_id: null` moves it to the top level; leave it out to keep it where it is. */
export const updateGroup = (
  orgId: string,
  id: string,
  version: number,
  change: { name?: string; description?: string; parent_id?: string | null },
) => request<Group>("PATCH", group(orgId, id), { version, ...change });

export const deleteGroup = (orgId: string, id: string) => request<void>("DELETE", group(orgId, id));

export const listGroupMembers = (orgId: string, id: string, includeSubgroups = false) =>
  request<GroupMember[]>("GET", `${group(orgId, id)}/members${includeSubgroups ? "?include_subgroups=true" : ""}`);

/** Adds them, or changes whether they lead it. */
export const setGroupMember = (orgId: string, id: string, userId: string, isLead = false) =>
  request<GroupMember>("PUT", `${group(orgId, id)}/members/${encodeURIComponent(userId)}`, { is_lead: isLead });

export const removeGroupMember = (orgId: string, id: string, userId: string) =>
  request<void>("DELETE", `${group(orgId, id)}/members/${encodeURIComponent(userId)}`);

/** "Engineering › Platform › Payments": a group after the groups above it. */
export function groupPath(groups: Group[], id: string): string {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const names: string[] = [];
  for (let g = byId.get(id); g; g = g.parent_id ? byId.get(g.parent_id) : undefined) names.unshift(g.name);
  return names.join(" › ");
}
