// Undo / redo. Each step takes you to where its change can be seen: the level
// is switched here, and the canvas pans to and highlights the change (see
// `useHistoryActions` in canvas/navigation.ts).

import { describeChange, type DiagramChange } from "@/model/diff";
import type { Diagram } from "@/model/types";
import { useDiagramStore } from "./diagramStore";
import { useViewStore } from "./viewStore";

export interface HistoryStep {
  change: DiagramChange;
  /** True when the step moved you to a different level. */
  switchedLevel: boolean;
  /** The diagram before the step, for where removed boxes used to be. */
  before: Diagram;
}

export function undo(): HistoryStep | null {
  return step(() => useDiagramStore.temporal.getState().undo());
}

export function redo(): HistoryStep | null {
  return step(() => useDiagramStore.temporal.getState().redo());
}

function step(apply: () => void): HistoryStep | null {
  const before = useDiagramStore.getState().diagram;
  apply();
  const after = useDiagramStore.getState().diagram;
  if (after === before) return null;

  const view = useViewStore.getState();
  const change = describeChange(before, after);
  const shownId = view.currentId && after.nodes[view.currentId] ? view.currentId : after.rootId;

  let switchedLevel = false;
  if (change && change.canvasId !== shownId) {
    view.setCurrent(change.canvasId === after.rootId ? null : change.canvasId);
    switchedLevel = true;
  } else if (view.currentId && !after.nodes[view.currentId]) {
    view.setCurrent(null); // safety net; the change normally names a level that exists
    switchedLevel = true;
  }

  const { selection } = useViewStore.getState();
  if (selection?.type === "connection") {
    if (!after.edges[selection.id]) view.select(null);
  } else if (selection) {
    const kept = selection.ids.filter((id) => after.nodes[id]);
    if (kept.length !== selection.ids.length) view.selectBoxes(kept);
  }

  if (change) view.flash([...change.boxes, ...change.connections]);
  return change ? { change, switchedLevel, before } : null;
}
