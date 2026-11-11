// The sections of an organization's page that are about its people:
// members, invitation links and groups.

import { Link2, Plus, Trash2, UserPlus, UsersRound, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import type { Organization, OrgRole } from "@/api/orgs";
import {
  createGroup,
  createInvitation,
  deleteGroup,
  listGroupMembers,
  listInvitations,
  removeGroupMember,
  removeMember,
  revokeInvitation,
  setGroupMember,
  updateGroup,
  updateMember,
  type Group,
  type GroupMember,
  type Invitation,
  type Member,
  groupPath,
} from "@/api/people";
import { formatDate } from "@/app/dates";
import { ORGANIZATIONS } from "@/app/pages";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { CopyLink } from "@/components/CopyLink";
import { NameDialog } from "@/components/NameDialog";
import { RenameDialog } from "@/components/RenameDialog";
import { field, neutralButton, quietButton } from "@/decisions/styles";
import { ImportInvitations } from "./ImportInvitations";
import { RoleGuide } from "./RoleGuide";

const ORG_ROLES: OrgRole[] = ["owner", "admin", "member"];
const ORG_ROLE_LABELS: Record<OrgRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };
const small = "rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs text-fg outline-none focus:border-fg";

export type Change = (task: () => Promise<unknown>) => Promise<void>;

// ---- Members ----

