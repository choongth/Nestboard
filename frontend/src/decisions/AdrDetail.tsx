import { Box, Download, FolderKanban, Link2, MoveRight, Pencil, Spline, Trash2, Waypoints } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { ApiError } from "@/api/client";
import { DIAGRAM_PARAM } from "@/app/DiagramSession";
import { useProjectPath } from "@/app/useProjectPath";
import {
  adrMarkdownUrl,
  deleteAdr,
  editAdr,
  setAdrLinks,
  setAdrRelations,
  setAdrScope,
  supersedeAdr,
  transitionAdr,
  type Adr,
  type AdrListField,
  type AdrStatus,
  type Author,
  authorName,
} from "@/api/adrs";
import { formatDate } from "@/app/dates";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AdrEditor } from "./AdrEditor";
import { useDecisionsStore } from "./decisionsStore";
import { HistorySection } from "./HistorySection";
import { DecisionMarker, NegativeMarker, PositiveMarker } from "./ItemMarkers";
import { ItemList } from "./ItemList";
import { LinksDialog } from "./LinksDialog";
import { MoveScopeDialog } from "./MoveScopeDialog";
import { Markdown } from "./Markdown";
import { RelationsDialog } from "./RelationsDialog";
import { scopeKey, type ScopeOption } from "./scopes";
import { NEXT_STATUSES, RELATION_IN, RELATION_OUT, STATUS_LABEL, TRANSITION_LABEL } from "./status";
import { StatusBadge } from "./StatusBadge";
import { acceptButton, neutralButton, quietButton, rejectButton, scrollArea, sectionLabel } from "./styles";


type Dialog =
  | { kind: "links" }
  | { kind: "relations" }
  | { kind: "scope" }
  | { kind: "transition"; to: AdrStatus }
  | { kind: "delete" }
  | { kind: "error"; title: string; message: string }
  | null;

interface AdrDetailProps {
  adr: Adr;
  /** Every decision of the diagram, for relations. */
  adrs: Adr[];
  /** Open the editor form right away (e.g. just created). */
  startEditing: boolean;
  /** The scopes you may write decisions about, to move this one to. */
  scopes: ScopeOption[];
}

