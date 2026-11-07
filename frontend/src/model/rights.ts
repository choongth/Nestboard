// Who may change which part of a diagram: the same rules the server checks
// when a diagram is saved (server/app/box_rights.py), so the editor can lock
// what you may not change instead of failing at save time.
//
// A grant on a box covers it and everything inside it. Your role at a box is
// the highest of your project-wide role and your grants on the box and every
// box above it. The root canvas is not a box: there only the project role counts.

import type { ProjectRole } from "@/api/orgs";
import type { Diagram, NodeId } from "./types";

const RANK: Record<ProjectRole, number> = { viewer: 0, editor: 1, owner: 2 };

export const atLeast = (role: ProjectRole, needed: ProjectRole) => RANK[role] >= RANK[needed];

export function highest(roles: ProjectRole[]): ProjectRole | null {
  return roles.reduce<ProjectRole | null>((best, r) => (best === null || RANK[r] > RANK[best] ? r : best), null);
}

/** One user's roles in one diagram. */
export interface Rights {
  projectRole: ProjectRole;
  /** Roles from grants on boxes that apply to the user, by box id. */
  boxRoles: Record<NodeId, ProjectRole>;
}

/** Your role at a box; `null` (or the root) is the canvas outside every box. */
export function roleAt(rights: Rights, diagram: Diagram, id: NodeId | null): ProjectRole {
  let role = rights.projectRole;
  for (let node = id ? diagram.nodes[id] : undefined; node; node = node.parentId ? diagram.nodes[node.parentId] : undefined) {
    const granted = rights.boxRoles[node.id];
    if (granted && RANK[granted] > RANK[role]) role = granted;
  }
  return role;
}

export const can = (rights: Rights, diagram: Diagram, id: NodeId | null, role: ProjectRole) =>
  atLeast(roleAt(rights, diagram, id), role);

/** Can the user change anything at all in the diagram? */
export const canEditSomething = (rights: Rights) =>
  atLeast(rights.projectRole, "editor") || Object.values(rights.boxRoles).some((r) => atLeast(r, "editor"));

/**
 * Who may add, change or delete a connection: an editor of either end; between
 * boxes on different levels, an editor of the box either end sits in. So
 * whoever may only edit Cart, inside Shop, connects it to nothing outside Shop.
 */
export function canConnect(rights: Rights, diagram: Diagram, from: NodeId, to: NodeId): boolean {
  const a = diagram.nodes[from]?.parentId ?? null;
  const b = diagram.nodes[to]?.parentId ?? null;
  if (a !== b) return can(rights, diagram, a, "editor") || can(rights, diagram, b, "editor");
  return can(rights, diagram, from, "editor") || can(rights, diagram, to, "editor");
}

/** A change the user may not make, and what it needs. */
export interface Refusal {
  boxId: NodeId;
  needs: ProjectRole;
  message: string;
}

const CONTENT = ["title", "typeId", "technology", "description"] as const;

function name(diagram: Diagram, id: NodeId | null): string {
  if (id === null || id === diagram.rootId) return "the top level";
  return `"${diagram.nodes[id]?.title ?? id}"`;
}

/**
 * The first change from `before` to `after` the user may not make, or null.
 * `granted`: the boxes of this diagram that have any grant at all; deleting
 * or moving them needs an owner above.
 */
export function checkChange(rights: Rights, granted: ReadonlySet<NodeId>, before: Diagram, after: Diagram): Refusal | null {
  if (rights.projectRole === "owner") return null;
  const refuse = (boxId: NodeId, needs: ProjectRole, message: string): Refusal => ({ boxId, needs, message });

  for (const old of Object.values(before.nodes)) {
    if (after.nodes[old.id] || old.parentId === null) continue;
    if (!can(rights, before, old.parentId, "editor")) return refuse(old.id, "editor", `You can't delete ${name(before, old.id)}.`);
    if (granted.has(old.id) && !can(rights, before, old.parentId, "owner")) {
      return refuse(
        old.id,
        "owner",
        `${name(before, old.id)} has people in charge of it: only an owner of ${name(before, old.parentId)} can delete it.`,
      );
    }
  }

  for (const node of Object.values(after.nodes)) {
    if (node.parentId === null) continue;
    const old = before.nodes[node.id];
    if (!old) {
      if (!can(rights, after, node.parentId, "editor")) {
        return refuse(node.id, "editor", `You can't add boxes to ${name(after, node.parentId)}.`);
      }
      continue;
    }
    // A box never moves into another box (the editor copies it there), so
    // there is no rule for that.
    if ((old.position.x !== node.position.x || old.position.y !== node.position.y) && !can(rights, after, node.parentId, "editor")) {
      return refuse(node.id, "editor", `You can't move ${name(after, node.id)} around in ${name(after, node.parentId)}.`);
    }
    if (CONTENT.some((key) => (old[key] ?? undefined) !== (node[key] ?? undefined)) && !can(rights, after, node.id, "editor")) {
      return refuse(node.id, "editor", `You can't change ${name(before, node.id)}.`);
    }
    // External boxes inside a box are arranged by whoever edits that box (the
    // server: "content"). A spot that goes with a deleted box is no change.
    const kept = Object.entries(old.externals ?? {}).filter(([id]) => after.nodes[id]);
    if (JSON.stringify(Object.fromEntries(kept)) !== JSON.stringify(node.externals ?? {}) && !can(rights, after, node.id, "editor")) {
      return refuse(node.id, "editor", `You can't move the boxes from other levels inside ${name(before, node.id)}.`);
    }
  }

  const edgeIds = new Set([...Object.keys(before.edges), ...Object.keys(after.edges)]);
  for (const id of edgeIds) {
    const was = before.edges[id];
    const now = after.edges[id];
    if (was && now && was.from === now.from && was.to === now.to && was.label === now.label && was.typeId === now.typeId) continue;
    for (const [edge, diagram] of [
      [was, before],
      [now, after],
    ] as const) {
      if (!edge || canConnect(rights, diagram, edge.from, edge.to)) continue;
      const a = diagram.nodes[edge.from]?.parentId ?? null;
      const b = diagram.nodes[edge.to]?.parentId ?? null;
      return refuse(
        edge.from,
        "editor",
        a !== b
          ? `The connection between ${name(diagram, edge.from)} and ${name(diagram, edge.to)} crosses levels: it needs an editor of ${name(diagram, a)} or of ${name(diagram, b)}.`
          : `You can't change the connection between ${name(diagram, edge.from)} and ${name(diagram, edge.to)}: you can edit neither end.`,
      );
    }
  }
  return null;
}
