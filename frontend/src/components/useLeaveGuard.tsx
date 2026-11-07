import { useState } from "react";
import { useNavigate } from "react-router";
import { discardWork, finishWork, hasUnsavedWork } from "@/app/unsavedWork";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Going somewhere that closes the open diagram (another project, all
 * projects, an organization's page): with unsaved changes, asks first.
 * Render `dialog` next to whatever calls `go`.
 */
export function useLeaveGuard() {
  const navigate = useNavigate();
  /** Where to go once unsaved changes are given up. */
  const [leavingFor, setLeavingFor] = useState<string | null>(null);

  // What is on its way may arrive first.
  const go = (path: string) =>
    void finishWork("diagram").then(() => (hasUnsavedWork("diagram") ? setLeavingFor(path) : void navigate(path)));

  const dialog = (
    <ConfirmDialog
      open={leavingFor !== null}
      onOpenChange={(open) => !open && setLeavingFor(null)}
      title="Leave without saving?"
      description="Some changes to the open diagram have not reached the server yet. Leaving the project closes it."
      confirmLabel="Leave"
      onConfirm={() => {
        // The changes are given up, so coming back does not ask again.
        discardWork("diagram");
        if (leavingFor) void navigate(leavingFor);
      }}
    />
  );
  return { go, dialog };
}
