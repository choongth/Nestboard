import { create } from "zustand";
import type { EdgeId, NodeId } from "@/model/types";

/**
 * One or more boxes on the level on screen, or a single connection. Never
 * empty: nothing selected is `null`. An external box is selected on its own.
 */
export type Selection = { type: "boxes"; ids: readonly NodeId[] } | { type: "connection"; id: EdgeId };

const NO_BOXES: readonly NodeId[] = [];

/** The selected boxes, or none when a connection (or nothing) is selected. */
export const selectedBoxIds = (selection: Selection | null): readonly NodeId[] =>
  selection?.type === "boxes" ? selection.ids : NO_BOXES;

/** The one selected box, or `undefined` when there are several, none, or a connection. */
export const singleSelectedBox = (selection: Selection | null): NodeId | undefined =>
  selection?.type === "boxes" && selection.ids.length === 1 ? selection.ids[0] : undefined;

// UI state. Deliberately kept out of undo history: navigating in and out of
// boxes or selecting one is not an edit.
interface ViewState {
  /** The node whose canvas is on screen. `null` means the diagram root. */
  currentId: NodeId | null;
  selection: Selection | null;
  /** The box or connection whose first field should grab focus once the sidebar shows it. */
  focusRequest: string | null;
  /** Boxes and connections to pulse briefly, e.g. what an undo just changed. `key` restarts the pulse. */
  highlight: { ids: ReadonlySet<string>; key: number } | null;
  /** Boxes waiting for the user to confirm deleting them (the dialog is in SelectionShortcuts). */
  deleteRequest: readonly NodeId[] | null;
  requestDelete: (ids: readonly NodeId[] | null) => void;
  setCurrent: (id: NodeId | null) => void;
  select: (selection: Selection | null, options?: { focus?: boolean }) => void;
  /** Selects these boxes; an empty list selects nothing. */
  selectBoxes: (ids: readonly NodeId[], options?: { focus?: boolean }) => void;
  clearFocusRequest: () => void;
  flash: (ids: string[]) => void;
}

/** Matches the pulse animation in index.css. */
const HIGHLIGHT_MS = 1200;

export const useViewStore = create<ViewState>()((set, get) => ({
  currentId: null,
  selection: null,
  focusRequest: null,
  highlight: null,
  deleteRequest: null,
  requestDelete: (deleteRequest) => set({ deleteRequest }),
  setCurrent: (currentId) => set({ currentId, selection: null, focusRequest: null, highlight: null }),
  select: (selection, options) => {
    // Only a single box or connection has fields to focus.
    const target = selection?.type === "connection" ? selection.id : singleSelectedBox(selection);
    set({ selection, focusRequest: (options?.focus && target) || null });
  },
  selectBoxes: (ids, options) => get().select(ids.length > 0 ? { type: "boxes", ids } : null, options),
  clearFocusRequest: () => set({ focusRequest: null }),
  flash: (ids) => {
    const key = (get().highlight?.key ?? 0) + 1;
    set({ highlight: { ids: new Set(ids), key } });
    // Cleared afterwards so revisiting the level does not replay it.
    setTimeout(() => {
      if (get().highlight?.key === key) set({ highlight: null });
    }, HIGHLIGHT_MS);
  },
}));
