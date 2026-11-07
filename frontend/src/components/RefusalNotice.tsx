import { Lock, X } from "lucide-react";
import { useEffect } from "react";
import { useAccessStore } from "@/store/accessStore";

const SHOWN_FOR_MS = 5000;

/** Says why the last edit did nothing: it was outside what you may change. */
export function RefusalNotice() {
  const refusal = useAccessStore((s) => s.refusal);
  const dismiss = useAccessStore((s) => s.dismissRefusal);

  useEffect(() => {
    if (!refusal) return;
    const timer = window.setTimeout(dismiss, SHOWN_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [refusal, dismiss]);

  if (!refusal) return null;
  return (
    <div
      role="status"
      className="absolute bottom-4 left-1/2 z-20 flex max-w-lg -translate-x-1/2 items-start gap-2.5 rounded-lg border border-amber-400/25 bg-surface-raised px-3 py-2 text-amber-100 shadow-xl shadow-black/40"
    >
      <Lock className="mt-0.5 size-4 shrink-0 text-amber-300" />
      <span>
        {refusal.message}{" "}
        <span className="text-fg-muted">
          {refusal.needs === "owner" ? "An owner above it can." : "Ask whoever is in charge of it."}
        </span>
      </span>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="rounded p-0.5 text-fg-muted hover:text-fg">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
