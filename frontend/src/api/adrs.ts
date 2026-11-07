// Architecture decision records on the server (see server/README.md, "ADR").

import { request } from "./client";
import type { ProjectRole } from "./orgs";

export type AdrStatus = "proposed" | "accepted" | "rejected" | "deprecated" | "superseded";
export type LinkKind = "box" | "connection";
export type RelationKind = "supersedes" | "amends" | "relates_to";

/** A box or connection of one of the project's diagrams. */
export interface LinkRef {
  diagram_id: string;
  kind: LinkKind;
  id: string;
}

export interface AdrLink extends LinkRef {
  /** The target's current name; if orphaned, its name when it was linked. */
  title: string;
  /** The target (or its diagram) has been deleted. */
  orphaned: boolean;
}

/** The box an ADR is about. */
export interface AdrScope {
  diagram_id: string;
  box_id: string;
  /** The box's current name; if orphaned, its name then. */
  title: string;
  orphaned: boolean;
}

/** Who made a change, with their job title in the organization then. */
export interface Author {
  user_id: string | null;
  name: string;
  title: string | null;
}

export interface RelatedAdr {
  kind: RelationKind;
  adr_id: string;
  ref: string;
  title: string;
  status: AdrStatus;
}

export interface Adr {
  id: string;
  project_id: string;
  /** `null`: about the whole project. */
  scope: AdrScope | null;
  number: number;
  /** e.g. "ADR-0007". */
  ref: string;
  title: string;
  status: AdrStatus;
  /** Markdown. */
  context: string;
  /** What was decided, one item each (short Markdown). */
  decisions: string[];
  positive_consequences: string[];
  negative_consequences: string[];
  version: number;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
  links: AdrLink[];
  /** Relations from this ADR to others. */
  relations: RelatedAdr[];
  /** Relations from other ADRs to this one. */
  referenced_by: RelatedAdr[];
  proposed_by: Author | null;
  /** Who accepted or rejected it. */
  decided_by: Author | null;
  /** Your role at its scope: viewers read; editors propose, edit, link and move it; owners decide. */
  my_role: ProjectRole;
}

export interface AdrSnapshot {
  title: string;
  status: AdrStatus;
  context: string;
  decisions: string[];
  positive_consequences: string[];
  negative_consequences: string[];
  links: { diagram_id?: string; kind: LinkKind; id: string }[];
  relations: { kind: RelationKind; adr_id: string }[];
  /** `null` (or missing, in older revisions): about the whole project. */
  scope?: { diagram_id: string; box_id: string } | null;
}

export type RevisionAction =
  | "created"
  | "edited"
  | "linked"
  | "scoped"
  | "related"
  | "accepted"
  | "rejected"
  | "deprecated"
  | "superseded";

export interface AdrRevision {
  revision: number;
  action: RevisionAction;
  /** `null` if not known (older revisions). */
  author: Author | null;
  snapshot: AdrSnapshot;
  created_at: string;
}

/** "Alice (Architect)", or just "Alice" without a job title. */
export const authorName = (author: Author) => (author.title ? `${author.name} (${author.title})` : author.name);

/** The three lists an ADR has. */
export type AdrListField = "decisions" | "positive_consequences" | "negative_consequences";

/** What an ADR says; editable while it is proposed. */
export type AdrSections = Pick<Adr, "title" | "context" | AdrListField>;

const project = (id: string) => `/projects/${encodeURIComponent(id)}`;
const adr = (id: string) => `/adrs/${encodeURIComponent(id)}`;

export const listAdrs = (projectId: string) => request<Adr[]>("GET", `${project(projectId)}/adrs`);

/** About the whole project, or (with `diagram_id` and `box_id`) one box. */
export const createAdr = (
  projectId: string,
  fields: Partial<AdrSections> & { title: string; diagram_id?: string; box_id?: string },
) => request<Adr>("POST", `${project(projectId)}/adrs`, fields);

export const editAdr = (id: string, version: number, changes: Partial<AdrSections>) =>
  request<Adr>("PATCH", adr(id), { version, ...changes });

export const transitionAdr = (id: string, version: number, to: AdrStatus) =>
  request<Adr>("POST", `${adr(id)}/transition`, { version, to });

export const setAdrLinks = (id: string, version: number, links: LinkRef[]) =>
  request<Adr>("PUT", `${adr(id)}/links`, { version, links });

/** Moves a proposed ADR: no box for the whole project. Its links must fit there. */
export const setAdrScope = (id: string, version: number, box?: { diagram_id: string; box_id: string }) =>
  request<Adr>("PUT", `${adr(id)}/scope`, { version, ...box });

export const setAdrRelations = (id: string, version: number, relations: { kind: RelationKind; adr_id: string }[]) =>
  request<Adr>("PUT", `${adr(id)}/relations`, { version, relations });

export const supersedeAdr = (id: string, title?: string) =>
  request<Adr>("POST", `${adr(id)}/supersede`, title ? { title } : {});

export const deleteAdr = (id: string) => request<void>("DELETE", adr(id));

export const adrRevisions = (id: string) => request<AdrRevision[]>("GET", `${adr(id)}/revisions`);

/** Downloads (the server names the files). */
export const adrMarkdownUrl = (id: string) => `/api/v1${adr(id)}/markdown`;
export const adrsZipUrl = (projectId: string) => `/api/v1${project(projectId)}/adrs/export.zip`;
