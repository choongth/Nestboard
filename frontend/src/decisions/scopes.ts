// What a decision is about (its scope): the whole project, or one box and
// everything inside it. The list of decisions is shown as a tree of scopes,
// and new decisions are written about a scope you may edit.

import type { Adr } from "@/api/adrs";
import { boxTitles, joinPath, walkBoxes } from "@/model/queries";
import { can, type Rights } from "@/model/rights";
import type { Diagram } from "@/model/types";

/** One branch of the tree: a scope and its decisions. */
export interface ScopeGroup {
  /** "project", or "<diagram id>:<box id>". */
  key: string;
  /** "Whole project", or where the box sits, e.g. "Shop › Payments". */
  label: string;
  /** How deep the box is in its diagram (0 at the top level), to indent it. */
  depth: number;
  /** For a box in a diagram other than the open one: that diagram's name. */
  diagramName?: string;
  /** The box (or its diagram) has been deleted since. */
  orphaned: boolean;
  adrs: Adr[];
}

export const PROJECT_SCOPE = "project";

export const scopeKey = (adr: Pick<Adr, "scope">) =>
  adr.scope ? `${adr.scope.diagram_id}:${adr.scope.box_id}` : PROJECT_SCOPE;

/**
 * Decisions about the whole project first; then those about boxes of the
 * open diagram, in its box order and indented by depth; then boxes of other
 * diagrams by name; deleted boxes last. Keeps the order of `adrs` within a group.
 */
export function scopeTree(
  adrs: Adr[],
  open: { id: string | null; diagram: Diagram },
  diagramNames: Record<string, string>,
): ScopeGroup[] {
  const groups = new Map<string, ScopeGroup>();
  // Box order in the open diagram, depth-first as drawn.
  const order = new Map(walkBoxes(open.diagram).map((b, i) => [b.node.id, i]));

  for (const adr of adrs) {
    const key = scopeKey(adr);
    let group = groups.get(key);
    if (!group) {
      const scope = adr.scope;
      const inOpen = scope !== null && scope.diagram_id === open.id && scope.box_id in open.diagram.nodes;
      const path = inOpen ? boxTitles(open.diagram, scope.box_id) : [];
      group = {
        key,
        label: scope === null ? "Whole project" : inOpen ? joinPath(path) : scope.title,
        depth: inOpen ? path.length - 1 : 0,
        diagramName: scope && !inOpen && !scope.orphaned ? (diagramNames[scope.diagram_id] ?? "another diagram") : undefined,
        orphaned: scope?.orphaned ?? false,
        adrs: [],
      };
      groups.set(key, group);
    }
    group.adrs.push(adr);
  }

  const rank = (g: ScopeGroup): [number, number, string] => {
    if (g.key === PROJECT_SCOPE) return [0, 0, ""];
    if (g.orphaned) return [3, 0, g.label.toLowerCase()];
    const boxId = g.key.slice(g.key.indexOf(":") + 1);
    if (g.diagramName === undefined) return [1, order.get(boxId) ?? 0, ""];
    return [2, 0, `${g.diagramName.toLowerCase()} ${g.label.toLowerCase()}`];
  };
  return [...groups.values()].sort((a, b) => {
    const [ra, oa, na] = rank(a);
    const [rb, ob, nb] = rank(b);
    return ra - rb || oa - ob || na.localeCompare(nb);
  });
}

/** A scope a decision can be about. */
export interface ScopeOption {
  key: string;
  label: string;
  /** Unset for the whole project. */
  diagram_id?: string;
  box_id?: string;
}

/**
 * The scopes you may write decisions about, from the open diagram: the
 * whole project if you edit it, and every box of the open diagram (saved on
 * the server) you may edit, in box order.
 */
export function scopeOptions(rights: Rights, open: { id: string | null; diagram: Diagram }): ScopeOption[] {
  const options: ScopeOption[] = [];
  if (can(rights, open.diagram, null, "editor")) options.push({ key: PROJECT_SCOPE, label: "Whole project" });
  if (open.id === null) return options;
  for (const { node } of walkBoxes(open.diagram)) {
    if (can(rights, open.diagram, node.id, "editor")) {
      options.push({
        key: `${open.id}:${node.id}`,
        label: joinPath(boxTitles(open.diagram, node.id)),
        diagram_id: open.id,
        box_id: node.id,
      });
    }
  }
  return options;
}
