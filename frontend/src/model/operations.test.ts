import { describe, expect, it } from "vitest";
import {
  addEdge,
  addNode,
  DEFAULT_BOX_TITLE,
  deleteEdge,
  deleteNode,
  deleteNodes,
  moveNode,
  moveNodes,
  setEdgeLabel,
  setEdgeType,
  setNodeType,
  updateNode,
} from "./operations";
import { getChildren, getEdgesOn, ModelError } from "./queries";
import { buildTree, connect, deepFreeze } from "./testUtils";

// Frozen so any accidental mutation of the input throws.
const tree = () => {
  const built = buildTree({ A: { A1: {}, A2: { A2a: {}, A2b: {} } }, B: {} });
  deepFreeze(built.diagram);
  return built;
};

describe("addNode", () => {
  it("adds a child at the given position with a default title", () => {
    const { diagram, id } = tree();
    const result = addNode(diagram, id("B"), { x: 10, y: 20 });
    expect(result.diagram.nodes[result.id]).toEqual({
      id: result.id,
      parentId: id("B"),
      title: DEFAULT_BOX_TITLE,
      position: { x: 10, y: 20 },
    });
    expect(getChildren(result.diagram, id("B"))).toHaveLength(1);
  });

  it("accepts initial details", () => {
    const { diagram } = tree();
    const result = addNode(diagram, diagram.rootId, { x: 0, y: 0 }, { title: "API", technology: "node" });
    expect(result.diagram.nodes[result.id]).toMatchObject({ title: "API", technology: "node" });
  });

  it("rejects an unknown parent", () => {
    const { diagram } = tree();
    expect(() => addNode(diagram, "missing", { x: 0, y: 0 })).toThrow(ModelError);
  });
});

describe("updateNode", () => {
  it("sets fields and leaves others alone", () => {
    const { diagram, id } = tree();
    const next = updateNode(diagram, id("A"), { title: "Payments", description: "Handles money" });
    expect(next.nodes[id("A")]).toMatchObject({ title: "Payments", description: "Handles money" });
    expect(next.nodes[id("A")]!.position).toEqual(diagram.nodes[id("A")]!.position);
  });

  it("clears optional fields given undefined, but never the title", () => {
    const { diagram, id } = tree();
    const withTech = updateNode(diagram, id("A"), { technology: "postgres" });
    const cleared = updateNode(withTech, id("A"), { technology: undefined, title: undefined });
    expect(cleared.nodes[id("A")]).not.toHaveProperty("technology");
    expect(cleared.nodes[id("A")]!.title).toBe("A");
  });
});

describe("box types", () => {
  it("changing the type clears the technology, which belonged to the old type", () => {
    const { diagram, id } = tree();
    const chosen = updateNode(diagram, id("A"), { typeId: "vector-db", technology: "Pinecone" });

    const retyped = setNodeType(chosen, id("A"), "ai-agent");
    expect(retyped.nodes[id("A")]!.typeId).toBe("ai-agent");
    expect(retyped.nodes[id("A")]).not.toHaveProperty("technology");

    // Even when the new type lists it too, and when going back to generic (free text).
    const both = updateNode(diagram, id("A"), { typeId: "cache", technology: "Redis" });
    expect(setNodeType(both, id("A"), "vector-db").nodes[id("A")]).not.toHaveProperty("technology");
    const generic = setNodeType(both, id("A"), undefined);
    expect(generic.nodes[id("A")]).not.toHaveProperty("typeId");
    expect(generic.nodes[id("A")]).not.toHaveProperty("technology");
  });

  it("choosing the type a box already has changes nothing", () => {
    const { diagram, id } = tree();
    const chosen = updateNode(diagram, id("A"), { typeId: "vector-db", technology: "Pinecone" });
    expect(setNodeType(chosen, id("A"), "vector-db")).toBe(chosen);
  });

  it("new boxes have no type unless one is given", () => {
    const { diagram } = tree();
    const plain = addNode(diagram, diagram.rootId, { x: 0, y: 0 });
    expect(plain.diagram.nodes[plain.id]).not.toHaveProperty("typeId");
    const typed = addNode(diagram, diagram.rootId, { x: 0, y: 0 }, { typeId: "cache" });
    expect(typed.diagram.nodes[typed.id]!.typeId).toBe("cache");
  });
});

describe("moveNode", () => {
  it("changes only the position", () => {
    const { diagram, id } = tree();
    const next = moveNode(diagram, id("A1"), { x: -50, y: 75 });
    expect(next.nodes[id("A1")]).toEqual({ ...diagram.nodes[id("A1")], position: { x: -50, y: 75 } });
  });

  it("refuses to move the root", () => {
    const { diagram } = tree();
    expect(() => moveNode(diagram, diagram.rootId, { x: 1, y: 1 })).toThrow(ModelError);
  });
});

describe("deleteNode", () => {
  it("removes the node and all its descendants", () => {
    const { diagram, id } = tree();
    const next = deleteNode(diagram, id("A"));
    expect(Object.values(next.nodes).map((n) => n.title).sort()).toEqual(["B", "Root"]);
  });

  it("removes edges reaching into the subtree from other levels", () => {
    const { diagram: d, id } = tree();
    const diagram = connect(connect(d, id("A2a"), id("B")), id("A1"), id("B"));
    const next = deleteNode(diagram, id("A2"));
    expect(Object.values(next.edges).map((e) => [e.from, e.to])).toEqual([[id("A1"), id("B")]]);
  });

  it("removes edges touching the subtree and edges inside it, keeping the rest", () => {
    const { diagram: d, id } = tree();
    let diagram = connect(d, id("A"), id("B")); // touches A
    diagram = connect(diagram, id("A2a"), id("A2b")); // inside A
    diagram = connect(diagram, id("A1"), id("A2")); // inside A
    const { diagram: withC, id: c } = addNode(diagram, diagram.rootId, { x: 0, y: 0 }, { title: "C" });
    diagram = connect(withC, id("B"), c); // unrelated

    const next = deleteNode(diagram, id("A"));
    expect(Object.values(next.edges).map((e) => [e.from, e.to])).toEqual([[id("B"), c]]);
  });

  it("refuses to delete the root", () => {
    const { diagram } = tree();
    expect(() => deleteNode(diagram, diagram.rootId)).toThrow(ModelError);
  });
});

