import { confirmCut, useCutWarning } from "@/canvas/clipboard";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Asks before cutting boxes that people are in charge of: a pasted box is a
 * new box, so what was given on the old one does not come along.
 */
export function CutWarningDialog() {
  const { ids, boxes } = useCutWarning();
  const names = boxes.map((b) => `"${b}"`).join(", ");
  return (
    <ConfirmDialog
      open={ids !== null}
      onOpenChange={(open) => !open && useCutWarning.setState({ ids: null, boxes: [] })}
      title="Cut boxes that people are in charge of?"
      description={`${names} ${boxes.length === 1 ? "has" : "have"} people in charge or with access of their own. Pasting makes new boxes, without that access: it would have to be given again. They are copied either way.`}
      confirmLabel="Cut anyway"
      onConfirm={confirmCut}
    />
  );
}
