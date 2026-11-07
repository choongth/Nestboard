import { create } from "zustand";
import { addUnsavedCheck } from "@/app/unsavedWork";

export const UNTITLED = "Untitled";

/**
 * Whether the server has every change (see files/liveDiagram.ts):
 *  - "local": not on the server; a new diagram goes there with its first change;
 *  - "saved": it has everything, or will in a moment;
 *  - "saving": changes have been on their way for a while;
 *  - "offline": the connection is lost; changes go once it is back.
 */
export type Sync = "local" | "saved" | "saving" | "offline";

// Which diagram is open, and whether the server has all of it.
interface DocumentState {
  /** The diagram's id on the server; `null` until it is there. */
  id: string | null;
  name: string;
  /** The server version the editor has every change up to; `null` if not on the server. */
  version: number | null;
  sync: Sync;
  /** Changes the server does not have yet (also those on their way). */
  unsaved: boolean;
  /** Something the editor should say about saving, e.g. a change the server refused; `key` restarts the notice. */
  notice: { message: string; key: number } | null;
  /** The diagram went away (deleted, or access lost): why. The editor then closes it. */
  gone: string | null;
  /** Counts diagrams loaded (opened, new, imported), so the editor knows to fit the view. */
  loads: number;
  /** For a diagram now on the server: its id, name and version. */
  setDocument: (doc: Pick<DocumentState, "id" | "name" | "version">) => void;
  /** Like `setDocument`, for a different diagram replacing the open one. */
  loaded: (doc: Pick<DocumentState, "id" | "name" | "version">) => void;
  setName: (name: string) => void;
  say: (message: string) => void;
  dismissNotice: () => void;
}

export const useDocumentStore = create<DocumentState>()((set) => ({
  id: null,
  name: UNTITLED,
  version: null,
  sync: "local",
  unsaved: false,
  notice: null,
  gone: null,
  loads: 0,
  setDocument: (doc) => set(doc),
  loaded: (doc) => set((s) => ({ ...doc, gone: null, loads: s.loads + 1 })),
  setName: (name) => set({ name }),
  say: (message) => set({ notice: { message, key: Date.now() } }),
  dismissNotice: () => set({ notice: null }),
}));

/** Changes the server does not have yet. */
export const hasUnsavedChanges = () => useDocumentStore.getState().unsaved;
addUnsavedCheck("diagram", hasUnsavedChanges);

export function useHasUnsavedChanges() {
  return useDocumentStore((s) => s.unsaved);
}
