import { describe, expect, it } from "vitest";
import { facingAnchors, PARALLEL_GAP, spreadAnchors } from "./edgeGeometry";

const box = (x: number, y: number) => ({ x, y, width: 240, height: 140 });

describe("facingAnchors", () => {
  it("connects side by side boxes right → left", () => {
    const { source, target } = facingAnchors(box(0, 0), box(400, 30));
    expect(source).toEqual({ x: 240, y: 70, side: "right" });
    expect(target).toEqual({ x: 400, y: 100, side: "left" });
  });

  it("flips when the target is on the left", () => {
    const { source, target } = facingAnchors(box(400, 0), box(0, 0));
    expect([source.side, target.side]).toEqual(["left", "right"]);
  });

  it("connects stacked boxes bottom → top, and top → bottom going up", () => {
    expect(facingAnchors(box(0, 0), box(50, 300)).source.side).toBe("bottom");
    expect(facingAnchors(box(0, 300), box(50, 0)).source.side).toBe("top");
  });

  it("judges diagonals by the box shape, not raw distance", () => {
    // 260 right, 200 down: further across than down in pixels, but boxes are
    // wide, so relative to their size this is more vertical.
    expect(facingAnchors(box(0, 0), box(260, 200)).source.side).toBe("bottom");
    expect(facingAnchors(box(0, 0), box(600, 200)).source.side).toBe("right");
  });
});

describe("spreadAnchors", () => {
  const across = facingAnchors(box(0, 0), box(400, 0)); // right → left
  const back = facingAnchors(box(400, 0), box(0, 0)); // left → right
  const down = facingAnchors(box(0, 0), box(0, 300)); // bottom → top

  it("leaves a single line alone", () => {
    expect(spreadAnchors(across, { index: 0, count: 1 })).toEqual(across);
  });

  it("spaces lines evenly around the middle of the box edge", () => {
    const ys = [0, 1, 2].map((index) => spreadAnchors(across, { index, count: 3 }).source.y);
    expect(ys).toEqual([70 - PARALLEL_GAP, 70, 70 + PARALLEL_GAP]);
    const xs = [0, 1].map((index) => spreadAnchors(down, { index, count: 2 }).source.x);
    expect(xs).toEqual([120 - PARALLEL_GAP / 2, 120 + PARALLEL_GAP / 2]);
  });

  it("moves both ends the same way, so opposite directions land on different tracks", () => {
    const a = spreadAnchors(across, { index: 0, count: 2 });
    const b = spreadAnchors(back, { index: 1, count: 2 });
    expect(a.source.y).toBe(a.target.y);
    expect(b.source.y).toBe(b.target.y);
    expect(a.source.y).not.toBe(b.target.y);
  });
});
