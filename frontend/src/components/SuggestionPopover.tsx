// Pieces shared by the sidebar's text fields: the labelled field wrapper, the
// input style, and the suggestion list that hangs under a field while typing.

import { Popover } from "radix-ui";
import type { ReactNode } from "react";
import type { SuggestionGroup } from "@/registry/technologySuggestions";
import { optionId } from "./combobox";

export const INPUT_CLASS =
  "w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg placeholder:text-fg-subtle outline-none transition-colors hover:border-line-strong focus:border-fg-muted focus:ring-2 focus:ring-white/10";

export function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-fg-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

interface SuggestionPopoverProps {
  open: boolean;
  onClose: () => void;
  /** The input's id: clicks on it do not count as clicking outside. */
  inputId: string;
  listId: string;
  /** Accessible name of the list, e.g. "Technology suggestions". */
  label: string;
  groups: SuggestionGroup[];
  /** Index into all items across groups, or -1. */
  active: number;
  onActiveChange: (index: number) => void;
  onPick: (item: string) => void;
  /** Drawn before each item's text, e.g. a logo. */
  renderBefore?: (item: string) => ReactNode;
  /** The input, which the list is anchored to. */
  children: ReactNode;
}

export function SuggestionPopover({
  open,
  onClose,
  inputId,
  listId,
  label,
  groups,
  active,
  onActiveChange,
  onPick,
  renderBefore,
  children,
}: SuggestionPopoverProps) {
  let index = 0;
  return (
    <Popover.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Popover.Anchor asChild>{children}</Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          id={listId}
          role="listbox"
          aria-label={label}
          align="start"
          sideOffset={6}
          collisionPadding={12}
          // Focus stays in the field; the list follows along.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if ((e.target as Element).id === inputId) e.preventDefault();
          }}
          className="z-50 max-h-64 w-(--radix-popover-trigger-width) overflow-y-auto rounded-lg border border-line bg-surface-raised p-1 shadow-xl shadow-black/40"
        >
          {groups.map((group) => (
            <div key={group.label} role="group" aria-label={group.label}>
              <div className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">
                {group.label}
              </div>
              {group.items.map((item) => {
                const i = index++;
                return (
                  <div
                    key={item}
                    id={optionId(listId, i)}
                    role="option"
                    aria-selected={i === active}
                    // Keep focus in the field so the edit stays one undo step.
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => onActiveChange(i)}
                    onClick={() => onPick(item)}
                    className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-fg select-none aria-selected:bg-surface-hover"
                  >
                    {renderBefore?.(item)}
                    <span data-option-text>{item}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
