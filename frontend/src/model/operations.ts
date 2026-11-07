// Every operation is pure: it returns a new Diagram and never mutates its input.
// Undo/redo relies on old snapshots staying intact.

import { newId } from "./ids";
import { connectionProblem, getNode, getSubtreeIds, lowestCommonAncestor, ModelError } from "./queries";
import type { BoxNode, Diagram, Edge, EdgeId, NodeId, Position } from "./types";

export const DEFAULT_BOX_TITLE = "New box";

export type NodeDetails = Pick<BoxNode, "title" | "typeId" | "technology" | "description">;

// ---- Nodes ----

export function addNode(
  diagram: Diagram,
  parentId: NodeId,
  position: Position,
  details: Partial<NodeDetails> = {},
): { diagram: Diagram; id: NodeId } {
  getNode(diagram, parentId);
  const id = newId();
  const node: BoxNode = { id, parentId, title: DEFAULT_BOX_TITLE, ...details, position: { ...position } };
  return { diagram: { ...diagram, nodes: { ...diagram.nodes, [id]: node } }, id };
}

/** Set title, type, technology or description. Pass `undefined` to clear an optional field. */
export function updateNode(diagram: Diagram, id: NodeId, patch: Partial<NodeDetails>): Diagram {
  const node = getNode(diagram, id);
  const updated: BoxNode = { ...node, ...patch };
  for (const key of ["typeId", "technology", "description"] as const) {
    if (updated[key] === undefined) delete updated[key];
  }
  if (updated.title === undefined) updated.title = node.title;
  return { ...diagram, nodes: { ...diagram.nodes, [id]: updated } };
}

/**
 * Gives a box another type. Its technology is cleared with it, as the same change: a technology belongs to the
 * type it was chosen for (box-type-specs.md §5). Choosing the type the box already has changes nothing.
 */
export function setNodeType(diagram: Diagram, id: NodeId, typeId: string | undefined): Diagram {
  if (getNode(diagram, id).typeId === typeId) return diagram;
  return updateNode(diagram, id, { typeId, technology: undefined });
}

export function moveNode(diagram: Diagram, id: NodeId, position: Position): Diagram {
  return moveNodes(diagram, { [id]: position });
}

/** Moves several nodes at once, e.g. a group drag. */
export function moveNodes(diagram: Diagram, positions: Record<NodeId, Position>): Diagram {
  const nodes = { ...diagram.nodes };
  for (const [id, position] of Object.entries(positions)) {
    if (id === diagram.rootId) throw new ModelError("The root canvas has no position to move");
    nodes[id] = { ...getNode(diagram, id), position: { ...position } };
  }
  return { ...diagram, nodes };
}

/**
 * Puts external boxes (by id) where the user dropped them on `canvasId`'s
 * canvas. Their spots are kept with the canvas's box.
 */
export function placeExternals(diagram: Diagram, canvasId: NodeId, positions: Record<NodeId, Position>): Diagram {
  const canvas = getNode(diagram, canvasId);
  const externals = { ...canvas.externals };
  for (const [id, position] of Object.entries(positions)) externals[id] = { ...position };
  return { ...diagram, nodes: { ...diagram.nodes, [canvasId]: { ...canvas, externals } } };
}

/** Removes the node, everything nested inside it, and every edge touching any of them. */
export function deleteNode(diagram: Diagram, id: NodeId): Diagram {
  return deleteNodes(diagram, [id]);
}

/** Removes several nodes at once, with everything nested inside them and every edge touching any of them. */
export function deleteNodes(diagram: Diagram, ids: readonly NodeId[]): Diagram {
  const removed = new Set<NodeId>();
  for (const id of ids) {
    if (id === diagram.rootId) throw new ModelError("The root canvas cannot be deleted");
    for (const nested of getSubtreeIds(diagram, id)) removed.add(nested);
  }

  const nodes: Diagram["nodes"] = {};
  for (const [key, node] of Object.entries(diagram.nodes)) {
    if (!removed.has(key)) nodes[key] = forgetSpots(node, removed);
  }
  // An edge inside a removed canvas has both endpoints in the subtree too,
  // so checking endpoints covers it.
  const edges: Diagram["edges"] = {};
  for (const [key, edge] of Object.entries(diagram.edges)) {
    if (!removed.has(edge.from) && !removed.has(edge.to)) edges[key] = edge;
  }
  return { ...diagram, nodes, edges };
}

/** The node without the spots of external boxes that are gone; the same object if there are none. */
function forgetSpots(node: BoxNode, gone: ReadonlySet<NodeId>): BoxNode {
  if (!node.externals || !Object.keys(node.externals).some((id) => gone.has(id))) return node;
  const kept = Object.entries(node.externals).filter(([id]) => !gone.has(id));
  const copy: BoxNode = { ...node, externals: Object.fromEntries(kept) };
  if (kept.length === 0) delete copy.externals;
  return copy;
}

// ---- Edges ----

/**
 * Connects two boxes, on the same level or on different ones (but never a box
 * with a box nested inside it). The edge is stored on their lowest common
 * ancestor: the deepest canvas that shows, or contains, both ends.
 */
export function addEdge(
  diagram: Diagram,
  from: NodeId,
  to: NodeId,
  label?: string,
): { diagram: Diagram; id: EdgeId } {
  getNode(diagram, from);
  getNode(diagram, to);
  const problem = connectionProblem(diagram, from, to);
  if (problem) throw new ModelError(problem);

  const id = newId();
  const edge: Edge = { id, parentId: lowestCommonAncestor(diagram, from, to), from, to };
  if (label !== undefined) edge.label = label;
  return { diagram: { ...diagram, edges: { ...diagram.edges, [id]: edge } }, id };
}

/** Pass `undefined` or an empty string to remove the label. */
export function setEdgeLabel(diagram: Diagram, id: EdgeId, label: string | undefined): Diagram {
  const edge = diagram.edges[id];
  if (!edge) throw new ModelError(`Edge not found: ${id}`);
  const updated: Edge = { ...edge };
  if (label) updated.label = label;
  else delete updated.label;
  return { ...diagram, edges: { ...diagram.edges, [id]: updated } };
}

/** Sets a connection's type; `undefined` clears it back to generic. */
export function setEdgeType(diagram: Diagram, id: EdgeId, typeId: string | undefined): Diagram {
  const edge = diagram.edges[id];
  if (!edge) throw new ModelError(`Edge not found: ${id}`);
  const updated: Edge = { ...edge };
  if (typeId !== undefined) updated.typeId = typeId;
  else delete updated.typeId;
  return { ...diagram, edges: { ...diagram.edges, [id]: updated } };
}

export function deleteEdge(diagram: Diagram, id: EdgeId): Diagram {
  if (!diagram.edges[id]) throw new ModelError(`Edge not found: ${id}`);
  const edges = { ...diagram.edges };
  delete edges[id];
  return { ...diagram, edges };
}
