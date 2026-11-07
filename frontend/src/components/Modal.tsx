import { Dialog } from "radix-ui";
import type { ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** For screen readers; shown only if `showDescription`. */
  description: string;
  showDescription?: boolean;
  width?: number;
  /** Rendered only while open, so its state starts fresh each time. */
  children: ReactNode;
}

/** A dialog in the app's style: title, optional description, then `children`. */
export function Modal({ open, onOpenChange, title, description, showDescription, width = 480, children }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px]" />
        <Dialog.Content
          style={{ width: `min(${width}px, calc(100vw - 32px))` }}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[80vh] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-surface-raised p-5 shadow-2xl shadow-black/50"
        >
          <Dialog.Title className="text-[15px] font-semibold text-fg">{title}</Dialog.Title>
          <Dialog.Description className={showDescription ? "mt-1.5 leading-relaxed text-fg-muted" : "sr-only"}>
            {description}
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
