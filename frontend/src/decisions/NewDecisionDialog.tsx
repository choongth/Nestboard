import { Dialog } from "radix-ui";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import type { ScopeOption } from "./scopes";
import { field, primaryButton, quietButton } from "./styles";

interface NewDecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What it can be about: the scopes you may write decisions for. */
  scopes: ScopeOption[];
  /** Picked to start with, e.g. the box selected in the editor. */
  initialScope?: string;
  /** Resolves once created; a rejection's message is shown in the dialog. */
  onCreate: (title: string, scope: ScopeOption) => Promise<void>;
}

export function NewDecisionDialog({ open, onOpenChange, ...form }: NewDecisionDialogProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="New ADR"
      description="It starts as proposed: write it up, then accept or reject it."
      showDescription
    >
      <NewDecisionForm {...form} />
    </Modal>
  );
}

function NewDecisionForm({ scopes, initialScope, onCreate }: Omit<NewDecisionDialogProps, "open" | "onOpenChange">) {
  const [title, setTitle] = useState("");
  const [scopeKey, setScopeKey] = useState(() =>
    scopes.some((s) => s.key === initialScope) ? initialScope! : (scopes[0]?.key ?? ""),
  );
  const scope = scopes.find((s) => s.key === scopeKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = title.replace(/\s+/g, " ").trim();

  return (
    <form
      className="mt-4 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed || busy || !scope) return;
        setBusy(true);
        setError(null);
        onCreate(trimmed, scope).catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
          setBusy(false);
        });
      }}
    >
      <input
        autoFocus
        aria-label="Title"
        placeholder="e.g. Use PostgreSQL for orders"
        maxLength={200}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className={field}
      />
      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-fg-muted">About</span>
        <select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} className={field}>
          {scopes.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-fg-subtle">
          Editors there can change it; owners there decide. It can link only to what is inside.
        </span>
      </label>
      {error && <p className="text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Dialog.Close className={quietButton}>Cancel</Dialog.Close>
        <button type="submit" disabled={!trimmed || busy || !scope} className={primaryButton}>
          Create
        </button>
      </div>
    </form>
  );
}
