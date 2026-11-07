// Converts between the in-memory Diagram and the server's records of its boxes
// and connections (see api/diagrams.ts), and works out what a save sends.

import type { BoxPatch, BoxRecord, DiagramChanges, DiagramRecord, EdgePatch, EdgeRecord } from "@/api/diagrams";
import { lowestCommonAncestor } from "./queries";
import type { BoxNode, Diagram, Edge, Position } from "./types";

/** The diagram a server record holds. The server has checked it already. */
export function fromRecord(record: Pick<DiagramRecord, "root_id" | "boxes" | "edges">): Diagram {
  const diagram: Diagram = { rootId: record.root_id, nodes: {}, edges: {} };
  for (const box of record.boxes) diagram.nodes[box.id] = nodeFromRecord(box);
  for (const edge of record.edges) diagram.edges[edge.id] = edgeFromRecord(edge, diagram);
  return diagram;
}

export function nodeFromRecord(box: BoxRecord): BoxNode {
  const { x, y } = box.position;
  const node: BoxNode = { id: box.id, parentId: box.parent_id, title: box.title, position: { x, y } };
  if (box.type_id != null) node.typeId = box.type_id;
  if (box.technology != null) node.technology = box.technology;
  if (box.description != null) node.description = box.description;
  const spots = Object.entries(box.externals ?? {});
  if (spots.length > 0) node.externals = Object.fromEntries(spots.map(([id, p]) => [id, { x: p.x, y: p.y }]));
  return node;
}

/** The connection, on the canvas of the deepest box of `diagram` holding both ends. */
export function edgeFromRecord({ id, from, to, type_id, label }: EdgeRecord, diagram: Diagram): Edge {
  const edge: Edge = { id, parentId: lowestCommonAncestor(diagram, from, to), from, to };
  if (type_id != null) edge.typeId = type_id;
  if (label != null) edge.label = label;
  return edge;
}

export function toBoxRecord(node: BoxNode): BoxRecord {
  return {
    id: node.id,
    parent_id: node.parentId,
    title: node.title,
    type_id: node.typeId ?? null,
    technology: node.technology ?? null,
    description: node.description ?? null,
    position: { x: node.position.x, y: node.position.y },
    externals: node.externals ?? {},
  };
}

export function toEdgeRecord(edge: Edge): EdgeRecord {
  return { id: edge.id, from: edge.from, to: edge.to, type_id: edge.typeId ?? null, label: edge.label ?? null };
}

/**
 * What saving `after` sends to a server holding `before`: boxes and
 * connections added (whole), changed (only the fields that differ, so that
 * someone else's change to another field stays) and deleted. Relies on
 * unchanged objects keeping their identity, which every model operation
 * guarantees.
 */
export function changesBetween(before: Diagram, after: Diagram): DiagramChanges {
  const changes: DiagramChanges = {
    added_boxes: [],
    changed_boxes: [],
    removed_boxes: Object.keys(before.nodes).filter((id) => !after.nodes[id]),
    added_edges: [],
    changed_edges: [],
    removed_edges: Object.keys(before.edges).filter((id) => !after.edges[id]),
  };
  for (const node of Object.values(after.nodes)) {
    const old = before.nodes[node.id];
    if (!old) changes.added_boxes.push(toBoxRecord(node));
    else if (old !== node) {
      const patch = boxPatch(old, node);
      if (Object.keys(patch).length > 1) changes.changed_boxes.push(patch);
    }
  }
  for (const edge of Object.values(after.edges)) {
    const old = before.edges[edge.id];
    if (!old) changes.added_edges.push(toEdgeRecord(edge));
    else if (old !== edge) {
      const patch = differences(toEdgeRecord(old), toEdgeRecord(edge)) as EdgePatch;
      if (Object.keys(patch).length > 1) changes.changed_edges.push(patch);
    }
  }
  return changes;
}

function boxPatch(old: BoxNode, node: BoxNode): BoxPatch {
  const { externals: was = {}, ...before } = toBoxRecord(old);
  const { externals: now = {}, ...after } = toBoxRecord(node);
  const patch = differences(before, after) as BoxPatch;
  const spots: Record<string, Position | null> = {};
  for (const [id, spot] of Object.entries(now)) if (!samePosition(was[id], spot)) spots[id] = spot;
  for (const id of Object.keys(was)) if (!(id in now)) spots[id] = null;
  if (Object.keys(spots).length > 0) patch.externals = spots;
  return patch;
}

/** The id, and each field of `after` that differs from `before`. */
function differences<T extends { id: string }>(before: T, after: T): Partial<T> & { id: string } {
  const patch: Partial<T> & { id: string } = { id: after.id } as Partial<T> & { id: string };
  for (const key of Object.keys(after) as (keyof T)[]) {
    const [was, now] = [before[key], after[key]];
    const same = isPosition(was) && isPosition(now) ? samePosition(was, now) : was === now;
    if (!same) patch[key] = now;
  }
  return patch;
}

const isPosition = (value: unknown): value is Position => typeof value === "object" && value !== null && "x" in value;
const samePosition = (a: Position | undefined, b: Position) => a !== undefined && a.x === b.x && a.y === b.y;

export const changesNothing = (changes: DiagramChanges) =>
  Object.values(changes).every((items: unknown[]) => items.length === 0);
