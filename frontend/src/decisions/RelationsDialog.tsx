import { Plus, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import type { Adr, RelationKind } from "@/api/adrs";
import { Modal } from "@/components/Modal";
import { RELATION_OUT } from "./status";
import { StatusBadge } from "./StatusBadge";
import { field, primaryButton, quietButton, secondaryButton } from "./styles";

type Relation = { kind: RelationKind; adr_id: string };

/** Relations that only make sense to a decision currently in force. */
const NEEDS_ACCEPTED: RelationKind[] = ["supersedes", "amends"];
const KINDS: RelationKind[] = ["supersedes", "amends", "relates_to"];

interface RelationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adr: Adr;
  /** The diagram's other decisions. */
  others: Adr[];
  onSave: (relations: Relation[]) => Promise<void>;
}

/** How a proposed decision relates to the diagram's other decisions. */
export function RelationsDialog({ open, onOpenChange, adr, others, onSave }: RelationsDialogProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`How ${adr.ref} relates to other decisions`}
      description="A decision it supersedes becomes superseded once this one is accepted. Superseding and amending need an accepted decision."
      showDescription
      width={640}
    >
      <RelationsForm adr={adr} others={others} onSave={onSave} />
    </Modal>
  );
}

function RelationsForm({ adr, others, onSave }: Omit<RelationsDialogProps, "open" | "onOpenChange">) {
  const [relations, setRelations] = useState<Relation[]>(() => adr.relations.map((r) => ({ kind: r.kind, adr_id: r.adr_id })));
  const [kind, setKind] = useState<RelationKind>("relates_to");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = new Map(others.map((a) => [a.id, a]));
  const existing = new Set(adr.relations.map((r) => `${r.kind}:${r.adr_id}`));
  const taken = new Set(relations.map((r) => r.adr_id));
  const candidates = others.filter(
    (a) => !taken.has(a.id) && (!NEEDS_ACCEPTED.includes(kind) || a.status === "accepted"),
  );

  const add = () => {
    if (!target) return;
    setRelations((prev) => [...prev, { kind, adr_id: target }]);
    setTarget("");
  };

  const save = () => {
    setBusy(true);
    setError(null);
    onSave(relations).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    });
  };

  return (
    <div className="mt-4 flex flex-col gap-3">
      <ul aria-label="Relations" className="flex flex-col gap-1">
        {relations.map((r) => {
          const other = byId.get(r.adr_id);
          const stale =
            NEEDS_ACCEPTED.includes(r.kind) && other?.status !== "accepted" && existing.has(`${r.kind}:${r.adr_id}`);
          return (
            <li key={r.adr_id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5">
              <span className="w-28 shrink-0 text-fg-muted">{RELATION_OUT[r.kind]}</span>
              <span className="font-mono text-xs text-fg-subtle">{other?.ref}</span>
              <span className="min-w-0 flex-1 truncate">{other?.title ?? "Unknown decision"}</span>
              {other && <StatusBadge status={other.status} size="small" />}
              {stale && <span className="text-xs text-amber-300">blocks accepting</span>}
              <button
                type="button"
                aria-label={`Remove relation to ${other?.ref ?? "decision"}`}
                onClick={() => setRelations((prev) => prev.filter((x) => x.adr_id !== r.adr_id))}
                className="rounded p-0.5 text-fg-subtle hover:bg-surface-hover hover:text-fg"
              >
                <X className="size-4" />
              </button>
            </li>
          );
        })}
        {relations.length === 0 && <li className="py-2 text-fg-muted">No relations yet.</li>}
      </ul>

      {/* A narrow kind, then as much room as possible for the decision's title.
          The wrappers set the widths; the fields fill them. */}
      <div className="flex items-center gap-2">
        <div className="w-30 shrink-0">
          <select
            aria-label="Relation kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as RelationKind);
              setTarget("");
            }}
            className={field}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {RELATION_OUT[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-1">
          <select
            aria-label="Related decision"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={`${field} truncate`}
          >
            <option value="">
              {candidates.length
                ? "Choose a decision…"
                : NEEDS_ACCEPTED.includes(kind)
                  ? "No accepted decision left"
                  : "No decision left"}
            </option>
            {candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {a.ref} · {a.title}
              </option>
            ))}
          </select>
        </div>
        <button type="button" disabled={!target} onClick={add} className={`${secondaryButton} shrink-0`}>
          <Plus className="size-4" />
          Add
        </button>
      </div>

      {error && <p className="text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Dialog.Close className={quietButton}>Cancel</Dialog.Close>
        <button type="button" disabled={busy} onClick={save} className={primaryButton}>
          Save relations
        </button>
      </div>
    </div>
  );
}
