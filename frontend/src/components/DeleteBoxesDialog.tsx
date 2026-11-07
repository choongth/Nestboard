import { getNestedCount } from "@/model/queries";
import type { NodeId } from "@/model/types";
import { useDiagramStore } from "@/store/diagramStore";
import { useViewStore } from "@/store/viewStore";
import { ConfirmDialog } from "./ConfirmDialog";

/** Asks before deleting boxes, saying how many nested boxes go with them. */
export function DeleteBoxesDialog({
  ids,
  open,
  onOpenChange,
}: {
  ids: readonly NodeId[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const select = useViewStore((s) => s.select);
  const deleteBoxes = useDiagramStore((s) => s.deleteBoxes);
  const diagram = useDiagramStore((s) => s.diagram);
  const nested = getNestedCount(diagram, ids);
  const single = ids.length === 1 ? diagram.nodes[ids[0]!] : undefined;
  const boxes = (n: number) => `${n} ${n === 1 ? "box" : "boxes"}`;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={single ? `Delete "${single.title}"?` : `Delete ${boxes(ids.length)}?`}
      description={
        nested > 0
          ? `This also deletes the ${boxes(nested)} nested inside ${single ? "it" : "them"}, and their connections.`
          : `${single ? "Its" : "Their"} connections will be deleted too.`
      }
      confirmLabel="Delete"
      onConfirm={() => {
        select(null);
        deleteBoxes(ids.filter((id) => useDiagramStore.getState().diagram.nodes[id]));
      }}
    />
  );
}
