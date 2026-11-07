import { create } from "zustand";
import type { User } from "@/api/auth";
import type { ProjectDetail } from "@/api/orgs";

// Who is signed in, and which project the editor and the Decisions page are
// working in. Diagrams are opened from, and saved into, that project.
interface SessionState {
  /** `undefined` until the server has been asked; `null` when nobody is signed in. */
  user: User | null | undefined;
  project: ProjectDetail | null;
  setUser: (user: User | null) => void;
  setProject: (project: ProjectDetail | null) => void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  user: undefined,
  project: null,
  setUser: (user) => set({ user }),
  setProject: (project) => set({ project }),
}));

/** The project being worked in; only pages inside a project call this. */
export function currentProject(): ProjectDetail {
  const { project } = useSessionStore.getState();
  if (!project) throw new Error("No project is open.");
  return project;
}
