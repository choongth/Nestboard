import { Check, ChevronsUpDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useLocation, useNavigate } from "react-router";
import { PAGES, pageForPath } from "@/app/pages";
import { useProjectPath } from "@/app/useProjectPath";

/** The current page of the project (after the project in the header); opens a menu to switch pages. */
export function PageSwitcher() {
  // The query (?diagram=...) goes along, so every page shows the same diagram.
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const current = pageForPath(pathname);
  const toPage = useProjectPath();
  const Icon = current.icon;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Page: ${current.label}. Switch page`}
        className="flex shrink-0 items-center gap-2 rounded-md py-1 pr-1.5 pl-2 outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent/50 data-[state=open]:bg-surface-hover"
      >
        <Icon className="size-4 text-fg-muted" />
        <span className="font-medium">{current.label}</span>
        <ChevronsUpDown className="size-3.5 text-fg-subtle" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 min-w-64 rounded-lg border border-line bg-surface-raised p-1 shadow-xl shadow-black/40"
        >
          <DropdownMenu.Label className="px-2 pt-1 pb-1.5 text-xs font-medium text-fg-subtle">
            Switch to
          </DropdownMenu.Label>
          {PAGES.map((page) => {
            const PageIcon = page.icon;
            const active = page.id === current.id;
            return (
              <DropdownMenu.Item
                key={page.id}
                disabled={page.path === null}
                onSelect={() => page.path && !active && void navigate(toPage(page.path) + search)}
                className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 outline-none select-none data-disabled:opacity-45 data-highlighted:bg-surface-hover"
              >
                <span
                  className={`flex size-7 items-center justify-center rounded-md border ${
                    active ? "border-accent/40 bg-accent-soft text-accent-hover" : "border-line text-fg-muted"
                  }`}
                >
                  <PageIcon className="size-4" />
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="text-fg">{page.label}</span>
                  <span className="text-xs text-fg-subtle">{page.hint}</span>
                </span>
                {active && <Check aria-label="Current page" className="size-4 text-accent-hover" />}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
