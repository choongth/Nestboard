import { create } from "zustand";
import { addUnsavedCheck } from "@/app/unsavedWork";
import { listAdrs, type Adr } from "@/api/adrs";

// The open project's ADRs, as the server last reported them. Every change goes
// to the server and then reloads the list, since one change can touch several
// ADRs (accepting one supersedes others; a relation shows on both ends).
interface DecisionsState {
  projectId: string | null;
  adrs: Adr[];
  state: "idle" | "loading" | "ready" | "error";
  error: string | null;
  /** Loads the ADRs of `projectId` (or clears them for `null`). */
  load: (projectId: string | null) => Promise<void>;
  /** Reloads the current project's ADRs. */
  refresh: () => Promise<void>;
  /** An ADR is being edited and has changes not yet saved. */
  draftDirty: boolean;
  setDraftDirty: (dirty: boolean) => void;
}

let latest = 0;

export const useDecisionsStore = create<DecisionsState>()((set, get) => ({
  projectId: null,
  adrs: [],
  state: "idle",
  error: null,

  load: async (projectId) => {
    const request = ++latest;
    if (projectId === null) {
      set({ projectId: null, adrs: [], state: "idle", error: null });
      return;
    }
    const switching = projectId !== get().projectId;
    set({ projectId, state: "loading", error: null, ...(switching ? { adrs: [] } : {}) });
    try {
      const adrs = await listAdrs(projectId);
      // A slower answer for an earlier request must not overwrite a newer one.
      if (request === latest) set({ adrs, state: "ready" });
    } catch (e) {
      if (request === latest) set({ state: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },

  refresh: () => get().load(get().projectId),

  draftDirty: false,
  setDraftDirty: (draftDirty) => set({ draftDirty }),
}));

// An ADR being edited is work that would be lost.
addUnsavedCheck("decision", () => useDecisionsStore.getState().draftDirty);
