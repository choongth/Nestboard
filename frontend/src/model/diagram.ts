import { newId } from "./ids";
import type { Diagram } from "./types";

export const ROOT_TITLE = "Root";

export function createEmptyDiagram(): Diagram {
  const rootId = newId();
  return {
    rootId,
    nodes: {
      [rootId]: { id: rootId, parentId: null, title: ROOT_TITLE, position: { x: 0, y: 0 } },
    },
    edges: {},
  };
}
