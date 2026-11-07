import { describe, expect, it } from "vitest";
import { addNode, deleteNodes, moveNode, placeExternals, setEdgeType, updateNode } from "./operations";
import { changesBetween, changesNothing, fromRecord, toBoxRecord, toEdgeRecord } from "./records";
import { buildTree, connect } from "./testUtils";
import type { Diagram } from "./types";

function sample() {
  const { diagram: d, id } = buildTree({ A: { A1: {}, A2: {} }, B: {} });
  let diagram = updateNode(d, id("A"), { typeId: "service", technology: "Go", description: "Service A" });
  diagram = connect(diagram, id("A1"), id("A2"), "calls");
  diagram = connect(diagram, id("A1"), id("B")); // across levels: stored on the root
  diagram = placeExternals(diagram, id("A"), { [id("B")]: { x: 900, y: 40 } });
  return { diagram: setEdgeType(diagram, Object.keys(diagram.edges)[1]!, "request"), id };
}

/** The diagram as the server would hand it back. */
const asRecord = (diagram: Diagram) => ({
  root_id: diagram.rootId,
  boxes: Object.values(diagram.nodes).map(toBoxRecord),
  edges: Object.values(diagram.edges).map(toEdgeRecord),
});

describe("records", () => {
  it("make the same diagram again, connections on the deepest box holding both ends", () => {
    const { diagram } = sample();
    expect(fromRecord(asRecord(diagram))).toEqual(diagram);
  });

  it("leave out fields a box or connection does not have", () => {
    const { diagram, id } = sample();
    const b = fromRecord(asRecord(diagram)).nodes[id("B")]!;
    expect(Object.keys(b)).toEqual(["id", "parentId", "title", "position"]);
    expect(toBoxRecord(b)).toMatchObject({ type_id: null, technology: null, description: null, externals: {} });
  });
});

describe("changesBetween", () => {
  it("sends only the fields that changed, so others' changes to the rest stay", () => {
    const { diagram, id } = sample();
    let after = updateNode(diagram, id("A2"), { title: "Renamed" });
    after = updateNode(after, id("A"), { technology: undefined });
    after = moveNode(after, id("B"), { x: 5, y: 6 });

    const changes = changesBetween(diagram, after);

    expect(changes.changed_boxes).toEqual([
      { id: id("A"), technology: null },
      { id: id("A2"), title: "Renamed" },
      { id: id("B"), position: { x: 5, y: 6 } },
    ]);
    expect([changes.added_boxes, changes.removed_boxes, changes.changed_edges]).toEqual([[], [], []]);
    expect(changesNothing(changesBetween(diagram, diagram))).toBe(true);
  });

  it("sends spots of external boxes one by one, null for one forgotten", () => {
    const { diagram, id } = sample();
    const after = placeExternals(diagram, id("A"), { [id("B")]: { x: 1, y: 2 } });
    const forgotten = deleteNodes(diagram, [id("B")]);

    expect(changesBetween(diagram, after).changed_boxes).toEqual([{ id: id("A"), externals: { [id("B")]: { x: 1, y: 2 } } }]);
    expect(changesBetween(diagram, forgotten).changed_boxes).toEqual([{ id: id("A"), externals: { [id("B")]: null } }]);
  });

  it("sends new boxes and connections whole, and what was deleted", () => {
    const { diagram, id } = sample();
    const edge = Object.keys(diagram.edges)[0]!;
    const added = addNode(diagram, id("B"), { x: 0, y: 0 });
    const relabelled = setEdgeType(diagram, edge, "event");
    const removed = deleteNodes(diagram, [id("A")]);

    expect(changesBetween(diagram, added.diagram).added_boxes).toEqual([toBoxRecord(added.diagram.nodes[added.id]!)]);
    expect(changesBetween(diagram, relabelled).changed_edges).toEqual([{ id: edge, type_id: "event" }]);
    const gone = changesBetween(diagram, removed);
    expect(gone.removed_boxes.sort()).toEqual([id("A"), id("A1"), id("A2")].sort());
    expect(gone.removed_edges).toHaveLength(2);
  });
});
