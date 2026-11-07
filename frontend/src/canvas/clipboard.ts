// Copy, cut, paste and duplicate for the selected boxes. The keyboard
// shortcuts go through the system clipboard (see useClipboardShortcuts), so
// boxes can be pasted into another tab or diagram; the canvas menu's Paste
// uses what was last copied in this tab, which needs no clipboard permission.

import type { XYPosition } from "@xyflow/react";
import { create } from "zustand";
import { extractFragment, fragmentFromText, fragmentToText } from "@/model/fragment";
import { getChildrenBounds, getSubtreeIds } from "@/model/queries";
import type { Diagram, NodeId, Position } from "@/model/types";
import { grantedBoxes, useAccessStore } from "@/store/accessStore";
import { useDiagramStore } from "@/store/diagramStore";
import { selectedBoxIds, useViewStore } from "@/store/viewStore";

/** How far each repeated paste or duplicate lands from the one before. */
export const PASTE_STEP = 24;

/** The text last copied in this tab, for the canvas menu's Paste. */
let copied: string | null = null;
/** The previous paste, so pasting again in the same place steps aside instead of stacking. */
let last: { text: string; at: XYPosition | null; count: number } | null = null;

/**
 * The selected boxes on the level on screen. An external box lives on another
 * level, so it is not copied, cut or duplicated from here.
 */
function selectedBoxes(): NodeId[] {
  const { nodes, rootId } = useDiagramStore.getState().diagram;
  const { selection, currentId } = useViewStore.getState();
  const canvasId = currentId && nodes[currentId] ? currentId : rootId;
  return selectedBoxIds(selection).filter((id) => nodes[id]?.parentId === canvasId);
}

/** Clipboard text for the selected boxes, or `null` when no box is selected. */
export function copySelection(): string | null {
  const ids = selectedBoxes();
  if (ids.length === 0) return null;
  copied = fragmentToText(extractFragment(useDiagramStore.getState().diagram, ids));
  last = null;
  return copied;
}

/**
 * A cut waiting for an answer: the boxes are copied already, but some have
 * people in charge of them (or hold such boxes), and pasting makes new boxes
 * without them. Deleting waits until the user says to go on.
 */
export const useCutWarning = create<{ ids: NodeId[] | null; boxes: string[] }>()(() => ({ ids: null, boxes: [] }));

/** Finishes a cut the user agreed to: deletes the boxes that were copied. */
export function confirmCut() {
  const { ids } = useCutWarning.getState();
  useCutWarning.setState({ ids: null, boxes: [] });
  if (!ids) return;
  useViewStore.getState().select(null);
  useDiagramStore.getState().deleteBoxes(ids);
}

/**
 * Copies the selected boxes, then deletes them (one undo step brings them
 * back). If any of them has people in charge, it asks first (useCutWarning).
 */
export function cutSelection(): string | null {
  const ids = selectedBoxes();
  const text = copySelection();
  if (text === null) return null;
  const { grants, diagramId } = useAccessStore.getState();
  const granted = grantedBoxes(grants, diagramId);
  const diagram = useDiagramStore.getState().diagram;
  const charged = ids.flatMap((id) => [...getSubtreeIds(diagram, id)]).filter((id) => granted.has(id));
  if (charged.length > 0) {
    useCutWarning.setState({ ids, boxes: charged.map((id) => diagram.nodes[id]?.title ?? id) });
    return text;
  }
  useViewStore.getState().select(null);
  useDiagramStore.getState().deleteBoxes(ids);
  return text;
}

/**
 * Copy and Cut from a menu, where there is no copy event to write into: they
 * go through the Clipboard API, which a menu click allows. If that is
 * unavailable or refused, Paste in the canvas menu still has the boxes.
 */
export const copySelectionToClipboard = () => writeToClipboard(copySelection());
export const cutSelectionToClipboard = () => writeToClipboard(cutSelection());

function writeToClipboard(text: string | null) {
  if (text !== null) navigator.clipboard?.writeText(text).catch(() => {});
}

export const hasCopied = () => copied !== null;

/**
 * Pastes clipboard text onto `canvasId`, centred on `at` (a canvas position)
 * when given, or else just off where the boxes were copied from. Pasting
 * again in the same place steps each copy aside. Returns `false`, changing
 * nothing, when the text is not Nestboard boxes.
 */
export function pasteText(text: string, canvasId: NodeId, at: XYPosition | null): boolean {
  const fragment = fragmentFromText(text);
  if (!fragment) return false;
  const same = last !== null && last.text === text && samePoint(last.at, at);
  const count = same ? last!.count + 1 : at ? 0 : 1;
  last = { text, at, count };

  const ids = useDiagramStore.getState().insertBoxes(canvasId, fragment, placement(fragment, at, count));
  useViewStore.getState().selectBoxes(ids);
  return true;
}

/** Pastes what was last copied in this tab. */
export function pasteCopied(canvasId: NodeId, at: XYPosition | null): boolean {
  return copied !== null && pasteText(copied, canvasId, at);
}

/** Copies the selected boxes next to themselves, leaving the clipboard alone. */
export function duplicateSelection(): boolean {
  const ids = selectedBoxes();
  if (ids.length === 0) return false;
  const store = useDiagramStore.getState();
  const fragment = extractFragment(store.diagram, ids);
  const pasted = store.insertBoxes(fragment.rootId, fragment, { x: PASTE_STEP, y: PASTE_STEP });
  useViewStore.getState().selectBoxes(pasted);
  return true;
}

/** How far to shift the fragment's boxes: centred on `at`, or stepped off their own spot. */
function placement(fragment: Diagram, at: XYPosition | null, count: number): Position {
  const step = count * PASTE_STEP;
  const bounds = getChildrenBounds(fragment, fragment.rootId)!;
  if (!at) return { x: step, y: step };
  return {
    x: Math.round(at.x - bounds.width / 2 - bounds.x) + step,
    y: Math.round(at.y - bounds.height / 2 - bounds.y) + step,
  };
}

function samePoint(a: XYPosition | null, b: XYPosition | null): boolean {
  return a === b || (a !== null && b !== null && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1);
}
