import { create } from "zustand";
import { temporal } from "zundo";
import { createEmptyDiagram } from "@/model/diagram";
import { insertFragment } from "@/model/fragment";
import {
  addEdge,
  addNode,
  deleteEdge,
  deleteNodes,
  moveNodes,
  placeExternals,
  setEdgeLabel,
  setEdgeType,
  setNodeType,
  updateNode,
  type NodeDetails,
} from "@/model/operations";
import type { Diagram, EdgeId, NodeId, Position } from "@/model/types";

/**
 * Decides whether an edit may be made (see accessStore: what the user may
 * change). Loading a diagram, undo and redo are not checked.
 */
type EditGuard = (before: Diagram, after: Diagram) => boolean;
let guard: EditGuard = () => true;

export function setEditGuard(next: EditGuard) {
  guard = next;
}

// Document state. Everything here is undoable (Ctrl+Z / Ctrl+Y). An edit the
// guard refuses leaves the diagram as it was.
interface DiagramState {
  diagram: Diagram;
  replaceDiagram: (diagram: Diagram) => void;
  addBox: (parentId: NodeId, position: Position) => NodeId;
  updateBox: (id: NodeId, patch: Partial<NodeDetails>) => void;
  /** Changes a box's type and clears its technology, as one undo step; the same type again changes nothing. */
  setBoxType: (id: NodeId, typeId: string | undefined) => void;
  moveBox: (id: NodeId, position: Position) => void;
  /** Moves several boxes as one undo step; boxes already in place are left out. */
  moveBoxes: (positions: Record<NodeId, Position>) => void;
  /** Puts external boxes where the user dropped them on `canvasId`'s canvas, as one undo step. */
  placeExternals: (canvasId: NodeId, positions: Record<NodeId, Position>) => void;
  deleteBox: (id: NodeId) => void;
  /** Deletes several boxes, and everything inside them, as one undo step. */
  deleteBoxes: (ids: readonly NodeId[]) => void;
  /** Pastes copied boxes onto a canvas as one undo step; returns the pasted top-level boxes. */
  insertBoxes: (canvasId: NodeId, fragment: Diagram, offset: Position) => NodeId[];
  /**
   * `place`: also put `to` at this spot on that canvas, where it is an
   * external box (the "External box…" placeholder it was picked from), as
   * the same undo step.
   */
  addConnection: (from: NodeId, to: NodeId, place?: { canvasId: NodeId; position: Position }) => EdgeId;
  setConnectionLabel: (id: EdgeId, label: string) => void;
  /** `undefined` clears it back to generic. */
  setConnectionType: (id: EdgeId, typeId: string | undefined) => void;
  deleteConnection: (id: EdgeId) => void;
  /**
   * Groups every change until the returned `commit` into one undo step, e.g.
   * typing a title. If nothing changed, no step is recorded.
   */
  beginTransaction: () => () => void;
}

export const useDiagramStore = create<DiagramState>()(
  temporal(
    (setState, get) => {
      /** Makes an edit, if the guard allows it. */
      const set = ({ diagram }: { diagram: Diagram }) => {
        if (diagram !== get().diagram && guard(get().diagram, diagram)) setState({ diagram });
      };
      return {
        diagram: createEmptyDiagram(),
        replaceDiagram: (diagram) => setState({ diagram }),

        addBox: (parentId, position) => {
          const result = addNode(get().diagram, parentId, position);
          set({ diagram: result.diagram });
          return result.id;
        },
        updateBox: (id, patch) => set({ diagram: updateNode(get().diagram, id, patch) }),
        setBoxType: (id, typeId) => {
          const { diagram } = get();
          const next = setNodeType(diagram, id, typeId);
          if (next !== diagram) set({ diagram: next });
        },
        moveBox: (id, position) => get().moveBoxes({ [id]: position }),
        moveBoxes: (positions) => {
          const { diagram } = get();
          const moved = Object.entries(positions).filter(([id, position]) => {
            const current = diagram.nodes[id]?.position;
            return !current || current.x !== position.x || current.y !== position.y;
          });
          if (moved.length === 0) return;
          set({ diagram: moveNodes(diagram, Object.fromEntries(moved)) });
        },
        placeExternals: (canvasId, positions) => {
          const { diagram } = get();
          const saved = diagram.nodes[canvasId]?.externals ?? {};
          const moved = Object.entries(positions).filter(([id, p]) => saved[id]?.x !== p.x || saved[id]?.y !== p.y);
          if (moved.length === 0) return;
          set({ diagram: placeExternals(diagram, canvasId, Object.fromEntries(moved)) });
        },
        deleteBox: (id) => get().deleteBoxes([id]),
        deleteBoxes: (ids) => {
          if (ids.length > 0) set({ diagram: deleteNodes(get().diagram, ids) });
        },
        insertBoxes: (canvasId, fragment, offset) => {
          const result = insertFragment(get().diagram, canvasId, fragment, offset);
          set({ diagram: result.diagram });
          return result.ids;
        },

        addConnection: (from, to, place) => {
          const result = addEdge(get().diagram, from, to);
          const diagram = place ? placeExternals(result.diagram, place.canvasId, { [to]: place.position }) : result.diagram;
          set({ diagram });
          return result.id;
        },
        setConnectionLabel: (id, label) => set({ diagram: setEdgeLabel(get().diagram, id, label) }),
        setConnectionType: (id, typeId) => set({ diagram: setEdgeType(get().diagram, id, typeId) }),
        deleteConnection: (id) => set({ diagram: deleteEdge(get().diagram, id) }),

        beginTransaction: () => {
          const history = useDiagramStore.temporal.getState();
          const transaction = { before: get().diagram };
          openTransaction = transaction;
          history.pause();
          return () => {
            if (openTransaction === transaction) openTransaction = null;
            const { before } = transaction;
            const after = get().diagram;
            // Rewind silently, then re-apply as a single tracked change.
            setState({ diagram: before });
            history.resume();
            if (after !== before) setState({ diagram: after });
          };
        },
      };
    },
    { partialize: (state) => ({ diagram: state.diagram }), limit: 200 },
  ),
);

/** The diagram as a transaction began (see beginTransaction), while one is open. */
let openTransaction: { before: Diagram } | null = null;

/** Puts `diagram` in place without an undo step (e.g. changes saved by someone else). */
export function replaceSilently(diagram: Diagram) {
  const history = useDiagramStore.temporal.getState();
  // A transaction has paused it already, and resumes it when it ends.
  const tracking = history.isTracking;
  if (tracking) history.pause();
  useDiagramStore.setState({ diagram });
  if (tracking) history.resume();
}

/**
 * Remakes every step of the undo history (and the start of an open
 * transaction) with `change`: what others changed is in every version, so
 * undo and redo take back only your own changes.
 */
export function rebaseHistory(change: (diagram: Diagram) => Diagram) {
  const { pastStates, futureStates } = useDiagramStore.temporal.getState();
  const remake = (states: Partial<{ diagram: Diagram }>[]) =>
    states.map((state) => (state.diagram ? { ...state, diagram: change(state.diagram) } : state));
  useDiagramStore.temporal.setState({ pastStates: remake(pastStates), futureStates: remake(futureStates) });
  if (openTransaction) openTransaction.before = change(openTransaction.before);
}
