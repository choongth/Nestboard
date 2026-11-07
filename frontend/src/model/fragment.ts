// Copy and paste. What is copied is a small diagram of its own (a "fragment"):
// a stand-in root holding the copied boxes, everything nested in them, and the
// connections among them. Connections reaching outside the copied boxes are
// left behind. On the clipboard a fragment is written in the file format,
// marked as one, so it travels between tabs and diagrams and is checked like
// an opened file when pasted.

import { newId } from "./ids";
import { getNode, getSubtreeIds, ModelError } from "./queries";
import { fromFile, toFile } from "./serialize";
import type { BoxNode, Diagram, Edge, NodeId, Position } from "./types";

/** Marks clipboard text as Nestboard boxes rather than any JSON. */
export const FRAGMENT_KIND = "nestboard/boxes";

/**
 * The boxes `ids` (all on one canvas), with everything nested inside them and
 * every connection whose two ends are both among them.
 */
export function extractFragment(diagram: Diagram, ids: readonly NodeId[]): Diagram {
  if (ids.length === 0) throw new ModelError("Nothing to copy");
  const canvasId = getNode(diagram, ids[0]!).parentId;
  if (canvasId === null) throw new ModelError("The root canvas cannot be copied");
  if (ids.some((id) => getNode(diagram, id).parentId !== canvasId)) {
    throw new ModelError("Only boxes on one canvas can be copied together");
  }

  const kept = new Set<NodeId>();
  for (const id of ids) for (const nested of getSubtreeIds(diagram, id)) kept.add(nested);

  // The stand-in root takes the canvas's id, so connections stored there need no rewriting.
  const nodes: Diagram["nodes"] = { [canvasId]: { id: canvasId, parentId: null, title: "", position: { x: 0, y: 0 } } };
  for (const node of Object.values(diagram.nodes)) if (kept.has(node.id)) nodes[node.id] = node;
  const edges: Diagram["edges"] = {};
  for (const edge of Object.values(diagram.edges)) {
    if (!kept.has(edge.from) || !kept.has(edge.to)) continue;
    // Stored inside a copied box, or else between copied boxes: on the root.
    edges[edge.id] = kept.has(edge.parentId) ? edge : { ...edge, parentId: canvasId };
  }
  return { rootId: canvasId, nodes, edges };
}

/**
 * Adds a copy of `fragment` to `canvasId`'s canvas, every box and connection
 * with a fresh id, its top-level boxes shifted by `offset`. Returns the ids of
 * those top-level boxes.
 */
export function insertFragment(
  diagram: Diagram,
  canvasId: NodeId,
  fragment: Diagram,
  offset: Position,
): { diagram: Diagram; ids: NodeId[] } {
  getNode(diagram, canvasId);
  const ids = new Map<NodeId, NodeId>([[fragment.rootId, canvasId]]);
  for (const id of Object.keys(fragment.nodes)) if (id !== fragment.rootId) ids.set(id, newId());
  const mapped = (id: NodeId) => ids.get(id)!;

  const nodes = { ...diagram.nodes };
  const top: NodeId[] = [];
  for (const node of Object.values(fragment.nodes)) {
    if (node.parentId === null) continue;
    const isTop = node.parentId === fragment.rootId;
    // Where external boxes were put inside it is not copied: a copy's
    // connections never leave the copied boxes, so it has none to place.
    const copy: BoxNode = {
      ...node,
      id: mapped(node.id),
      parentId: mapped(node.parentId),
      position: isTop ? { x: node.position.x + offset.x, y: node.position.y + offset.y } : { ...node.position },
    };
    delete copy.externals;
    nodes[copy.id] = copy;
    if (isTop) top.push(copy.id);
  }
  const edges = { ...diagram.edges };
  for (const edge of Object.values(fragment.edges)) {
    const copy: Edge = { ...edge, id: newId(), parentId: mapped(edge.parentId), from: mapped(edge.from), to: mapped(edge.to) };
    edges[copy.id] = copy;
  }
  return { diagram: { ...diagram, nodes, edges }, ids: top };
}

/** Clipboard text for a fragment. */
export function fragmentToText(fragment: Diagram): string {
  return JSON.stringify({ kind: FRAGMENT_KIND, ...toFile(fragment) });
}

/**
 * The fragment in clipboard text, or `null` when the text is anything else:
 * not ours, damaged, from a newer version, or holding no boxes.
 */
export function fragmentFromText(text: string): Diagram | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || (data as { kind?: unknown }).kind !== FRAGMENT_KIND) return null;
  const result = fromFile(data);
  if (!result.ok) return null;
  const { diagram } = result;
  return Object.keys(diagram.nodes).length > 1 ? diagram : null;
}
