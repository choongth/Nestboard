import { BOX_HEIGHT, BOX_WIDTH, type BoxNode, type Diagram, type Edge, type NodeId } from "./types";

/** Thrown when an operation is asked to do something the model forbids. A bug in the caller, not user error. */
export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelError";
  }
}

export function getNode(diagram: Diagram, id: NodeId): BoxNode {
  const node = diagram.nodes[id];
  if (!node) throw new ModelError(`Node not found: ${id}`);
  return node;
}

// Child lookups scan every node: fine for one level. To walk the whole tree,
// use childrenIndex or walkBoxes, which scan once.
export function getChildren(diagram: Diagram, parentId: NodeId): BoxNode[] {
  return Object.values(diagram.nodes).filter((n) => n.parentId === parentId);
}

/** Each box's children, in the diagram's order, from one pass over it. */
export function childrenIndex(diagram: Diagram): Map<NodeId, BoxNode[]> {
  const index = new Map<NodeId, BoxNode[]>();
  for (const n of Object.values(diagram.nodes)) {
    if (n.parentId === null) continue;
    const siblings = index.get(n.parentId);
    if (siblings) siblings.push(n);
    else index.set(n.parentId, [n]);
  }
  return index;
}

/**
 * Every box inside `id` (the root by default), depth-first in the diagram's
 * order, as drawn. `depth` is 0 for the boxes directly inside `id`.
 */
export function walkBoxes(diagram: Diagram, id: NodeId = diagram.rootId): { node: BoxNode; depth: number }[] {
  const index = childrenIndex(diagram);
  const result: { node: BoxNode; depth: number }[] = [];
  const visit = (parentId: NodeId, depth: number) => {
    for (const node of index.get(parentId) ?? []) {
      result.push({ node, depth });
      visit(node.id, depth + 1);
    }
  };
  visit(id, 0);
  return result;
}

/** The titles from the top-level box down to `id`, the root left out (none for the root itself). */
export function boxTitles(diagram: Diagram, id: NodeId): string[] {
  return getPath(diagram, id)
    .slice(1)
    .map((n) => n.title);
}

/** Titles as a path, e.g. "Payments › Ledger". */
export const joinPath = (titles: readonly string[]) => titles.join(" › ");

export function getChildCount(diagram: Diagram, parentId: NodeId): number {
  let count = 0;
  for (const n of Object.values(diagram.nodes)) if (n.parentId === parentId) count++;
  return count;
}

/** Edges drawn on `canvasId`'s canvas, i.e. between its direct children. */
export function getEdgesOn(diagram: Diagram, canvasId: NodeId): Edge[] {
  return Object.values(diagram.edges).filter((e) => e.parentId === canvasId);
}

/** Root first, `id` last. This is the breadcrumb. */
export function getPath(diagram: Diagram, id: NodeId): BoxNode[] {
  const path: BoxNode[] = [];
  let current: BoxNode | undefined = getNode(diagram, id);
  while (current) {
    path.push(current);
    current = current.parentId === null ? undefined : getNode(diagram, current.parentId);
  }
  return path.reverse();
}

/** `id` plus everything nested inside it. */
export function getSubtreeIds(diagram: Diagram, id: NodeId): Set<NodeId> {
  getNode(diagram, id);
  return new Set([id, ...walkBoxes(diagram, id).map((b) => b.node.id)]);
}

/** How many boxes are nested inside `ids` at any depth, not counting `ids` themselves. Missing ids are skipped. */
export function getNestedCount(diagram: Diagram, ids: readonly NodeId[]): number {
  const roots = ids.filter((id) => diagram.nodes[id]);
  const all = new Set<NodeId>();
  for (const id of roots) for (const nested of getSubtreeIds(diagram, id)) all.add(nested);
  return all.size - new Set(roots).size;
}

/** Whether `ancestor` contains `node`, at any depth (a node does not contain itself). */
export function isAncestor(diagram: Diagram, ancestor: NodeId, node: NodeId): boolean {
  let parentId = getNode(diagram, node).parentId;
  while (parentId !== null) {
    if (parentId === ancestor) return true;
    parentId = getNode(diagram, parentId).parentId;
  }
  return false;
}

/**
 * Why two boxes cannot be connected, or `null` if they can. Any two boxes may
 * be connected, at any levels, except a box with itself or with a box nested
 * inside it: that reads as nesting, not as a connection.
 */
export function connectionProblem(diagram: Diagram, from: NodeId, to: NodeId): string | null {
  if (from === to) return "A box cannot connect to itself";
  if (isAncestor(diagram, from, to) || isAncestor(diagram, to, from)) {
    return "A box cannot connect to a box nested inside it";
  }
  return null;
}

/**
 * The deepest node that contains both `a` and `b` (strict ancestors only, so for
 * siblings it is their parent). This is the canvas an edge between them lives on.
 */
export function lowestCommonAncestor(diagram: Diagram, a: NodeId, b: NodeId): NodeId {
  const pathA = getPath(diagram, a);
  const pathB = getPath(diagram, b);
  let lca: NodeId | undefined;
  for (let i = 0; i < Math.min(pathA.length, pathB.length) - 1; i++) {
    if (pathA[i]!.id !== pathB[i]!.id) break;
    lca = pathA[i]!.id;
  }
  if (lca === undefined) throw new ModelError(`No common ancestor below the endpoints: ${a}, ${b}`);
  return lca;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The area covered by `canvasId`'s direct children, or `null` if it has none. */
export function getChildrenBounds(diagram: Diagram, canvasId: NodeId): Rect | null {
  const children = getChildren(diagram, canvasId);
  if (children.length === 0) return null;
  const xs = children.map((n) => n.position.x);
  const ys = children.map((n) => n.position.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) + BOX_WIDTH - x, height: Math.max(...ys) + BOX_HEIGHT - y };
}
