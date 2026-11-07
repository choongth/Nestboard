import { describe, expect, it } from "vitest";
import { alignBoxes, distributeBoxes } from "./arrange";
import { moveNodes } from "./operations";
import { ModelError } from "./queries";
import { buildTree } from "./testUtils";
import { BOX_HEIGHT, BOX_WIDTH } from "./types";

// A at (0, 0), B at (300, 50), C at (1000, 200), D elsewhere.
const tree = () => {
  const built = buildTree({ A: {}, B: {}, C: {}, D: {} });
  const diagram = moveNodes(built.diagram, {
    [built.id("A")]: { x: 0, y: 0 },
    [built.id("B")]: { x: 300, y: 50 },
    [built.id("C")]: { x: 1000, y: 200 },
  });
  return { diagram, id: built.id, abc: [built.id("A"), built.id("B"), built.id("C")] };
};

describe("alignBoxes", () => {
  it("lines boxes up on the left, right or centre of the space they cover", () => {
    const { diagram, abc, id } = tree();
    expect(alignBoxes(diagram, abc, "left")[id("C")]).toEqual({ x: 0, y: 200 });
    expect(alignBoxes(diagram, abc, "right")[id("A")]).toEqual({ x: 1000, y: 0 });
    expect(alignBoxes(diagram, abc, "centre")[id("B")]).toEqual({ x: 500, y: 50 });
  });

  it("lines boxes up on the top, bottom or middle, leaving x alone", () => {
    const { diagram, abc, id } = tree();
    expect(alignBoxes(diagram, abc, "top")[id("C")]).toEqual({ x: 1000, y: 0 });
    expect(alignBoxes(diagram, abc, "bottom")[id("A")]).toEqual({ x: 0, y: 200 });
    expect(alignBoxes(diagram, abc, "middle")[id("A")]).toEqual({ x: 0, y: 100 });
  });

  it("returns a position for every box and none for others", () => {
    const { diagram, abc, id } = tree();
    const positions = alignBoxes(diagram, abc, "left");
    expect(Object.keys(positions).sort()).toEqual([...abc].sort());
    expect(positions[id("D")]).toBeUndefined();
    expect(alignBoxes(diagram, [], "left")).toEqual({});
  });

  it("uses the box size, so right and bottom line up outer edges", () => {
    const { diagram, abc } = tree();
    const right = Object.values(alignBoxes(diagram, abc, "right"));
    expect(new Set(right.map((p) => p.x + BOX_WIDTH))).toEqual(new Set([1000 + BOX_WIDTH]));
    const bottom = Object.values(alignBoxes(diagram, abc, "bottom"));
    expect(new Set(bottom.map((p) => p.y + BOX_HEIGHT))).toEqual(new Set([200 + BOX_HEIGHT]));
  });
});

describe("distributeBoxes", () => {
  it("keeps the outermost boxes and spaces the rest evenly between them", () => {
    const { diagram, abc, id } = tree();
    const x = distributeBoxes(diagram, abc, "x");
    expect(x[id("A")]).toEqual({ x: 0, y: 0 });
    expect(x[id("B")]).toEqual({ x: 500, y: 50 });
    expect(x[id("C")]).toEqual({ x: 1000, y: 200 });
    const y = distributeBoxes(diagram, abc, "y");
    expect(y[id("B")]).toEqual({ x: 300, y: 100 });
  });

  it("orders boxes by position, not by the order given", () => {
    const { diagram, id } = tree();
    const x = distributeBoxes(diagram, [id("C"), id("A"), id("B")], "x");
    expect(x[id("B")]!.x).toBe(500);
  });

  it("needs at least three boxes", () => {
    const { diagram, id } = tree();
    expect(distributeBoxes(diagram, [id("A"), id("C")], "x")).toEqual({});
  });

  it("rejects unknown boxes", () => {
    const { diagram, abc } = tree();
    expect(() => distributeBoxes(diagram, [...abc, "missing"], "x")).toThrow(ModelError);
  });
});
