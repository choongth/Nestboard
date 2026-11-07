import { getPath } from "./queries";
import type { BoxNode, Diagram, EdgeId, NodeId } from "./types";

export interface DiagramChange {
  /** The canvas to show so the change can be seen: the shallowest one it touches. */
  canvasId: NodeId;
  /** Boxes on that canvas that were added or edited and still exist. */
  boxes: NodeId[];
  /** Connections on that canvas that were added or edited and still exist. */
  connections: EdgeId[];
  /** Boxes on that canvas that were removed. Their old positions show where. */
  removedBoxes: NodeId[];
}

/**
 * Describes where the difference between two versions of a diagram is visible.
 * Returns `null` when nothing visible changed. Relies on unchanged objects
 * keeping their identity, which every model operation guarantees.
 */
export function describeChange(before: Diagram, after: Diagram): DiagramChange | null {
  type Touch = { canvasId: NodeId; diagram: Diagram };
  const touches: Touch[] = [];

  const changedNodes = changedKeys(before.nodes, after.nodes);
  const changedEdges = changedKeys(before.edges, after.edges);

  for (const id of changedNodes) {
    const node = after.nodes[id] ?? before.nodes[id]!;
    // External boxes moved inside a box are seen on that box's own canvas.
    if (onlySpotsMoved(before.nodes[id], after.nodes[id])) {
      touches.push({ canvasId: id, diagram: after });
      continue;
    }
    if (node.parentId === null) continue; // the root itself has no canvas to show it on
    touches.push({ canvasId: node.parentId, diagram: after.nodes[node.parentId] ? after : before });
  }
  for (const id of changedEdges) {
    const edge = after.edges[id] ?? before.edges[id]!;
    touches.push({ canvasId: edge.parentId, diagram: after.nodes[edge.parentId] ? after : before });
  }

  // Only canvases that still exist can be shown; of those, the shallowest wins
  // (deleting a box with contents is seen on the level that held the box).
  const visible = touches.filter((t) => after.nodes[t.canvasId]);
  if (visible.length === 0) return null;
  const depth = (t: Touch) => getPath(after, t.canvasId).length;
  const canvasId = visible.reduce((best, t) => (depth(t) < depth(best) ? t : best)).canvasId;

  return {
    canvasId,
    boxes: changedNodes.filter((id) => after.nodes[id]?.parentId === canvasId),
    connections: changedEdges.filter((id) => after.edges[id]?.parentId === canvasId),
    removedBoxes: changedNodes.filter((id) => !after.nodes[id] && before.nodes[id]?.parentId === canvasId),
  };
}

/** True when a box still there changed only where external boxes sit inside it. */
function onlySpotsMoved(was: BoxNode | undefined, now: BoxNode | undefined): boolean {
  if (!was || !now || was.externals === now.externals) return false;
  return (
    was.parentId === now.parentId &&
    was.title === now.title &&
    was.typeId === now.typeId &&
    was.technology === now.technology &&
    was.description === now.description &&
    was.position.x === now.position.x &&
    was.position.y === now.position.y
  );
}

function changedKeys<T>(before: Record<string, T>, after: Record<string, T>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => before[k] !== after[k]);
}
