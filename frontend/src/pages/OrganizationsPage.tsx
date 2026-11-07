import { Building2, Ellipsis, PencilLine, Plus, Search, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { createOrg, deleteOrg, listOrgs, listProjects, renameOrg, type Organization, type Project } from "@/api/orgs";
import { listGroups, listMembers, type Group, type Member } from "@/api/people";
import { ORG_SECTIONS, ORGANIZATIONS, orgPath, orgSectionFor, type OrgSection } from "@/app/pages";
import { AccountMenu } from "@/components/AccountMenu";
import { AppMenu } from "@/components/AppMenu";
import { DeleteByNameDialog } from "@/components/DeleteByNameDialog";
import { NameDialog } from "@/components/NameDialog";
import { RenameDialog } from "@/components/RenameDialog";
import { neutralButton, scrollArea, searchBox } from "@/decisions/styles";
import { useSessionStore } from "@/store/sessionStore";
import { Groups, Invitations, Members } from "./org/PeopleSections";
import { ProjectsSection } from "./org/ProjectsSection";

const TAB_LABELS: Record<OrgSection, string> = {
  invitations: "Invitations",
  members: "Members",
  groups: "Groups",
  projects: "Projects",
};

/** What is loaded for the organization on screen. */
interface Selected {
  org: Organization;
  projects: Project[];
  members: Member[];
  groups: Group[];
}

/**
 * /organizations: your organizations down the left; pick one to see its
 * projects, members, groups and (for admins) invitations on the right.
 * /organizations/<org> opens on its projects; #members, #groups and
 * #invitations pick the other tabs.
 */
export function OrganizationsPage() {
  const { org: orgId } = useParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const me = useSessionStore((s) => s.user);
  const section = orgSectionFor(hash);
  const [orgs, setOrgs] = useState<Organization[] | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<"rename" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const org = orgId ? orgs?.find((o) => o.id === orgId) : undefined;
  const admin = org !== undefined && org.membership.role !== "member";
  // Every tab, greyed out, until an organization is picked; invitations are for its admins.
  const tabs = org ? ORG_SECTIONS.filter((s) => s !== "invitations" || admin) : ORG_SECTIONS;

  const loadOrgs = useCallback(async () => {
    const all = await listOrgs();
    setOrgs(all);
    // In only one organization: straight to it.
    if (all.length === 1) void navigate(orgPath(all[0]!.id), { replace: true });
  }, [navigate]);

  /** Reloads the organization on screen (and the list, for your own role in it). */
  const loadSelected = useCallback(async () => {
    const all = await listOrgs();
    setOrgs(all);
    const found = all.find((o) => o.id === orgId);
    if (!found) {
      setSelected(null);
      return;
    }
    const [projects, members, groups] = await Promise.all([listProjects(found.id), listMembers(found.id), listGroups(found.id)]);
    setSelected({ org: found, projects, members, groups });
  }, [orgId]);

  useEffect(() => {
    const load = orgId ? loadSelected : loadOrgs;
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [orgId, loadOrgs, loadSelected]);

  useEffect(() => {
    document.title = org ? `${TAB_LABELS[section]} · ${org.name} — Nestboard` : "Organizations — Nestboard";
  }, [org, section]);

  /** Runs a change, then reloads; a failure is shown above the content. */
  const change = (task: () => Promise<unknown>) => {
    setError(null);
    return task()
      .then(() => loadSelected())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const q = query.trim().toLowerCase();
  const shownOrgs = (orgs ?? []).filter((o) => !q || o.name.toLowerCase().includes(q));
  const current = selected && selected.org.id === orgId ? selected : null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
        <AppMenu />
        <div className="ml-auto flex items-center gap-3">
          <AccountMenu />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* The list of organizations and the content scroll on their own. */}
        <nav aria-label="Organizations" className="flex w-72 shrink-0 flex-col border-r border-line bg-surface">
          <div className="flex flex-col gap-2 border-b border-line p-3">
            <h1 className="py-1 text-center text-[15px] font-semibold">Organizations</h1>
            {me?.is_instance_admin && (
              <button type="button" onClick={() => setCreating(true)} className={`${neutralButton} justify-center`}>
                <Plus className="size-4" />
                New Organization
              </button>
            )}
            <label className={`${searchBox} bg-canvas`}>
              <Search className="size-4 text-fg-subtle" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Organizations"
                aria-label="Search organizations"
                className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-subtle"
              />
            </label>
          </div>
          <ul className={`${scrollArea} flex-1 p-1.5`}>
            {orgs === null && <li className="px-3 py-4 text-fg-muted">Loading…</li>}
            {orgs?.length === 0 && (
              <li className="px-3 py-4 text-fg-muted">
                {me?.is_instance_admin
                  ? "No organizations yet. Create one: people, groups and projects live in an organization."
                  : "You're not in any organization yet. Ask an admin for an invitation link."}
              </li>
            )}
            {orgs !== null && orgs.length > 0 && shownOrgs.length === 0 && (
              <li className="px-3 py-4 text-fg-muted">No organization matches.</li>
            )}
            {shownOrgs.map((o) => {
              const active = o.id === orgId;
              return (
                <li key={o.id} className="relative">
                  <Link
                    to={orgPath(o.id, active ? section : undefined)}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
                      active ? "bg-white/[0.12] pr-10 text-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg"
                    }`}
                  >
                    <Building2 className="size-4 shrink-0" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{o.name}</span>
                      <span className="text-xs text-fg-subtle capitalize">{o.membership.role}</span>
                    </span>
                  </Link>
                  {active && o.membership.role === "owner" && (
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger
                        aria-label={`Manage ${o.name}`}
                        className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-fg-muted outline-none hover:bg-white/[0.08] hover:text-fg focus-visible:ring-2 focus-visible:ring-white/25"
                      >
                        <Ellipsis className="size-4" />
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          align="start"
                          sideOffset={4}
                          className="z-50 min-w-48 rounded-lg border border-line bg-surface-raised p-1 shadow-xl shadow-black/40"
                        >
                          <DropdownMenu.Item
                            onSelect={() => setManaging("rename")}
                            className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-fg outline-none select-none data-highlighted:bg-surface-hover"
                          >
                            <PencilLine className="size-4 text-fg-muted" />
                            Rename organization…
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            onSelect={() => setManaging("delete")}
                            className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-danger outline-none select-none data-highlighted:bg-surface-hover"
                          >
                            <Trash2 className="size-4" />
                            Delete organization…
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="flex min-w-0 flex-1 flex-col bg-canvas">
          <nav aria-label="Organization" className="flex shrink-0 justify-around border-b border-line px-6 py-2">
            {tabs.map((tab) =>
              org ? (
                <Link
                  key={tab}
                  to={orgPath(org.id, tab)}
                  aria-current={tab === section ? "page" : undefined}
                  className={`rounded-lg px-4 py-1.5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
                    tab === section ? "bg-accent-soft text-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg"
                  }`}
                >
                  {TAB_LABELS[tab]}
                </Link>
              ) : (
                <span key={tab} aria-disabled="true" className="px-4 py-1.5 font-medium text-fg-subtle">
                  {TAB_LABELS[tab]}
                </span>
              ),
            )}
          </nav>
          <div className={`${scrollArea} flex-1`}>
            {!orgId ? (
              <div className="flex h-full items-center justify-center p-8 text-[15px] text-fg-muted">
                Select an organization to see more.
              </div>
            ) : orgs !== null && !org ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                <h2 className="text-base font-semibold">This organization does not exist</h2>
                <p className="text-fg-muted">It may have been renamed, or you are not in it.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 px-8 py-6">
                {error && <p className="text-danger">{error}</p>}
                {!current && !error && <p className="text-fg-muted">Loading…</p>}
                {current && me && section === "members" && (
                  <Members org={current.org} members={current.members} myId={me.id} change={change} />
                )}
                {current && section === "invitations" &&
                  (admin ? (
                    <Invitations org={current.org} />
                  ) : (
                    <p className="text-fg-muted">Only the organization's admins invite people.</p>
                  ))}
                {current && section === "groups" && (
                  <Groups org={current.org} groups={current.groups} members={current.members} change={change} />
                )}
                {current && section === "projects" && <ProjectsSection org={current.org} projects={current.projects} />}
              </div>
            )}
          </div>
        </main>
      </div>

      {org && (
        <>
          <RenameDialog
            open={managing === "rename"}
            onOpenChange={(open) => !open && setManaging(null)}
            title="Rename organization"
            label="Organization name"
            current={org.name}
            onRename={(name) => void change(() => renameOrg(org.id, org.version, name))}
          />
          <DeleteByNameDialog
            open={managing === "delete"}
            onOpenChange={(open) => !open && setManaging(null)}
            title={`Delete ${org.name}?`}
            description="Its projects, diagrams, decisions, groups and invitations are deleted for good, and everyone in it loses access. This cannot be undone."
            name={org.name}
            onDelete={async () => {
              await deleteOrg(org.id);
              setManaging(null);
              setSelected(null);
              void navigate(ORGANIZATIONS, { replace: true });
            }}
          />
        </>
      )}
      {creating && (
        <NameDialog
          title="New organization"
          description="You become its owner. Invite its people afterwards."
          onClose={() => setCreating(false)}
          onCreate={async (name) => {
            const created = await createOrg(name);
            setCreating(false);
            void navigate(orgPath(created.id));
          }}
        />
      )}
    </div>
  );
}
