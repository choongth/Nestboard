import { useEffect } from "react";

/**
 * "?" opens help, unless the key is meant for something else: typing in a field, or a dialog or menu already open.
 */
export function useHelpShortcut(openHelp: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (document.querySelector("[role='alertdialog'], [role='dialog'], [role='menu']")) return;
      event.preventDefault();
      openHelp();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openHelp]);
}