/** One decision: what it says, its status and what it is linked to. Give it `key={adr.id}`. */
export function AdrDetail({ adr, adrs, startEditing, scopes }: AdrDetailProps) {
  const navigate = useNavigate();
  const toPage = useProjectPath();
  const { search } = useLocation();
  const refresh = useDecisionsStore((s) => s.refresh);
  /** Editing, optionally having just asked for a new item in one of the lists. */
  // What you may do depends on your role where the decision is (its scope):
  // editors there write and link it, owners there decide.
  const canEdit = adr.my_role !== "viewer";
  const canDecide = adr.my_role === "owner";
  const [editing, setEditing] = useState<false | { addTo?: AdrListField }>(
    startEditing && adr.status === "proposed" && canEdit ? {} : false,
  );
  const [dialog, setDialog] = useState<Dialog>(null);
  /** Proposed, and yours to change. */
  const proposed = adr.status === "proposed" && canEdit;
  const others = adrs.filter((a) => a.id !== adr.id);

  /**
   * Sends a change, then reloads every decision (one change can touch
   * several). A conflict reloads too, so the latest version is on screen.
   * Rethrows, so forms can show the message.
   */
  const change = async (task: () => Promise<unknown>) => {
    try {
      await task();
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "version_conflict") {
        await refresh();
        throw new Error("Someone else changed this decision. The latest version is now shown; please try again.");
      }
      throw e;
    }
  };

  /** The same, for buttons: errors become a dialog. */
  const act = (title: string, task: () => Promise<unknown>) =>
    change(task).catch((e: unknown) =>
      setDialog({ kind: "error", title, message: e instanceof Error ? e.message : String(e) }),
    );

  const open = (number: number, edit = false) => navigate(toPage(`/decisions/${number}`) + search, { state: { edit } });
  const showInEditor = (diagramId: string, boxId: string) => {
    const params = new URLSearchParams(search);
    params.set(DIAGRAM_PARAM, diagramId);
    params.set("select", boxId);
    void navigate(`${toPage("/editor")}?${params}`);
  };

  const supersede = () =>
    act("Couldn't start the new decision", async () => {
      const created = await supersedeAdr(adr.id);
      await refresh();
      void open(created.number, true);
    });

  const transition = (to: AdrStatus) => act(`Couldn't mark it ${STATUS_LABEL[to].toLowerCase()}`, () => transitionAdr(adr.id, adr.version, to));

  const willSupersede = adr.relations.filter((r) => r.kind === "supersedes");

  /** Status, number and title in one row, then the date and the actions. */
  const header = (title: ReactNode) => (
    <header className="flex flex-col gap-2 border-b border-line pb-5">
      <div className="flex min-h-9 items-center gap-3">
        <StatusBadge status={adr.status} size="large" />
        <span className="shrink-0 font-mono text-sm text-fg-muted">{adr.ref}</span>
        {title}
      </div>
      <p className="text-fg-subtle">
        {adr.decided_at
          ? `${adr.status === "rejected" ? "Rejected" : "Accepted"} on ${formatDate(adr.decided_at)}${byline(adr.decided_by)}`
          : `Proposed on ${formatDate(adr.created_at)}${byline(adr.proposed_by)}`}
        {adr.status === "deprecated" && " · since deprecated"}
        {adr.status === "superseded" && " · since superseded"}
      </p>
      <div data-scope-line className="flex items-center gap-1.5 text-fg-subtle">
        {adr.scope ? <Box className="size-3.5" /> : <FolderKanban className="size-3.5" />}
        <span>
          About{" "}
          <span className={adr.scope?.orphaned ? "line-through" : "text-fg-muted"}>
            {adr.scope ? adr.scope.title : "the whole project"}
          </span>
          {adr.scope?.orphaned && " (deleted)"}
        </span>
        {proposed && scopes.some((s) => s.key !== scopeKey(adr)) && (
          <button type="button" onClick={() => setDialog({ kind: "scope" })} className={quietButton}>
            <MoveRight className="size-3.5" />
            Move…
          </button>
        )}
      </div>
      {!editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {proposed && (
            <button type="button" onClick={() => setEditing({})} className={neutralButton}>
              <Pencil className="size-4" />
              Edit
            </button>
          )}
          {adr.status === "accepted" && canDecide && (
            <button type="button" onClick={() => void supersede()} className={neutralButton}>
              <Waypoints className="size-4" />
              Supersede…
            </button>
          )}
          {(canDecide ? NEXT_STATUSES[adr.status] : []).map((to) => (
            <button
              key={to}
              type="button"
              onClick={() => setDialog({ kind: "transition", to })}
              className={to === "accepted" ? acceptButton : to === "rejected" ? rejectButton : neutralButton}
            >
              {TRANSITION_LABEL[to]}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-1">
            <a href={adrMarkdownUrl(adr.id)} download className={quietButton}>
              <Download className="size-4" />
              Markdown
            </a>
            {proposed && (
              <button
                type="button"
                aria-label="Delete decision"
                onClick={() => setDialog({ kind: "delete" })}
                className={`${quietButton} hover:text-danger`}
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </span>
        </div>
      )}
    </header>
  );

  return (
    <article aria-label={`${adr.ref} ${adr.title}`} className="flex min-h-0 min-w-0 flex-1">
      {/* The middle column scrolls on its own; the sidebars stay put. */}
      <div className={`${scrollArea} min-w-0 flex-1`}>
        <div className="mx-auto w-full max-w-3xl px-8 py-6">
          {editing ? (
            <AdrEditor
              adr={adr}
              addTo={editing.addTo}
              renderHeader={header}
              onCancel={() => setEditing(false)}
              onSave={async (changes) => {
                await change(() => editAdr(adr.id, adr.version, changes));
                setEditing(false);
              }}
            />
          ) : (
            <div className="flex flex-col gap-8">
              {header(<h1 className="min-w-0 flex-1 text-xl leading-snug font-semibold">{adr.title}</h1>)}
              <section aria-label="Context" className="flex flex-col gap-2">
                <h2 className={sectionLabel}>Context</h2>
                {adr.context.trim() ? (
                  <Markdown text={adr.context} />
                ) : (
                  <p className="text-fg-subtle italic">Not written yet.</p>
                )}
              </section>

              <section aria-label="Decision" className="flex flex-col gap-2">
                <h2 className={sectionLabel}>Decision</h2>
                <ItemList
                  items={adr.decisions}
                  marker={<DecisionMarker />}
                  empty="No decisions yet."
                  add={proposed ? { label: "New decision", onClick: () => setEditing({ addTo: "decisions" }) } : undefined}
                />
              </section>

              <section aria-label="Consequences" className="flex flex-col gap-3">
                <h2 className={sectionLabel}>Consequences</h2>
                <div className="flex flex-col gap-5">
                  <section aria-label="Positive consequences" className="flex flex-col gap-2">
                    <h3 className="font-medium text-emerald-300">Positive</h3>
                    <ItemList
                      items={adr.positive_consequences}
                      marker={<PositiveMarker />}
                      empty="None yet."
                      add={
                        proposed
                          ? { label: "Positive", onClick: () => setEditing({ addTo: "positive_consequences" }) }
                          : undefined
                      }
                    />
                  </section>
                  <section aria-label="Negative consequences" className="flex flex-col gap-2">
                    <h3 className="font-medium text-rose-300">Negative</h3>
                    <ItemList
                      items={adr.negative_consequences}
                      marker={<NegativeMarker />}
                      empty="None yet."
                      add={
                        proposed
                          ? { label: "Negative", onClick: () => setEditing({ addTo: "negative_consequences" }) }
                          : undefined
                      }
                    />
                  </section>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>

      <aside className={`${scrollArea} flex w-80 shrink-0 flex-col gap-7 border-l border-line px-6 py-6`}>
        <section aria-label="Diagram elements" className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className={sectionLabel}>About</h2>
            {canEdit && (
              <button type="button" aria-label="Edit links" onClick={() => setDialog({ kind: "links" })} className={quietButton}>
                <Link2 className="size-3.5" />
                Edit
              </button>
            )}
          </div>
          {adr.links.length === 0 && <p className="text-fg-subtle">Not linked to any box or connection.</p>}
          <ul className="flex flex-col gap-1">
            {adr.links.map((link) => {
              const Icon = link.kind === "box" ? Box : Spline;
              const label = (
                <>
                  <Icon className="size-4 shrink-0 text-fg-subtle" aria-label={link.kind === "box" ? "Box" : "Connection"} />
                  <span className={`min-w-0 flex-1 truncate ${link.orphaned ? "text-fg-subtle line-through" : ""}`}>
                    {link.title || "Untitled"}
                  </span>
                </>
              );
              return (
                <li key={`${link.diagram_id}:${link.kind}:${link.id}`}>
                  {link.kind === "box" && !link.orphaned ? (
                    <button
                      type="button"
                      title="Show in the editor"
                      onClick={() => showInEditor(link.diagram_id, link.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-surface-hover"
                    >
                      {label}
                    </button>
                  ) : (
                    <span className="flex items-center gap-2 px-2 py-1" title={link.orphaned ? "No longer in the diagram" : undefined}>
                      {label}
                      {link.orphaned && <span className="text-xs text-fg-subtle">deleted</span>}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="Related decisions" className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className={sectionLabel}>Related decisions</h2>
            {proposed && (
              <button type="button" aria-label="Edit relations" onClick={() => setDialog({ kind: "relations" })} className={quietButton}>
                <Pencil className="size-3.5" />
                Edit
              </button>
            )}
          </div>
          {adr.relations.length + adr.referenced_by.length === 0 && <p className="text-fg-subtle">None.</p>}
          <ul className="flex flex-col gap-1">
            {[
              ...adr.relations.map((r) => ({ r, verb: RELATION_OUT[r.kind] })),
              ...adr.referenced_by.map((r) => ({ r, verb: RELATION_IN[r.kind] })),
            ].map(({ r, verb }) => {
              const number = Number(r.ref.replace("ADR-", ""));
              return (
                <li key={`${verb}:${r.adr_id}`}>
                  <button
                    type="button"
                    onClick={() => void open(number)}
                    className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1 text-left hover:bg-surface-hover"
                  >
                    <span className="text-xs text-fg-subtle">{verb}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-fg-subtle">{r.ref}</span>
                      <span className="min-w-0 flex-1 truncate">{r.title}</span>
                      <StatusBadge status={r.status} size="small" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <HistorySection key={adr.version} adrId={adr.id} />
      </aside>

      <LinksDialog
        open={dialog?.kind === "links"}
        onOpenChange={(o) => !o && setDialog(null)}
        adr={adr}
        onSave={async (links) => {
          await change(() => setAdrLinks(adr.id, adr.version, links));
          setDialog(null);
        }}
      />
      <MoveScopeDialog
        open={dialog?.kind === "scope"}
        onOpenChange={(o) => !o && setDialog(null)}
        adr={adr}
        scopes={scopes.filter((s) => s.key !== scopeKey(adr))}
        onMove={async (scope) => {
          const box = scope.diagram_id && scope.box_id ? { diagram_id: scope.diagram_id, box_id: scope.box_id } : undefined;
          await change(() => setAdrScope(adr.id, adr.version, box));
          setDialog(null);
        }}
      />
      <RelationsDialog
        open={dialog?.kind === "relations"}
        onOpenChange={(o) => !o && setDialog(null)}
        adr={adr}
        others={others}
        onSave={async (relations) => {
          await change(() => setAdrRelations(adr.id, adr.version, relations));
          setDialog(null);
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === "transition"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.kind === "transition" ? `${TRANSITION_LABEL[dialog.to]} ${adr.ref}?` : ""}
        description={dialog?.kind === "transition" ? transitionWarning(adr, dialog.to, willSupersede.map((r) => r.ref)) : ""}
        confirmLabel={dialog?.kind === "transition" ? (TRANSITION_LABEL[dialog.to] ?? "") : ""}
        tone={dialog?.kind === "transition" && dialog.to === "accepted" ? "accent" : "danger"}
        onConfirm={() => {
          if (dialog?.kind === "transition") void transition(dialog.to);
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Delete ${adr.ref}?`}
        description="This proposed decision and its history are deleted. Its number is not reused."
        confirmLabel="Delete"
        onConfirm={() =>
          void act("Couldn't delete the decision", async () => {
            await deleteAdr(adr.id);
            void navigate(toPage("/decisions") + search);
          })
        }
      />
      <ConfirmDialog
        open={dialog?.kind === "error"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.kind === "error" ? dialog.title : ""}
        description={dialog?.kind === "error" ? dialog.message : ""}
        confirmLabel="OK"
        tone="accent"
        hideCancel
        onConfirm={() => setDialog(null)}
      />
    </article>
  );
}

/** What confirming a status change means, in a sentence or two. */
function transitionWarning(adr: Adr, to: AdrStatus, superseding: string[]): string {
  if (to === "accepted") {
    const also = superseding.length ? ` ${superseding.join(", ")} will be marked superseded.` : "";
    return `Once accepted, its text can no longer be edited; to change course later, supersede it.${also}`;
  }
  if (to === "rejected") return "A rejected decision stays on record, but can no longer be edited or accepted.";
  return `${adr.ref} stays on record as no longer in force. This cannot be undone.`;
}

/** " by Alice (Architect)", or nothing if not known. */
function byline(author: Author | null): string {
  return author ? ` by ${authorName(author)}` : "";
}
