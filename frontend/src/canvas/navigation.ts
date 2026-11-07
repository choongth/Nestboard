// Moving between levels: double-click into a box, back out, jump to any
// ancestor from the breadcrumb, or follow an undo/redo to where it happened.
//
// The zoom effect is a CSS transform on the whole canvas stage rather than a
// React Flow viewport animation: a box filling the screen needs far more zoom
// than the canvas allows (maxZoom), and the transform has no such limit.

import {
  getViewportForBounds,
  useReactFlow,
  useStoreApi,
  useUpdateNodeInternals,
  type ReactFlowState,
  type Viewport,
} from "@xyflow/react";
import { useCallback, useEffect } from "react";
import { connectionsOn } from "@/model/lift";
import { getChildrenBounds, getPath, type Rect } from "@/model/queries";
import { BOX_HEIGHT, BOX_WIDTH, type NodeId } from "@/model/types";
import { useDiagramStore } from "@/store/diagramStore";
import { redo, undo, type HistoryStep } from "@/store/history";
import { EXTERNAL_HEIGHT, EXTERNAL_WIDTH, externalBoxes } from "./externalLayout";
import { useViewStore } from "@/store/viewStore";

export const STAGE_ATTR = "data-canvas-stage";

const OUT_MS = 200;
const IN_MS = 280;
const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
/** Fitting a level never zooms in past 100%, so a lone box is not blown up. */
const FIT_MAX_ZOOM = 1;
const FIT_PADDING = 0.2;

// Where you were on each canvas, so going back out returns you there.
// Session-only; not part of the document.
const savedViewports = new Map<NodeId, Viewport>();
let busy = false;

/** True while a level transition is animating. */
export const isNavigating = () => busy;

/**
 * Has React Flow measure the boxes on screen again. Boxes appear during a
 * level transition, while the stage is scaled, so React Flow records their
 * connection points in the wrong places; a dragged line would then start
 * away from the point it came from. Called once the transition has finished.
 */
