import { useEffect } from "react";
import { whenAccessChanges } from "@/files/liveDiagram";
import { useAccessStore } from "@/store/accessStore";
import { useDocumentStore } from "@/store/documentStore";
import { useSessionStore } from "@/store/sessionStore";

/**
 * Keeps what you may change in step with the open diagram and project, also
 * when the live connection says it changed.
 */
export function AccessSession() {
  const diagramId = useDocumentStore((s) => s.id);
  const projectId = useSessionStore((s) => s.project?.id);
  const load = useAccessStore((s) => s.load);

  useEffect(() => {
    void load(diagramId);
  }, [diagramId, projectId, load]);

  useEffect(() => {
    whenAccessChanges(() => void useAccessStore.getState().refresh());
    return () => whenAccessChanges(() => {});
  }, []);

  return null;
}
