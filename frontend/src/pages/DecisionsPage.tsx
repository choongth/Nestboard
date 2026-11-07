import { Download, ScrollText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useBlocker, useLocation, useNavigate, useParams } from "react-router";
import { adrsZipUrl, createAdr, type Adr } from "@/api/adrs";
import { listDiagrams } from "@/api/diagrams";
import { useProjectPath } from "@/app/useProjectPath";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AccountMenu } from "@/components/AccountMenu";
import { HeaderNav } from "@/components/HeaderNav";
import { AdrDetail } from "@/decisions/AdrDetail";
import { AdrList } from "@/decisions/AdrList";
import { useDecisionsStore } from "@/decisions/decisionsStore";
import { NewDecisionDialog } from "@/decisions/NewDecisionDialog";
import { scopeOptions, scopeTree } from "@/decisions/scopes";
import { quietButton, secondaryButton } from "@/decisions/styles";
import { useAccessStore } from "@/store/accessStore";
import { useDiagramStore } from "@/store/diagramStore";
import { useDocumentStore } from "@/store/documentStore";
import { useSessionStore } from "@/store/sessionStore";

/** Architecture decision records of the open project. */
export function DecisionsPage() {
  const project = useSessionStore((s) => s.project);
  const projectId = project?.id ?? null;
  const { adrs, state, error, load, refresh } = useDecisionsStore();
  const params = useParams();
  const { pathname, search, state: navState } = useLocation();
  const navigate = useNavigate();
  const toPage = useProjectPath();
  const [creating, setCreating] = useState(false);

  // The tree of what decisions are about is drawn from the open diagram;
  // boxes of other diagrams are named by their diagram.
  const diagram = useDiagramStore((s) => s.diagram);
  const diagramId = useDocumentStore((s) => s.id);
  const rights = useAccessStore((s) => s.rights);
  const [diagramNames, setDiagramNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    listDiagrams(projectId).then(
      (page) => !cancelled && setDiagramNames(Object.fromEntries(page.items.map((d) => [d.id, d.name]))),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  const open = useMemo(() => ({ id: diagramId, diagram }), [diagramId, diagram]);
  const groupByScope = useCallback((list: Adr[]) => scopeTree(list, open, diagramNames), [open, diagramNames]);
  const scopes = useMemo(() => scopeOptions(rights, open), [rights, open]);

  const number = params.number ? Number(params.number) : null;
  const selected = number === null ? undefined : adrs.find((a) => a.number === number);
  const startEditing = Boolean((navState as { edit?: boolean } | null)?.edit);

  // "Open it ready to edit" is a one-off: drop it from the history entry once
  // the decision is on screen, so coming Back later shows it read-only.
  useEffect(() => {
    if (startEditing && selected) void navigate(`${pathname}${search}`, { replace: true, state: null });
  }, [startEditing, selected, navigate, pathname, search]);

  useEffect(() => {
    document.title = `Decisions · ${project?.name ?? ""} — Nestboard`;
  }, [project?.name]);

  // The decisions follow the open project.
  useEffect(() => {
    void load(projectId);
  }, [projectId, load]);

  // The page always shows an ADR: with none chosen, the first one.
  const first = adrs[0]?.number;
  useEffect(() => {
    if (number === null && state === "ready" && first !== undefined) {
      void navigate(toPage(`/decisions/${first}`) + search, { replace: true });
    }
  }, [number, state, first, navigate, search, toPage]);

  const select = (n: number, edit = false) => navigate(toPage(`/decisions/${n}`) + search, { state: { edit } });

  // Leaving an ADR with unsaved edits (another ADR, another page, Back) asks
  // first. Changes that stay on the same ADR (e.g. tidying the history entry)
  // pass.
  const setDraftDirty = useDecisionsStore((s) => s.setDraftDirty);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      useDecisionsStore.getState().draftDirty &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );
  const discarding = useRef(false);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
        <HeaderNav />
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {projectId !== null &&
            (adrs.length > 0 ? (
              <a href={adrsZipUrl(projectId)} download className={quietButton} title="Every ADR as Markdown files, zipped">
                <Download className="size-4" />
                Export all
              </a>
            ) : (
              <span aria-disabled="true" className={`${quietButton} pointer-events-none opacity-40`}>
                <Download className="size-4" />
                Export all
              </span>
            ))}
          <AccountMenu />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 bg-canvas">
        {state === "error" ? (
          <Empty title="Couldn't load the ADRs" icon={<ScrollText className="size-5" />}>
            <p className="text-fg-muted">{error}</p>
            <button type="button" onClick={() => void refresh()} className={secondaryButton}>
              Try again
            </button>
          </Empty>
        ) : (
          <>
            <AdrList
              adrs={adrs}
              loading={state !== "ready"}
              selected={number}
              onSelect={(n) => void select(n)}
              onNew={() => setCreating(true)}
              groupByScope={groupByScope}
              cannotPropose={
                scopes.length > 0
                  ? undefined
                  : "You can't propose decisions here. Open a diagram with a box you can edit, or ask a project owner."
              }
            />
            {selected ? (
              <AdrDetail key={selected.id} adr={selected} adrs={adrs} startEditing={startEditing} scopes={scopes} />
            ) : (
              number !== null &&
              state === "ready" && (
                <Empty title={`There is no ADR-${String(number).padStart(4, "0")}`}>
                  <p className="text-fg-muted">It may have been deleted.</p>
                </Empty>
              )
            )}
          </>
        )}
      </main>

      <ConfirmDialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          // Closed without discarding (Cancel, Escape): stay on the ADR.
          if (!open && !discarding.current && blocker.state === "blocked") blocker.reset();
          discarding.current = false;
        }}
        title="Discard unsaved changes?"
        description={`Your changes to ${selected?.ref ?? "this ADR"} have not been saved.`}
        confirmLabel="Discard changes"
        onConfirm={() => {
          discarding.current = true;
          setDraftDirty(false);
          blocker.proceed?.();
        }}
      />

      {projectId !== null && (
        <NewDecisionDialog
          open={creating}
          onOpenChange={setCreating}
          scopes={scopes}
          onCreate={async (title, scope) => {
            const adr = await createAdr(projectId, { title, diagram_id: scope.diagram_id, box_id: scope.box_id });
            await refresh();
            setCreating(false);
            void select(adr.number, true);
          }}
        />
      )}
    </div>
  );
}

function Empty({ title, icon, children }: { title: string; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        {icon && (
          <span className="flex size-10 items-center justify-center rounded-lg border border-line bg-surface text-fg-muted">
            {icon}
          </span>
        )}
        <h1 className="text-base font-semibold">{title}</h1>
        {children}
      </div>
    </div>
  );
}
