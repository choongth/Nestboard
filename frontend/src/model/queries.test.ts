import { describe, expect, it } from "vitest";
import {
  boxTitles,
  childrenIndex,
  joinPath,
  walkBoxes,
  getChildCount,
  getChildren,
  getChildrenBounds,
  getEdgesOn,
  getNestedCount,
  getPath,
  connectionProblem,
  getSubtreeIds,
  isAncestor,
  lowestCommonAncestor,
  ModelError,
} from "./queries";
import { moveNode } from "./operations";
import { buildTree, connect } from "./testUtils";
import { BOX_HEIGHT, BOX_WIDTH } from "./types";

const tree = () => buildTree({ A: { A1: {}, A2: { A2a: {} } }, B: {} });

describe("getChildren / getChildCount", () => {
  it("returns direct children only, in creation order", () => {
    const { diagram, id } = tree();
    expect(getChildren(diagram, diagram.rootId).map((n) => n.title)).toEqual(["A", "B"]);
    expect(getChildren(diagram, id("A")).map((n) => n.title)).toEqual(["A1", "A2"]);
    expect(getChildCount(diagram, id("A"))).toBe(2);
    expect(getChildCount(diagram, id("B"))).toBe(0);
  });
});

describe("getPath", () => {
  it("lists ancestors from the root down to the node", () => {
    const { diagram, id } = tree();
    expect(getPath(diagram, id("A2a")).map((n) => n.title)).toEqual(["Root", "A", "A2", "A2a"]);
    expect(getPath(diagram, diagram.rootId).map((n) => n.title)).toEqual(["Root"]);
  });

  it("throws for an unknown id", () => {
    const { diagram } = tree();
    expect(() => getPath(diagram, "missing")).toThrow(ModelError);
  });
});

describe("getSubtreeIds", () => {
  it("includes the node and all its descendants", () => {
    const { diagram, id } = tree();
    expect(getSubtreeIds(diagram, id("A"))).toEqual(new Set([id("A"), id("A1"), id("A2"), id("A2a")]));
    expect(getSubtreeIds(diagram, id("B"))).toEqual(new Set([id("B")]));
  });
});

describe("walkBoxes / boxTitles", () => {
  it("walks depth-first in the diagram's order, with each box's depth", () => {
    const { diagram, id } = tree();
    const walk = (from?: string) => walkBoxes(diagram, from).map((b) => `${b.node.title}:${b.depth}`);
    expect(walk()).toEqual(["A:0", "A1:1", "A2:1", "A2a:2", "B:0"]);
    expect(walk(id("A2"))).toEqual(["A2a:0"]);
    expect(childrenIndex(diagram).get(id("A"))!.map((n) => n.title)).toEqual(["A1", "A2"]);
  });

  it("names a box by the boxes it sits in, the root left out", () => {
    const { diagram, id } = tree();
    expect(joinPath(boxTitles(diagram, id("A2a")))).toBe("A › A2 › A2a");
    expect(boxTitles(diagram, diagram.rootId)).toEqual([]);
  });
});

describe("getNestedCount", () => {
  it("counts boxes nested inside the given ones, at any depth, each once", () => {
    const { diagram, id } = tree();
    expect(getNestedCount(diagram, [id("A")])).toBe(3);
    expect(getNestedCount(diagram, [id("A"), id("B")])).toBe(3);
    expect(getNestedCount(diagram, [id("A"), id("A2")])).toBe(2); // A2 itself is not "nested" here
    expect(getNestedCount(diagram, [id("B"), "missing"])).toBe(0);
  });
});

describe("lowestCommonAncestor", () => {
  it("is the parent for siblings", () => {
    const { diagram, id } = tree();
    expect(lowestCommonAncestor(diagram, id("A1"), id("A2"))).toBe(id("A"));
  });

  it("is the deepest shared ancestor across levels", () => {
    const { diagram, id } = tree();
    expect(lowestCommonAncestor(diagram, id("A2a"), id("A1"))).toBe(id("A"));
    expect(lowestCommonAncestor(diagram, id("A2a"), id("B"))).toBe(diagram.rootId);
  });

  it("is strictly above both when one contains the other", () => {
    const { diagram, id } = tree();
    expect(lowestCommonAncestor(diagram, id("A"), id("A2a"))).toBe(diagram.rootId);
  });

  it("throws when one endpoint is the root", () => {
    const { diagram, id } = tree();
    expect(() => lowestCommonAncestor(diagram, diagram.rootId, id("A"))).toThrow(ModelError);
  });
});

describe("getEdgesOn", () => {
  it("returns only edges drawn on that canvas", () => {
    const { diagram: d, id } = tree();
    const diagram = connect(connect(d, id("A1"), id("A2")), id("A"), id("B"));
    expect(getEdgesOn(diagram, id("A")).map((e) => [e.from, e.to])).toEqual([[id("A1"), id("A2")]]);
    expect(getEdgesOn(diagram, diagram.rootId).map((e) => [e.from, e.to])).toEqual([[id("A"), id("B")]]);
    expect(getEdgesOn(diagram, id("B"))).toEqual([]);
  });
});

describe("getChildrenBounds", () => {
  it("covers every child box, including its size", () => {
    const { diagram: d, id } = tree();
    const diagram = moveNode(moveNode(d, id("A1"), { x: -100, y: 50 }), id("A2"), { x: 400, y: -20 });
    expect(getChildrenBounds(diagram, id("A"))).toEqual({
      x: -100,
      y: -20,
      width: 500 + BOX_WIDTH,
      height: 70 + BOX_HEIGHT,
    });
  });

  it("is null for an empty canvas", () => {
    const { diagram, id } = tree();
    expect(getChildrenBounds(diagram, id("B"))).toBeNull();
  });
});

describe("isAncestor / connectionProblem", () => {
  it("knows which boxes contain which", () => {
    const { diagram, id } = tree();
    expect(isAncestor(diagram, id("A"), id("A2a"))).toBe(true);
    expect(isAncestor(diagram, diagram.rootId, id("B"))).toBe(true);
    expect(isAncestor(diagram, id("A2a"), id("A"))).toBe(false);
    expect(isAncestor(diagram, id("A"), id("A"))).toBe(false);
    expect(isAncestor(diagram, id("A"), id("B"))).toBe(false);
  });

  it("allows any two boxes except a box and itself or its own contents", () => {
    const { diagram, id } = tree();
    expect(connectionProblem(diagram, id("A1"), id("A2"))).toBeNull();
    expect(connectionProblem(diagram, id("A2a"), id("B"))).toBeNull();
    expect(connectionProblem(diagram, id("A"), id("A"))).toMatch(/itself/);
    expect(connectionProblem(diagram, id("A2a"), id("A"))).toMatch(/nested inside it/);
  });
});
