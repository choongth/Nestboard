// The app's pages, in the order the page switcher lists them.

import { ScrollText, Users, Workflow, type LucideIcon } from "lucide-react";

export interface PageInfo {
  id: string;
  label: string;
  /** One line under the label in the switcher. */
  hint: string;
  icon: LucideIcon;
  /** `null` while the page does not exist yet: listed, but not selectable. */
  path: string | null;
}

export const PAGES: PageInfo[] = [
  { id: "editor", label: "Editor", hint: "Draw the diagram", icon: Workflow, path: "/editor" },
  {
    id: "decisions",
    label: "Decisions",
    hint: "Architecture decision records",
    icon: ScrollText,
    path: "/decisions",
  },
  { id: "people", label: "People", hint: "Who works on what", icon: Users, path: "/people" },
];

/**
 * Pages live inside a project: /organizations/<org id>/projects/<project id>/editor.
 * The part before the page; "" outside a project.
 */
export function projectBase(pathname: string): string {
  return /^\/organizations\/[^/]+\/projects\/[^/]+/.exec(pathname)?.[0] ?? "";
}

/** The page a URL belongs to (its first path segment after the project). */
export function pageForPath(pathname: string): PageInfo {
  const first = `/${pathname.slice(projectBase(pathname).length).split("/")[1] ?? ""}`;
  return PAGES.find((p) => p.path === first) ?? PAGES[0]!;
}

/** The address of a project's page: /organizations/<org id>/projects/<project id>/editor. */
export function projectPath(orgId: string, projectId: string, page = "/editor"): string {
  return `${orgPath(orgId)}/projects/${encodeURIComponent(projectId)}${page}`;
}

/** Where your organizations are listed; one of them opens on its projects. */
export const ORGANIZATIONS = "/organizations";

/** The tabs of an organization's page, in the order shown. */
export const ORG_SECTIONS = ["invitations", "members", "groups", "projects"] as const;
export type OrgSection = (typeof ORG_SECTIONS)[number];
export const DEFAULT_ORG_SECTION: OrgSection = "projects";

/**
 * The address of an organization's page, by its id (which says nothing about
 * it): /organizations/<id> opens its projects, and a tab is picked with the
 * part after "#", e.g. /organizations/<id>#members.
 */
export function orgPath(orgId: string, section: OrgSection = DEFAULT_ORG_SECTION): string {
  const base = `${ORGANIZATIONS}/${encodeURIComponent(orgId)}`;
  return section === DEFAULT_ORG_SECTION ? base : `${base}#${section}`;
}

/** The tab an address picks; anything else is the default (projects). */
export function orgSectionFor(hash: string): OrgSection {
  const wanted = hash.replace(/^#/, "");
  return ORG_SECTIONS.find((s) => s === wanted) ?? DEFAULT_ORG_SECTION;
}
