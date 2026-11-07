import { Dialog } from "radix-ui";
import { useState } from "react";
import type { Adr } from "@/api/adrs";
import { Modal } from "@/components/Modal";
import type { ScopeOption } from "./scopes";
import { field, primaryButton, quietButton } from "./styles";

interface MoveScopeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adr: Adr;
  /** Where it can go: scopes you may edit, other than its own. */
  scopes: ScopeOption[];
  /** Resolves once moved; a rejection's message is shown in the dialog. */
  onMove: (scope: ScopeOption) => Promise<void>;
}

/** Moves a proposed decision to the whole project or another box. */
export function MoveScopeDialog({ open, onOpenChange, adr, scopes, onMove }: MoveScopeDialogProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Move ${adr.ref}`}
      description="Who can change and decide it follows: editors and owners of where it goes. Its links must all be inside."
      showDescription
    >
      <MoveForm scopes={scopes} onMove={onMove} />
    </Modal>
  );
}

function MoveForm({ scopes, onMove }: Pick<MoveScopeDialogProps, "scopes" | "onMove">) {
  const [key, setKey] = useState(scopes[0]?.key ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = scopes.find((s) => s.key === key);

  return (
    <form
      className="mt-4 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!scope || busy) return;
        setBusy(true);
        setError(null);
        onMove(scope).catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
          setBusy(false);
        });
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-fg-muted">About</span>
        <select value={key} onChange={(e) => setKey(e.target.value)} className={field}>
          {scopes.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Dialog.Close className={quietButton}>Cancel</Dialog.Close>
        <button type="submit" disabled={!scope || busy} className={primaryButton}>
          Move
        </button>
      </div>
    </form>
  );
}
