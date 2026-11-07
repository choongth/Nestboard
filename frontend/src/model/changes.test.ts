import { describe, expect, it } from "vitest";
import type { DiagramChanges } from "@/api/diagrams";
import { applyChanges, asChanges } from "./changes";
import { moveNode, updateNode } from "./operations";
import { changesBetween, toBoxRecord, toEdgeRecord } from "./records";
import { buildTree, connect, deepFreeze } from "./testUtils";

const NONE: DiagramChanges = {
  added_boxes: [],
  changed_boxes: [],
  removed_boxes: [],
  added_edges: [],
  changed_edges: [],
  removed_edges: [],
};

function shop() {
  const { diagram: d, id } = buildTree({ Shop: { Cart: {}, Payments: {} }, Web: {} });
  const diagram = deepFreeze(connect(d, id("Web"), id("Cart"), "orders"));
  return { diagram, id, edge: Object.keys(diagram.edges)[0]! };
}

describe("applyChanges", () => {
  it("makes what changesBetween found, whatever else is different", () => {
    const { diagram, id } = shop();
    const mine = updateNode(diagram, id("Cart"), { title: "Basket", technology: "Go" });
    // Someone else moved Cart meanwhile: both changes stay.
    const theirs = moveNode(diagram, id("Cart"), { x: 50, y: 60 });

    const both = applyChanges(theirs, changesBetween(diagram, mine));

    expect(both.nodes[id("Cart")]).toMatchObject({ title: "Basket", technology: "Go", position: { x: 50, y: 60 } });
  });

  it("keeps what nothing changed, and returns the same diagram for no change", () => {
    const { diagram, id } = shop();
    const after = applyChanges(diagram, { ...NONE, changed_boxes: [{ id: id("Web"), title: "Shop front" }] });

    expect(after.nodes[id("Cart")]).toBe(diagram.nodes[id("Cart")]);
    expect(after.edges).toEqual(diagram.edges);
    expect(applyChanges(diagram, NONE)).toBe(diagram);
    expect(applyChanges(diagram, { ...NONE, changed_boxes: [{ id: id("Web"), title: "Web" }] })).toBe(diagram);
  });

  it("skips changes to what is not there, and whatever is added to it", () => {
    const { diagram, id, edge } = shop();
    const changes: DiagramChanges = {
      ...NONE,
      added_boxes: [{ ...toBoxRecord(diagram.nodes[id("Web")]!), id: "inner", parent_id: "gone" }],
      changed_boxes: [{ id: "gone", title: "?" }],
      added_edges: [{ id: "e2", from: id("Web"), to: "gone", type_id: null, label: null }],
      changed_edges: [{ id: "e9", label: "?" }, { id: edge, to: "gone" }],
      removed_boxes: ["gone"],
      removed_edges: ["e9"],
    };

    expect(applyChanges(diagram, changes)).toBe(diagram);
  });

  it("adds boxes inside new boxes in any order, and connections between them", () => {
    const { diagram, id } = shop();
    const box = (boxId: string, parent: string) => ({ ...toBoxRecord(diagram.nodes[id("Web")]!), id: boxId, parent_id: parent });

    const after = applyChanges(diagram, {
      ...NONE,
      added_boxes: [box("inner", "outer"), box("outer", id("Payments"))],
      added_edges: [{ id: "e2", from: "inner", to: id("Cart"), type_id: "request", label: null }],
    });

    expect(after.nodes.inner!.parentId).toBe("outer");
    expect(after.edges.e2).toMatchObject({ parentId: id("Shop"), typeId: "request" });
  });

  it("replaces a box added again, spots and all", () => {
    const { diagram, id } = shop();
    const placed = { ...toBoxRecord(diagram.nodes[id("Shop")]!), externals: { [id("Web")]: { x: 1, y: 2 } } };
    const withSpot = applyChanges(diagram, { ...NONE, added_boxes: [placed] });
    const without = applyChanges(withSpot, { ...NONE, added_boxes: [toBoxRecord(diagram.nodes[id("Shop")]!)] });

    expect(withSpot.nodes[id("Shop")]!.externals).toEqual({ [id("Web")]: { x: 1, y: 2 } });
    expect(without.nodes[id("Shop")]!.externals).toBeUndefined();
  });

  it("changes spots one by one, and clears fields set to null", () => {
    const { diagram, id } = shop();
    const spots = applyChanges(diagram, {
      ...NONE,
      changed_boxes: [{ id: id("Shop"), externals: { [id("Web")]: { x: 1, y: 2 }, a: { x: 3, y: 4 } } }],
    });
    const one = applyChanges(spots, { ...NONE, changed_boxes: [{ id: id("Shop"), externals: { a: null } }] });
    const typed = updateNode(diagram, id("Web"), { typeId: "web-app" });
    const cleared = applyChanges(typed, { ...NONE, changed_boxes: [{ id: id("Web"), type_id: null }] });

    expect(Object.keys(one.nodes[id("Shop")]!.externals!)).toEqual([id("Web")]);
    expect(cleared.nodes[id("Web")]).not.toHaveProperty("typeId");
  });

  it("deletes boxes with what is inside them and their connections", () => {
    const { diagram, id, edge } = shop();
    const after = applyChanges(diagram, { ...NONE, removed_boxes: [id("Shop")] });

    expect(Object.keys(after.nodes)).toEqual([diagram.rootId, id("Web")]);
    expect(after.edges[edge]).toBeUndefined();
  });

  it("moves a connection to the canvas its new ends share", () => {
    const { diagram, id, edge } = shop();
    const after = applyChanges(diagram, { ...NONE, changed_edges: [{ id: edge, from: id("Payments") }] });

    expect(after.edges[edge]).toMatchObject({ from: id("Payments"), parentId: id("Shop"), label: "orders" });
  });

  it("gives diagrams that shared a box the same changed box", () => {
    const { diagram, id } = shop();
    const later = updateNode(diagram, id("Web"), { title: "Shop front" });
    const theirs = { ...NONE, changed_boxes: [{ id: id("Cart"), title: "Basket" }] };
    const patched = new WeakMap();

    const a = applyChanges(diagram, theirs, patched);
    const b = applyChanges(later, theirs, patched);

    expect(b.nodes[id("Cart")]).toBe(a.nodes[id("Cart")]);
  });

  it("makes a save as the server tells it: boxes and connections whole", () => {
    const { diagram, id, edge } = shop();
    const told = asChanges({
      boxes: [{ ...toBoxRecord(diagram.nodes[id("Cart")]!), title: "Basket" }],
      edges: [{ ...toEdgeRecord(diagram.edges[edge]!), label: null }],
      removed_boxes: [id("Payments")],
      removed_edges: [],
    });

    const after = applyChanges(diagram, told);

    expect(after.nodes[id("Cart")]!.title).toBe("Basket");
    expect(after.edges[edge]).not.toHaveProperty("label");
    expect(after.nodes[id("Payments")]).toBeUndefined();
  });
});
