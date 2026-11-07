import { useEffect } from "react";
import { useHistoryActions } from "@/canvas/navigation";

/**
 * Ctrl+Z undoes; Ctrl+Y or Ctrl+Shift+Z redoes (Cmd on macOS). Text fields keep
 * the browser's own undo for what is being typed, and an open dialog blocks
 * both so nothing changes behind it.
 */
export function useUndoShortcuts() {
  const { undo, redo } = useHistoryActions();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const action = key === "z" ? (event.shiftKey ? redo : undo) : key === "y" ? redo : null;
      if (!action) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      // Steps queue behind each other; a level transition in progress is skipped by the queue itself.
      if (document.querySelector("[role='alertdialog']")) return;
      void action();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);
}
