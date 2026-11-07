// How project roles read in the interface.

import type { ProjectRole } from "@/api/orgs";

export const ROLE_LABELS: Record<ProjectRole, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

/** What each role allows, on a box or on the whole project. */
export const ROLE_HINTS: Record<ProjectRole, string> = {
  viewer: "Can look",
  editor: "Can change it and propose decisions",
  owner: "In charge: decides, and gives others access",
};
