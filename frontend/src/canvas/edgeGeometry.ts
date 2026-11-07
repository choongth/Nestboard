import type { Position as XY } from "@/model/types";

export type Side = "top" | "right" | "bottom" | "left";

export interface Anchor {
  x: number;
  y: number;
  side: Side;
}

interface BoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Picks the facing sides of two boxes and returns the midpoint of each, where
 * the connection points sit. The choice accounts for the box shape, so wide
 * boxes side by side connect left-right and stacked boxes connect top-bottom.
 */
export function facingAnchors(source: BoxRect, target: BoxRect): { source: Anchor; target: Anchor } {
  const sc = center(source);
  const tc = center(target);
  const dx = tc.x - sc.x;
  const dy = tc.y - sc.y;
  // Normalise by size so "more horizontal than vertical" means relative to the box shape.
  const horizontal = Math.abs(dx) / (source.width + target.width) >= Math.abs(dy) / (source.height + target.height);

  if (horizontal) {
    const sourceSide: Side = dx >= 0 ? "right" : "left";
    return { source: anchor(source, sourceSide), target: anchor(target, opposite(sourceSide)) };
  }
  const sourceSide: Side = dy >= 0 ? "bottom" : "top";
  return { source: anchor(source, sourceSide), target: anchor(target, opposite(sourceSide)) };
}

export function anchor(box: BoxRect, side: Side): Anchor {
  switch (side) {
    case "top":
      return { x: box.x + box.width / 2, y: box.y, side };
    case "bottom":
      return { x: box.x + box.width / 2, y: box.y + box.height, side };
    case "left":
      return { x: box.x, y: box.y + box.height / 2, side };
    case "right":
      return { x: box.x + box.width, y: box.y + box.height / 2, side };
  }
}

function center(box: BoxRect): XY {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function opposite(side: Side): Side {
  return ({ top: "bottom", bottom: "top", left: "right", right: "left" } as const)[side];
}

/** Space between neighbouring parallel lines, in canvas pixels: enough for their labels not to touch. */
export const PARALLEL_GAP = 26;

/**
 * Spreads lines that join the same two boxes so they sit side by side. Both
 * ends move the same way along their box edge (down for left/right edges,
 * right for top/bottom ones), whatever the line's direction, so a line and
 * its opposite still land on different tracks. A single line is unchanged.
 */
export function spreadAnchors(
  anchors: { source: Anchor; target: Anchor },
  parallel: { index: number; count: number },
): { source: Anchor; target: Anchor } {
  const offset = (parallel.index - (parallel.count - 1) / 2) * PARALLEL_GAP;
  if (offset === 0) return anchors;
  const shift = (a: Anchor): Anchor =>
    a.side === "left" || a.side === "right" ? { ...a, y: a.y + offset } : { ...a, x: a.x + offset };
  return { source: shift(anchors.source), target: shift(anchors.target) };
}