function useRemeasure() {
  const { getNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  return useCallback(async () => {
    await nextFrame();
    updateNodeInternals(getNodes().map((n) => n.id));
  }, [getNodes, updateNodeInternals]);
}

export function useNavigation() {
  const { getViewport, setViewport } = useReactFlow();
  const store = useStoreApi();
  const remeasure = useRemeasure();

  const run = useCallback(
    async (steps: (stage: HTMLElement) => Promise<void>) => {
      const stage = document.querySelector<HTMLElement>(`[${STAGE_ATTR}]`);
      if (busy || !stage) return;
      busy = true;
      // Close the sidebar as the zoom starts; the first click of a
      // double-click will have just opened it.
      useViewStore.getState().select(null);
      try {
        await steps(stage);
      } finally {
        stage.getAnimations().forEach((a) => a.cancel());
        await remeasure();
        busy = false;
      }
    },
    [remeasure],
  );

  const fitViewportFor = useCallback((canvasId: NodeId) => fitViewport(canvasId, store.getState()), [store]);

  /** Switches the visible level and waits until React has drawn it. */
  const showLevel = useCallback(
    async (canvasId: NodeId, viewport: Viewport) => {
      const { rootId } = useDiagramStore.getState().diagram;
      useViewStore.getState().setCurrent(canvasId === rootId ? null : canvasId);
      await nextFrame();
      await setViewport(viewport);
      await nextFrame();
    },
    [setViewport],
  );

  /** Zoom into a box on the current canvas. */
  const enter = useCallback(
    (id: NodeId) =>
      run(async (stage) => {
        const node = useDiagramStore.getState().diagram.nodes[id];
        if (!node || node.parentId === null) return;
        const from = getViewport();
        savedViewports.set(node.parentId, from);

        const origin = boxCenterOnScreen(node.position, from);
        await animate(stage, origin, [
          { transform: "scale(1)", opacity: 1 },
          { transform: "scale(3)", opacity: 0 },
        ], OUT_MS, "ease-in");

        await showLevel(id, fitViewportFor(id));
        stage.getAnimations().forEach((a) => a.cancel());
        await animate(stage, "50% 50%", [
          { transform: "scale(0.7)", opacity: 0 },
          { transform: "scale(1)", opacity: 1 },
        ], IN_MS, "ease-out");
      }),
    [run, getViewport, showLevel, fitViewportFor],
  );

  /** Zoom out to an ancestor of the current canvas (by default, its parent). */
  const exitTo = useCallback(
    (ancestorId?: NodeId) =>
      run(async (stage) => {
        const { diagram } = useDiagramStore.getState();
        const currentId = useViewStore.getState().currentId;
        if (!currentId || !diagram.nodes[currentId]) return;

        const path = getPath(diagram, currentId);
        const targetIndex = ancestorId ? path.findIndex((n) => n.id === ancestorId) : path.length - 2;
        if (targetIndex < 0 || targetIndex >= path.length - 1) return;
        const target = path[targetIndex]!;
        // The box on the target canvas that we are coming out of.
        const cameFrom = path[targetIndex + 1]!;

        await animate(stage, "50% 50%", [
          { transform: "scale(1)", opacity: 1 },
          { transform: "scale(0.4)", opacity: 0 },
        ], OUT_MS, "ease-in");

        const viewport = savedViewports.get(target.id) ?? fitViewportFor(target.id);
        await showLevel(target.id, viewport);
        stage.getAnimations().forEach((a) => a.cancel());
        await animate(stage, boxCenterOnScreen(cameFrom.position, viewport), [
          { transform: "scale(2.5)", opacity: 0 },
          { transform: "scale(1)", opacity: 1 },
        ], IN_MS, "ease-out");
      }),
    [run, showLevel, fitViewportFor],
  );

  /** After another document is loaded: forget remembered views and fit its root level. */
  const resetView = useCallback(async () => {
    savedViewports.clear();
    await nextFrame();
    const { rootId } = useDiagramStore.getState().diagram;
    await setViewport(fitViewportFor(rootId));
  }, [setViewport, fitViewportFor]);

  /**
   * Shows the inside of a box (the root: the top level), e.g. where someone
   * else is. Into a box on this level it zooms in, up the tree it zooms out
   * as usual; anywhere else it fades across.
   */
  const goTo = useCallback(
    async (levelId: NodeId) => {
      const { diagram } = useDiagramStore.getState();
      const level = diagram.nodes[levelId];
      const currentId = useViewStore.getState().currentId ?? diagram.rootId;
      if (!level || levelId === currentId) return;
      if (level.parentId === currentId) {
        await enter(levelId);
      } else if (getPath(diagram, currentId).some((n) => n.id === levelId)) {
        await exitTo(levelId);
      } else {
        await run(async (stage) => {
          savedViewports.set(currentId, getViewport());
          await animate(stage, "50% 50%", [{ opacity: 1 }, { opacity: 0 }], SWITCH_MS, "ease-in");
          await showLevel(levelId, savedViewports.get(levelId) ?? fitViewportFor(levelId));
          stage.getAnimations().forEach((a) => a.cancel());
          await animate(stage, "50% 50%", [{ opacity: 0 }, { opacity: 1 }], SWITCH_MS, "ease-out");
        });
      }
    },
    [enter, exitTo, run, getViewport, showLevel, fitViewportFor],
  );

  /** Goes to the level a box lives on and selects it there, e.g. from an external box. */
  const reveal = useCallback(
    async (boxId: NodeId) => {
      const target = useDiagramStore.getState().diagram.nodes[boxId]?.parentId;
      if (target === undefined || target === null) return;
      await goTo(target);
      useViewStore.getState().selectBoxes([boxId]);
    },
    [goTo],
  );

  return { enter, exitTo, goTo, resetView, reveal };
}

function fitViewport(canvasId: NodeId, rf: ReactFlowState): Viewport {
  const { diagram } = useDiagramStore.getState();
  const own = getChildrenBounds(diagram, canvasId);
  // External boxes this level connects to are part of the picture too.
  const externals: Rect[] = externalBoxes(diagram, canvasId).map((b) => ({
    ...b.position,
    width: EXTERNAL_WIDTH,
    height: EXTERNAL_HEIGHT,
  }));
  const rects = [...(own ? [own] : []), ...externals];
  if (rects.length === 0) return DEFAULT_VIEWPORT;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const bounds = {
    x,
    y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y,
  };
  return getViewportForBounds(bounds, rf.width, rf.height, rf.minZoom, FIT_MAX_ZOOM, FIT_PADDING);
}

function boxCenterOnScreen(position: { x: number; y: number }, vp: Viewport): string {
  const x = (position.x + BOX_WIDTH / 2) * vp.zoom + vp.x;
  const y = (position.y + BOX_HEIGHT / 2) * vp.zoom + vp.y;
  return `${x}px ${y}px`;
}

async function animate(
  stage: HTMLElement,
  origin: string,
  keyframes: Keyframe[],
  duration: number,
  easing: string,
): Promise<void> {
  if (prefersReducedMotion()) return;
  stage.style.transformOrigin = origin;
  await stage.animate(keyframes, { duration, easing, fill: "forwards" }).finished.catch(() => {});
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Esc clears the selection, or with nothing selected goes up one level,
 * unless something else (a field, a dialog, a menu) wants it.
 */
export function useEscapeToExit() {
  const { exitTo } = useNavigation();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const view = useViewStore.getState();
      if (view.selection) {
        view.select(null);
        return;
      }
      void exitTo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exitTo]);
}

