import { describe, expect, it } from "vitest";
import { setEdgeType, updateNode } from "./operations";
import { fromFile, parse, serialize, toFile } from "./serialize";
import { buildTree, connect } from "./testUtils";
import { SCHEMA_VERSION, type DiagramFile, type FileNode } from "./types";

function sample() {
  const { diagram: d, id } = buildTree({ A: { A1: {}, A2: {} }, B: {} });
  let diagram = updateNode(d, id("A"), { technology: "node", description: "Service A" });
  diagram = connect(diagram, id("A1"), id("A2"), "calls");
  diagram = connect(diagram, id("A"), id("B"));
  return diagram;
}

const box = (id: string, title: string): FileNode => ({
  id,
  title,
  position: { x: 0, y: 0 },
  children: [],
  edges: [],
});

function validFile(): DiagramFile {
  const root = box("r", "Root");
  root.children = [box("a", "A"), box("b", "B")];
  root.edges = [{ id: "e", from: "a", to: "b", label: "uses" }];
  return { schemaVersion: SCHEMA_VERSION, root };
}

describe("toFile", () => {
  it("nests children and stores each edge on its canvas", () => {
    const file = toFile(sample());
    expect(file.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.root.children.map((c) => c.title)).toEqual(["A", "B"]);

    const a = file.root.children[0]!;
    expect(a).toMatchObject({ technology: "node", description: "Service A" });
    expect(a.children.map((c) => c.title)).toEqual(["A1", "A2"]);
    expect(a.edges).toEqual([expect.objectContaining({ label: "calls" })]);
    expect(file.root.edges).toHaveLength(1);
    expect(file.root.edges[0]).not.toHaveProperty("label");
  });

  it("does not write parentId, since the nesting implies it", () => {
    expect(serialize(sample())).not.toContain("parentId");
  });
});

describe("round trip", () => {
  it("parse(serialize(d)) reproduces the diagram exactly, including order", () => {
    const diagram = sample();
    const result = parse(serialize(diagram));
    expect(result).toEqual({ ok: true, diagram });
    if (result.ok) expect(serialize(result.diagram)).toBe(serialize(diagram));
  });

  it("keeps where external boxes were put inside a box, forgetting boxes not in the file", () => {
    const file = validFile();
    file.root.children[0]!.externals = { b: { x: 600, y: -40 }, gone: { x: 1, y: 1 } };
    const result = fromFile(file);
    expect(result.ok && result.diagram.nodes.a!.externals).toEqual({ b: { x: 600, y: -40 } });
    if (result.ok) expect(toFile(result.diagram).root.children[0]!.externals).toEqual({ b: { x: 600, y: -40 } });

    file.root.children[0]!.externals = { gone: { x: 1, y: 1 } };
    const empty = fromFile(file);
    expect(empty.ok && "externals" in empty.diagram.nodes.a!).toBe(false);
  });

  it("refuses malformed places for external boxes", () => {
    const file = validFile();
    (file.root.children[0] as unknown as Record<string, unknown>).externals = { b: { x: "1", y: 0 } };
    expect(fromFile(file)).toEqual({ ok: false, error: 'Box "a" has invalid places for external boxes.' });
  });
});

describe("parse errors", () => {
  const errorOf = (data: unknown) => {
    const result = fromFile(data);
    return result.ok ? null : result.error;
  };
  const fileWith = (patch: (file: DiagramFile) => void) => {
    const file = validFile();
    patch(file);
    return file;
  };

  it("accepts a valid file", () => {
    expect(errorOf(validFile())).toBeNull();
  });

  it("reports invalid JSON", () => {
    expect(parse("{ nope")).toEqual({ ok: false, error: "The file is not valid JSON." });
  });

  it("rejects things that are not Nestboard files", () => {
    expect(errorOf(null)).toMatch(/not a Nestboard file/);
    expect(errorOf([])).toMatch(/not a Nestboard file/);
    expect(errorOf({ hello: "world" })).toMatch(/not a Nestboard file/);
  });

  it("explains files from a newer or unknown version", () => {
    expect(errorOf({ ...validFile(), schemaVersion: SCHEMA_VERSION + 1 })).toMatch(/newer version/);
    expect(errorOf({ ...validFile(), schemaVersion: 0 })).toMatch(/Unsupported/);
  });

  it("rejects malformed boxes", () => {
    expect(errorOf(fileWith((f) => Object.assign(f.root.children[0]!, { id: 7 })))).toMatch(/no id/);
    expect(errorOf(fileWith((f) => (f.root.children[0]!.position = { x: NaN, y: 0 })))).toMatch(
      /invalid position/,
    );
    expect(errorOf(fileWith((f) => Object.assign(f.root.children[0]!, { children: undefined })))).toMatch(
      /children list/,
    );
  });

  it("rejects duplicate ids", () => {
    expect(errorOf(fileWith((f) => (f.root.children[1]!.id = "a")))).toMatch(/Duplicate box id "a"/);
    expect(errorOf(fileWith((f) => f.root.edges.push({ id: "e", from: "b", to: "a" })))).toMatch(
      /Duplicate connection id/,
    );
  });

  it("rejects connections to missing boxes, to themselves, or to their own container", () => {
    expect(errorOf(fileWith((f) => (f.root.edges[0]!.to = "nope")))).toMatch(/two boxes in this file/);
    expect(errorOf(fileWith((f) => (f.root.edges[0]!.to = "a")))).toMatch(/itself/);
    expect(errorOf(fileWith((f) => (f.root.edges[0]!.to = "r")))).toMatch(/nested inside it/);
  });

  it("accepts a connection between levels stored on the deepest box containing both ends", () => {
    const file = fileWith((f) => {
      f.root.children[0]!.children = [box("a1", "A1")];
      f.root.edges.push({ id: "deep", from: "a1", to: "b" });
    });
    expect(errorOf(file)).toBeNull();
  });

  it("rejects a connection stored in the wrong box", () => {
    const file = fileWith((f) => {
      f.root.children[0]!.children = [box("a1", "A1"), box("a2", "A2")];
      f.root.edges.push({ id: "misplaced", from: "a1", to: "a2" }); // belongs inside A
    });
    expect(errorOf(file)).toMatch(/"misplaced" is stored in the wrong box/);
  });

  it("handles very deep nesting without overflowing the stack", () => {
    const file = validFile();
    let parent = file.root.children[0]!;
    for (let i = 0; i < 20_000; i++) {
      const child = box(`n${i}`, "x");
      parent.children.push(child);
      parent = child;
    }
    expect(errorOf(file)).toBeNull();
  });
});

