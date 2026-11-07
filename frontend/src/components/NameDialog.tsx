import { useId, useState, type FormEvent } from "react";
import { field, primaryButton, secondaryButton } from "@/decisions/styles";
import { Modal } from "./Modal";

interface NameDialogProps {
  title: string;
  description: string;
  onClose: () => void;
  /** Resolves once created; a rejection's message is shown in the dialog. */
  onCreate: (name: string) => Promise<void>;
}

/** Names something new: an organization or a project. */
export function NameDialog({ title, description, onClose, onCreate }: NameDialogProps) {
  const nameId = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={title} description={description} showDescription>
      <form onSubmit={(e) => void submit(e)} className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className="font-medium text-fg-muted">
            Name
          </label>
          <input id={nameId} value={name} onChange={(e) => setName(e.target.value)} className={field} autoFocus />
        </div>
        {error && <p className="text-rose-200">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={busy || !name.trim()}>
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}
