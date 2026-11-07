// Alignment guides: while boxes are dragged, their edges and centre lines snap
// to those of the other boxes on the level, and a guide line shows each match.
// They also snap to equal spacing: the gap to a neighbour in the same row (or
// column) matching another gap in it, or sitting midway between two boxes.
// Pure geometry in canvas coordinates; the canvas applies it during a drag.

import type { Rect } from "@/model/queries";
import type { Position } from "@/model/types";

type Axis = "x" | "y";

/** A guide line: vertical at x = `at` from y = `from` to `to`, or horizontal at y = `at`. */
export interface Guide {
  axis: Axis;
  at: number;
  from: number;
  to: number;
}

/**
 * One of several equal gaps between neighbouring boxes: along `axis` from
 * `from` to `to` (x positions for "x"), drawn across the gap at `at`.
 */
export interface Gap {
  axis: Axis;
  from: number;
  to: number;
  at: number;
}

export interface Snap {
  /** How far to shift the dragged boxes so they line up. */
  offset: Position;
  guides: Guide[];
  gaps: Gap[];
}

/** How close, in screen pixels, a line must come before it snaps. */
export const SNAP_DISTANCE = 6;
/** How far a guide runs past the boxes it joins, in canvas units. */
const GUIDE_OVERHANG = 16;
/** Lines (or gaps) this close after snapping count as aligned (rounding). */
const ALIGNED = 0.5;

type Line = { kind: "start" | "centre" | "end"; at: number };
type Candidate = { shift: number; distance: number };

const startOf = (r: Rect, axis: Axis) => (axis === "x" ? r.x : r.y);
const sizeOf = (r: Rect, axis: Axis) => (axis === "x" ? r.width : r.height);
const endOf = (r: Rect, axis: Axis) => startOf(r, axis) + sizeOf(r, axis);
/** The extent across the axis: y range for "x", x range for "y". */
const across = (r: Rect, axis: Axis): [number, number] => (axis === "x" ? [r.y, r.y + r.height] : [r.x, r.x + r.width]);

const linesOf = (r: Rect, axis: Axis): Line[] => {
  const start = startOf(r, axis);
  const size = sizeOf(r, axis);
  return [
    { kind: "start", at: start },
    { kind: "centre", at: start + size / 2 },
    { kind: "end", at: start + size },
  ];
};

/**
 * Lines `moving` (the dragged boxes' bounds) up with `others`. Each axis snaps
 * on its own, to the nearest aligned line or equal spacing within `threshold`
 * (canvas units); on a tie, lines win. Guides are drawn for every box that
 * ends up aligned; when two boxes line up at the centre, only the centre guide
 * is drawn, since equal-sized boxes would otherwise show three guides for one
 * alignment. Equal gaps are marked whenever the dragged boxes' gap to a
 * neighbour matches another.
 */
export function snapToGuides(moving: Rect, others: readonly Rect[], threshold: number): Snap {
  const shift = (axis: Axis) => {
    const line = nearestLine(moving, others, axis, threshold);
    const spacing = nearestSpacing(moving, others, axis, threshold);
    const best = !spacing || (line && line.distance <= spacing.distance) ? line : spacing;
    return best?.shift ?? 0;
  };
  const offset = { x: shift("x"), y: shift("y") };
  const snapped = { ...moving, x: moving.x + offset.x, y: moving.y + offset.y };
  return {
    offset,
    guides: [...guidesFor(snapped, others, "x"), ...guidesFor(snapped, others, "y")],
    gaps: [...gapsFor(snapped, others, "x"), ...gapsFor(snapped, others, "y")],
  };
}

/** The smallest shift along `axis` that lines `moving` up with any other box. */
function nearestLine(moving: Rect, others: readonly Rect[], axis: Axis, threshold: number): Candidate | null {
  let best: Candidate | null = null;
  for (const other of others) {
    for (const m of linesOf(moving, axis)) {
      for (const o of linesOf(other, axis)) {
        const distance = Math.abs(o.at - m.at);
        if (distance <= threshold && (!best || distance <= best.distance)) best = { shift: o.at - m.at, distance };
      }
    }
  }
  return best;
}

/** Boxes in the same row as `r` for spacing along `axis`: overlapping it across the axis. */
const rowOf = (r: Rect, others: readonly Rect[], axis: Axis) => {
  const [r0, r1] = across(r, axis);
  return others.filter((o) => {
    const [o0, o1] = across(o, axis);
    return o0 < r1 && r0 < o1;
  });
};

