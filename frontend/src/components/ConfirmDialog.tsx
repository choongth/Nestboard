import { AlertDialog } from "radix-ui";
import type { ReactNode } from "react";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  /** "danger" for destructive actions (the default), "accent" for plain acknowledgements. */
  tone?: "danger" | "accent";
  /** Omit the Cancel button, for messages that only need acknowledging. */
  hideCancel?: boolean;
  /** A second way out, shown between Cancel and the main action. */
  secondary?: { label: string; onClick: () => void };
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  tone = "danger",
  hideCancel,
  secondary,
}: ConfirmDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px]" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface-raised p-5 shadow-2xl shadow-black/50">
          <AlertDialog.Title className="text-[15px] font-semibold text-fg">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 leading-relaxed text-fg-muted">{description}</AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            {!hideCancel && (
              <AlertDialog.Cancel className="rounded-lg px-3 py-1.5 font-medium text-fg-muted hover:bg-surface-hover hover:text-fg">
                Cancel
              </AlertDialog.Cancel>
            )}
            {secondary && (
              <AlertDialog.Action
                onClick={secondary.onClick}
                className="rounded-lg border border-line-strong px-3 py-1.5 font-medium text-fg hover:bg-surface-hover"
              >
                {secondary.label}
              </AlertDialog.Action>
            )}
            <AlertDialog.Action
              onClick={onConfirm}
              className={`rounded-lg border px-3 py-1.5 font-medium transition-colors ${
                // Quiet tints, no solid fills: red for destructive, neutral otherwise.
                tone === "danger"
                  ? "border-rose-400/30 bg-rose-400/[0.10] text-rose-200 hover:bg-rose-400/[0.16]"
                  : "border-line-strong bg-white/[0.06] text-fg hover:bg-white/[0.10]"
              }`}
            >
              {confirmLabel}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