describe("connection types (format 4)", () => {
  function typed() {
    const { diagram: d, id } = buildTree({ Api: {}, Db: {}, Replica: {} });
    let diagram = connect(d, id("Api"), id("Db"), "orders");
    diagram = connect(diagram, id("Db"), id("Replica"));
    diagram = connect(diagram, id("Api"), id("Replica"));
    const [rw, rep, plain] = Object.keys(diagram.edges) as [string, string, string];
    diagram = setEdgeType(diagram, rw, "read-write");
    diagram = setEdgeType(diagram, rep, "type-from-the-future");
    return { diagram, rw, rep, plain };
  }

  it("writes typeId only for connections that have one", () => {
    const { diagram } = typed();
    const [rw, rep, plain] = toFile(diagram).root.edges;
    expect(rw).toEqual(expect.objectContaining({ typeId: "read-write", label: "orders" }));
    expect(rep!.typeId).toBe("type-from-the-future");
    expect(plain).not.toHaveProperty("typeId"); // generic is stored as no type
  });

  it("round-trips types, keeping unknown ids exactly as written", () => {
    const { diagram } = typed();
    expect(parse(serialize(diagram))).toEqual({ ok: true, diagram });
  });

  it("opens format 3 files, whose connections have no types", () => {
    expect(fromFile({ ...validFile(), schemaVersion: 3 }).ok).toBe(true);
  });

  it("rejects a connection typeId that is not a non-empty string", () => {
    const withType = (typeId: unknown) => {
      const file = validFile();
      Object.assign(file.root.edges[0]!, { typeId });
      return fromFile(file);
    };
    expect(withType(7)).toEqual({ ok: false, error: 'Connection "e" has an invalid type.' });
    expect(withType("")).toEqual({ ok: false, error: 'Connection "e" has an invalid type.' });
    expect(withType("request").ok).toBe(true);
  });
});

describe("connections between levels (format 3)", () => {
  it("round-trips, each connection saved inside the deepest box containing both ends", () => {
    const { diagram: d, id } = buildTree({ Shop: { Cart: {} }, Payments: { Ledger: {}, Fraud: {} } });
    let diagram = connect(d, id("Cart"), id("Ledger"), "pays via");
    diagram = connect(diagram, id("Ledger"), id("Fraud"));
    const file = toFile(diagram);
    expect(file.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.root.edges).toEqual([expect.objectContaining({ label: "pays via" })]);
    expect(file.root.children[1]!.edges).toHaveLength(1);
    expect(parse(serialize(diagram))).toEqual({ ok: true, diagram });
  });

  it("still opens format 2 files", () => {
    expect(fromFile({ ...validFile(), schemaVersion: 2 }).ok).toBe(true);
  });
});

describe("box types (format 2)", () => {
  function typed() {
    const { diagram: d, id } = buildTree({ LB: {}, Cache: {}, Plain: {} });
    let diagram = updateNode(d, id("LB"), { typeId: "load-balancer", technology: "Nginx" });
    diagram = updateNode(diagram, id("Cache"), { typeId: "some-type-from-the-future" });
    return { diagram, id };
  }

  it("writes typeId only for boxes that have one", () => {
    const file = toFile(typed().diagram);
    const [lb, cache, plain] = file.root.children;
    expect(lb).toMatchObject({ typeId: "load-balancer", technology: "Nginx" });
    expect(cache!.typeId).toBe("some-type-from-the-future");
    expect(plain).not.toHaveProperty("typeId"); // generic is stored as no type
    expect(file.root).not.toHaveProperty("typeId");
  });

  it("round-trips types, keeping unknown ids exactly as written", () => {
    const { diagram, id } = typed();
    const result = parse(serialize(diagram));
    expect(result).toEqual({ ok: true, diagram });
    if (result.ok) expect(result.diagram.nodes[id("Cache")]!.typeId).toBe("some-type-from-the-future");
  });

  it("opens version 1 files (no types) and saves them as the current version", () => {
    const v1 = { ...validFile(), schemaVersion: 1 };
    const result = fromFile(v1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.values(result.diagram.nodes).every((n) => n.typeId === undefined)).toBe(true);
    expect(toFile(result.diagram).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("rejects a typeId that is not a non-empty string", () => {
    const withType = (typeId: unknown) => {
      const file = validFile();
      Object.assign(file.root.children[0]!, { typeId });
      return fromFile(file);
    };
    expect(withType(42)).toEqual({ ok: false, error: 'Box "a" has an invalid type.' });
    expect(withType("")).toEqual({ ok: false, error: 'Box "a" has an invalid type.' });
    expect(withType("cache").ok).toBe(true);
  });

  it("rejects version numbers that are not whole", () => {
    expect(fromFile({ ...validFile(), schemaVersion: 1.5 })).toMatchObject({ ok: false, error: expect.stringMatching(/Unsupported/) });
  });
});
