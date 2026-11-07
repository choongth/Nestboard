import { describe, expect, it } from "vitest";
import { extractFragment, FRAGMENT_KIND, fragmentFromText, fragmentToText, insertFragment } from "./fragment";
import { placeExternals, setEdgeType, updateNode } from "./operations";
import { getChildren, ModelError } from "./queries";
import { parse, serialize } from "./serialize";
import { buildTree, connect, deepFreeze } from "./testUtils";
import type { Diagram } from "./types";

// A and B hold boxes; C is outside the copy in most tests.
const tree = () => {
  const built = buildTree({ A: { A1: {}, A2: { A2a: {} } }, B: { B1: {} }, C: {} });
  let d = built.diagram;
  d = connect(d, built.id("A1"), built.id("A2")); // inside A
  d = connect(d, built.id("A2a"), built.id("B1")); // between A and B, across levels
  d = connect(d, built.id("A"), built.id("B"), "calls"); // between A and B
  d = connect(d, built.id("A1"), built.id("C")); // leaves the copy
  deepFreeze(d);
  return { diagram: d, id: built.id };
};

const titles = (d: Diagram) =>
  Object.values(d.nodes)
    .filter((n) => n.parentId !== null)
    .map((n) => n.title)
    .sort();
const ends = (d: Diagram) =>
  Object.values(d.edges)
    .map((e) => `${d.nodes[e.from]!.title}→${d.nodes[e.to]!.title}`)
    .sort();

describe("extractFragment", () => {
  it("keeps the boxes, everything nested in them, and connections among them only", () => {
    const { diagram, id } = tree();
    const fragment = extractFragment(diagram, [id("A"), id("B")]);
    expect(titles(fragment)).toEqual(["A", "A1", "A2", "A2a", "B", "B1"]);
    expect(ends(fragment)).toEqual(["A1→A2", "A2a→B1", "A→B"]);
  });

  it("stores connections between copied boxes on its own root, and others where they were", () => {
    const { diagram, id } = tree();
    const fragment = extractFragment(diagram, [id("A"), id("B")]);
    const parentOf = (from: string) => Object.values(fragment.edges).find((e) => e.from === id(from))!.parentId;
    expect(parentOf("A")).toBe(fragment.rootId);
    expect(parentOf("A2a")).toBe(fragment.rootId);
    expect(parentOf("A1")).toBe(id("A"));
  });

  it("refuses boxes from different canvases, and nothing at all", () => {
    const { diagram, id } = tree();
    expect(() => extractFragment(diagram, [id("A"), id("A1")])).toThrow(ModelError);
    expect(() => extractFragment(diagram, [])).toThrow(ModelError);
  });
});

describe("insertFragment", () => {
  it("adds a copy with fresh ids, shifting only the top-level boxes", () => {
    const { diagram, id } = tree();
    const fragment = extractFragment(diagram, [id("A"), id("B")]);
    const { diagram: next, ids } = insertFragment(diagram, id("C"), fragment, { x: 10, y: 20 });

    const pasted = getChildren(next, id("C"));
    expect(pasted.map((n) => n.title)).toEqual(["A", "B"]);
    expect(ids).toEqual(pasted.map((n) => n.id));
    expect(ids).not.toContain(id("A"));
    expect(pasted[0]!.position).toEqual({ x: diagram.nodes[id("A")]!.position.x + 10, y: 20 });
    const a1 = Object.values(next.nodes).find((n) => n.title === "A1" && n.parentId === ids[0])!;
    expect(a1.position).toEqual(diagram.nodes[id("A1")]!.position);

    expect(titles(next)).toHaveLength(13);
    expect(Object.keys(next.edges)).toHaveLength(4 + 3);
  });

  it("pasted boxes start without the spots of external boxes inside them", () => {
    const { diagram: d, id } = tree();
    const diagram = placeExternals(d, id("A"), { [id("C")]: { x: 900, y: 0 } });
    const fragment = extractFragment(diagram, [id("A")]);
    const { diagram: next, ids } = insertFragment(diagram, id("C"), fragment, { x: 0, y: 0 });
    expect(next.nodes[ids[0]!]!.externals).toBeUndefined();
    expect(next.nodes[id("A")]!.externals).toEqual({ [id("C")]: { x: 900, y: 0 } });
  });

  it("stores each pasted connection on the deepest box containing both ends", () => {
    const { diagram, id } = tree();
    const fragment = extractFragment(diagram, [id("A"), id("B")]);
    const { diagram: next, ids } = insertFragment(diagram, id("C"), fragment, { x: 0, y: 0 });
    const original = new Set(Object.keys(diagram.edges));
    const pasted = Object.values(next.edges).filter((e) => !original.has(e.id));
    // Reading the file back checks where every connection is stored.
    expect(parse(serialize(next)).ok).toBe(true);
    expect(pasted.map((e) => e.parentId).sort()).toEqual([id("C"), id("C"), ids[0]].sort());
  });

  it("keeps types, labels and unknown type ids", () => {
    const { diagram: d, id } = tree();
    let diagram = updateNode(d, id("A"), { typeId: "from-the-future", technology: "postgres" });
    const edge = Object.values(diagram.edges).find((e) => e.label === "calls")!;
    diagram = setEdgeType(diagram, edge.id, "request");
    const { diagram: next, ids } = insertFragment(diagram, diagram.rootId, extractFragment(diagram, [id("A"), id("B")]), {
      x: 0,
      y: 0,
    });
    expect(next.nodes[ids[0]!]).toMatchObject({ typeId: "from-the-future", technology: "postgres" });
    expect(Object.values(next.edges).filter((e) => e.typeId === "request" && e.label === "calls")).toHaveLength(2);
  });

  it("can paste a box into a copy of itself", () => {
    const { diagram, id } = tree();
    const { diagram: next } = insertFragment(diagram, id("A2a"), extractFragment(diagram, [id("A")]), { x: 0, y: 0 });
    expect(getChildren(next, id("A2a")).map((n) => n.title)).toEqual(["A"]);
  });
});

describe("clipboard text", () => {
  it("round-trips a fragment", () => {
    const { diagram, id } = tree();
    const fragment = extractFragment(diagram, [id("A"), id("B")]);
    const back = fragmentFromText(fragmentToText(fragment))!;
    expect(titles(back)).toEqual(titles(fragment));
    expect(ends(back)).toEqual(ends(fragment));
  });

  it("ignores anything that is not Nestboard boxes", () => {
    const { diagram } = tree();
    expect(fragmentFromText("hello")).toBeNull();
    expect(fragmentFromText('{"some":"json"}')).toBeNull();
    // A whole diagram file is not a fragment.
    expect(fragmentFromText(serialize(diagram))).toBeNull();
    // Marked, but damaged or from a newer version.
    expect(fragmentFromText(JSON.stringify({ kind: FRAGMENT_KIND, schemaVersion: 4 }))).toBeNull();
    const future = JSON.parse(fragmentToText(extractFragment(diagram, [Object.values(diagram.nodes)[1]!.id])));
    expect(fragmentFromText(JSON.stringify({ ...future, schemaVersion: 999 }))).toBeNull();
    // Marked, but empty.
    expect(fragmentFromText(JSON.stringify({ ...future, root: { ...future.root, children: [], edges: [] } }))).toBeNull();
  });
});