describe("moveNodes", () => {
  it("moves every given node and leaves the rest untouched", () => {
    const { diagram, id } = tree();
    const next = moveNodes(diagram, { [id("A")]: { x: 5, y: 6 }, [id("B")]: { x: 7, y: 8 } });
    expect(next.nodes[id("A")]!.position).toEqual({ x: 5, y: 6 });
    expect(next.nodes[id("B")]!.position).toEqual({ x: 7, y: 8 });
    expect(next.nodes[id("A1")]).toBe(diagram.nodes[id("A1")]);
  });

  it("refuses the root and unknown nodes", () => {
    const { diagram } = tree();
    expect(() => moveNodes(diagram, { [diagram.rootId]: { x: 0, y: 0 } })).toThrow(ModelError);
    expect(() => moveNodes(diagram, { missing: { x: 0, y: 0 } })).toThrow(ModelError);
  });
});

describe("deleteNodes", () => {
  it("removes several nodes with their descendants and every edge touching them", () => {
    const { diagram: d, id } = tree();
    let diagram = connect(d, id("A2a"), id("B"));
    const { diagram: withC, id: c } = addNode(diagram, diagram.rootId, { x: 0, y: 0 }, { title: "C" });
    diagram = connect(withC, id("A1"), c);

    const next = deleteNodes(diagram, [id("A2"), id("B")]);
    expect(Object.values(next.nodes).map((n) => n.title).sort()).toEqual(["A", "A1", "C", "Root"]);
    expect(Object.values(next.edges).map((e) => [e.from, e.to])).toEqual([[id("A1"), c]]);
  });

  it("accepts a node together with one nested inside it", () => {
    const { diagram, id } = tree();
    const next = deleteNodes(diagram, [id("A"), id("A2a")]);
    expect(Object.values(next.nodes).map((n) => n.title).sort()).toEqual(["B", "Root"]);
  });

  it("refuses the root", () => {
    const { diagram, id } = tree();
    expect(() => deleteNodes(diagram, [id("B"), diagram.rootId])).toThrow(ModelError);
  });
});

describe("addEdge", () => {
  it("stores the edge on the shared parent's canvas", () => {
    const { diagram, id } = tree();
    const result = addEdge(diagram, id("A1"), id("A2"), "calls");
    expect(result.diagram.edges[result.id]).toEqual({
      id: result.id,
      parentId: id("A"),
      from: id("A1"),
      to: id("A2"),
      label: "calls",
    });
  });

  it("allows several edges between the same two boxes", () => {
    const { diagram: d, id } = tree();
    const diagram = connect(connect(d, id("A1"), id("A2")), id("A1"), id("A2"));
    expect(getEdgesOn(diagram, id("A"))).toHaveLength(2);
  });

  it("connects boxes on different levels, storing the edge on their lowest common ancestor", () => {
    const { diagram, id } = tree();
    const deep = addEdge(diagram, id("A2a"), id("B"));
    expect(deep.diagram.edges[deep.id]).toMatchObject({ parentId: diagram.rootId, from: id("A2a"), to: id("B") });
    const inside = addEdge(diagram, id("A1"), id("A2b"));
    expect(inside.diagram.edges[inside.id]!.parentId).toBe(id("A"));
  });

  it("rejects a box connecting to itself, to a box nested inside it, or to its container", () => {
    const { diagram, id } = tree();
    expect(() => addEdge(diagram, id("A1"), id("A1"))).toThrow("itself");
    expect(() => addEdge(diagram, id("A"), id("A2a"))).toThrow("nested inside it");
    expect(() => addEdge(diagram, id("A2a"), id("A"))).toThrow("nested inside it");
    expect(() => addEdge(diagram, diagram.rootId, id("B"))).toThrow("nested inside it");
    expect(() => addEdge(diagram, id("A1"), "missing")).toThrow(ModelError);
  });
});

describe("setEdgeType", () => {
  it("sets a type, keeps the label, and clears back to generic", () => {
    const { diagram, id } = tree();
    const { diagram: d, id: e } = addEdge(diagram, id("A"), id("B"), "orders");
    const typed = setEdgeType(d, e, "request");
    expect(typed.edges[e]).toMatchObject({ typeId: "request", label: "orders" });
    expect(setEdgeType(typed, e, undefined).edges[e]).not.toHaveProperty("typeId");
    expect(() => setEdgeType(d, "missing", "request")).toThrow(ModelError);
  });
});

describe("setEdgeLabel / deleteEdge", () => {
  it("sets and clears a label", () => {
    const { diagram, id } = tree();
    const { diagram: d, id: e } = addEdge(diagram, id("A"), id("B"));
    const labelled = setEdgeLabel(d, e, "reads");
    expect(labelled.edges[e]!.label).toBe("reads");
    expect(setEdgeLabel(labelled, e, "").edges[e]).not.toHaveProperty("label");
  });

  it("deletes an edge", () => {
    const { diagram, id } = tree();
    const { diagram: d, id: e } = addEdge(diagram, id("A"), id("B"));
    expect(deleteEdge(d, e).edges).toEqual({});
    expect(() => deleteEdge(d, "missing")).toThrow(ModelError);
  });
});
