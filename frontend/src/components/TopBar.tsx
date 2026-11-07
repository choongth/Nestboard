import { ChevronRight, Redo2, Undo2, type LucideIcon } from "lucide-react";
import { Tooltip } from "radix-ui";
import { Fragment, useMemo } from "react";
import { useStore } from "zustand";
import { useHistoryActions, useNavigation } from "@/canvas/navigation";
import { getPath } from "@/model/queries";
import { useDiagramStore } from "@/store/diagramStore";
import { useCurrentCanvasId } from "@/store/hooks";
import { AccountMenu } from "./AccountMenu";
import { FileMenu } from "./FileMenu";
import { MOD } from "./keys";
import { HeaderNav } from "./HeaderNav";
import { PeopleHere } from "./PeopleHere";

/** Beyond this many levels the middle of the breadcrumb collapses to "…". */
const MAX_CRUMBS = 5;

export function TopBar() {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
      <HeaderNav />

      <div className="h-5 w-px shrink-0 bg-line" />

      <Breadcrumb />

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <PeopleHere />
        <HistoryButtons />
        <div className="h-5 w-px bg-line" />
        <FileMenu />
        <AccountMenu />
      </div>
    </header>
  );
}

function Breadcrumb() {
  const canvasId = useCurrentCanvasId();
  const diagram = useDiagramStore((s) => s.diagram);
  const path = useMemo(() => getPath(diagram, canvasId), [diagram, canvasId]);
  const { exitTo } = useNavigation();

  type Crumb = { id: string; title: string } | "gap";
  const crumbs: Crumb[] =
    path.length > MAX_CRUMBS ? [path[0]!, "gap", ...path.slice(-(MAX_CRUMBS - 2))] : path;

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-0.5">
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1;
        return (
          <Fragment key={crumb === "gap" ? "gap" : crumb.id}>
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" />}
            {crumb === "gap" ? (
              <span className="px-1 text-fg-subtle">…</span>
            ) : last ? (
              <span aria-current="page" className="truncate rounded-md px-2 py-1 font-medium text-fg">
                {crumb.title}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void exitTo(crumb.id)}
                className="max-w-48 truncate rounded-md px-2 py-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
              >
                {crumb.title}
              </button>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}


function HistoryButtons() {
  const canUndo = useStore(useDiagramStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useDiagramStore.temporal, (s) => s.futureStates.length > 0);
  const { undo, redo } = useHistoryActions();
  const run = (action: () => Promise<void>) => () => void action();
  return (
    <div className="flex items-center gap-0.5">
      <IconButton icon={Undo2} label="Undo" shortcut={`${MOD}Z`} disabled={!canUndo} onClick={run(undo)} />
      <IconButton icon={Redo2} label="Redo" shortcut={`${MOD}Y`} disabled={!canRedo} onClick={run(redo)} />
    </div>
  );
}

interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
}

function IconButton({ icon: Icon, label, shortcut, disabled, onClick }: IconButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="rounded-md p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35"
        >
          <Icon className="size-4" />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          sideOffset={6}
          className="z-50 flex items-center gap-2 rounded-md border border-line bg-surface-raised px-2 py-1 text-xs text-fg shadow-lg shadow-black/40"
        >
          {label}
          {shortcut && <kbd className="font-sans text-fg-subtle">{shortcut}</kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
