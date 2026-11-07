// Help for the editor: every shortcut and mouse gesture (helpContent.ts), and a short getting-started tour.
// Opened from the File menu, or with "?" (useHelpShortcut.ts).

import { Dialog, Tabs } from "radix-ui";
import type { ReactNode } from "react";
import { quietButton } from "@/decisions/styles";
import { canEditSomething } from "@/model/rights";
import { useAccessStore } from "@/store/accessStore";
import { GETTING_STARTED, keyLabel, SHORTCUT_GROUPS, type Key } from "./helpContent";
import { IS_MAC } from "./keys";
import { Modal } from "./Modal";

interface HelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HelpDialog({ open, onOpenChange }: HelpDialogProps) {
  const canEdit = useAccessStore((s) => canEditSomething(s.rights));
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Help"
      description="Shortcuts and a short guide to the editor."
      width={680}
    >
      <Tabs.Root defaultValue="shortcuts" className="mt-3 flex min-h-0 flex-1 flex-col">
        <Tabs.List aria-label="Help" className="flex shrink-0 gap-1 border-b border-line pb-2">
          <HelpTab value="shortcuts">Shortcuts</HelpTab>
          <HelpTab value="start">Getting started</HelpTab>
        </Tabs.List>

        <Tabs.Content value="shortcuts" className="scroll-thin min-h-0 flex-1 overflow-y-auto pt-3 pr-1 outline-none">
          {!canEdit && (
            <p className="mb-3 rounded-lg bg-surface-hover px-3 py-2 text-fg-muted">
              You can look at this diagram but not change it, so the items marked <EditorsOnly /> do nothing for you.
            </p>
          )}
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="mb-4 last:mb-0">
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">{group.title}</h3>
              <ul>
                {group.items.map((item) => (
                  <li
                    key={item.action}
                    data-shortcut={item.action}
                    className="flex items-baseline gap-4 border-b border-line/60 py-1.5 last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 text-fg">
                      {item.action}
                      {item.editOnly && !canEdit && <EditorsOnly />}
                    </span>
                    <span className="flex shrink-0 flex-wrap items-baseline justify-end gap-x-1.5 gap-y-1 text-right text-fg-muted">
                      {item.mouse && <span>{item.mouse}</span>}
                      {item.keys?.map((combo, i) => (
                        <span key={combo.join("+")} className="flex items-baseline gap-1.5">
                          {(i > 0 || item.mouse) && <span className="text-fg-subtle">or</span>}
                          <Combo keys={combo} />
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Tabs.Content>

        <Tabs.Content value="start" className="scroll-thin min-h-0 flex-1 overflow-y-auto pt-3 pr-1 outline-none">
          <ol className="flex flex-col gap-2.5">
            {GETTING_STARTED.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="flex gap-3 rounded-lg border border-line bg-surface p-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg-muted">
                  <Icon aria-hidden className="size-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="font-medium text-fg">
                    {i + 1}. {title}
                  </h3>
                  <p className="mt-1 leading-relaxed text-fg-muted">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </Tabs.Content>
      </Tabs.Root>

      <div className="mt-4 flex shrink-0 justify-end">
        <Dialog.Close className={quietButton}>Close</Dialog.Close>
      </div>
    </Modal>
  );
}

function HelpTab({ value, children }: { value: string; children: ReactNode }) {
  return (
    <Tabs.Trigger
      value={value}
      className="rounded-lg px-3 py-1.5 font-medium text-fg-muted outline-none hover:bg-surface-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-white/25 data-[state=active]:bg-accent-soft data-[state=active]:text-fg"
    >
      {children}
    </Tabs.Trigger>
  );
}

function Combo({ keys }: { keys: Key[] }) {
  return (
    <span className="flex items-baseline gap-0.5">
      {keys.map((key, i) => (
        <span key={key} className="flex items-baseline gap-0.5">
          {i > 0 && !IS_MAC && <span className="text-fg-subtle">+</span>}
          <kbd className="rounded border border-line-strong bg-surface px-1.5 py-px font-sans text-xs text-fg">
            {keyLabel(key)}
          </kbd>
        </span>
      ))}
    </span>
  );
}

function EditorsOnly() {
  return (
    <span className="ml-2 rounded bg-surface-hover px-1.5 py-px align-middle text-[11px] font-medium text-fg-subtle">
      Editors only
    </span>
  );
}
