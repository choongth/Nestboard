import { markerUrl } from "@/canvas/lineMarkerIds";
import type { LineStyle } from "@/registry/edgeTypes";

const DASH: Record<LineStyle["stroke"], string | undefined> = {
  solid: undefined,
  dashed: "4 3",
  "long-dashed": "9 4",
  dotted: "0.5 3.5",
  double: undefined,
};

/** A short sample of a connection type's line, for pickers: stroke and arrowheads, no motion. */
export function LinePreview({ style }: { style: LineStyle }) {
  const d = "M7,6 H41";
  return (
    <svg data-line-preview aria-hidden width="48" height="12" viewBox="0 0 48 12" className="shrink-0 overflow-visible">
      <path
        d={d}
        fill="none"
        stroke="var(--color-connection)"
        strokeWidth={style.stroke === "double" ? 4 : style.stroke === "dotted" ? 2 : 1.5}
        strokeLinecap={style.stroke === "dotted" ? "round" : "butt"}
        strokeDasharray={DASH[style.stroke]}
        markerStart={markerUrl(style.start, false)}
        markerEnd={markerUrl(style.end, false)}
      />
      {style.stroke === "double" && <path d="M9,6 H37" fill="none" stroke="var(--color-surface-raised)" strokeWidth={1.5} />}
    </svg>
  );
}
