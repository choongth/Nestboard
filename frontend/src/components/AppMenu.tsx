import { Building2, Check, ChevronDown, LayoutGrid } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import { useLocation } from "react-router";
import { listOrgs, type Organization } from "@/api/orgs";
import { ORGANIZATIONS, orgPath } from "@/app/pages";
import { useLeaveGuard } from "./useLeaveGuard";

const item =
  "flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 outline-none select-none data-highlighted:bg-surface-hover";

/**
 * Top-left: the logo. Opens what sits above any one project: all your
 * organizations, and each one's page (its projects, members and groups).
 */
export function AppMenu() {
  const { pathname } = useLocation();
  const { go, dialog } = useLeaveGuard();
  const [orgs, setOrgs] = useState<Organization[] | null>(null);
  const currentOrg = /^\/organizations\/([^/]+)/.exec(pathname)?.[1];

  return (
    <>
      <DropdownMenu.Root
        onOpenChange={(open) => {
          if (open) listOrgs().then(setOrgs, () => setOrgs([]));
        }}
      >
        <DropdownMenu.Trigger
          aria-label="Nestboard menu"
          className="flex shrink-0 items-center gap-2 rounded-md py-1 pr-1.5 pl-1 outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent/50 data-[state=open]:bg-surface-hover"
        >
          <img src="/logo-dark.svg" alt="" className="size-6" />
          <span className="text-sm font-semibold tracking-tight">Nestboard</span>
          <ChevronDown className="size-3.5 text-fg-subtle" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className="z-50 max-h-[70vh] min-w-64 overflow-y-auto rounded-lg border border-line bg-surface-raised p-1 shadow-xl shadow-black/40"
          >
            <DropdownMenu.Item onSelect={() => pathname !== ORGANIZATIONS && go(ORGANIZATIONS)} className={item}>
              <span className="flex size-7 items-center justify-center rounded-md border border-line text-fg-muted">
                <LayoutGrid className="size-4" />
              </span>
              <span className="flex flex-1 flex-col">
                <span className="text-fg">All Organizations</span>
                <span className="text-xs text-fg-subtle">Their projects, members and groups</span>
              </span>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Label className="px-2 pt-1 pb-1.5 text-xs font-medium text-fg-subtle">Organizations</DropdownMenu.Label>
            {orgs === null && <p className="px-2 py-1.5 text-fg-subtle">Loading…</p>}
            {orgs?.length === 0 && <p className="px-2 py-1.5 text-fg-subtle">You're not in any organization yet.</p>}
            {orgs?.map((org) => (
              <DropdownMenu.Item key={org.id} onSelect={() => go(orgPath(org.id))} className={item}>
                <span className="flex size-7 items-center justify-center rounded-md border border-line text-fg-muted">
                  <Building2 className="size-4" />
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="text-fg">{org.name}</span>
                  <span className="text-xs text-fg-subtle capitalize">{org.membership.role}</span>
                </span>
                {org.id === currentOrg && <Check aria-label="Current organization" className="size-4 text-accent-hover" />}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {dialog}
    </>
  );
}
