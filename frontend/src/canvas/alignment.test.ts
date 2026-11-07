import { describe, expect, it } from "vitest";
import { snapToGuides } from "./alignment";

const box = (x: number, y: number, width = 240, height = 140) => ({ x, y, width, height });

describe("snapToGuides", () => {
  it("leaves boxes alone when nothing is within reach", () => {
    expect(snapToGuides(box(0, 0), [box(500, 500)], 6)).toEqual({ offset: { x: 0, y: 0 }, guides: [], gaps: [] });
  });

  it("snaps equal boxes into line and draws one centre guide, not three", () => {
    const { offset, guides } = snapToGuides(box(4, 300), [box(0, 0)], 6);
    expect(offset).toEqual({ x: -4, y: 0 });
    expect(guides).toEqual([{ axis: "x", at: 120, from: -16, to: 456 }]);
  });

  it("snaps each axis on its own", () => {
    const { offset, guides } = snapToGuides(box(303, -5), [box(0, 0), box(600, 400)], 6);
    expect(offset).toEqual({ x: 0, y: 5 });
    expect(guides.map((g) => g.axis)).toEqual(["y"]);
  });

  it("lines an edge up with a neighbour's opposite edge", () => {
    // The dragged box's left edge meets the other's right edge.
    const { offset, guides } = snapToGuides(box(243, 400), [box(0, 0)], 6);
    expect(offset.x).toBe(-3);
    expect(guides).toEqual([{ axis: "x", at: 240, from: -16, to: 556 }]);
  });

  it("takes the nearest line when several are within reach", () => {
    expect(snapToGuides(box(5, 300), [box(0, 0), box(3, 600)], 6).offset.x).toBe(-2);
  });

  it("merges guides on the same line into one spanning every box on it", () => {
    const { guides } = snapToGuides(box(2, 300), [box(0, 0), box(0, 600)], 6);
    expect(guides).toEqual([{ axis: "x", at: 120, from: -16, to: 756 }]);
  });

  it("aligns a group by its bounds", () => {
    // Two boxes side by side, dragged together; their combined right edge meets another box's right edge.
    const group = { x: 0, y: 300, width: 540, height: 140 };
    const { offset, guides } = snapToGuides(group, [box(304, 0)], 6);
    expect(offset.x).toBe(4);
    expect(guides).toEqual([{ axis: "x", at: 544, from: -16, to: 456 }]);
  });

  it("snaps to the same gap as two boxes in its row, and marks both gaps", () => {
    // A and B are 60 apart; C is dragged to the right of B, 63 from it.
    const { offset, gaps } = snapToGuides(box(603, 410), [box(0, 400), box(300, 400)], 6);
    expect(offset.x).toBe(-3);
    expect(gaps).toEqual([
      { axis: "x", from: 240, to: 300, at: 470 },
      { axis: "x", from: 540, to: 600, at: 475 },
    ]);
  });

  it("snaps midway between its neighbours", () => {
    const { offset, gaps } = snapToGuides(box(0, 300, 100, 100), [box(-200, 300, 100, 100), box(202, 300, 100, 100)], 6);
    expect(offset.x).toBe(1);
    expect(gaps.map((g) => [g.from, g.to])).toEqual([
      [-100, 1],
      [101, 202],
    ]);
  });

  it("spaces boxes in a column too", () => {
    const { offset, gaps } = snapToGuides(box(500, 404), [box(500, 0), box(500, 200)], 6);
    expect(offset.y).toBe(-4);
    expect(gaps.map((g) => g.axis)).toEqual(["y", "y"]);
  });

  it("ignores boxes outside its row", () => {
    // A and B are 60 apart, but far below C's row.
    expect(snapToGuides(box(603, 0), [box(0, 400), box(300, 400)], 6).gaps).toEqual([]);
    expect(snapToGuides(box(603, 0), [box(0, 400), box(300, 400)], 6).offset.x).toBe(0);
  });

  it("prefers lining up when it is as close as equal spacing", () => {
    // 3px from equal spacing after B, and 3px from lining up with D's left edge.
    const { offset, guides } = snapToGuides(box(603, 410), [box(0, 400), box(300, 400), box(606, 0)], 6);
    expect(offset.x).toBe(3);
    expect(guides.map((g) => g.at)).toContain(726);
  });

  it("uses the threshold it is given (screen pixels divided by zoom)", () => {
    expect(snapToGuides(box(10, 300), [box(0, 0)], 6).offset.x).toBe(0);
    expect(snapToGuides(box(10, 300), [box(0, 0)], 12).offset.x).toBe(-10);
  });
});
