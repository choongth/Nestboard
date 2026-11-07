import { createEmptyDiagram } from "./diagram";
import { addEdge, addNode } from "./operations";
import type { Diagram, NodeId } from "./types";

export interface TreeSpec {
  [title: string]: TreeSpec;
}

/**
 * Builds a diagram from nested titles, e.g. `{ A: { A1: {}, A2: {} }, B: {} }`.
 * Returns the diagram plus a title → id lookup (titles must be unique).
 */
export function buildTree(spec: TreeSpec): { diagram: Diagram; id: (title: string) => NodeId } {
  let diagram = createEmptyDiagram();
  const ids = new Map<string, NodeId>([["Root", diagram.rootId]]);

  const visit = (parentId: NodeId, children: TreeSpec) => {
    Object.entries(children).forEach(([title, grandchildren], i) => {
      const result = addNode(diagram, parentId, { x: i * 300, y: 0 }, { title });
      diagram = result.diagram;
      ids.set(title, result.id);
      visit(result.id, grandchildren);
    });
  };
  visit(diagram.rootId, spec);

  const id = (title: string) => {
    const found = ids.get(title);
    if (!found) throw new Error(`No node titled ${title}`);
    return found;
  };
  return { diagram, id };
}

export function connect(diagram: Diagram, from: NodeId, to: NodeId, label?: string): Diagram {
  return addEdge(diagram, from, to, label).diagram;
}

/** Freezes a diagram deeply so any accidental mutation throws in tests. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