const SWITCH_MS = 180;
const PAN_MS = 300;
/** How close to the canvas edge (in screen pixels) still counts as "in view". */
const VIEW_MARGIN = 40;

/**
 * Undo / redo that take you to the change: switch to its level if needed,
 * pan to it if it is off-screen, and (via the view store) highlight it.
 * Steps queue up, so pressing Ctrl+Z repeatedly never drops one.
 */
export function useHistoryActions() {
  const { getViewport, setViewport } = useReactFlow();
  const store = useStoreApi();
  const remeasure = useRemeasure();

  const perform = useCallback(
    (action: () => HistoryStep | null) => {
      queued++;
      queue = queue.then(async () => {
        queued--;
        if (busy) return; // a level transition is animating
        const { diagram } = useDiagramStore.getState();
        const view = useViewStore.getState();
        const fromCanvas = view.currentId && diagram.nodes[view.currentId] ? view.currentId : diagram.rootId;
        const fromViewport = getViewport();

        const step = action();
        if (!step) return;

        const stage = document.querySelector<HTMLElement>(`[${STAGE_ATTR}]`);
        busy = true;
        try {
          if (step.switchedLevel) {
            savedViewports.set(fromCanvas, fromViewport);
            await nextFrame();
            await setViewport(savedViewports.get(step.change.canvasId) ?? fitViewport(step.change.canvasId, store.getState()));
            await nextFrame();
            // Skip the fade when more steps are waiting (e.g. Ctrl+Z held
            // down); only the last one animates.
            if (stage && queued === 0) {
              await animate(stage, "50% 50%", [
                { transform: "scale(0.98)", opacity: 0 },
                { transform: "scale(1)", opacity: 1 },
              ], SWITCH_MS, "ease-out");
            }
          }
        } finally {
          stage?.getAnimations().forEach((a) => a.cancel());
          if (step.switchedLevel) await remeasure();
          busy = false;
        }

        // Bring the change into view if it is off-screen, keeping the zoom where possible.
        const area = changeArea(step);
        if (!area) return;
        const rf = store.getState();
        const vp = getViewport();
        const onScreen = {
          x: area.x * vp.zoom + vp.x,
          y: area.y * vp.zoom + vp.y,
          width: area.width * vp.zoom,
          height: area.height * vp.zoom,
        };
        const inView =
          onScreen.x >= VIEW_MARGIN &&
          onScreen.y >= VIEW_MARGIN &&
          onScreen.x + onScreen.width <= rf.width - VIEW_MARGIN &&
          onScreen.y + onScreen.height <= rf.height - VIEW_MARGIN;
        if (!inView) {
          const target = getViewportForBounds(area, rf.width, rf.height, rf.minZoom, vp.zoom, FIT_PADDING);
          void setViewport(target, { duration: prefersReducedMotion() || queued > 0 ? 0 : PAN_MS });
        }
      });
      return queue;
    },
    [getViewport, setViewport, store, remeasure],
  );

  return {
    undo: useCallback(() => perform(undo), [perform]),
    redo: useCallback(() => perform(redo), [perform]),
  };
}

let queue: Promise<void> = Promise.resolve();
/** Steps waiting behind the one running. */
let queued = 0;

/** The canvas area covering everything the step touched, or `null` if none of it is drawn. */
function changeArea({ change, before }: HistoryStep): Rect | null {
  const { diagram } = useDiagramStore.getState();
  const positions = [
    ...change.boxes.map((id) => diagram.nodes[id]?.position),
    ...change.removedBoxes.map((id) => before.nodes[id]?.position),
    // A connection is drawn between the boxes on this canvas containing its
    // ends (lifted), which are not its real ends when those are deeper.
    ...connectionsOn(diagram, change.canvasId)
      .lines.filter((line) => change.connections.includes(line.edgeId))
      .flatMap((line) => [diagram.nodes[line.from]?.position, diagram.nodes[line.to]?.position]),
  ].filter((p) => p !== undefined);
  if (positions.length === 0) return null;
  const x = Math.min(...positions.map((p) => p.x));
  const y = Math.min(...positions.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...positions.map((p) => p.x)) + BOX_WIDTH - x,
    height: Math.max(...positions.map((p) => p.y)) + BOX_HEIGHT - y,
  };
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
