import { useEffect, useState } from "react";
import { Link, Outlet, useParams } from "react-router";
import { getProject } from "@/api/orgs";
import { neutralButton } from "@/decisions/styles";
import { newDiagram } from "@/files/documentActions";
import { useSessionStore } from "@/store/sessionStore";
import { AccessSession } from "./AccessSession";
import { DiagramSession } from "./DiagramSession";
import { preloadProjectPages } from "./pageLoaders";
import { ORGANIZATIONS } from "./pages";

/**
 * /organizations/<org id>/projects/<project id>/...: finds the project from
 * the address and makes it the one the pages work in. Entering a different
 * project starts from an empty diagram, since diagrams belong to their project.
 */
export function ProjectShell() {
  const { org: orgId = "", project: projectId = "" } = useParams();
  const project = useSessionStore((s) => s.project);
  const setProject = useSessionStore((s) => s.setProject);
  const [problem, setProblem] = useState<{ ids: string; message: string } | null>(null);
  const ids = `${orgId}/${projectId}`;
  const matches = project !== null && `${project.org_id}/${project.id}` === ids;

  // The project's other pages, so switching to them does not wait.
  useEffect(() => {
    if (matches) preloadProjectPages();
  }, [matches]);

  useEffect(() => {
    if (matches) return;
    let cancelled = false;
    const missing = "It may have been deleted, or you don't have access to it.";
    void (async () => {
      const detail = await getProject(projectId).catch(() => {
        throw new Error(missing);
      });
      // The organization in the address must be the project's own.
      if (detail.org_id !== orgId) throw new Error(missing);
      if (cancelled) return;
      if (useSessionStore.getState().project?.id !== detail.id) newDiagram();
      setProject(detail);
    })().catch((e: unknown) => {
      if (!cancelled) setProblem({ ids, message: e instanceof Error ? e.message : String(e) });
    });
    return () => {
      cancelled = true;
    };
  }, [matches, orgId, projectId, ids, setProject]);

  if (problem?.ids === ids) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <h1 className="text-base font-semibold">This project doesn't exist</h1>
          <p className="text-fg-muted">{problem.message}</p>
          <Link to={ORGANIZATIONS} className={neutralButton}>
            Your projects
          </Link>
        </div>
      </div>
    );
  }
  if (!matches) return null;
  return (
    <>
      <DiagramSession />
      <AccessSession />
      <Outlet />
    </>
  );
}
