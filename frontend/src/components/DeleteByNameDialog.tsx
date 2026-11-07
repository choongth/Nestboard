import { Dialog } from "radix-ui";
import { useState } from "react";
import { field, quietButton } from "@/decisions/styles";
import { Modal } from "./Modal";

interface DeleteByNameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "Delete Checkout?" */
  title: string;
  /** What goes with it. */
  description: string;
  /** Typed in full to confirm. */
  name: string;
  /** Resolves once deleted; a rejection's message is shown in the dialog. */
  onDelete: () => Promise<void>;
}

/**
 * For deletions that take a lot with them (a project, an organization):
 * confirmed by typing the name, so it cannot happen by a stray click.
 */
export function DeleteByNameDialog({ open, onOpenChange, title, description, ...form }: DeleteByNameDialogProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description} showDescription>
      <DeleteForm {...form} />
    </Modal>
  );
}

function DeleteForm({ name, onDelete }: Pick<DeleteByNameDialogProps, "name" | "onDelete">) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === name.trim();

  return (
    <form
      className="mt-4 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!matches || busy) return;
        setBusy(true);
        setError(null);
        onDelete().catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
          setBusy(false);
        });
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-fg-muted">
          Type <strong className="text-fg">{name}</strong> to confirm
        </span>
        <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} className={field} />
      </label>
      {error && <p className="text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Dialog.Close className={quietButton}>Cancel</Dialog.Close>
        <button
          type="submit"
          disabled={!matches || busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/25 bg-rose-400/[0.08] px-3 py-1.5 font-medium text-rose-200 outline-none hover:bg-rose-400/[0.14] focus-visible:ring-2 focus-visible:ring-white/25 disabled:opacity-40"
        >
          Delete
        </button>
      </div>
    </form>
  );
}
