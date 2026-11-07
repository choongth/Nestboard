import { useDiagramStore } from "./diagramStore";
import { useViewStore } from "./viewStore";

/**
 * The id of the canvas on screen: the current node, or the root. Falls back to
 * the root if the current node no longer exists (e.g. another file was opened).
 */
export function useCurrentCanvasId() {
  const currentId = useViewStore((s) => s.currentId);
  return useDiagramStore((s) =>
    currentId && s.diagram.nodes[currentId] ? currentId : s.diagram.rootId,
  );
}
