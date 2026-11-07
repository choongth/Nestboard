import { describe, expect, it } from "vitest";
import { connectionsOn } from "./lift";
import { addEdge } from "./operations";
import { buildTree } from "./testUtils";
import type { Diagram, NodeId } from "./types";

// Root ─┬─ Shop ── Cart ── Item
//       ├─ Payments ─┬─ Ledger
//       │            └─ Fraud
//       └─ Users
function shop() {
  const built = buildTree({ Shop: { Cart: { Item: {} } }, Payments: { Ledger: {}, Fraud: {} }, Users: {} });
  let diagram = built.diagram;
  const edges: Record<string, string> = {};
  const connect = (name: string, from: string, to: string) => {
    const result = addEdge(diagram, built.id(from), built.id(to));
    diagram = result.diagram;
    edges[name] = result.id;
  };
  return { ...built, connect, get diagram() { return diagram; }, edge: (name: string) => edges[name]! };
}

/** Lines on a canvas as readable [from, to, lifted] triples. */
function linesAt(diagram: Diagram, canvas: NodeId, title: (id: NodeId) => string) {
  return connectionsOn(diagram, canvas).lines.map((l) => [title(l.from), title(l.to), l.lifted]);
}

describe("connectionsOn", () => {
  it("draws a connection between siblings as it is", () => {
    const s = shop();
    s.connect("direct", "Shop", "Payments");
    const t = (id: NodeId) => s.diagram.nodes[id]!.title;
    expect(linesAt(s.diagram, s.diagram.rootId, t)).toEqual([["Shop", "Payments", false]]);
  });

  it("lifts a connection between levels to the boxes containing its ends, keeping its direction", () => {
    const s = shop();
    s.connect("across", "Cart", "Ledger");
    s.connect("deep", "Fraud", "Item"); // three levels down on one side
    const t = (id: NodeId) => s.diagram.nodes[id]!.title;
    expect(linesAt(s.diagram, s.diagram.rootId, t)).toEqual([
      ["Shop", "Payments", true],
      ["Payments", "Shop", true],
    ]);
    const [line] = connectionsOn(s.diagram, s.diagram.rootId).lines;
    expect(line!.edgeId).toBe(s.edge("across"));
  });

  it("lifts only the end that is nested deeper", () => {
    const s = shop();
    s.connect("half", "Ledger", "Shop");
    const t = (id: NodeId) => s.diagram.nodes[id]!.title;
    expect(linesAt(s.diagram, s.diagram.rootId, t)).toEqual([["Payments", "Shop", true]]);
  });

  it("hides a connection internal to one box, and shows it inside that box", () => {
    const s = shop();
    s.connect("inside", "Ledger", "Fraud");
    const t = (id: NodeId) => s.diagram.nodes[id]!.title;
    expect(connectionsOn(s.diagram, s.diagram.rootId)).toEqual({ lines: [], external: [] });
    expect(linesAt(s.diagram, s.id("Payments"), t)).toEqual([["Ledger", "Fraud", false]]);
  });

  it("reports connections leaving the canvas as external, going to their exact far end", () => {
    const s = shop();
    s.connect("across", "Cart", "Ledger");
    // Inside Shop, the line is drawn to Ledger itself (shown as an external box).
    expect(connectionsOn(s.diagram, s.id("Shop"))).toEqual({
      lines: [],
      external: [
        {
          edgeId: s.edge("across"),
          inside: s.id("Cart"),
          outside: s.id("Ledger"),
          direction: "out",
          lifted: false,
          parallel: { index: 0, count: 1 },
        },
      ],
    });
    expect(connectionsOn(s.diagram, s.id("Payments")).external).toEqual([
      expect.objectContaining({ inside: s.id("Ledger"), outside: s.id("Cart"), direction: "in" }),
    ]);
  });

  it("lifts only the inside end of an external connection", () => {
    const s = shop();
    s.connect("deep", "Item", "Fraud");
    expect(connectionsOn(s.diagram, s.id("Shop")).external).toEqual([
      expect.objectContaining({ inside: s.id("Cart"), outside: s.id("Fraud"), lifted: true }),
    ]);
  });

  it("keeps the far end exact from several levels down", () => {
    const s = shop();
    s.connect("far", "Item", "Ledger");
    expect(connectionsOn(s.diagram, s.id("Cart")).external).toEqual([
      expect.objectContaining({ inside: s.id("Item"), outside: s.id("Ledger"), lifted: false }),
    ]);
  });

  it("numbers external lines that share a pair of boxes", () => {
    const s = shop();
    s.connect("a", "Cart", "Ledger");
    s.connect("b", "Ledger", "Cart");
    s.connect("c", "Cart", "Fraud");
    expect(connectionsOn(s.diagram, s.id("Shop")).external.map((e) => [e.edgeId, e.parallel])).toEqual([
      [s.edge("a"), { index: 0, count: 2 }],
      [s.edge("b"), { index: 1, count: 2 }],
      [s.edge("c"), { index: 0, count: 1 }],
    ]);
  });

  it("ignores connections that do not touch the canvas", () => {
    const s = shop();
    s.connect("across", "Cart", "Ledger");
    s.connect("inside", "Ledger", "Fraud");
    expect(connectionsOn(s.diagram, s.id("Users"))).toEqual({ lines: [], external: [] });
  });

  it("leaves a box's own connections to the canvas it sits on", () => {
    const s = shop();
    s.connect("own", "Shop", "Users");
    // Inside Shop, Shop itself is not a box on the canvas, so nothing shows.
    expect(connectionsOn(s.diagram, s.id("Shop"))).toEqual({ lines: [], external: [] });
  });

  it("keeps every connection between the same two boxes, numbered for drawing side by side", () => {
    const s = shop();
    s.connect("direct", "Shop", "Payments");
    s.connect("across", "Cart", "Ledger");
    s.connect("back", "Fraud", "Item");
    s.connect("other", "Shop", "Users");
    const lines = connectionsOn(s.diagram, s.diagram.rootId).lines;
    expect(lines.map((l) => [l.edgeId, l.parallel])).toEqual([
      [s.edge("direct"), { index: 0, count: 3 }],
      [s.edge("across"), { index: 1, count: 3 }],
      [s.edge("back"), { index: 2, count: 3 }], // opposite direction, same pair
      [s.edge("other"), { index: 0, count: 1 }],
    ]);
  });
});