/** Neighbouring boxes along `axis` with space between them, in order. */
function gapsBetween(boxes: readonly Rect[], axis: Axis): { a: Rect; b: Rect; size: number }[] {
  const sorted = [...boxes].sort((p, q) => startOf(p, axis) - startOf(q, axis));
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    const size = startOf(b, axis) - endOf(a, axis);
    if (size > 0) gaps.push({ a, b, size });
  }
  return gaps;
}

/**
 * The smallest shift along `axis` that spaces `moving` evenly in its row:
 * midway between its neighbours on either side, or as far from one of them
 * as two other boxes in the row are from each other.
 */
function nearestSpacing(moving: Rect, others: readonly Rect[], axis: Axis, threshold: number): Candidate | null {
  const row = rowOf(moving, others, axis);
  const start = startOf(moving, axis);
  const size = sizeOf(moving, axis);
  const centre = start + size / 2;
  const centreOf = (o: Rect) => startOf(o, axis) + sizeOf(o, axis) / 2;
  // The nearest neighbour on each side.
  const before = row.filter((o) => centreOf(o) < centre).sort((p, q) => endOf(q, axis) - endOf(p, axis))[0];
  const after = row.filter((o) => centreOf(o) >= centre).sort((p, q) => startOf(p, axis) - startOf(q, axis))[0];
  const gaps = gapsBetween(row, axis).map((g) => g.size);

  const targets: number[] = [];
  if (before && after) {
    const midway = (endOf(before, axis) + startOf(after, axis) - size) / 2;
    if (midway > endOf(before, axis)) targets.push(midway);
  }
  for (const gap of gaps) {
    if (before) targets.push(endOf(before, axis) + gap);
    if (after) targets.push(startOf(after, axis) - gap - size);
  }

  let best: Candidate | null = null;
  for (const target of targets) {
    const distance = Math.abs(target - start);
    if (distance <= threshold && (!best || distance < best.distance)) best = { shift: target - start, distance };
  }
  return best;
}

function guidesFor(moving: Rect, others: readonly Rect[], axis: Axis): Guide[] {
  // Guides at the same line are merged into one spanning every box on it.
  const byLine = new Map<number, Guide>();

  for (const other of others) {
    const matches = linesOf(moving, axis).flatMap((m) =>
      linesOf(other, axis)
        .filter((o) => Math.abs(o.at - m.at) < ALIGNED)
        .map((o) => ({ m, o })),
    );
    const centred = matches.filter(({ m, o }) => m.kind === "centre" && o.kind === "centre");
    for (const { m } of centred.length > 0 ? centred : matches) {
      const at = Math.round(m.at * 2) / 2;
      const [a0, a1] = across(moving, axis);
      const [b0, b1] = across(other, axis);
      const from = Math.min(a0, b0) - GUIDE_OVERHANG;
      const to = Math.max(a1, b1) + GUIDE_OVERHANG;
      const existing = byLine.get(at);
      byLine.set(
        at,
        existing ? { ...existing, from: Math.min(existing.from, from), to: Math.max(existing.to, to) } : { axis, at, from, to },
      );
    }
  }
  return [...byLine.values()];
}

/** Every gap in `moving`'s row equal to one of its own gaps to a neighbour, when there are at least two. */
function gapsFor(moving: Rect, others: readonly Rect[], axis: Axis): Gap[] {
  const gaps = gapsBetween([...rowOf(moving, others, axis), moving], axis);
  const marked = new Set<(typeof gaps)[number]>();
  for (const own of gaps.filter((g) => g.a === moving || g.b === moving)) {
    const equal = gaps.filter((g) => Math.abs(g.size - own.size) < ALIGNED);
    if (equal.length >= 2) for (const g of equal) marked.add(g);
  }
  return [...marked].map(({ a, b }) => {
    // Drawn across the middle of where the two boxes face each other.
    const [a0, a1] = across(a, axis);
    const [b0, b1] = across(b, axis);
    const lo = Math.max(a0, b0);
    const hi = Math.min(a1, b1);
    const at = lo <= hi ? (lo + hi) / 2 : (a0 + a1 + b0 + b1) / 4;
    return { axis, from: endOf(a, axis), to: startOf(b, axis), at };
  });
}
