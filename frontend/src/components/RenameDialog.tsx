import { Dialog } from "radix-ui";
import { useState } from "react";

const MAX_LENGTH = 200;

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: string;
  onRename: (name: string) => void;
  /** Defaults to "Rename diagram". */
  title?: string;
  /** The field's name for screen readers; defaults to "Diagram name". */
  label?: string;
}

export function RenameDialog({
  open,
  onOpenChange,
  current,
  onRename,
  title = "Rename diagram",
  label = "Diagram name",
}: RenameDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface-raised p-5 shadow-2xl shadow-black/50">
          {/* Mounted only while open, so it always starts from the current name. */}
          <RenameForm current={current} onRename={onRename} close={() => onOpenChange(false)} title={title} label={label} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RenameForm({
  current,
  onRename,
  close,
  title,
  label,
}: {
  current: string;
  onRename: (name: string) => void;
  close: () => void;
  title: string;
  label: string;
}) {
  const [value, setValue] = useState(current);
  const name = oneLine(value);
  const valid = name.length > 0 && name.length <= MAX_LENGTH;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        if (name !== current) onRename(name);
        close();
      }}
    >
      <Dialog.Title className="text-[15px] font-semibold text-fg">{title}</Dialog.Title>
      <Dialog.Description className="sr-only">Give the diagram a new name.</Dialog.Description>
      <input
        autoFocus
        aria-label={label}
        value={value}
        maxLength={MAX_LENGTH}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()}
        className="mt-3 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-fg outline-none focus:border-fg"
      />
      <div className="mt-5 flex justify-end gap-2">
        <Dialog.Close className="rounded-lg px-3 py-1.5 font-medium text-fg-muted hover:bg-surface-hover hover:text-fg">
          Cancel
        </Dialog.Close>
        <button
          type="submit"
          disabled={!valid}
          className="rounded-lg border border-line-strong bg-white/[0.06] px-3 py-1.5 font-medium text-fg transition-colors hover:bg-white/[0.10] disabled:opacity-40"
        >
          Rename
        </button>
      </div>
    </form>
  );
}

/** Names are one line, as the backend requires: control characters become spaces. */
function oneLine(text: string): string {
  return Array.from(text, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? " " : ch;
  })
    .join("")
    .trim();
}
