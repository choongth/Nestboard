import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyDiagram } from "@/model/diagram";
import { useDiagramStore } from "./diagramStore";

const store = () => useDiagramStore.getState();
const history = () => useDiagramStore.temporal.getState();
const rootId = () => store().diagram.rootId;

beforeEach(() => {
  store().replaceDiagram(createEmptyDiagram());
  history().clear();
});

describe("diagram store history", () => {
  it("records each box action as one undo step", () => {
    const id = store().addBox(rootId(), { x: 0, y: 0 });
    store().moveBox(id, { x: 50, y: 50 });
    expect(history().pastStates).toHaveLength(2);

    history().undo();
    expect(store().diagram.nodes[id]!.position).toEqual({ x: 0, y: 0 });
    history().undo();
    expect(store().diagram.nodes[id]).toBeUndefined();
  });

  it("ignores a move to the same position", () => {
    const id = store().addBox(rootId(), { x: 0, y: 0 });
    store().moveBox(id, { x: 0, y: 0 });
    expect(history().pastStates).toHaveLength(1);
  });

  it("records a group move as one undo step, leaving boxes already in place out", () => {
    const a = store().addBox(rootId(), { x: 0, y: 0 });
    const b = store().addBox(rootId(), { x: 300, y: 0 });
    const before = store().diagram.nodes[b];
    store().moveBoxes({ [a]: { x: 20, y: 20 }, [b]: { x: 300, y: 0 } });
    expect(history().pastStates).toHaveLength(3);
    expect(store().diagram.nodes[b]).toBe(before);

    store().moveBoxes({ [a]: { x: 20, y: 20 } });
    expect(history().pastStates).toHaveLength(3);
  });

  it("records a group delete as one undo step", () => {
    const a = store().addBox(rootId(), { x: 0, y: 0 });
    const b = store().addBox(rootId(), { x: 300, y: 0 });
    store().deleteBoxes([a, b]);
    expect(Object.keys(store().diagram.nodes)).toEqual([rootId()]);
    expect(history().pastStates).toHaveLength(3);
    store().deleteBoxes([]);
    expect(history().pastStates).toHaveLength(3);
  });

  it("groups a transaction into a single undo step", () => {
    const id = store().addBox(rootId(), { x: 0, y: 0 });
    const commit = store().beginTransaction();
    for (const title of ["P", "Pa", "Pay", "Payments"]) store().updateBox(id, { title });
    commit();

    expect(store().diagram.nodes[id]!.title).toBe("Payments");
    expect(history().pastStates).toHaveLength(2);
    history().undo();
    expect(store().diagram.nodes[id]!.title).toBe("New box");
    history().redo();
    expect(store().diagram.nodes[id]!.title).toBe("Payments");
  });

  it("connects to a box from the placeholder and puts it there, as one undo step", () => {
    const shop = store().addBox(rootId(), { x: 0, y: 0 });
    const cart = store().addBox(shop, { x: 0, y: 0 });
    const users = store().addBox(rootId(), { x: 300, y: 0 });
    const edge = store().addConnection(cart, users, { canvasId: shop, position: { x: -400, y: 10 } });

    expect(store().diagram.edges[edge]).toBeDefined();
    expect(store().diagram.nodes[shop]!.externals).toEqual({ [users]: { x: -400, y: 10 } });
    history().undo();
    expect(store().diagram.edges[edge]).toBeUndefined();
    expect(store().diagram.nodes[shop]!.externals).toBeUndefined();
  });

  it("records nothing for a transaction that changed nothing", () => {
    store().addBox(rootId(), { x: 0, y: 0 });
    store().beginTransaction()();
    expect(history().pastStates).toHaveLength(1);
  });
});
