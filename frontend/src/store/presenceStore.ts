import { create } from "zustand";
import type { Presence } from "@/api/live";
import { useSessionStore } from "./sessionStore";

// Who else has the open diagram open, and what they are doing (see
// api/live.ts), as the live connection tells it (files/liveDiagram.ts).
interface PresenceState {
  /** This tab's own connection, while the diagram is live. */
  me: string | null;
  /** The other tabs with it open, by connection. */
  people: Record<string, Presence>;
}

export const usePresenceStore = create<PresenceState>()(() => ({ me: null, people: {} }));

// One per person (the server hands out the numbers); they read on the dark canvas.
const COLORS = [
  "#f472b6",
  "#38bdf8",
  "#a3e635",
  "#fbbf24",
  "#a78bfa",
  "#2dd4bf",
  "#fb923c",
  "#e879f9",
  "#4ade80",
  "#f87171",
  "#60a5fa",
  "#facc15",
];

export const presenceColor = (color: number) => COLORS[color % COLORS.length]!;

/** Everyone else here: not this tab, nor the user's own other tabs. */
export function others(state: PresenceState): Presence[] {
  const userId = useSessionStore.getState().user?.id;
  return Object.values(state.people).filter((p) => p.connection !== state.me && p.user_id !== userId);
}
