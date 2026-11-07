import { CloudAlert, X } from "lucide-react";
import { useEffect } from "react";
import { useDocumentStore } from "@/store/documentStore";

const SHOWN_FOR_MS = 6000;

/** Says what went wrong saving, e.g. a change the server refused (it was taken back). */
export function SaveNotice() {
  const notice = useDocumentStore((s) => s.notice);
  const dismiss = useDocumentStore((s) => s.dismissNotice);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(dismiss, SHOWN_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [notice, dismiss]);

  if (!notice) return null;
  return (
    <div
      role="status"
      // Above the refusal notice, should both show.
      className="absolute bottom-16 left-1/2 z-20 flex max-w-lg -translate-x-1/2 items-start gap-2.5 rounded-lg border border-amber-400/25 bg-surface-raised px-3 py-2 text-amber-100 shadow-xl shadow-black/40"
    >
      <CloudAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
      <span>{notice.message}</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="rounded p-0.5 text-fg-muted hover:text-fg">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
