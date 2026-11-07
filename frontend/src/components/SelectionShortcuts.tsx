import { useEffect } from "react";
import { deleteSelection } from "@/canvas/deleteSelection";
import { isNavigating } from "@/canvas/navigation";
import { getChildren } from "@/model/queries";
import { useDiagramStore } from "@/store/diagramStore";
import { useCurrentCanvasId } from "@/store/hooks";
import { useViewStore } from "@/store/viewStore";
import { DeleteBoxesDialog } from "./DeleteBoxesDialog";

/**
 * Delete / Backspace removes what is selected (see deleteSelection); Ctrl+A
 * (⌘A on macOS) selects every box on the level. Text fields, dialogs and
 * menus keep these keys to themselves. Also shows the confirmation for
 * deleting boxes, whether asked for here or from a box's menu.
 */
export function SelectionShortcuts() {
  const canvasId = useCurrentCanvasId();
  const deleteRequest = useViewStore((s) => s.deleteRequest);
  const requestDelete = useViewStore((s) => s.requestDelete);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (document.querySelector("[role='alertdialog'], [role='dialog'], [role='menu']")) return;
      if (isNavigating()) return;

      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const { diagram } = useDiagramStore.getState();
        useViewStore.getState().selectBoxes(getChildren(diagram, canvasId).map((n) => n.id));
        return;
      }

      if ((event.key !== "Delete" && event.key !== "Backspace") || mod || event.shiftKey) return;
      if (!useViewStore.getState().selection) return;
      event.preventDefault();
      deleteSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canvasId]);

  return (
    <DeleteBoxesDialog
      ids={deleteRequest ?? []}
      open={deleteRequest !== null}
      onOpenChange={(open) => {
        if (!open) requestDelete(null);
      }}
    />
  );
}
