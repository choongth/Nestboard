import { getNestedCount } from "@/model/queries";
import { useDiagramStore } from "@/store/diagramStore";
import { useViewStore } from "@/store/viewStore";

/**
 * Deletes what is selected, from the Delete key or a box's menu. Several
 * boxes, or a box with boxes inside, are confirmed first; one connection or
 * one empty box goes straight away, since undo brings it back.
 */
export function deleteSelection() {
  const view = useViewStore.getState();
  const store = useDiagramStore.getState();
  const { selection } = view;
  if (!selection) return;
  if (selection.type === "connection") {
    view.select(null);
    store.deleteConnection(selection.id);
    return;
  }
  const ids = selection.ids.filter((id) => store.diagram.nodes[id]);
  if (ids.length === 1 && getNestedCount(store.diagram, ids) === 0) {
    view.select(null);
    store.deleteBoxes(ids);
  } else if (ids.length > 0) {
    view.requestDelete(ids);
  }
}
