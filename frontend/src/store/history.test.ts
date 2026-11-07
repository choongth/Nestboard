import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyDiagram } from "@/model/diagram";
import { useDiagramStore } from "./diagramStore";
import { redo, undo } from "./history";
import { useViewStore } from "./viewStore";

const store = () => useDiagramStore.getState();
const view = () => useViewStore.getState();
const rootId = () => store().diagram.rootId;

beforeEach(() => {
  store().replaceDiagram(createEmptyDiagram());
  useDiagramStore.temporal.getState().clear();
  view().setCurrent(null);
});

describe("undo / redo", () => {
  it("undoes and redoes edits", () => {
    const id = store().addBox(rootId(), { x: 0, y: 0 });
    undo();
    expect(store().diagram.nodes[id]).toBeUndefined();
    redo();
    expect(store().diagram.nodes[id]).toBeDefined();
  });

  it("does nothing with an empty history", () => {
    const before = store().diagram;
    undo();
    redo();
    expect(store().diagram).toBe(before);
  });

  it("moves up when the box you are inside is undone away", () => {
    const outer = store().addBox(rootId(), { x: 0, y: 0 });
    const inner = store().addBox(outer, { x: 0, y: 0 });
    view().setCurrent(inner);

    undo(); // removes `inner`
    expect(view().currentId).toBe(outer);

    undo(); // removes `outer`
    expect(view().currentId).toBeNull();

    redo();
    redo();
    expect(view().currentId).toBe(outer); // shown where `inner` reappears, not inside it
  });

  it("takes you to the level where the undone change happened", () => {
    const outer = store().addBox(rootId(), { x: 0, y: 0 });
    const inner = store().addBox(outer, { x: 0, y: 0 });
    store().updateBox(inner, { title: "Renamed" });
    view().setCurrent(null); // back at the root

    const step = undo();
    expect(store().diagram.nodes[inner]!.title).toBe("New box");
    expect(view().currentId).toBe(outer);
    expect(step).toMatchObject({ switchedLevel: true, change: { canvasId: outer, boxes: [inner] } });
    expect([...view().highlight!.ids]).toEqual([inner]);

    view().setCurrent(null);
    expect(redo()?.switchedLevel).toBe(true);
    expect(view().currentId).toBe(outer);
    expect(redo()).toBeNull(); // nothing left to redo
  });

  it("stays put when the change is on the level already shown", () => {
    const a = store().addBox(rootId(), { x: 0, y: 0 });
    store().moveBox(a, { x: 10, y: 10 });
    expect(undo()?.switchedLevel).toBe(false);
    expect(view().currentId).toBeNull();
  });

  it("clears a selection whose box or connection is gone", () => {
    const a = store().addBox(rootId(), { x: 0, y: 0 });
    const b = store().addBox(rootId(), { x: 300, y: 0 });
    const edge = store().addConnection(a, b);

    view().select({ type: "connection", id: edge });
    undo();
    expect(view().selection).toBeNull();

    view().selectBoxes([b]);
    undo();
    expect(view().selection).toBeNull();
  });

  it("keeps a selection that still exists", () => {
    const a = store().addBox(rootId(), { x: 0, y: 0 });
    store().moveBox(a, { x: 50, y: 50 });
    view().selectBoxes([a]);
    undo();
    expect(view().selection).toEqual({ type: "boxes", ids: [a] });
  });

  it("drops only the selected boxes an undo removed", () => {
    const a = store().addBox(rootId(), { x: 0, y: 0 });
    const b = store().addBox(rootId(), { x: 300, y: 0 });
    view().selectBoxes([a, b]);
    undo(); // removes `b`
    expect(view().selection).toEqual({ type: "boxes", ids: [a] });
  });

  it("undoes a group move and a group delete in one step each", () => {
    const a = store().addBox(rootId(), { x: 0, y: 0 });
    const b = store().addBox(rootId(), { x: 300, y: 0 });
    store().moveBoxes({ [a]: { x: 10, y: 10 }, [b]: { x: 310, y: 10 } });
    store().deleteBoxes([a, b]);

    const deleted = undo();
    expect(Object.keys(store().diagram.nodes)).toHaveLength(3);
    expect(deleted?.change.boxes.sort()).toEqual([a, b].sort());

    undo();
    expect(store().diagram.nodes[a]!.position).toEqual({ x: 0, y: 0 });
    expect(store().diagram.nodes[b]!.position).toEqual({ x: 300, y: 0 });
  });
});
