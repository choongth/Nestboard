import { LoaderCircle } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import type { Paper } from "@/api/diagrams";
import { primaryButton, quietButton } from "@/decisions/styles";
import type { NodeId } from "@/model/types";
import { Modal } from "./Modal";

interface ExportPdfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The box whose inside is on screen, offered as a smaller export; `null` at the root. */
  level: { id: NodeId; title: string } | null;
  /** The diagram is not on the server yet: it goes there first. */
  unsaved: boolean;
  /** Resolves once the download has started; the dialog then closes. */
  onExport: (options: { box: NodeId | null; paper: Paper }) => Promise<void>;
}

const PAPERS: { value: Paper; label: string; hint: string }[] = [
  { value: "a4", label: "A4", hint: "210 × 297 mm" },
  { value: "letter", label: "US Letter", hint: "8.5 × 11 in" },
];

/** File > Export as PDF…: what to include and the paper size. */
export function ExportPdfDialog({ open, onOpenChange, level, unsaved, onExport }: ExportPdfDialogProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Export as PDF"
      description="A report with a cover, a table of contents and one page for each level of the diagram."
      showDescription
      width={440}
    >
      <ExportForm level={level} unsaved={unsaved} onExport={onExport} close={() => onOpenChange(false)} />
    </Modal>
  );
}

function ExportForm({
  level,
  unsaved,
  onExport,
  close,
}: Omit<ExportPdfDialogProps, "open" | "onOpenChange"> & { close: () => void }) {
  const [whole, setWhole] = useState(true);
  const [paper, setPaper] = useState<Paper>("a4");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="mt-4 flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void onExport({ box: whole || !level ? null : level.id, paper }).finally(close);
      }}
    >
      {level && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 font-medium text-fg-muted">Include</legend>
          <Choice name="scope" checked={whole} onChange={() => setWhole(true)} label="The whole diagram" hint="Every level, from the root" />
          <Choice
            name="scope"
            checked={!whole}
            onChange={() => setWhole(false)}
            label={`Only inside ${level.title}`}
            hint="This level and those nested in it"
          />
        </fieldset>
      )}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-medium text-fg-muted">Paper</legend>
        {PAPERS.map((p) => (
          <Choice key={p.value} name="paper" checked={paper === p.value} onChange={() => setPaper(p.value)} label={p.label} hint={p.hint} />
        ))}
      </fieldset>
      {unsaved && <p className="text-fg-subtle">The diagram will be saved first.</p>}
      <div className="flex justify-end gap-2">
        <Dialog.Close className={quietButton}>Cancel</Dialog.Close>
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
          {busy ? "Exporting…" : "Export PDF"}
        </button>
      </div>
    </form>
  );
}

function Choice(props: { name: string; checked: boolean; onChange: () => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-0.5">
      <input type="radio" name={props.name} checked={props.checked} onChange={props.onChange} className="accent-accent" />
      <span className="min-w-0 truncate text-fg">{props.label}</span>
      <span className="shrink-0 text-fg-subtle">{props.hint}</span>
    </label>
  );
}
