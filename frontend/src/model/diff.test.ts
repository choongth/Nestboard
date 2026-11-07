import { describe, expect, it } from "vitest";
import { describeChange } from "./diff";
import { addNode, deleteNode, moveNode, placeExternals, setEdgeLabel, updateNode } from "./operations";
import { buildTree, connect } from "./testUtils";

const tree = () => buildTree({ A: { A1: { A1a: {} }, A2: {} }, B: {} });

describe("describeChange", () => {
  it("is null when nothing changed", () => {
    const { diagram } = tree();
    expect(describeChange(diagram, diagram)).toBeNull();
  });

  it("points at the canvas holding an edited or moved box", () => {
    const { diagram, id } = tree();
    expect(describeChange(diagram, updateNode(diagram, id("A1"), { title: "X" }))).toEqual({
      canvasId: id("A"),
      boxes: [id("A1")],
      connections: [],
      removedBoxes: [],
    });
    expect(describeChange(diagram, moveNode(diagram, id("B"), { x: 9, y: 9 }))?.canvasId).toBe(diagram.rootId);
  });

  it("shows external boxes moved inside a box on that box's own canvas", () => {
    const { diagram, id } = tree();
    const moved = placeExternals(diagram, id("A"), { [id("B")]: { x: 900, y: 0 } });
    expect(describeChange(diagram, moved)?.canvasId).toBe(id("A"));
    expect(describeChange(moved, diagram)?.canvasId).toBe(id("A"));
  });

  it("reports added boxes", () => {
    const { diagram, id } = tree();
    const { diagram: after, id: added } = addNode(diagram, id("A2"), { x: 0, y: 0 });
    expect(describeChange(diagram, after)).toMatchObject({ canvasId: id("A2"), boxes: [added] });
  });

  it("shows a subtree deletion on the level that held the deleted box", () => {
    const { diagram, id } = tree();
    const change = describeChange(diagram, deleteNode(diagram, id("A1")));
    expect(change).toEqual({ canvasId: id("A"), boxes: [], connections: [], removedBoxes: [id("A1")] });
  });

  it("shows a subtree restore (undoing a delete) the same way", () => {
    const { diagram, id } = tree();
    const change = describeChange(deleteNode(diagram, id("A1")), diagram);
    expect(change).toMatchObject({ canvasId: id("A"), boxes: [id("A1")] });
  });

  it("points at the canvas holding a changed connection", () => {
    const { diagram: d, id } = tree();
    const diagram = connect(d, id("A1"), id("A2"));
    const edgeId = Object.keys(diagram.edges)[0]!;
    expect(describeChange(d, diagram)).toEqual({
      canvasId: id("A"),
      boxes: [],
      connections: [edgeId],
      removedBoxes: [],
    });
    expect(describeChange(diagram, setEdgeLabel(diagram, edgeId, "calls"))?.connections).toEqual([edgeId]);
  });
});
