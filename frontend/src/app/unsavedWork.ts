// Work that would be lost by leaving, asked about from every page (closing
// the tab, signing out, leaving the project) without loading the editor or
// the Decisions page for it: they sign up here when their code loads. Before
// that there is no such work.

/** The open diagram, or an ADR being edited. */
export type Work = "diagram" | "decision";

const checks = new Map<Work, () => boolean>();
const discards = new Map<Work, () => void>();
const finishers = new Map<Work, () => Promise<unknown>>();

/**
 * `finish` sends what can be sent and waits (a little) for it to arrive:
 * work that saves itself is then often not unsaved any more.
 */
export function addFinish(work: Work, finish: () => Promise<unknown>) {
  finishers.set(work, finish);
}

/** Lets the work finish what it can (see addFinish); then ask hasUnsavedWork. */
export async function finishWork(work: Work): Promise<void> {
  await finishers.get(work)?.();
}

/** `check` says whether there is unsaved `work`. */
export function addUnsavedCheck(work: Work, check: () => boolean) {
  checks.set(work, check);
}

/** Whether there is unsaved work of that kind, or of any kind. */
export function hasUnsavedWork(work?: Work): boolean {
  if (work) return checks.get(work)?.() ?? false;
  return [...checks.values()].some((check) => check());
}

/** `discard` gives up `work`, e.g. starts from an empty diagram. */
export function addDiscard(work: Work, discard: () => void) {
  discards.set(work, discard);
}

export function discardWork(work: Work) {
  discards.get(work)?.();
}
