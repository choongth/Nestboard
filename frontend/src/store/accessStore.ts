import { create } from "zustand";
import { getDiagramAccess, listGrants, type Grant } from "@/api/access";
import { checkChange, type Refusal, type Rights } from "@/model/rights";
import { setEditGuard } from "./diagramStore";
import { useSessionStore } from "./sessionStore";

// What the signed-in user may change in the open diagram, and who has which
// grant in the project (for "In charge" on boxes and the People page). Every
// edit to the diagram is checked against it before it is made (see
// setEditGuard); the server checks the same rules again when saving.
interface AccessState {
  /** The diagram these rights are for; `null` for one not saved yet. */
  diagramId: string | null;
  rights: Rights;
  /** Every grant in the project. */
  grants: Grant[];
  /** The last edit refused, shown briefly; `key` restarts the notice. */
  refusal: (Refusal & { key: number }) | null;
  /** Reloads the user's rights in `diagramId` and the project's grants. */
  load: (diagramId: string | null) => Promise<void>;
  refresh: () => Promise<void>;
  dismissRefusal: () => void;
}

let latest = 0;

const projectRights = (): Rights => ({ projectRole: useSessionStore.getState().project?.role ?? "viewer", boxRoles: {} });

export const useAccessStore = create<AccessState>()((set, get) => ({
  diagramId: null,
  rights: projectRights(),
  grants: [],
  refusal: null,

  load: async (diagramId) => {
    const request = ++latest;
    const project = useSessionStore.getState().project;
    // Right away: what the project role allows (all there is for a diagram
    // not saved yet); grants on boxes come with the answer.
    if (diagramId === null || diagramId !== get().diagramId) set({ diagramId, rights: projectRights() });
    if (!project) return;
    try {
      const [access, grants] = await Promise.all([
        diagramId ? getDiagramAccess(diagramId) : Promise.resolve(null),
        listGrants(project.id),
      ]);
      if (request !== latest) return;
      set({
        rights: access ? { projectRole: access.project_role, boxRoles: access.box_roles } : projectRights(),
        grants,
      });
    } catch {
      // Left as it was: the server still checks every save.
    }
  },

  refresh: () => get().load(get().diagramId),
  dismissRefusal: () => set({ refusal: null }),
}));

/** The boxes of the open diagram that have any grant at all. */
export function grantedBoxes(grants: Grant[], diagramId: string | null): Set<string> {
  return new Set(grants.filter((g) => g.diagram_id === diagramId && g.box_id).map((g) => g.box_id!));
}

/** Who is in charge of each box of the diagram: the names on its owner grants. */
export function inChargeOf(grants: Grant[], diagramId: string | null): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const g of grants) {
    if (g.diagram_id !== diagramId || !g.box_id || g.role !== "owner" || g.orphaned) continue;
    (found[g.box_id] ??= []).push(g.user?.display_name ?? g.group?.name ?? "?");
  }
  return found;
}

setEditGuard((before, after) => {
  const { rights, grants, diagramId } = useAccessStore.getState();
  const refusal = checkChange(rights, grantedBoxes(grants, diagramId), before, after);
  if (refusal) useAccessStore.setState({ refusal: { ...refusal, key: Date.now() } });
  return refusal === null;
});
