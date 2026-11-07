import { Command } from "cmdk";
import { ChevronRight } from "lucide-react";
import { Popover } from "radix-ui";
import { useMemo, useState, type KeyboardEvent } from "react";
import { childrenIndex, connectionProblem, getPath, joinPath } from "@/model/queries";
import type { Diagram, NodeId } from "@/model/types";
import { boxTypes } from "@/registry/boxTypes";
import { GROUP_HEADING_CLASS } from "./commandList";
import { TypeTile } from "./TypeTile";

interface ConnectToMenuProps {
  diagram: Diagram;
  /** The box the line was dragged from. */
  from: NodeId;
  /**
   * The box the line was dropped on: it and the boxes nested inside it are
   * offered. `null` (dropped on "External box…"): the boxes outside the
   * canvas, from the top level down.
   */
  into: NodeId | null;
  /** The canvas the line was drawn on. */
  canvasId: NodeId;
  /** Whether the user may make the connection to a box (see canConnect). */
  allowed: (to: NodeId) => boolean;
  /** Where the line was dropped, in screen coordinates. */
  at: { x: number; y: number };
  /** The side the line was pulled from: the list opens on that side of the drop point. */
  side: "top" | "right" | "bottom" | "left";
  onPick: (to: NodeId) => void;
  onClose: () => void;
}

interface Row {
  id: NodeId;
  title: string;
  typeId?: string;
  /** Whether a connection to it can be made; others only open. */
  pickable: boolean;
  /** Why it cannot be picked. */
  note?: string;
  /** Whether there is anything to offer inside it. */
  openable: boolean;
  /** Boxes between the list's top and this one, for showing where it sits in a search. */
  within: string[];
}

/**
 * Opens when a line is dropped on a box that has boxes inside it, or on the
 * "External box…" placeholder. One level at a time: pick a box, or open it
 * (the arrow, or →) to see the boxes inside it, as deep as they go; ← or
 * Backspace goes back up. Typing searches every level at once, so a diagram
 * with thousands of boxes stays quick to connect in.
 */
