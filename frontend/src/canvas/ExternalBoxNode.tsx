import { Handle, Position, useConnection, type Node, type NodeProps } from "@xyflow/react";
import { Network } from "lucide-react";
import { memo } from "react";
import { TypeTile } from "@/components/TypeTile";
import { boxTypes } from "@/registry/boxTypes";

export type ExternalBoxData = {
  title: string;
  typeId?: string;
  /** The path ending at the box, e.g. "Finance › Ledger". */
  location: string;
  highlightKey?: number;
};

export type ExternalFlowNode = Node<ExternalBoxData, "external">;

/** The id of the "External box…" placeholder; box ids never look like it. */
export const PLACEHOLDER_ID = "nb-external-placeholder";

export type PlaceholderFlowNode = Node<Record<string, never>, "placeholder">;

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];

/**
 * A box from a level above, shown at the edge of this canvas: where this
 * level's connections lead, and somewhere to drop a new line. Faded and
 * dashed so it never reads as part of this level. Editors may move the
 * connected ones around (see externalLayout.ts).
 */
export const ExternalBoxNode = memo(function ExternalBoxNode({ data, selected }: NodeProps<ExternalFlowNode>) {
  const connecting = useConnection((c) => c.inProgress);
  const { type, category } = boxTypes.resolve(data.typeId);
  return (
    <div
      data-external-box
      title={`${data.location}. Double-click to go there.`}
      className={[
        "group relative flex h-full w-full items-center gap-2.5 rounded-xl border border-dashed bg-surface/60 px-3 transition-[border-color,opacity]",
        selected ? "border-fg opacity-100" : "border-line-strong opacity-75 hover:opacity-100",
      ].join(" ")}
    >
      <TypeTile icon={type.icon} color={category.color} size="md" />
      <div className="min-w-0">
        <div data-box-title className="truncate font-semibold text-fg">
          {data.title}
        </div>
        <div data-external-location className="truncate text-[11px] text-fg-subtle">
          {data.location}
        </div>
      </div>

      {data.highlightKey !== undefined && (
        <div key={data.highlightKey} aria-hidden className="nb-highlight pointer-events-none absolute -inset-1 rounded-[14px]" />
      )}

      {SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={side}
          className={["nb-handle", connecting ? "opacity-100" : "opacity-0 group-hover:opacity-100"].join(" ")}
        />
      ))}
    </div>
  );
});

/**
 * Shown only while a line is being dragged inside a box: drop the line here
 * to pick a box on another level from a list (see ConnectToMenu). The box
 * picked then sits where this one was.
 */
export const PlaceholderNode = memo(function PlaceholderNode() {
  return (
    <div
      data-external-placeholder
      className="relative flex h-full w-full items-center gap-2.5 rounded-xl border border-dashed border-line-strong bg-surface/60 px-3 text-fg-muted"
    >
      <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-hover">
        <Network className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="truncate font-semibold text-fg">External box…</div>
        <div className="truncate text-[11px] text-fg-subtle">Drop to pick from other levels</div>
      </div>
      {SIDES.map((side) => (
        <Handle key={side} id={side} type="source" position={side} className="nb-handle opacity-100" />
      ))}
    </div>
  );
});
