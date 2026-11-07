import { Box, Search, Spline } from "lucide-react";
import { Dialog } from "radix-ui";
import { useMemo, useState } from "react";
import type { Adr, LinkKind, LinkRef } from "@/api/adrs";
import { Modal } from "@/components/Modal";
import { getSubtreeIds } from "@/model/queries";
import { useDiagramStore } from "@/store/diagramStore";
import { useDocumentStore, useHasUnsavedChanges } from "@/store/documentStore";
import { linkKey, linkTargets, type LinkTarget } from "./linkTargets";
import { primaryButton, quietButton, searchBox } from "./styles";

interface LinksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adr: Adr;
  /** Resolves once saved; a rejection's message is shown in the dialog. */
  onSave: (links: LinkRef[]) => Promise<void>;
}

/**
 * Which boxes and connections of the open diagram a decision is about. Its
 * links into other diagrams of the project are kept as they are.
 */
export function LinksDialog({ open, onOpenChange, adr, onSave }: LinksDialogProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`What ${adr.ref} is about`}
      description="Pick the boxes and connections this decision concerns."
      showDescription
      width={560}
    >
      <LinksForm adr={adr} onSave={onSave} />
    </Modal>
  );
}

function LinksForm({ adr, onSave }: { adr: Adr; onSave: LinksDialogProps["onSave"] }) {
  const diagram = useDiagramStore((s) => s.diagram);
  // Only a diagram saved on the server can be linked to.
  const diagramId = useDocumentStore((s) => s.id);
  const dirty = useHasUnsavedChanges();
  // A decision about a box links only to what is in it: the box, the boxes
  // inside, and connections touching them.
  const scope = adr.scope;
  const elsewhereScope = scope !== null && (scope.diagram_id !== diagramId || !(scope.box_id in diagram.nodes));
  const targets = useMemo(() => {
    if (diagramId === null || elsewhereScope) return [];
    const all = linkTargets(diagram);
    if (!scope) return all;
    const inside = getSubtreeIds(diagram, scope.box_id);
    return all.filter((t) => {
      if (t.kind === "box") return inside.has(t.id);
      const edge = diagram.edges[t.id];
      return edge !== undefined && (inside.has(edge.from) || inside.has(edge.to));
    });
  }, [diagram, diagramId, scope, elsewhereScope]);
  const here = useMemo(() => adr.links.filter((l) => l.diagram_id === diagramId), [adr.links, diagramId]);
  const elsewhere = adr.links.length - here.length;
  const orphans = useMemo(() => {
    const present = new Set(targets.map((t) => linkKey(t.kind, t.id)));
    return here.filter((l) => !present.has(linkKey(l.kind, l.id)));
  }, [here, targets]);

  const [chosen, setChosen] = useState(() => new Set(here.map((l) => linkKey(l.kind, l.id))));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const matches = (t: { title: string; path?: string }) =>
    !q || t.title.toLowerCase().includes(q) || (t.path ?? "").toLowerCase().includes(q);
  const toggle = (key: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const save = () => {
    setBusy(true);
    setError(null);
    const kept = adr.links
      .filter((l) => l.diagram_id !== diagramId)
      .map(({ diagram_id, kind, id }) => ({ diagram_id, kind, id }));
    const links =
      diagramId === null
        ? kept
        : [
            ...kept,
            ...[...chosen].map((key) => {
              const [kind, ...rest] = key.split(":");
              return { diagram_id: diagramId, kind: kind as LinkKind, id: rest.join(":") };
            }),
          ];
    onSave(links).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    });
  };

  const shown = targets.filter(matches);
  return (
    <div className="mt-4 flex min-h-0 flex-col gap-3">
      {diagramId === null && (
        <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-amber-200">
          This diagram is not saved on the server yet. Save it to link its boxes and connections.
        </p>
      )}
      {diagramId !== null && elsewhereScope && (
        <p className="rounded-lg border border-line bg-canvas px-3 py-2 text-fg-muted">
          {adr.ref} is about “{scope.title}”, which is not in this diagram. Open its diagram to link what is inside it.
        </p>
      )}
      {diagramId !== null && !elsewhereScope && dirty && (
        <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-amber-200">
          Some changes to the diagram have not reached the server yet. Boxes and connections added since can be linked
          once they have.
        </p>
      )}
      <label className={`${searchBox} bg-surface`}>
        <Search className="size-4 text-fg-subtle" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search boxes and connections"
          aria-label="Search boxes and connections"
          className="flex-1 bg-transparent text-fg outline-none placeholder:text-fg-subtle"
        />
      </label>

      <ul className="min-h-24 overflow-y-auto rounded-lg border border-line p-1" aria-label="Boxes and connections">
        {orphans.filter(matches).map((l) => (
          <TargetRow
            key={linkKey(l.kind, l.id)}
            target={{ ...l, path: "" }}
            note="No longer in the diagram"
            checked={chosen.has(linkKey(l.kind, l.id))}
            onToggle={() => toggle(linkKey(l.kind, l.id))}
          />
        ))}
        {shown.map((t) => (
          <TargetRow
            key={linkKey(t.kind, t.id)}
            target={t}
            checked={chosen.has(linkKey(t.kind, t.id))}
            onToggle={() => toggle(linkKey(t.kind, t.id))}
          />
        ))}
        {diagramId !== null && targets.length === 0 && orphans.length === 0 && (
          <li className="px-3 py-6 text-center text-fg-muted">The diagram has no boxes yet.</li>
        )}
        {(targets.length > 0 || orphans.length > 0) && shown.length === 0 && orphans.filter(matches).length === 0 && (
          <li className="px-3 py-6 text-center text-fg-muted">Nothing matches.</li>
        )}
      </ul>

      {error && <p className="text-danger">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-fg-subtle">
          {chosen.size} selected{elsewhere > 0 && ` · ${elsewhere} in other diagrams, kept`}
        </span>
        <Dialog.Close className={quietButton}>Cancel</Dialog.Close>
        <button type="button" disabled={busy} onClick={save} className={primaryButton}>
          Save links
        </button>
      </div>
    </div>
  );
}

function TargetRow({
  target,
  note,
  checked,
  onToggle,
}: {
  target: LinkTarget;
  note?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const Icon = target.kind === "box" ? Box : Spline;
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-hover">
        <input type="checkbox" checked={checked} onChange={onToggle} className="size-3.5 accent-accent" />
        <Icon className="size-4 shrink-0 text-fg-subtle" aria-label={target.kind === "box" ? "Box" : "Connection"} />
        <span className={`min-w-0 flex-1 truncate ${note ? "text-fg-muted line-through" : "text-fg"}`}>
          {target.title || <em className="text-fg-subtle">Untitled</em>}
        </span>
        <span className="shrink-0 truncate text-xs text-fg-subtle">{note ?? target.path}</span>
      </label>
    </li>
  );
}
