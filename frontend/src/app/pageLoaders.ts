// Pages that are not part of the first load (see App.tsx). The app arrives
// with signing in and the Organizations page; a project's pages come when a
// project is opened, the editor first (most people start with the diagrams),
// then Decisions and People in the background.

export const loadProjectShell = () => import("./ProjectShell");
export const loadEditorPage = () => import("@/pages/EditorPage");
export const loadDecisionsPage = () => import("@/pages/DecisionsPage");
export const loadPeoplePage = () => import("@/pages/PeoplePage");
export const loadAdminPage = () => import("@/pages/AdminPage");

/**
 * Inside a project: fetches the editor, then, once the browser has nothing
 * else to do, Decisions and People, so switching pages does not wait.
 * Each is fetched once; later calls cost nothing.
 */
export function preloadProjectPages() {
  void loadEditorPage().then(() =>
    whenIdle(() => {
      void loadDecisionsPage();
      void loadPeoplePage();
    }),
  );
}

function whenIdle(run: () => void) {
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 500);
}
