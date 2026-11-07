import { KeyRound, Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { createPasswordReset, listUsers } from "@/api/admin";
import type { User } from "@/api/auth";
import { formatDateTime } from "@/app/dates";
import { AccountMenu } from "@/components/AccountMenu";
import { AppMenu } from "@/components/AppMenu";
import { CopyLink } from "@/components/CopyLink";
import { quietButton, scrollArea, sectionLabel } from "@/decisions/styles";
import { useSessionStore } from "@/store/sessionStore";

/**
 * /admin, for the instance admin: every account, and one-off links to set a
 * new password. Only the instance admin makes these: someone in several
 * organizations would otherwise be open to the admins of all of them.
 */
export function AdminPage() {
  const me = useSessionStore((s) => s.user);
  const [users, setUsers] = useState<User[] | null>(null);
  const [link, setLink] = useState<{ userId: string; url: string; until: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Accounts — Nestboard";
    if (!me?.is_instance_admin) return;
    listUsers().then(
      (page) => setUsers(page.items),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [me]);

  if (me && !me.is_instance_admin) return <Navigate to="/" replace />;

  const reset = async (user: User) => {
    setError(null);
    try {
      const created = await createPasswordReset(user.id);
      setLink({ userId: user.id, url: `${window.location.origin}/reset-password/${created.token}`, until: created.expires_at });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
        <AppMenu />
        <span className="text-fg-subtle">/</span>
        <span className="flex items-center gap-1.5 font-medium text-fg">
          <Shield className="size-4 text-fg-muted" />
          Accounts
        </span>
        <div className="ml-auto flex items-center gap-3">
          <AccountMenu />
        </div>
      </header>
      <main className={`flex-1 bg-canvas ${scrollArea}`}>
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-8">
          <h1 className={sectionLabel}>Every account on this server</h1>
          <p className="text-fg-subtle">
            Someone who forgot their password gets a link from you to set a new one. It works once; making a new one
            stops the old.
          </p>
          {error && <p className="text-danger">{error}</p>}
          {users === null && !error && <p className="text-fg-muted">Loading…</p>}
          <ul className="flex flex-col gap-1">
            {users?.map((u) => (
              <li key={u.id} className="flex flex-col gap-2 rounded-lg px-3 py-2 hover:bg-surface-hover">
                <div className="flex items-center gap-3">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-fg">
                      {u.display_name}
                      {u.is_instance_admin && <span className="text-fg-subtle"> · instance admin</span>}
                    </span>
                    <span className="text-xs text-fg-subtle">{u.email}</span>
                  </span>
                  <button type="button" onClick={() => void reset(u)} className={quietButton}>
                    <KeyRound className="size-4" />
                    Reset link
                  </button>
                </div>
                {link?.userId === u.id && (
                  <CopyLink
                    label={`Reset link for ${u.display_name}`}
                    link={link.url}
                    note={`Send it to ${u.display_name} yourself. It works once, until ${formatDateTime(link.until)}.`}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
