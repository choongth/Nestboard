// How each ADR status reads and looks, and which changes the UI offers.

import type { AdrStatus, RelationKind } from "@/api/adrs";

export const STATUSES: AdrStatus[] = ["proposed", "accepted", "rejected", "deprecated", "superseded"];

export const STATUS_LABEL: Record<AdrStatus, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  rejected: "Rejected",
  deprecated: "Deprecated",
  superseded: "Superseded",
};

/** Badge colours: in force is green, undecided amber, no longer in force muted. */
export const STATUS_BADGE: Record<AdrStatus, string> = {
  proposed: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  accepted: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  rejected: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  deprecated: "border-line-strong bg-surface-hover text-fg-muted",
  superseded: "border-violet-400/30 bg-violet-400/10 text-violet-300",
};

/** The status changes a person can make (superseding is done by a newer ADR). */
export const NEXT_STATUSES: Record<AdrStatus, AdrStatus[]> = {
  proposed: ["accepted", "rejected"],
  accepted: ["deprecated"],
  rejected: [],
  deprecated: [],
  superseded: [],
};

/** The button that moves an ADR to a status. */
export const TRANSITION_LABEL: Partial<Record<AdrStatus, string>> = {
  accepted: "Accept",
  rejected: "Reject",
  deprecated: "Deprecate",
};

/** How a relation reads from the ADR that has it, and from its target. */
export const RELATION_OUT: Record<RelationKind, string> = {
  supersedes: "Supersedes",
  amends: "Amends",
  relates_to: "Relates to",
};
export const RELATION_IN: Record<RelationKind, string> = {
  supersedes: "Superseded by",
  amends: "Amended by",
  relates_to: "Related to",
};
