import { markerId } from "./lineMarkerIds";

/**
 * The arrowheads and dots lines end in, defined once for the whole canvas.
 * `orient="auto-start-reverse"` turns a marker at a line's start to point
 * back along it, so one arrow serves both ends ("Reads from" points at the
 * reader, at the start). Sizes are in canvas units, so a thick double line
 * does not get giant arrowheads.
 */
export function LineMarkers() {
  return (
    <svg aria-hidden width="0" height="0" style={{ position: "absolute" }}>
      <defs>
        {[false, true].map((selected) => (
          <g key={String(selected)}>
            <marker {...common} id={markerId("arrow", selected)} refX="9" refY="5">
              <path d="M0,1 L9,5 L0,9 Z" className={cls("nb-marker", selected)} />
            </marker>
            <marker {...common} id={markerId("open-arrow", selected)} refX="9" refY="5">
              <path d="M1,1 L9,5 L1,9" className={cls("nb-marker-open", selected)} />
            </marker>
            <marker {...common} id={markerId("dot", selected)} refX="5" refY="5">
              <circle cx="5" cy="5" r="4.5" className={cls("nb-marker", selected)} />
            </marker>
          </g>
        ))}
      </defs>
    </svg>
  );
}

const common = {
  viewBox: "0 0 10 10",
  markerWidth: 12,
  markerHeight: 12,
  markerUnits: "userSpaceOnUse",
  orient: "auto-start-reverse",
} as const;

const cls = (base: string, selected: boolean) => (selected ? `${base} nb-marker-selected` : base);
