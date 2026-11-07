import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import type { Subject } from "@/api/access";
import type { ProjectRole } from "@/api/orgs";
import { groupPath, listGroups, listMembers, type Group, type Member } from "@/api/people";
import { ROLE_HINTS, ROLE_LABELS } from "@/app/roles";
import { field, primaryButton, quietButton } from "@/decisions/styles";
import { Modal } from "./Modal";

interface GrantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  orgId: string;
  /** Resolves once given; a rejection's message is shown in the dialog. */
  onGrant: (subject: Subject, role: ProjectRole) => Promise<void>;
  initialRole?: ProjectRole;
}

/** Gives a person or a group (and so everyone in it and its subgroups) a role. */
export function GrantDialog({ open, onOpenChange, title, description, ...form }: GrantDialogProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description} showDescription>
      <GrantForm {...form} />
    </Modal>
  );
}

function GrantForm({ orgId, onGrant, initialRole = "editor" }: Omit<GrantDialogProps, "open" | "onOpenChange" | "title" | "description">) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [who, setWho] = useState("");
  const [role, setRole] = useState<ProjectRole>(initialRole);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listMembers(orgId), listGroups(orgId)]).then(
      ([m, g]) => {
        if (cancelled) return;
        setMembers(m);
        setGroups(g);
      },
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const give = () => {
    const [kind, id] = who.split(":");
    if (!id) return;
    setBusy(true);
    setError(null);
    onGrant(kind === "group" ? { group_id: id } : { user_id: id }, role).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    });
  };

  const sortedGroups = [...groups].sort((a, b) => groupPath(groups, a.id).localeCompare(groupPath(groups, b.id)));
  return (
    <form
      className="mt-4 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        give();
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-fg-muted">Person or group</span>
        <select value={who} onChange={(e) => setWho(e.target.value)} className={field} disabled={!members}>
          <option value="">{members ? "Choose…" : "Loading…"}</option>
          <optgroup label="People">
            {(members ?? []).map((m) => (
              <option key={m.user.id} value={`user:${m.user.id}`}>
                {m.user.display_name}
                {m.title ? ` · ${m.title}` : ""}
              </option>
            ))}
          </optgroup>
          {sortedGroups.length > 0 && (
            <optgroup label="Groups (everyone in them and their subgroups)">
              {sortedGroups.map((g) => (
                <option key={g.id} value={`group:${g.id}`}>
                  {groupPath(groups, g.id)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-medium text-fg-muted">Role</legend>
        {(["viewer", "editor", "owner"] as const).map((r) => (
          <label key={r} className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-0.5">
            <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} className="accent-accent" />
            <span className="text-fg">{ROLE_LABELS[r]}</span>
            <span className="text-fg-subtle">{ROLE_HINTS[r]}</span>
          </label>
        ))}
      </fieldset>
      {error && <p className="text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Dialog.Close className={quietButton}>Cancel</Dialog.Close>
        <button type="submit" disabled={busy || !who} className={primaryButton}>
          Give access
        </button>
      </div>
    </form>
  );
}
