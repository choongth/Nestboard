import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { ApiError } from "@/api/client";
import { finishWork } from "@/app/unsavedWork";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { newDiagram, openDiagram } from "@/files/documentActions";
import { hasUnsavedChanges, useDocumentStore } from "@/store/documentStore";

export const DIAGRAM_PARAM = "diagram";

/**
 * Keeps `?diagram=<id>` in the address in step with the open diagram, on
 * every page:
 *  - opening a diagram, or a new one reaching the server, updates the address;
 *  - a changed address (reload, back/forward, a pasted link) opens that
 *    diagram, once what is on its way has arrived (asking first if it can't).
 * Also says so when the open diagram goes away (deleted, or access lost).
 */
export function DiagramSession() {
  const [params, setParams] = useSearchParams();
  const wanted = params.get(DIAGRAM_PARAM);
  const openId = useDocumentStore((s) => s.id);
  const gone = useDocumentStore((s) => s.gone);
  /** An address to open once the user agrees to lose the changes that could not be sent. */
  const [asking, setAsking] = useState<string | null>(null);
  /** They did: the address stays as the dialog closes. */
  const discarding = useRef(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  const setParamsRef = useRef(setParams);
  useEffect(() => {
    setParamsRef.current = setParams;
  }, [setParams]);

  /** Points the address at `id`; `push` adds a history entry, so Back returns. */
  const pointAt = useCallback((id: string | null, push = false) => {
    setParamsRef.current(
      (p) => {
        const next = new URLSearchParams(p);
        if (id === null) next.delete(DIAGRAM_PARAM);
        else next.set(DIAGRAM_PARAM, id);
        return next;
      },
      { replace: !push },
    );
  }, []);

  /**
   * The diagram being fetched. Asking again while it loads does nothing: a
   * second, later answer could carry a newer version than the one the
   * editor settled on, and replace it.
   */
  const loading = useRef<string | null>(null);

  const load = useCallback(
    async (id: string) => {
      if (loading.current === id) return;
      loading.current = id;
      try {
        await openDiagram(id);
      } catch (e) {
        // Point the address back at what is actually open.
        pointAt(useDocumentStore.getState().id);
        const missing = e instanceof ApiError && e.code === "diagram_not_found";
        setError({
          title: missing ? "This diagram doesn't exist" : "Couldn't open the diagram",
          message: missing ? "It may have been deleted, or the link is wrong." : e instanceof Error ? e.message : String(e),
        });
      } finally {
        if (loading.current === id) loading.current = null;
      }
    },
    [pointAt],
  );

  // The open diagram changed (opened, new, first save...): the address follows.
  // Switching away from a diagram is a step Back can undo; a first save only
  // gives the open diagram its address, so it replaces the entry instead.
  const previousId = useRef(openId);
  useEffect(() => {
    const switched = previousId.current !== null;
    if (openId === previousId.current) return;
    previousId.current = openId;
    if (new URLSearchParams(window.location.search).get(DIAGRAM_PARAM) !== openId) pointAt(openId, switched);
  }, [openId, pointAt]);

  // The address changed: open what it names, once the open diagram's changes
  // have arrived; if they can't, ask first. Nothing is set synchronously.
  useEffect(() => {
    if (wanted === null || wanted === useDocumentStore.getState().id) return;
    let cancelled = false;
    void finishWork("diagram").then(() => {
      if (cancelled) return;
      if (hasUnsavedChanges()) setAsking(wanted);
      else void load(wanted);
    });
    return () => {
      cancelled = true;
    };
  }, [wanted, load]);

  return (
    <>
      <ConfirmDialog
        open={asking !== null && asking === wanted}
        onOpenChange={(open) => {
          if (open) return;
          setAsking(null);
          // Kept the current diagram: the address goes back to it.
          if (!discarding.current) pointAt(useDocumentStore.getState().id);
          discarding.current = false;
        }}
        title="Discard unsaved changes?"
        description="The link points at another diagram, and some of your changes to this one have not reached the server yet."
        confirmLabel="Discard changes"
        onConfirm={() => {
          discarding.current = true;
          if (asking !== null) void load(asking);
        }}
      />
      <ConfirmDialog
        open={gone !== null}
        // OK, or Escape: an empty diagram takes its place.
        onOpenChange={(open) => !open && newDiagram()}
        title="This diagram is no longer available"
        description={gone ?? ""}
        confirmLabel="OK"
        tone="accent"
        hideCancel
        onConfirm={() => {}}
      />
      <ConfirmDialog
        open={error !== null}
        onOpenChange={(open) => !open && setError(null)}
        title={error?.title ?? ""}
        description={error?.message ?? ""}
        confirmLabel="OK"
        tone="accent"
        hideCancel
        onConfirm={() => setError(null)}
      />
    </>
  );
}