export function ConnectToMenu({ diagram, from, into, canvasId, allowed, at, side, onPick, onClose }: ConnectToMenuProps) {
  const top = into ?? diagram.rootId;
  const fromTitle = diagram.nodes[from]?.title ?? "";
  const title = (id: NodeId) => diagram.nodes[id]?.title ?? "";

  // What is worth showing: a box that can be picked, or one holding such a
  // box. Outside the canvas, the canvas itself and all inside it are left out.
  const tree = useMemo(() => {
    const index = childrenIndex(diagram);
    const childrenOf = (id: NodeId) => (index.get(id) ?? []).map((n) => n.id);
    const pickable = new Set<NodeId>();
    const useful = new Set<NodeId>();
    const visit = (id: NodeId): boolean => {
      let any = false;
      for (const child of childrenOf(id)) {
        if (into === null && child === canvasId) continue;
        if (visit(child)) any = true;
      }
      if (id !== diagram.rootId && connectionProblem(diagram, from, id) === null && allowed(id)) {
        pickable.add(id);
        any = true;
      }
      if (any) useful.add(id);
      return any;
    };
    visit(top);
    return { childrenOf, pickable, useful };
  }, [diagram, from, into, canvasId, top, allowed]);

  const depthOfTop = getPath(diagram, top).length;
  const aboveFrom = new Set(getPath(diagram, from).map((n) => n.id));
  const row = (id: NodeId): Row => {
    const node = diagram.nodes[id]!;
    const pickable = tree.pickable.has(id);
    return {
      id,
      title: node.title,
      typeId: node.typeId,
      pickable,
      note: pickable ? undefined : aboveFrom.has(id) ? "you are inside it" : "you can't connect to it",
      openable: tree.childrenOf(id).some((c) => tree.useful.has(c)),
      within: getPath(diagram, id).slice(depthOfTop, -1).map((n) => n.title),
    };
  };
  const rowsIn = (id: NodeId) => tree.childrenOf(id).filter((c) => tree.useful.has(c)).map(row);

  const [level, setLevel] = useState<NodeId>(top);
  const [search, setSearch] = useState("");
  const [highlighted, setHighlighted] = useState("");
  const levels = getPath(diagram, level).slice(depthOfTop - 1).map((n) => n.id);

  const open = (id: NodeId) => {
    setLevel(id);
    setHighlighted("");
  };
  const up = () => {
    if (level === top) return false;
    setHighlighted(level);
    setLevel(diagram.nodes[level]!.parentId!);
    return true;
  };

  // Searching: every box the list can offer, at any depth, in tree order.
  const everything: Row[] = [];
  const visit = (id: NodeId) => {
    for (const child of tree.childrenOf(id)) {
      if (!tree.useful.has(child)) continue;
      if (tree.pickable.has(child)) everything.push(row(child));
      visit(child);
    }
  };
  if (search !== "") visit(top);

  const onKeyDown = (event: KeyboardEvent) => {
    if (search !== "") return;
    if (event.key === "ArrowLeft" || event.key === "Backspace") {
      if (up()) event.preventDefault();
    } else if (event.key === "ArrowRight") {
      const target = rowsIn(level).find((r) => r.id === highlighted);
      if (target?.openable) {
        event.preventDefault();
        open(target.id);
      }
    }
  };

  const here = rowsIn(level);
  const self = into !== null && level === top && tree.pickable.has(into) ? row(into) : null;
  const searchLabel = into === null ? "Search other levels…" : `Search inside ${title(into)}…`;

  return (
    <Popover.Root open onOpenChange={(open) => !open && onClose()}>
      <Popover.Anchor asChild>
        {/* A point where the line was dropped, for the menu to hang from. */}
        <div aria-hidden style={{ position: "fixed", left: at.x, top: at.y, width: 1, height: 1 }} />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          data-side-requested={side}
          side={side}
          // Left/right: top edge level with the drop point; above/below: left edge level with it.
          align="start"
          sideOffset={6}
          collisionPadding={12}
          // Focus moves on to the new line's label field; do not pull it back.
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="z-50 w-80 overflow-hidden rounded-lg border border-line bg-surface-raised shadow-xl shadow-black/40"
        >
          <Command
            label={into === null ? `Connect ${fromTitle} to a box on another level` : `Connect ${fromTitle} to ${title(into)} or a box inside it`}
            shouldFilter={search !== ""}
            value={highlighted}
            onValueChange={setHighlighted}
            onKeyDown={onKeyDown}
            className="flex max-h-[min(420px,var(--radix-popover-content-available-height))] flex-col"
          >
            <div className="border-b border-line px-3 pt-2.5 text-xs text-fg-subtle">
              Connect <span className="font-medium text-fg">{fromTitle}</span> to…
            </div>
            <Command.Input
              autoFocus
              value={search}
              onValueChange={setSearch}
              placeholder={searchLabel}
              className="border-b border-line bg-transparent px-3 py-2.5 text-fg outline-none placeholder:text-fg-subtle"
            />
            {search === "" && levels.length > 1 && (
              <nav aria-label="Levels" data-menu-levels className="flex flex-wrap items-center gap-0.5 border-b border-line px-2 py-1.5 text-xs">
                {levels.map((id, i) => (
                  <span key={id} className="flex items-center gap-0.5">
                    {i > 0 && <ChevronRight aria-hidden className="size-3 text-fg-subtle" />}
                    <button
                      type="button"
                      onClick={() => open(id)}
                      aria-current={id === level ? "location" : undefined}
                      className="rounded px-1 py-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg aria-[current]:text-fg"
                    >
                      {title(id)}
                    </button>
                  </span>
                ))}
              </nav>
            )}
            <Command.List className="min-h-0 overflow-y-auto p-1">
              <Command.Empty className="px-2 py-6 text-center text-fg-subtle">No box with that name</Command.Empty>
              {search !== "" ? (
                <Command.Group heading="Matching boxes" className={GROUP_HEADING_CLASS}>
                  {self && <TargetItem row={{ ...self, openable: false }} onPick={onPick} onOpen={open} />}
                  {everything.map((r) => (
                    <TargetItem key={r.id} row={{ ...r, openable: false }} showWithin onPick={onPick} onOpen={open} />
                  ))}
                </Command.Group>
              ) : (
                <>
                  {self && (
                    <Command.Group heading="This box" className={GROUP_HEADING_CLASS}>
                      <TargetItem row={{ ...self, openable: false }} onPick={onPick} onOpen={open} />
                    </Command.Group>
                  )}
                  {here.length > 0 ? (
                    <Command.Group heading={level === diagram.rootId ? "Top level" : `Inside ${title(level)}`} className={GROUP_HEADING_CLASS}>
                      {here.map((r) => (
                        <TargetItem key={r.id} row={r} onPick={onPick} onOpen={open} />
                      ))}
                    </Command.Group>
                  ) : (
                    !self && <p className="px-2 py-6 text-center text-fg-subtle">Nothing here to connect to</p>
                  )}
                </>
              )}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function TargetItem({
  row,
  showWithin,
  onPick,
  onOpen,
}: {
  row: Row;
  showWithin?: boolean;
  onPick: (id: NodeId) => void;
  onOpen: (id: NodeId) => void;
}) {
  const { type, category } = boxTypes.resolve(row.typeId);
  return (
    <Command.Item
      value={row.id}
      // Search by name, by the boxes it sits in, and by type.
      keywords={[row.title, ...row.within, type.label]}
      // One that cannot be connected to (e.g. a level above this canvas) only opens.
      onSelect={() => (row.pickable ? onPick(row.id) : onOpen(row.id))}
      data-pickable={row.pickable || undefined}
      className="group flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 outline-none select-none data-[selected=true]:bg-surface-hover"
    >
      <TypeTile icon={type.icon} color={category.color} size="sm" />
      <span data-target-name className="min-w-0 flex-1 truncate">
        {showWithin && row.within.length > 0 && <span className="text-fg-subtle">{joinPath(row.within)} › </span>}
        <span className={row.pickable ? "text-fg" : "text-fg-muted"}>{row.title}</span>
        {row.note && <span className="ml-1.5 text-[11px] text-fg-subtle">{row.note}</span>}
      </span>
      {row.openable && (
        <button
          type="button"
          aria-label={`Open ${row.title}`}
          data-open-level
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(row.id);
          }}
          className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-surface hover:text-fg"
        >
          <ChevronRight className="size-4" />
        </button>
      )}
    </Command.Item>
  );
}
