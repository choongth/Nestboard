import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { authStatus, getMe } from "@/api/auth";
import { ApiError } from "@/api/client";
import { neutralButton } from "@/decisions/styles";
import { useSessionStore } from "@/store/sessionStore";

/**
 * Pages behind it need someone signed in. Nobody is: to sign in (coming back
 * here afterwards), or to set up a brand-new Nestboard.
 */
export function RequireSignIn() {
  const user = useSessionStore((s) => s.user);
  const setUser = useSessionStore((s) => s.setUser);
  const { pathname, search } = useLocation();
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (user !== undefined) return;
    let cancelled = false;
    getMe().then(
      (me) => !cancelled && setUser(me),
      async (e: unknown) => {
        if (!(e instanceof ApiError && e.status === 401)) {
          if (!cancelled) setProblem(e instanceof Error ? e.message : String(e));
          return;
        }
        const status = await authStatus().catch(() => ({ needs_setup: false }));
        if (cancelled) return;
        setSetupNeeded(status.needs_setup);
        setUser(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [user, setUser, attempt]);

  if (user === null) {
    const next = encodeURIComponent(pathname + search);
    return <Navigate to={setupNeeded ? "/setup" : `/sign-in${next === "%2F" ? "" : `?next=${next}`}`} replace />;
  }
  if (user === undefined) {
    if (!problem) return null;
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <h1 className="text-base font-semibold">Couldn't reach Nestboard</h1>
          <p className="text-fg-muted">{problem}</p>
          <button
            type="button"
            className={neutralButton}
            onClick={() => {
              setProblem(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
  return <Outlet />;
}