export function Members({ org, members, myId, change }: { org: Organization; members: Member[]; myId: string; change: Change }) {
  const navigate = useNavigate();
  const role = org.membership.role;
  const admin = role !== "member";
  const [removing, setRemoving] = useState<Member | null>(null);
  const leaving = removing?.user.id === myId;

  return (
    <section aria-label="Members" className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <table className="w-full text-left">
          <thead className="border-b border-line text-xs text-fg-subtle">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Job title</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Can create projects</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const self = m.user.id === myId;
              // Admins remove members; owners remove anyone; anyone leaves.
              const removable = self || role === "owner" || (admin && m.role === "member");
              return (
                <tr key={m.user.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      <span className="text-fg">
                        {m.user.display_name}
                        {self && <span className="text-fg-subtle"> (you)</span>}
                      </span>
                      <span className="text-xs text-fg-subtle">{m.user.email}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {admin ? (
                      <TitleField
                        label={`Job title of ${m.user.display_name}`}
                        value={m.title}
                        onSave={(title) => change(() => updateMember(org.id, m.user.id, { title }))}
                      />
                    ) : (
                      <span className="text-fg-muted">{m.title || "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {role === "owner" ? (
                      <select
                        aria-label={`Role of ${m.user.display_name}`}
                        value={m.role}
                        onChange={(e) => void change(() => updateMember(org.id, m.user.id, { role: e.target.value as OrgRole }))}
                        className={small}
                      >
                        {ORG_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ORG_ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-fg-muted">{ORG_ROLE_LABELS[m.role]}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`${m.user.display_name} can create projects`}
                      checked={m.can_create_projects}
                      // Owners and admins always can.
                      disabled={!admin || m.role !== "member"}
                      onChange={(e) =>
                        void change(() => updateMember(org.id, m.user.id, { can_create_projects: e.target.checked }))
                      }
                      className="accent-accent"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {removable && (
                      <button
                        type="button"
                        onClick={() => setRemoving(m)}
                        aria-label={self ? "Leave the organization" : `Remove ${m.user.display_name}`}
                        className={`${quietButton} hover:text-danger`}
                      >
                        {self ? "Leave" : <Trash2 className="size-4" />}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={leaving ? `Leave ${org.name}?` : `Remove ${removing?.user.display_name ?? ""}?`}
        description={
          leaving
            ? "You lose access to its projects and leave its groups. Someone has to invite you to come back."
            : "They lose access to every project of the organization and leave its groups. Their name stays in the history."
        }
        confirmLabel={leaving ? "Leave" : "Remove"}
        onConfirm={() => {
          const who = removing;
          if (!who) return;
          void change(async () => {
            await removeMember(org.id, who.user.id);
            if (who.user.id === myId) void navigate(ORGANIZATIONS);
          });
        }}
      />
    </section>
  );
}

/** Saves when it loses focus or Enter is pressed, if it changed. */
function TitleField({ label, value, onSave }: { label: string; value: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const save = () => {
    const next = draft.trim();
    if (next !== value) onSave(next);
  };
  return (
    <input
      aria-label={label}
      value={draft}
      placeholder="e.g. Architect"
      maxLength={100}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={`${field} py-1`}
    />
  );
}

// ---- Invitations ----

export function Invitations({ org }: { org: Organization }) {
  const owner = org.membership.role === "owner";
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [role, setRole] = useState<OrgRole>("member");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [canCreate, setCanCreate] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => listInvitations(org.id).then(setInvitations), [org.id]);
  useEffect(() => {
    void reload().catch(() => {});
  }, [reload]);

  const invite = async () => {
    setError(null);
    try {
      const created = await createInvitation(org.id, {
        role,
        title: title.trim(),
        can_create_projects: role === "member" && canCreate,
        email: email.trim() || undefined,
      });
      setLink(`${window.location.origin}/invite/${created.token}`);
      setTitle("");
      setEmail("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section aria-label="Invitations" className="flex flex-col gap-3">
      <div className="flex justify-end gap-2">
        <ImportInvitations org={org} onInvited={() => void reload().catch(() => {})} />
        <RoleGuide />
      </div>
      <form
        className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void invite();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as OrgRole)} className={field}>
            {(owner ? ORG_ROLES : (["member"] as OrgRole[])).map((r) => (
              <option key={r} value={r}>
                {ORG_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">Job title (optional)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">Only for this email (optional)</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
        </label>
        {role === "member" && (
          <label className="flex items-center gap-2 pb-2">
            <input type="checkbox" checked={canCreate} onChange={(e) => setCanCreate(e.target.checked)} className="accent-accent" />
            <span className="text-fg-muted">Can create projects</span>
          </label>
        )}
        <button type="submit" className={neutralButton}>
          <UserPlus className="size-4" />
          Create invitation link
        </button>
        {error && <p className="w-full text-danger">{error}</p>}
        {link && <CopyLink label="Invitation link" link={link} note="Send it yourself; it works once, for 7 days." />}
      </form>
      {invitations.length > 0 && (
        <ul className="flex flex-col gap-1">
          {invitations.map((i) => (
            <li key={i.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-hover">
              <Link2 className="size-4 shrink-0 text-fg-subtle" />
              <span className="min-w-0 flex-1 truncate text-fg">
                {i.name && `${i.name} · `}
                {ORG_ROLE_LABELS[i.role]}
                {i.title && ` · ${i.title}`}
                {i.email && <span className="text-fg-subtle"> · for {i.email}</span>}
              </span>
              <span className="text-xs text-fg-subtle">
                {i.status === "accepted"
                  ? `Used by ${i.accepted_by?.display_name ?? "someone"}`
                  : i.status === "pending"
                    ? `Until ${formatDate(i.expires_at)}`
                    : i.status === "revoked"
                      ? "Revoked"
                      : "Expired"}
              </span>
              {i.status === "pending" && (
                <button
                  type="button"
                  aria-label="Revoke the invitation"
                  onClick={() => void revokeInvitation(org.id, i.id).then(reload)}
                  className="rounded p-0.5 text-fg-subtle hover:text-fg"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- Groups ----

export function Groups({ org, groups, members, change }: { org: Organization; groups: Group[]; members: Member[]; change: Change }) {
  const admin = org.membership.role !== "member";
  const childrenOf = (id: string | null) =>
    groups.filter((g) => g.parent_id === id).sort((a, b) => a.name.localeCompare(b.name));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The group shown on the right: the one picked, else the first at the top.
  const selected = groups.find((g) => g.id === selectedId) ?? childrenOf(null)[0] ?? null;
  const [creating, setCreating] = useState<{ parent: Group | null } | null>(null);

  const renderTree = (parentId: string | null, depth: number): ReactNode =>
    childrenOf(parentId).map((g) => (
      <li key={g.id}>
        <button
          type="button"
          onClick={() => setSelectedId(g.id)}
          aria-current={g.id === selected?.id ? "true" : undefined}
          style={{ paddingLeft: `${12 + depth * 18}px` }}
          className={`flex w-full items-center gap-2 rounded-lg py-2 pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
            g.id === selected?.id ? "bg-white/[0.08] text-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg"
          }`}
        >
          <UsersRound className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
          <span className="text-xs text-fg-subtle">{g.member_count}</span>
        </button>
        <ul>{renderTree(g.id, depth + 1)}</ul>
      </li>
    ));

  return (
    <section aria-label="Groups" className="flex flex-col gap-3">
      <p className="text-fg-subtle">
        People in a group count as members of every group above it, so access given to a group covers its subgroups.
        Leads manage their group and everything below it.
      </p>
      <div className="grid min-h-[420px] grid-cols-[minmax(240px,320px)_1fr] gap-4">
        <div className="flex flex-col rounded-xl border border-line bg-surface">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
            <span className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">All groups</span>
            {admin && (
              <button type="button" onClick={() => setCreating({ parent: null })} className={quietButton}>
                <Plus className="size-4" />
                New group
              </button>
            )}
          </div>
          {groups.length === 0 ? (
            <p className="p-4 text-fg-muted">No groups yet.</p>
          ) : (
            <ul aria-label="Group tree" className="flex flex-col gap-0.5 p-2">
              {renderTree(null, 0)}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-line bg-surface">
          {selected ? (
            <GroupDetail
              key={selected.id}
              org={org}
              group={selected}
              groups={groups}
              members={members}
              subgroups={childrenOf(selected.id)}
              change={change}
              onSelect={setSelectedId}
              onAddSubgroup={() => setCreating({ parent: selected })}
            />
          ) : (
            <p className="flex h-full items-center justify-center p-8 text-fg-muted">
              {admin ? "Create a group to start." : "Pick a group to see who is in it."}
            </p>
          )}
        </div>
      </div>
      {creating && (
        <NameDialog
          title={creating.parent ? `New group inside ${creating.parent.name}` : "New group"}
          description={
            creating.parent
              ? "Its people will also count as members of the groups above it."
              : "A group at the top level. Groups can hold other groups."
          }
          onClose={() => setCreating(null)}
          onCreate={async (name) => {
            const parentId = creating.parent?.id ?? null;
            await change(async () => {
              const made = await createGroup(org.id, name, parentId);
              setSelectedId(made.id);
            });
            setCreating(null);
          }}
        />
      )}
    </section>
  );
}

/** The group picked in the tree: where it sits, its people and leads, and what can be done with it. */
function GroupDetail({
  org,
  group,
  groups,
  members,
  subgroups,
  change,
  onSelect,
  onAddSubgroup,
}: {
  org: Organization;
  group: Group;
  /** Every group of the organization, for where it can move to. */
  groups: Group[];
  members: Member[];
  subgroups: Group[];
  change: Change;
  onSelect: (id: string) => void;
  onAddSubgroup: () => void;
}) {
  const [people, setPeople] = useState<GroupMember[] | null>(null);
  const [adding, setAdding] = useState("");
  const [dialog, setDialog] = useState<"rename" | "move" | "delete" | null>(null);
  const above = groupPath(groups, group.id).split(" › ").slice(0, -1);

  const loadPeople = useCallback(() => listGroupMembers(org.id, group.id).then(setPeople), [org.id, group.id]);
  useEffect(() => {
    void loadPeople().catch(() => setPeople([]));
  }, [loadPeople]);

  /** Changes membership, then reloads this group's people and the counts. */
  const changePeople = (task: () => Promise<unknown>) =>
    change(async () => {
      await task();
      await loadPeople();
    });

  const outside = members.filter((m) => !people?.some((p) => p.user.id === m.user.id));

  return (
    <article aria-label={group.name} className="flex flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-col">
          {above.length > 0 && <span className="truncate text-xs text-fg-subtle">{above.join(" › ")} ›</span>}
          <h3 className="truncate text-base font-semibold text-fg">{group.name}</h3>
        </div>
        {group.can_manage && (
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" onClick={onAddSubgroup} className={quietButton}>
              <Plus className="size-4" />
              Subgroup
            </button>
            <button type="button" aria-label={`Rename ${group.name}`} onClick={() => setDialog("rename")} className={quietButton}>
              Rename
            </button>
            <button type="button" aria-label={`Move ${group.name}`} onClick={() => setDialog("move")} className={quietButton}>
              Move
            </button>
            {subgroups.length === 0 && (
              <button
                type="button"
                aria-label={`Delete ${group.name}`}
                onClick={() => setDialog("delete")}
                className={`${quietButton} hover:text-danger`}
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        )}
      </header>

      <div className="flex flex-col gap-6 px-5 py-4">
        <section aria-label={`People in ${group.name}`} className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            People ({people?.length ?? group.member_count})
          </h4>
          {people === null && <p className="text-fg-subtle">Loading…</p>}
          {people?.length === 0 && <p className="text-fg-subtle">Nobody in it directly.</p>}
          {people && people.length > 0 && (
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {people.map((p) => (
                <li key={p.user.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-fg">{p.user.display_name}</span>
                    <span className="truncate text-xs text-fg-subtle">{p.title || p.user.email}</span>
                  </span>
                  {group.can_manage ? (
                    <>
                      <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                        <input
                          type="checkbox"
                          checked={p.is_lead}
                          onChange={(e) => void changePeople(() => setGroupMember(org.id, group.id, p.user.id, e.target.checked))}
                          className="accent-accent"
                        />
                        Lead
                      </label>
                      <button
                        type="button"
                        aria-label={`Take ${p.user.display_name} out of ${group.name}`}
                        onClick={() => void changePeople(() => removeGroupMember(org.id, group.id, p.user.id))}
                        className="rounded p-1 text-fg-subtle hover:text-fg"
                      >
                        <X className="size-3.5" />
                      </button>
                    </>
                  ) : (
                    p.is_lead && <span className="text-xs text-fg-subtle">Lead</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {group.can_manage && outside.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                aria-label={`Add someone to ${group.name}`}
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                className={`${field} max-w-72`}
              >
                <option value="">Add someone…</option>
                {outside.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.display_name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!adding}
                onClick={() => {
                  const who = adding;
                  setAdding("");
                  void changePeople(() => setGroupMember(org.id, group.id, who));
                }}
                className={neutralButton}
              >
                Add
              </button>
            </div>
          )}
        </section>

        <section aria-label={`Groups inside ${group.name}`} className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">Groups inside</h4>
          {subgroups.length === 0 ? (
            <p className="text-fg-subtle">None.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {subgroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onSelect(g.id)}
                  className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-fg-muted hover:border-line-strong hover:text-fg"
                >
                  <UsersRound className="size-3.5" />
                  {g.name}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <MoveGroupDialog
        open={dialog === "move"}
        onOpenChange={(open) => !open && setDialog(null)}
        group={group}
        groups={groups}
        onMove={(parentId) => change(() => updateGroup(org.id, group.id, group.version, { parent_id: parentId }))}
      />
      <RenameDialog
        open={dialog === "rename"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Rename group"
        label="New group name"
        current={group.name}
        onRename={(name) => void change(() => updateGroup(org.id, group.id, group.version, { name }))}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Delete ${group.name}?`}
        description="Its people stay in the organization, but lose the access the group gave them."
        confirmLabel="Delete"
        onConfirm={() => void change(() => deleteGroup(org.id, group.id))}
      />
    </article>
  );
}

/**
 * Moves a group, with everything below it, under another group or to the
 * top level. It cannot go inside itself. Needs managing where it leaves and
 * where it lands; the server says so if not.
 */
function MoveGroupDialog({
  open,
  onOpenChange,
  group,
  groups,
  onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: Group;
  groups: Group[];
  onMove: (parentId: string | null) => Promise<void>;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Move ${group.name}`}
      description="Its subgroups move with it. People in it then count as members of the groups above its new place."
      showDescription
    >
      <MoveGroupForm group={group} groups={groups} onMove={onMove} close={() => onOpenChange(false)} />
    </Modal>
  );
}

function MoveGroupForm({
  group,
  groups,
  onMove,
  close,
}: {
  group: Group;
  groups: Group[];
  onMove: (parentId: string | null) => Promise<void>;
  close: () => void;
}) {
  const [parent, setParent] = useState(group.parent_id ?? "");
  // Not itself, nor anything below it.
  const below = new Set([group.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of groups) {
      if (g.parent_id && below.has(g.parent_id) && !below.has(g.id)) {
        below.add(g.id);
        grew = true;
      }
    }
  }
  const places = groups
    .filter((g) => !below.has(g.id))
    .map((g) => ({ id: g.id, label: groupPath(groups, g.id) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <form
      className="mt-4 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onMove(parent || null).then(close);
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-fg-muted">Inside</span>
        <select value={parent} onChange={(e) => setParent(e.target.value)} className={field}>
          <option value="">Top level</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex justify-end gap-2">
        <Dialog.Close className={quietButton}>Cancel</Dialog.Close>
        <button type="submit" disabled={parent === (group.parent_id ?? "")} className={neutralButton}>
          Move
        </button>
      </div>
    </form>
  );
}
