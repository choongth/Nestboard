import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Position,
  useInternalNode,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { memo } from "react";
import { TypeIconGlyph } from "@/components/typeIcons";
import { BOX_HEIGHT, BOX_WIDTH } from "@/model/types";
import { edgeTypes, GENERIC_EDGE_TYPE_ID } from "@/registry/edgeTypes";
import { useViewStore } from "@/store/viewStore";
import { facingAnchors, spreadAnchors, type Side } from "./edgeGeometry";
import { markerUrl } from "./lineMarkerIds";

export type ConnectionEdgeData = {
  label?: string;
  /** Stored connection type; missing or unknown ids are drawn as generic. */
  typeId?: string;
  /** Where this line sits among the lines joining the same two boxes. */
  parallel: { index: number; count: number };
  /** Drawn between boxes containing the real ends; faded (with its label) unless selected. */
  lifted?: boolean;
  /** Set while this connection should pulse; a new value restarts the pulse. */
  highlightKey?: number;
};
export type ConnectionFlowEdge = Edge<ConnectionEdgeData, "connection">;

/** Length (canvas pixels) at each end of a double line where the core is left out. */
const DOUBLE_END_GAP = 12;

const POSITION: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/**
 * A directional line drawn in its connection type's style (stroke, flow and
 * arrowheads; see src/registry/edgeTypes.ts). It attaches to whichever sides
 * of the two boxes face each other, so it re-routes as the boxes move.
 */
export const ConnectionEdge = memo(function ConnectionEdge({
  id,
  source,
  target,
  data,
  selected,
}: EdgeProps<ConnectionFlowEdge>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const select = useViewStore((st) => st.select);
  if (!sourceNode || !targetNode) return null;

  const rect = (n: typeof sourceNode) => ({
    ...n.internals.positionAbsolute,
    width: n.measured.width ?? BOX_WIDTH,
    height: n.measured.height ?? BOX_HEIGHT,
  });
  const { source: s, target: t } = spreadAnchors(
    facingAnchors(rect(sourceNode), rect(targetNode)),
    data?.parallel ?? { index: 0, count: 1 },
  );
  const [path, labelX, labelY] = getBezierPath({
    sourceX: s.x,
    sourceY: s.y,
    sourcePosition: POSITION[s.side],
    targetX: t.x,
    targetY: t.y,
    targetPosition: POSITION[t.side],
  });

  const { type, category } = edgeTypes.resolve(data?.typeId);
  const { stroke, flow, start, end } = type.style;
  const typed = type.id !== GENERIC_EDGE_TYPE_ID;
  // A typed line without a label of its own still says what it is.
  const text = data?.label || (typed ? type.verb : undefined);

  return (
    <>
      {data?.highlightKey !== undefined && (
        <path key={data.highlightKey} d={path} className="nb-highlight-edge" fill="none" aria-hidden />
      )}
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerUrl(start, !!selected)}
        markerEnd={markerUrl(end, !!selected)}
        className={[
          "nb-connection",
          `nb-stroke-${stroke}`,
          flow !== "none" ? `nb-flow-${flow}` : "",
          `nb-type-${type.id}`,
          selected ? "nb-connection-selected" : "",
        ].join(" ")}
        interactionWidth={18}
      />
      {stroke === "double" && (
        <path
          d={path}
          className="nb-double-core"
          aria-hidden
          // Stop the core short of both ends, so it does not cut through the arrowhead.
          ref={(el) => {
            if (el) el.style.strokeDasharray = `0 ${DOUBLE_END_GAP} ${Math.max(el.getTotalLength() - 2 * DOUBLE_END_GAP, 0)} 100000`;
          }}
        />
      )}
      {text && (
        <EdgeLabelRenderer>
          <div
            data-edge-label
            className={[
              "nodrag nopan pointer-events-auto absolute flex max-w-48 items-center gap-1 rounded-md border py-0.5 pr-2 text-[11px] font-medium shadow-md shadow-black/30",
              typed ? "pl-1" : "pl-2",
              selected
                ? "border-connection-active bg-surface-raised text-fg"
                : "border-line bg-surface-raised text-fg-muted",
              // Labels live in their own layer, so they fade separately from the line.
              data?.lifted && !selected ? "opacity-50" : "",
            ].join(" ")}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            // Labels sit in their own layer, outside the edge's click target.
            onClick={() => select({ type: "connection", id })}
          >
            {typed && (
              <TypeIconGlyph
                icon={type.icon}
                aria-label={type.label}
                className="size-3 shrink-0"
                style={{ color: category.color }}
              />
            )}
            <span className={`truncate ${data?.label ? "" : "italic"}`}>{text}</span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
