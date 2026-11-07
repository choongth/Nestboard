import { Tooltip } from "radix-ui";
import { useEffect } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useRouteError } from "react-router";
import { whenSignedOut } from "@/api/client";
import {
  loadAdminPage,
  loadDecisionsPage,
  loadEditorPage,
  loadPeoplePage,
  loadProjectShell,
} from "@/app/pageLoaders";
import { ORGANIZATIONS } from "@/app/pages";
import { RequireSignIn } from "@/app/RequireSignIn";
import { hasUnsavedWork } from "@/app/unsavedWork";
import { neutralButton } from "@/decisions/styles";
import { InvitePage } from "@/pages/auth/InvitePage";
import { ResetPasswordPage } from "@/pages/auth/ResetPasswordPage";
import { SetupPage } from "@/pages/auth/SetupPage";
import { SignInPage } from "@/pages/auth/SignInPage";
import { OrganizationsPage } from "@/pages/OrganizationsPage";
import { useSessionStore } from "@/store/sessionStore";

// A data router, so pages can hold off a navigation that would lose work
// (useBlocker), e.g. leaving an ADR with unsaved edits. Signing in and the
// Organizations page come with the app; the rest is fetched when first
// opened (`lazy`, see app/pageLoaders.ts).
const router = createBrowserRouter([
  {
    element: <Shell />,
    // Shown while the first page's code arrives: the dark background, nothing else.
    HydrateFallback: () => null,
    ErrorBoundary: PageError,
    children: [
      { path: "/setup", element: <SetupPage /> },
      { path: "/sign-in", element: <SignInPage /> },
      { path: "/invite/:token", element: <InvitePage /> },
      { path: "/reset-password/:token", element: <ResetPasswordPage /> },
      {
        element: <RequireSignIn />,
        children: [
          { path: "/", element: <Navigate to={ORGANIZATIONS} replace /> },
          { path: "/admin", lazy: async () => ({ Component: (await loadAdminPage()).AdminPage }) },
          // Your organizations; one of them, its tab picked by #members, #groups...
          { path: ORGANIZATIONS, element: <OrganizationsPage /> },
          { path: `${ORGANIZATIONS}/:org`, element: <OrganizationsPage /> },
          {
            // Every page of a project: /organizations/<org id>/projects/<project id>/editor, /decisions...
            path: `${ORGANIZATIONS}/:org/projects/:project`,
            lazy: async () => ({ Component: (await loadProjectShell()).ProjectShell }),
            children: [
              { index: true, element: <Navigate to="editor" replace /> },
              { path: "editor", lazy: async () => ({ Component: (await loadEditorPage()).EditorPage }) },
              {
                path: "decisions/:number?",
                lazy: async () => ({ Component: (await loadDecisionsPage()).DecisionsPage }),
              },
              { path: "people", lazy: async () => ({ Component: (await loadPeoplePage()).PeoplePage }) },
            ],
          },
        ],
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  useWarnBeforeLeaving();
  useSignInAgainWhenSignedOut();
  return <RouterProvider router={router} />;
}

/** What every page shares. */
function Shell() {
  return (
    <Tooltip.Provider delayDuration={400}>
      <Outlet />
    </Tooltip.Provider>
  );
}

/**
 * A page that failed to load or show. Most often its code is gone: a new
 * version was released since this tab opened, and reloading fetches it
 * (asking first if there is unsaved work, see useWarnBeforeLeaving).
 */
function PageError() {
  const error = useRouteError();
  const outdated = error instanceof TypeError && /dynamically imported module|module script failed/i.test(error.message);
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <h1 className="text-base font-semibold">{outdated ? "Nestboard has been updated" : "Something went wrong"}</h1>
        <p className="text-fg-muted">
          {outdated
            ? "Reload the page to get the new version."
            : error instanceof Error
              ? error.message
              : "This page could not be shown."}
        </p>
        <button type="button" onClick={() => window.location.reload()} className={neutralButton}>
          Reload
        </button>
      </div>
    </div>
  );
}

/**
 * The session ended (expired, or signed out elsewhere): back to signing in.
 * Not while there is unsaved work; the failed save says what happened, and
 * the work stays on screen.
 */
function useSignInAgainWhenSignedOut() {
  useEffect(() => {
    whenSignedOut(() => {
      if (!hasUnsavedWork()) useSessionStore.getState().setUser(null);
    });
    return () => whenSignedOut(null);
  }, []);
}

/**
 * Closing or reloading the tab with unsaved work asks first, on every page:
 * a diagram with unsaved changes (it stays open while you look at its
 * decisions), or an ADR being edited.
 */
function useWarnBeforeLeaving() {
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedWork()) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
}
