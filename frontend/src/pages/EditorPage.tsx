import { ReactFlowProvider } from "@xyflow/react";
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { Canvas } from "@/canvas/Canvas";
import { useEscapeToExit, useNavigation } from "@/canvas/navigation";
import { CutWarningDialog } from "@/components/CutWarningDialog";
import { RefusalNotice } from "@/components/RefusalNotice";
import { SaveNotice } from "@/components/SaveNotice";
import { SelectionShortcuts } from "@/components/SelectionShortcuts";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { useClipboardShortcuts } from "@/components/useClipboardShortcuts";
import { useUndoShortcuts } from "@/components/useUndoShortcuts";
import { useDiagramStore } from "@/store/diagramStore";
import { useDocumentStore } from "@/store/documentStore";

export function EditorPage() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}

// Inside the React Flow provider, so shortcuts can drive the viewport.
function Editor() {
  useEscapeToExit();
  useUndoShortcuts();
  useClipboardShortcuts();
  useFitLoadedDiagram();
  useSelectFromAddress();
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="relative min-h-0 flex-1 overflow-hidden">
        <Canvas />
        <Sidebar />
        <SelectionShortcuts />
        <RefusalNotice />
        <SaveNotice />
        <CutWarningDialog />
      </main>
    </div>
  );
}

/**
 * `?select=<box id>` (e.g. from a decision's "About" list) goes to that box's
 * level and selects it, once the diagram holding it is open. The parameter is
 * then dropped, so a reload does not jump again.
 */
function useSelectFromAddress() {
  const [params, setParams] = useSearchParams();
  const boxId = params.get("select");
  const present = useDiagramStore((s) => boxId !== null && boxId in s.diagram.nodes);
  const { reveal } = useNavigation();
  useEffect(() => {
    if (!boxId || !present) return;
    void reveal(boxId);
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete("select");
        return next;
      },
      { replace: true },
    );
  }, [boxId, present, reveal, setParams]);
}

/** The load the view was last fitted for; module-wide so it survives page switches. */
let fittedLoad = 0;

/**
 * A newly loaded diagram (opened, new, imported; from the menu or the address
 * bar, even while another page was showing) is fitted on screen once the
 * editor shows it. Coming back to the same diagram keeps where you were.
 */
function useFitLoadedDiagram() {
  const loads = useDocumentStore((s) => s.loads);
  const { resetView } = useNavigation();
  useEffect(() => {
    if (loads === fittedLoad) return;
    fittedLoad = loads;
    void resetView();
  }, [loads, resetView]);
}
