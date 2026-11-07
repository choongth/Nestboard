// Align and distribute: tidying several boxes on one canvas at once. Each
// returns the boxes' new positions; boxes are all the same size.

import { getNode } from "./queries";
import { BOX_HEIGHT, BOX_WIDTH, type Diagram, type NodeId, type Position } from "./types";

/** Which edge or centre line the boxes are lined up on. */
export type AlignTo = "left" | "centre" | "right" | "top" | "middle" | "bottom";

/** Lines the boxes up on the outermost edge, or the middle, of the space they cover. */
export function alignBoxes(diagram: Diagram, ids: readonly NodeId[], to: AlignTo): Record<NodeId, Position> {
  const nodes = ids.map((id) => getNode(diagram, id));
  if (nodes.length === 0) return {};
  const horizontal = to === "left" || to === "centre" || to === "right";
  const size = horizontal ? BOX_WIDTH : BOX_HEIGHT;
  const starts = nodes.map((n) => (horizontal ? n.position.x : n.position.y));
  const low = Math.min(...starts);
  const high = Math.max(...starts) + size;
  const at =
    to === "left" || to === "top" ? low : to === "right" || to === "bottom" ? high - size : Math.round((low + high - size) / 2);

  return Object.fromEntries(
    nodes.map((n) => [n.id, horizontal ? { x: at, y: n.position.y } : { x: n.position.x, y: at }]),
  );
}

/**
 * Spaces three or more boxes evenly along an axis: the first and last stay
 * put, and those between get equal gaps. Fewer than three change nothing.
 */
export function distributeBoxes(diagram: Diagram, ids: readonly NodeId[], axis: "x" | "y"): Record<NodeId, Position> {
  const nodes = ids.map((id) => getNode(diagram, id));
  if (nodes.length < 3) return {};
  // Sorted by position; ties keep the given order.
  const sorted = [...nodes].sort((a, b) => a.position[axis] - b.position[axis]);
  const first = sorted[0]!.position[axis];
  const step = (sorted.at(-1)!.position[axis] - first) / (sorted.length - 1);
  return Object.fromEntries(
    sorted.map((n, i) => [n.id, { ...n.position, [axis]: Math.round(first + i * step) }]),
  );
}
