import { useReactFlow, type XYPosition } from "@xyflow/react";
import { useEffect } from "react";
import { copySelection, cutSelection, duplicateSelection, pasteText } from "@/canvas/clipboard";
import { isNavigating, STAGE_ATTR } from "@/canvas/navigation";
import { useCurrentCanvasId } from "@/store/hooks";

/**
 * Ctrl+C / Ctrl+X / Ctrl+V copy, cut and paste the selected boxes through the
 * system clipboard (⌘ on macOS); Ctrl+D duplicates them. Listening to the
 * browser's own copy and paste events needs no clipboard permission, and text
 * fields, dialogs and selected text keep the usual behaviour.
 */
export function useClipboardShortcuts() {
  const canvasId = useCurrentCanvasId();
  const { screenToFlowPosition } = useReactFlow();

  useEffect(() => {
    // Where the pointer last was over the canvas, in screen coordinates.
    let pointer: XYPosition | null = null;
    const onPointerMove = (event: PointerEvent) => {
      const over = (event.target as Element | null)?.closest(".react-flow__pane, .react-flow__node");
      pointer = over?.closest(`[${STAGE_ATTR}]`) ? { x: event.clientX, y: event.clientY } : null;
    };

    const busy = (event: Event) => {
      if (event.defaultPrevented || isNavigating()) return true;
      const target = (event.target as HTMLElement | null) ?? null;
      const editing = (el: Element | null) => !!el?.closest("input, textarea, select, [contenteditable='true']");
      if (editing(target) || editing(document.activeElement)) return true;
      return !!document.querySelector("[role='alertdialog'], [role='dialog'], [role='menu']");
    };
    // Text the user has highlighted (e.g. in the sidebar) is copied as text.
    const textSelected = () => !!document.getSelection()?.toString();

    const onCopyOrCut = (event: ClipboardEvent) => {
      if (busy(event) || textSelected()) return;
      const text = event.type === "cut" ? cutSelection() : copySelection();
      if (text === null) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", text);
    };

    const onPaste = (event: ClipboardEvent) => {
      if (busy(event)) return;
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      if (pasteText(text, canvasId, pointer && screenToFlowPosition(pointer))) event.preventDefault();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "d" || busy(event)) return;
      // Also keeps the browser from bookmarking the page.
      event.preventDefault();
      duplicateSelection();
    };

    window.addEventListener("pointermove", onPointerMove);
    document.addEventListener("copy", onCopyOrCut);
    document.addEventListener("cut", onCopyOrCut);
    document.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("copy", onCopyOrCut);
      document.removeEventListener("cut", onCopyOrCut);
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [canvasId, screenToFlowPosition]);
}
