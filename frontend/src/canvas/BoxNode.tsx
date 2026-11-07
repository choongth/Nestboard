import { Handle, Position, useConnection, type Node, type NodeProps } from "@xyflow/react";
import { Layers, Lock, UserRound } from "lucide-react";
import { memo } from "react";
import { TechMark } from "@/components/TechMark";
import { TypeTile } from "@/components/TypeTile";
import { boxTypes, GENERIC_TYPE_ID } from "@/registry/boxTypes";
import { BOX_BACKGROUND, NOTE_BACKGROUND } from "./boxStyle";

export type BoxNodeData = {
  title: string;
  /** Stored type id; missing or unknown ids are drawn as the generic type. */
  typeId?: string;
  technology?: string;
  childCount: number;
  /** Set while this box should pulse (e.g. an undo just changed it); a new value restarts the pulse. */
  highlightKey?: number;
  /** You may not change this box (see model/rights.ts). */
  locked?: boolean;
  /** Who is in charge of it: people and groups with an owner grant on it. */
  inCharge?: string[];
  /** You may draw connections at all (a viewer may not). */
  connectable?: boolean;
  /** Others who have it selected (or are dragging it), in their colours. */
  watchers?: { name: string; color: string }[];
};

export type BoxFlowNode = Node<BoxNodeData, "box">;

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];
const TECH_LOGO_SIZE = 30;

/**
 * A box: type icon and label on the top border, technology logo top-left,
 * nested-box count top-right, and the title in the middle. The technology name
 * and description live in the sidebar only, to keep boxes uncluttered.
 */
export const BoxNode = memo(function BoxNode({ data, selected }: NodeProps<BoxFlowNode>) {
  // While a connection is being dragged, every box shows its points as drop targets.
  const connecting = useConnection((c) => c.inProgress);
  const { type, category, known, storedId } = boxTypes.resolve(data.typeId);
  const look = !known ? "generic" : type.id === "group" ? "group" : type.id === "note" ? "note" : "default";
  // Generic boxes carry no label (and so no type icon), so new boxes stay
  // clean. Unknown types show their stored id so the user notices.
  const label = !known ? storedId : type.id === GENERIC_TYPE_ID ? null : type.label;

  return (
    <div
      data-box-type={known ? type.id : "unknown"}
      className={[
        "group relative flex h-full w-full items-center justify-center rounded-xl border px-4 pt-6 pb-3 transition-[border-color,box-shadow]",
        look === "group"
          ? "border-dashed bg-surface-raised/35"
          : look === "note"
            ? "nb-note shadow-lg shadow-black/25"
            : "bg-surface-raised shadow-lg shadow-black/25",
        selected
          ? "border-fg ring-2 ring-white/15"
          : look === "group"
            ? "border-line-strong hover:border-fg-subtle"
            : look === "note"
              ? "border-note-edge hover:border-note-edge-strong"
              : "border-line hover:border-line-strong hover:shadow-xl hover:shadow-black/35",
      ].join(" ")}
    >
      {label && (
        <span
          data-box-label
          title={known ? undefined : `Unknown type "${storedId}", shown as Generic`}
          className={[
            "absolute top-0 left-3 flex max-w-[calc(100%-1.5rem)] -translate-y-1/2 items-center gap-1 rounded-md bg-canvas py-0.5 pr-1.5 pl-0.5",
            known ? "" : "border border-dashed border-line-strong",
          ].join(" ")}
        >
          <TypeTile data-box-icon icon={type.icon} color={category.color} size="xs" />
          <span
            data-box-label-text
            className={[
              "truncate text-[10px] leading-4 font-semibold",
              known ? "tracking-wider uppercase" : "font-mono text-fg-muted",
            ].join(" ")}
            style={known ? { color: category.color } : undefined}
          >
            {label}
          </span>
        </span>
      )}

      {/* Technology logo, a little larger than the type icon it replaced. */}
      <span className="absolute top-3 left-3">
        <TechMark
          technology={data.technology}
          background={look === "note" ? NOTE_BACKGROUND : BOX_BACKGROUND}
          size={TECH_LOGO_SIZE}
        />
      </span>

      {data.childCount > 0 && (
        <span
          className="absolute top-[17px] right-3 flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-accent"
          title={`${data.childCount} nested ${data.childCount === 1 ? "box" : "boxes"}`}
        >
          <Layers className="size-3" />
          {data.childCount}
        </span>
      )}

      <div data-box-title className="line-clamp-2 text-center text-[17px] leading-snug font-semibold text-fg">
        {data.title}
      </div>

      {(data.locked || (data.inCharge && data.inCharge.length > 0)) && (
        <div className="absolute right-3 bottom-2 left-3 flex items-center justify-end gap-1.5 text-[11px] text-fg-subtle">
          {data.inCharge && data.inCharge.length > 0 && (
            <span data-in-charge className="flex min-w-0 items-center gap-1" title={`In charge: ${data.inCharge.join(", ")}`}>
              <UserRound className="size-3 shrink-0" />
              <span className="truncate">{data.inCharge.join(", ")}</span>
            </span>
          )}
          {data.locked && <Lock data-locked aria-label="Locked: you can't change this box" className="size-3 shrink-0" />}
        </div>
      )}

      {data.watchers && data.watchers.length > 0 && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-[3px] rounded-[14px] border-2"
            style={{ borderColor: data.watchers[0]!.color }}
          />
          <span
            data-watched-by={data.watchers.map((w) => w.name).join(", ")}
            className="pointer-events-none absolute -top-1 right-2 max-w-[calc(100%-1rem)] -translate-y-full truncate rounded-md px-1.5 py-0.5 text-[10px] leading-3 font-semibold text-black"
            style={{ backgroundColor: data.watchers[0]!.color }}
          >
            {data.watchers.map((w) => w.name).join(", ")}
          </span>
        </>
      )}

      {data.highlightKey !== undefined && (
        <div
          key={data.highlightKey}
          aria-hidden
          className="nb-highlight pointer-events-none absolute -inset-1 rounded-[14px]"
        />
      )}

      {/* Any point can start or end a connection (the canvas uses loose
          connection mode), so all four are sources. */}
      {SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={side}
          isConnectable={data.connectable !== false}
          className={[
            "nb-handle",
            data.connectable === false ? "invisible" : connecting ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          ].join(" ")}
        />
      ))}
    </div>
  );
});
