import { FileText, Search } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { listDiagrams, type DiagramSummary } from "@/api/diagrams";
import { useDocumentStore } from "@/store/documentStore";
import { currentProject } from "@/store/sessionStore";
import { edited } from "./relativeTime";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; items: DiagramSummary[] };

interface OpenDiagramDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (id: string) => void;
}

/** Ctrl+O: the diagrams on the server, most recently edited first. */
export function OpenDiagramDialog({ open, onOpenChange, onPick }: OpenDiagramDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed top-[18%] left-1/2 z-50 flex max-h-[64vh] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 flex-col rounded-xl border border-line bg-surface-raised shadow-2xl shadow-black/50">
          {/* Mounted only while open, so every opening starts fresh. */}
          <DiagramPicker onPick={onPick} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DiagramPicker({ onPick }: { onPick: (id: string) => void }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const currentId = useDocumentStore((s) => s.id);

  useEffect(() => {
    let cancelled = false;
    listDiagrams(currentProject().id).then(
      (page) => !cancelled && setLoad({ state: "ready", items: page.items }),
      (e: unknown) => !cancelled && setLoad({ state: "error", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const shown = useMemo(() => {
    if (load.state !== "ready") return [];
    const q = query.trim().toLowerCase();
    return q ? load.items.filter((d) => d.name.toLowerCase().includes(q)) : load.items;
  }, [load, query]);

  return (
    <>
      <div className="border-b border-line px-4 pt-4 pb-3">
        <Dialog.Title className="text-[15px] font-semibold text-fg">Open diagram</Dialog.Title>
        <Dialog.Description className="sr-only">Pick a diagram saved on the server.</Dialog.Description>
        <label className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 focus-within:border-fg">
          <Search className="size-4 text-fg-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && shown[0]) onPick(shown[0].id);
            }}
            placeholder="Search diagrams"
            aria-label="Search diagrams"
            className="flex-1 bg-transparent text-fg outline-none placeholder:text-fg-subtle"
          />
        </label>
      </div>

      <div className="min-h-24 overflow-y-auto p-1.5">
        {load.state === "loading" && <p className="px-3 py-6 text-center text-fg-muted">Loading…</p>}
        {load.state === "error" && (
          <div className="flex flex-col items-center gap-3 px-3 py-6 text-center">
            <p className="text-fg-muted">{load.message}</p>
            <button
              type="button"
              onClick={() => {
                setLoad({ state: "loading" });
                setAttempt((n) => n + 1);
              }}
              className="rounded-lg border border-line-strong px-3 py-1.5 font-medium text-fg hover:bg-surface-hover"
            >
              Try again
            </button>
          </div>
        )}
        {load.state === "ready" && load.items.length === 0 && (
          <p className="px-3 py-6 text-center text-fg-muted">No diagrams in this project yet. Save one with Ctrl+S.</p>
        )}
        {load.state === "ready" && load.items.length > 0 && shown.length === 0 && (
          <p className="px-3 py-6 text-center text-fg-muted">No diagram matches “{query.trim()}”.</p>
        )}
        {shown.length > 0 && (
          <ul aria-label="Diagrams">
            {shown.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onPick(d.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-surface-hover focus-visible:bg-surface-hover"
                >
                  <FileText className="size-4 shrink-0 text-fg-subtle" />
                  <span className="min-w-0 flex-1 truncate text-fg">{d.name}</span>
                  {d.id === currentId && (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent-hover">Open</span>
                  )}
                  <span className="shrink-0 text-xs text-fg-subtle">{edited(d.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
