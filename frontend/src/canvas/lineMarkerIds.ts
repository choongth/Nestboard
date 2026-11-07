import type { LineEnd } from "@/registry/edgeTypes";

/** Element id of a marker defined in LineMarkers. */
export const markerId = (end: Exclude<LineEnd, "none">, selected: boolean) =>
  `nb-marker-${end}${selected ? "-selected" : ""}`;

/** The `marker-start` / `marker-end` value for a line end, or undefined for none. */
export function markerUrl(end: LineEnd, selected: boolean): string | undefined {
  return end === "none" ? undefined : `url(#${markerId(end, selected)})`;
}
