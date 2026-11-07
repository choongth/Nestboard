// What an ADR can be linked to: the boxes and connections of the open diagram.

import type { LinkKind } from "@/api/adrs";
import { boxTitles, getEdgesOn, joinPath, walkBoxes } from "@/model/queries";
import type { Diagram, NodeId } from "@/model/types";

export interface LinkTarget {
  kind: LinkKind;
  id: string;
  /** A box's title; a connection's label, else "From → To" (as the server names it). */
  title: string;
  /** Where it sits, e.g. "Payments › API"; empty at the top level. */
  path: string;
}

/** Boxes, then connections, each in the diagram's own (tree) order. The root canvas is not a box. */
export function linkTargets(diagram: Diagram): LinkTarget[] {
  const boxes: LinkTarget[] = [];
  const connections: LinkTarget[] = [];
  const where = (canvasId: NodeId) => joinPath(boxTitles(diagram, canvasId));

  // Every canvas in tree order: the root, then each box.
  for (const canvasId of [diagram.rootId, ...walkBoxes(diagram).map((b) => b.node.id)]) {
    for (const edge of getEdgesOn(diagram, canvasId)) {
      const from = diagram.nodes[edge.from]?.title ?? "?";
      const to = diagram.nodes[edge.to]?.title ?? "?";
      connections.push({ kind: "connection", id: edge.id, title: edge.label || `${from} → ${to}`, path: where(canvasId) });
    }
  }
  for (const { node } of walkBoxes(diagram)) {
    boxes.push({ kind: "box", id: node.id, title: node.title, path: where(node.parentId!) });
  }
  return [...boxes, ...connections];
}

export const linkKey = (kind: LinkKind, id: string) => `${kind}:${id}`;
