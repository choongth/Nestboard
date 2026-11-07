// What this tab is doing, told to the others with the diagram open (see
// api/live.ts PresenceState): the level on screen, what is selected, where
// the pointer is, and boxes being dragged. Never saved.

import type { PresenceSelection, PresenceState } from "@/api/live";
import type { NodeId, Position } from "@/model/types";
import { useDiagramStore } from "@/store/diagramStore";
import { useDocumentStore } from "@/store/documentStore";
import { useViewStore, type Selection } from "@/store/viewStore";
import { liveDiagram } from "./liveDiagram";

/** Told at most this often: a pointer moving smoothly, without a message per pixel. */
const SEND_EVERY_MS = 50;

let cursor: Position | null = null;
let dragging: Record<NodeId, Position> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** What was told last, to tell nothing new. */
let told = "";

/** Where the pointer is on the canvas on screen, in its coordinates; `null` when it is not over it. */
export function reportCursor(at: Position | null) {
  cursor = at && { x: Math.round(at.x), y: Math.round(at.y) };
  schedule();
}

/**
 * Where the boxes being dragged are now; `null` once the drag ends. The move
 * itself is sent first then, so the others see the box land, not jump back.
 */
export function reportDragging(at: Record<NodeId, Position> | null) {
  if (at === null && dragging === null) return;
  const ended = at === null;
  dragging = at && Object.fromEntries(Object.entries(at).map(([id, p]) => [id, { x: Math.round(p.x), y: Math.round(p.y) }]));
  if (!ended) {
    schedule();
    return;
  }
  liveDiagram.flush();
  sendNow();
}

function schedule() {
  timer ??= setTimeout(sendNow, SEND_EVERY_MS);
}

function sendNow() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (useDocumentStore.getState().id === null) return; // not live yet
  const state = current();
  const text = JSON.stringify(state);
  if (text === told) return;
  told = text;
  liveDiagram.sendPresence(state);
}

function current(): PresenceState {
  const { currentId, selection } = useViewStore.getState();
  return {
    level: currentId ?? useDiagramStore.getState().diagram.rootId,
    selection: asPresence(selection),
    cursor,
    dragging,
  };
}

function asPresence(selection: Selection | null): PresenceSelection | null {
  if (selection === null) return null;
  return selection.type === "boxes" ? { type: "boxes", ids: [...selection.ids] } : selection;
}

// Another level: the pointer and drags were on the last one.
useViewStore.subscribe((state, previous) => {
  if (state.currentId !== previous.currentId) {
    cursor = null;
    dragging = null;
  }
  if (state.currentId !== previous.currentId || state.selection !== previous.selection) schedule();
});

// Another diagram (opened, or a new one now on the server): told from scratch.
useDocumentStore.subscribe((state, previous) => {
  if (state.id !== previous.id || state.loads !== previous.loads) {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    told = "";
    schedule();
  }
});
