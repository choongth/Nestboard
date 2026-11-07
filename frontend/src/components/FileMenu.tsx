import {
  ChevronDown,
  CloudOff,
  Download,
  FilePlus2,
  FileText,
  FolderOpen,
  LoaderCircle,
  CircleHelp,
  PencilLine,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { finishWork } from "@/app/unsavedWork";
import {
  deleteOpenDiagram,
  exportFile,
  exportPdf,
  importFile,
  newDiagram,
  openDiagram,
  rename,
  saveNow,
} from "@/files/documentActions";
import { atLeast, canEditSomething } from "@/model/rights";
import { useAccessStore } from "@/store/accessStore";
import { useDiagramStore } from "@/store/diagramStore";
import { hasUnsavedChanges, useDocumentStore, useHasUnsavedChanges } from "@/store/documentStore";
import { useSessionStore } from "@/store/sessionStore";
import { useViewStore } from "@/store/viewStore";
import { ConfirmDialog } from "./ConfirmDialog";
import { ExportPdfDialog } from "./ExportPdfDialog";
import { HelpDialog } from "./HelpDialog";
import { MOD } from "./keys";
import { OpenDiagramDialog } from "./OpenDiagramDialog";
import { RenameDialog } from "./RenameDialog";
import { useHelpShortcut } from "./useHelpShortcut";

/** What replaces the open diagram once unsaved changes are dealt with. */
type Replacement = { kind: "new" } | { kind: "open"; id: string } | { kind: "import" };

type Dialog =
  | { kind: "open" }
  | { kind: "rename" }
  | { kind: "discard"; then: Replacement }
  | { kind: "delete" }
  | { kind: "pdf" }
  | { kind: "help" }
  | { kind: "error"; title: string; message: string }
  | null;

/** The diagram's name in the top bar, its menu, the file shortcuts and their dialogs, and the editor's help. */
export function FileMenu() {
  const name = useDocumentStore((s) => s.name);
  const onServer = useDocumentStore((s) => s.id !== null);
  const sync = useDocumentStore((s) => s.sync);
  const unsaved = useHasUnsavedChanges();
  const [dialog, setDialog] = useState<Dialog>(null);
  // New and imported diagrams, and names, belong to the whole project: its editors.
  const projectEditor = useSessionStore((s) => atLeast(s.project?.role ?? "viewer", "editor"));
  const canEdit = useAccessStore((s) => canEditSomething(s.rights));
  // Deleting a diagram is for the project's owners.
  const projectOwner = useSessionStore((s) => s.project?.role === "owner");
  // The server makes PDFs from what it has: anyone can export a diagram on
  // it, and whoever may edit can export one not there yet (it goes first).
  const canExportPdf = onServer || canEdit;
  // Inside a box, the PDF may cover just that box's inside.
  const currentId = useViewStore((s) => s.currentId);
  const levelTitle = useDiagramStore((s) => (currentId ? s.diagram.nodes[currentId]?.title : undefined));
  const level = currentId && levelTitle !== undefined ? { id: currentId, title: levelTitle } : null;

  // Changes go as they are made; only those held up (offline, or slow) are worth a mark.
  const behind = unsaved && sync !== "saved";
  useEffect(() => {
    document.title = `${behind ? "● " : ""}${name} — Nestboard`;
  }, [behind, name]);

  const fail = useCallback((title: string, e: unknown) => {
    setDialog({ kind: "error", title, message: e instanceof Error ? e.message : String(e) });
  }, []);

  const replace = useCallback(
    async (then: Replacement) => {
      try {
        if (then.kind === "new") newDiagram();
        else if (then.kind === "open") await openDiagram(then.id);
        else {
          const result = await importFile();
          if (result.status === "error") setDialog({ kind: "error", title: "Couldn't import the file", message: result.message });
        }
      } catch (e) {
        fail(then.kind === "import" ? "Couldn't import the file" : "Couldn't open the diagram", e);
      }
    },
    [fail],
  );

  /** Counts New, Open and Import asked for: only the last one asked goes ahead. */
  const asked = useRef(0);

  /**
   * New, Open and Import replace the diagram: what is on its way is let
   * arrive first, and changes that cannot (offline) are confirmed.
   */
  const replaceDocument = useCallback(
    (then: Replacement) => {
      setDialog(null);
      const ask = ++asked.current;
      // At once when nothing is on its way: a file picker needs the click it came from to be recent.
      if (!hasUnsavedChanges()) {
        void replace(then);
        return;
      }
      void finishWork("diagram").then(() => {
        if (ask !== asked.current) return; // something else was asked for meanwhile
        if (hasUnsavedChanges()) setDialog({ kind: "discard", then });
        else void replace(then);
      });
    },
    [replace],
  );

  // Ctrl+S and Ctrl+O (Cmd on macOS). They work inside text fields too.
  // Changes save themselves; Ctrl+S just sends them now, and keeps the
  // browser from saving the page. Ctrl+N cannot be taken over from the
  // browser, so New is menu-only.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (document.querySelector("[role='alertdialog'], [role='dialog']")) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        saveNow();
      } else if (key === "o") {
        event.preventDefault();
        setDialog({ kind: "open" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useHelpShortcut(useCallback(() => setDialog({ kind: "help" }), []));

  const status =
    sync === "offline"
      ? "offline, changes are sent once the connection is back"
      : sync === "saving"
        ? "saving"
        : sync === "local" && unsaved
          ? "not saved yet"
          : null;

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={`File: ${name}${status ? `, ${status}` : ""}`}
          className="flex max-w-64 items-center gap-1.5 rounded-md px-2 py-1 text-fg-muted outline-none hover:bg-surface-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50 data-[state=open]:bg-surface-hover data-[state=open]:text-fg"
        >
          <span className="truncate">{name}</span>
          {sync === "offline" ? (
            <CloudOff aria-hidden className="size-3.5 shrink-0 text-amber-300" />
          ) : sync === "saving" ? (
            <LoaderCircle aria-hidden className="size-3.5 shrink-0 animate-spin text-fg-subtle" />
          ) : (
            sync === "local" && unsaved && <span className="size-1.5 shrink-0 rounded-full bg-accent" />
          )}
          <ChevronDown className="size-3.5 shrink-0" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-60 rounded-lg border border-line bg-surface-raised p-1 shadow-xl shadow-black/40"
          >
            {projectEditor && (
              <MenuItem icon={FilePlus2} label="New diagram" onSelect={() => replaceDocument({ kind: "new" })} />
            )}
            <MenuItem icon={FolderOpen} label="Open…" shortcut={`${MOD}O`} onSelect={() => setDialog({ kind: "open" })} />
            {projectEditor && (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-line" />
                <MenuItem icon={PencilLine} label="Rename…" onSelect={() => setDialog({ kind: "rename" })} />
              </>
            )}
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            {projectEditor && (
              <MenuItem icon={Upload} label="Import from file…" onSelect={() => replaceDocument({ kind: "import" })} />
            )}
            <MenuItem
              icon={Download}
              label="Export to file…"
              onSelect={() => void exportFile().catch((e: unknown) => fail("Couldn't export the file", e))}
            />
            {canExportPdf && (
              <MenuItem icon={FileText} label="Export as PDF…" onSelect={() => setDialog({ kind: "pdf" })} />
            )}
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <MenuItem icon={CircleHelp} label="Help" shortcut="?" onSelect={() => setDialog({ kind: "help" })} />
            {projectOwner && onServer && (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-line" />
                <MenuItem icon={Trash2} label="Delete diagram…" onSelect={() => setDialog({ kind: "delete" })} />
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <OpenDiagramDialog
        open={dialog?.kind === "open"}
        onOpenChange={(o) => !o && setDialog(null)}
        onPick={(id) => replaceDocument({ kind: "open", id })}
      />
      <RenameDialog
        open={dialog?.kind === "rename"}
        onOpenChange={(o) => !o && setDialog(null)}
        current={name}
        onRename={(next) => void rename(next).catch((e: unknown) => fail("Couldn't rename the diagram", e))}
      />
      <ConfirmDialog
        open={dialog?.kind === "discard"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Discard unsaved changes?"
        description={`Some of your changes to ${name} have not reached the server yet.`}
        confirmLabel="Discard changes"
        onConfirm={() => {
          const then = dialog?.kind === "discard" ? dialog.then : null;
          setDialog(null);
          if (then) void replace(then);
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Delete ${name}?`}
        description="The diagram is deleted for everyone, with the access given on its boxes. The project's decisions stay; those about its boxes show them as deleted."
        confirmLabel="Delete diagram"
        onConfirm={() => void deleteOpenDiagram().catch((e: unknown) => fail("Couldn't delete the diagram", e))}
      />
      <HelpDialog open={dialog?.kind === "help"} onOpenChange={(o) => !o && setDialog(null)} />
      <ExportPdfDialog
        open={dialog?.kind === "pdf"}
        // It closes once the export ends; a failure has replaced it with an error by then.
        onOpenChange={(o) => !o && setDialog((d) => (d?.kind === "pdf" ? null : d))}
        level={level}
        unsaved={!onServer}
        onExport={(options) => exportPdf(options).catch((e: unknown) => fail("Couldn't export the PDF", e))}
      />
      <ConfirmDialog
        open={dialog?.kind === "error"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.kind === "error" ? dialog.title : ""}
        description={dialog?.kind === "error" ? dialog.message : ""}
        confirmLabel="OK"
        tone="accent"
        hideCancel
        onConfirm={() => setDialog(null)}
      />
    </>
  );
}

interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  onSelect: () => void;
}

function MenuItem({ icon: Icon, label, shortcut, onSelect }: MenuItemProps) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-fg outline-none select-none data-highlighted:bg-surface-hover"
    >
      <Icon className="size-4" />
      <span className="flex-1">{label}</span>
      {shortcut && <kbd className="font-sans text-xs opacity-60">{shortcut}</kbd>}
    </DropdownMenu.Item>
  );
}
