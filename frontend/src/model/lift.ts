// How connections appear on one canvas. A connection's ends may sit at any
// depth; on a given canvas each end is shown by the box on that canvas that
// contains it ("lifting"). Connections are never merged: several between the
// same two boxes are each listed, numbered so they can be drawn side by side.
//
// A connection leaving the canvas is shown going to its far end itself, drawn
// as an external box at the edge of the canvas (see canvas/externalLayout.ts).

import type { Diagram, EdgeId, NodeId } from "./types";

type Parallel = { index: number; count: number };

/** A connection drawn between two boxes on this canvas. */
export interface CanvasLine {
  edgeId: EdgeId;
  /** The boxes on this canvas the line is drawn between, in the connection's direction. */
  from: NodeId;
  to: NodeId;
  /** True when at least one real end is nested deeper and is shown by its container. */
  lifted: boolean;
  /** Position among the lines joining the same two boxes (either direction), and how many there are. */
  parallel: Parallel;
}

/** A connection with one end on this canvas (possibly lifted) and the other outside it. */
export interface ExternalLine {
  edgeId: EdgeId;
  /** The box on this canvas that shows the inside end. */
  inside: NodeId;
  /** The real box at the other end, somewhere outside this canvas: drawn as an external box. */
  outside: NodeId;
  /** "out" when the connection runs from the inside end to the outside one. */
  direction: "out" | "in";
  /** True when the inside end is nested deeper and is drawn by its container. */
  lifted: boolean;
  parallel: Parallel;
}

export interface CanvasConnections {
  lines: CanvasLine[];
  external: ExternalLine[];
}

export function connectionsOn(diagram: Diagram, canvasId: NodeId): CanvasConnections {
  /** The box on this canvas containing `node` (or `node` itself), or null if it is outside the canvas. */
  const shownBy = (node: NodeId): NodeId | null => {
    let current = diagram.nodes[node];
    while (current && current.parentId !== null) {
      if (current.parentId === canvasId) return current.id;
      current = diagram.nodes[current.parentId];
    }
    return null;
  };

  const lines: Omit<CanvasLine, "parallel">[] = [];
  const external: Omit<ExternalLine, "parallel">[] = [];

  for (const edge of Object.values(diagram.edges)) {
    const from = shownBy(edge.from);
    const to = shownBy(edge.to);
    if (from && to) {
      // Both ends land in the same box: the connection is internal to it.
      if (from !== to) lines.push({ edgeId: edge.id, from, to, lifted: from !== edge.from || to !== edge.to });
    } else if (from || to) {
      const [inside, realInside, outside] = from ? [from, edge.from, edge.to] : [to!, edge.to, edge.from];
      external.push({ edgeId: edge.id, inside, outside, direction: from ? "out" : "in", lifted: inside !== realInside });
    }
  }

  return {
    lines: numberParallel(lines, (l) => [l.from, l.to]),
    external: numberParallel(external, (e) => [e.inside, e.outside]),
  };
}

/** Numbers the items that share a pair of boxes, whichever way they point. */
function numberParallel<T>(items: T[], ends: (item: T) => [NodeId, NodeId]): (T & { parallel: Parallel })[] {
  const pairKey = (item: T) => {
    const [a, b] = ends(item);
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };
  const counts = new Map<string, number>();
  for (const item of items) counts.set(pairKey(item), (counts.get(pairKey(item)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return items.map((item) => {
    const key = pairKey(item);
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    return { ...item, parallel: { index, count: counts.get(key)! } };
  });
}
