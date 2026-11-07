// Makes a save's changes (api/diagrams.ts DiagramChanges) on a diagram, the
// way the server makes them (server/app/diagram_changes.py): on top of what is
// there, field by field. A change to a box or connection that is not there is
// skipped, as is a box or connection added to one; adding one that is there
// replaces it. The live editor keeps its diagram, and its undo history, in
// step with changes saved elsewhere this way (see files/liveDiagram.ts).

import type { BoxPatch, DiagramChanges, EdgePatch, EdgeRecord } from "@/api/diagrams";
import { deleteNodes } from "./operations";
import { lowestCommonAncestor } from "./queries";
import { edgeFromRecord, nodeFromRecord } from "./records";
import type { BoxNode, Diagram, Edge } from "./types";

/**
 * What each box or connection became, by what it was. Pass the same one when
 * making the same changes on several diagrams that share boxes (consecutive
 * undo steps), so they share the changed boxes too, and an undo step still
 * sees only what it changed itself.
 */
export type Patched = WeakMap<object, object>;

/** The diagram with `changes` made. Boxes and connections that end up as they were keep their identity. */
export function applyChanges(diagram: Diagram, changes: DiagramChanges, patched: Patched = new WeakMap()): Diagram {
  const gone = changes.removed_boxes.filter((id) => id !== diagram.rootId && diagram.nodes[id]);
  const start = gone.length > 0 ? deleteNodes(diagram, gone) : diagram;
  const nodes = { ...start.nodes };
  const edges = { ...start.edges };
  let changed = start !== diagram;
  for (const id of changes.removed_edges) {
    if (edges[id]) {
      delete edges[id];
      changed = true;
    }
  }

  /** `old` as `make` makes it: the same object if nothing about it changes. */
  const become = <T extends BoxNode | Edge>(old: T | undefined, make: () => T): T => {
    const done = old && (patched.get(old) as T | undefined);
    if (done) return done;
    const made = make();
    const result = old && equal(old, made) ? old : made;
    if (old) patched.set(old, result);
    return result;
  };
  const put = <T extends BoxNode | Edge>(map: Record<string, T>, item: T) => {
    if (map[item.id] !== item) {
      map[item.id] = item;
      changed = true;
    }
  };

  // New boxes, each once the box it sits in is there; those in a box that is not are skipped.
  let waiting = changes.added_boxes;
  for (let placed = true; placed && waiting.length > 0; ) {
    placed = false;
    waiting = waiting.filter((box) => {
      const old = nodes[box.id];
      if (box.parent_id === null || !nodes[box.parent_id] || (old && old.parentId !== box.parent_id)) return true;
      put(nodes, become(old, () => nodeFromRecord(box)));
      placed = true;
      return false;
    });
  }
  for (const patch of changes.changed_boxes) {
    const old = nodes[patch.id];
    if (old) put(nodes, become(old, () => patchNode(old, patch)));
  }

  const now: Diagram = { ...start, nodes, edges };
  for (const record of changes.added_edges) {
    if (nodes[record.from] && nodes[record.to]) put(edges, become(edges[record.id], () => edgeFromRecord(record, now)));
  }
  for (const patch of changes.changed_edges) {
    const old = edges[patch.id];
    if (!old) continue;
    const next = patchEdge(old, patch, now);
    if (nodes[next.from] && nodes[next.to]) put(edges, become(old, () => next));
  }
  return changed ? now : diagram;
}

/** A save as the server tells it (its boxes and connections whole, as they now are), as changes. */
export function asChanges(saved: {
  boxes: DiagramChanges["added_boxes"];
  edges: EdgeRecord[];
  removed_boxes: string[];
  removed_edges: string[];
}): DiagramChanges {
  return {
    added_boxes: saved.boxes,
    changed_boxes: [],
    removed_boxes: saved.removed_boxes,
    added_edges: saved.edges,
    changed_edges: [],
    removed_edges: saved.removed_edges,
  };
}

function patchNode(old: BoxNode, patch: BoxPatch): BoxNode {
  const next: BoxNode = { ...old };
  if (patch.title !== undefined) next.title = patch.title;
  setOptional(next, "typeId", patch, "type_id");
  setOptional(next, "technology", patch, "technology");
  setOptional(next, "description", patch, "description");
  if (patch.position) next.position = { x: patch.position.x, y: patch.position.y };
  if (patch.externals) {
    const spots = { ...old.externals };
    for (const [id, spot] of Object.entries(patch.externals)) {
      if (spot === null) delete spots[id];
      else spots[id] = { x: spot.x, y: spot.y };
    }
    if (Object.keys(spots).length > 0) next.externals = spots;
    else delete next.externals;
  }
  return next;
}

function patchEdge(old: Edge, patch: EdgePatch, diagram: Diagram): Edge {
  const next: Edge = { ...old };
  if (patch.from !== undefined) next.from = patch.from;
  if (patch.to !== undefined) next.to = patch.to;
  setOptional(next, "typeId", patch, "type_id");
  setOptional(next, "label", patch, "label");
  if ((next.from !== old.from || next.to !== old.to) && diagram.nodes[next.from] && diagram.nodes[next.to]) {
    next.parentId = lowestCommonAncestor(diagram, next.from, next.to);
  }
  return next;
}

/** An optional field the patch gives (null clears it), or leaves alone. */
function setOptional<T extends object, P extends object>(target: T, key: keyof T, patch: P, field: keyof P) {
  if (!(field in patch)) return;
  const value = patch[field];
  if (value == null) delete target[key];
  else target[key] = value as T[keyof T];
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
