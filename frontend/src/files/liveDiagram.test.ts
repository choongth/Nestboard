import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { whenSignedOut } from "@/api/client";
import type { DiagramChanges } from "@/api/diagrams";
import type { ProjectDetail } from "@/api/orgs";
import { buildTree } from "@/model/testUtils";
import { useAccessStore } from "@/store/accessStore";
import { useDiagramStore } from "@/store/diagramStore";
import { useDocumentStore } from "@/store/documentStore";
import { undo } from "@/store/history";
import { useSessionStore } from "@/store/sessionStore";
import { useViewStore } from "@/store/viewStore";
import { usePresenceStore } from "@/store/presenceStore";
import { newDiagram, openDiagram } from "./documentActions";
import { liveDiagram, setLiveSocketOpener } from "./liveDiagram";
import { reportCursor, reportDragging } from "./presence";
import { FakeLiveServer } from "./testLiveServer";

const PROJECT: ProjectDetail = {
  id: "p1",
  org_id: "o1",
  name: "Checkout",
  version: 1,
  updated_at: "2026-11-04T00:00:00Z",
  role: "owner",
  organization: { id: "o1", name: "Acme" },
};

const NONE: DiagramChanges = {
  added_boxes: [],
  changed_boxes: [],
  removed_boxes: [],
  added_edges: [],
  changed_edges: [],
  removed_edges: [],
};

const store = () => useDiagramStore.getState();
const doc = () => useDocumentStore.getState();

let server: FakeLiveServer;
let id: (title: string) => string;
const box = (title: string) => store().diagram.nodes[id(title)]!;

beforeEach(async () => {
  vi.useFakeTimers();
  useSessionStore.getState().setProject(PROJECT);
  // The edit guard lets an owner change anything.
  useAccessStore.setState({ rights: { projectRole: "owner", boxRoles: {} } });
  const tree = buildTree({ Shop: { Cart: {} }, Web: {} });
  id = tree.id;
  server = new FakeLiveServer(tree.diagram);
  setLiveSocketOpener(server.open);
  await openDiagram("d1");
});
afterEach(() => {
  newDiagram();
  vi.useRealTimers();
});

describe("my edits", () => {
  it("go a moment after they are made, only what changed", async () => {
    store().updateBox(id("Cart"), { title: "Basket" });
    expect(server.socket.changes()).toHaveLength(0);
    expect(doc().unsaved).toBe(true);

    await vi.advanceTimersByTimeAsync(250);

    expect(server.socket.changes()).toEqual([
      expect.objectContaining({ changed_boxes: [{ id: id("Cart"), title: "Basket" }], added_boxes: [] }),
    ]);
    server.answer();
    expect(doc()).toMatchObject({ unsaved: false, sync: "saved", version: 2 });
  });

  it("made close together go as one change", async () => {
    store().updateBox(id("Cart"), { title: "B" });
    store().updateBox(id("Cart"), { title: "Ba" });
    await vi.advanceTimersByTimeAsync(250);

    expect(server.socket.changes()).toHaveLength(1);
  });

  it("show as being saved only once they take a while", async () => {
    store().updateBox(id("Cart"), { title: "Basket" });
    await vi.advanceTimersByTimeAsync(250);
    expect(doc().sync).toBe("saved");

    await vi.advanceTimersByTimeAsync(1000);
    expect(doc().sync).toBe("saving");
    server.answer();
    expect(doc().sync).toBe("saved");
  });

  it("are waited for by settle, which says whether they arrived", async () => {
    store().updateBox(id("Cart"), { title: "Basket" });
    const arrived = liveDiagram.settle();
    server.answer();
    expect(await arrived).toBe(true);

    server.greet = false;
    server.socket.drop();
    store().updateBox(id("Cart"), { title: "Cart" });
    const lost = liveDiagram.settle(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await lost).toBe(false);
  });

  it("refused by the server are taken back, and the editor says why", () => {
    store().updateBox(id("Cart"), { title: "Basket" });
    liveDiagram.flush();

    server.refuse(server.socket, 'You may not change "Cart".');

    expect(box("Cart").title).toBe("Cart");
    expect(doc().notice?.message).toBe('You may not change "Cart".');
    expect(doc().unsaved).toBe(false);
  });
});

describe("others' changes", () => {
  it("show at once, and my own to the same box stay", () => {
    store().updateBox(id("Cart"), { title: "Basket" }); // not sent yet

    server.make({ ...NONE, changed_boxes: [{ id: id("Cart"), position: { x: 50, y: 60 } }] });

    expect(box("Cart")).toMatchObject({ title: "Basket", position: { x: 50, y: 60 } });
    liveDiagram.flush();
    expect(server.socket.changes()[0]!.changed_boxes).toEqual([{ id: id("Cart"), title: "Basket" }]);
  });

  it("saved before mine to the same field give way to mine, as the server makes mine later", () => {
    store().updateBox(id("Cart"), { title: "Mine" });
    liveDiagram.flush(); // on its way

    server.make({ ...NONE, changed_boxes: [{ id: id("Cart"), title: "Theirs" }] });
    expect(box("Cart").title).toBe("Mine");
    server.answer();

    expect(box("Cart").title).toBe("Mine");
    expect(server.diagram.nodes[id("Cart")]!.title).toBe("Mine");
  });

  it("are not undone: undo takes back only mine", () => {
    store().updateBox(id("Web"), { title: "Storefront" });
    liveDiagram.flush();
    server.answer();
    server.make({
      ...NONE,
      changed_boxes: [
        { id: id("Web"), position: { x: 5, y: 6 } },
        { id: id("Cart"), title: "Basket" },
      ],
    });

    undo();

    expect(box("Web")).toMatchObject({ title: "Web", position: { x: 5, y: 6 } });
    expect(box("Cart").title).toBe("Basket");
    liveDiagram.flush();
    expect(server.socket.changes().at(-1)!.changed_boxes).toEqual([{ id: id("Web"), title: "Web" }]);
  });

  it("while I type stay out of my one undo step", () => {
    const commit = store().beginTransaction();
    store().updateBox(id("Web"), { title: "S" });
    server.make({ ...NONE, changed_boxes: [{ id: id("Cart"), title: "Basket" }] });
    store().updateBox(id("Web"), { title: "Shop front" });
    commit();

    expect(useDiagramStore.temporal.getState().pastStates).toHaveLength(1);
    undo();
    expect(box("Web").title).toBe("Web");
    expect(box("Cart").title).toBe("Basket");
  });

  it("deleting the level on screen go up to the nearest level left", () => {
    useViewStore.getState().setCurrent(id("Shop"));

    server.make({ ...NONE, removed_boxes: [id("Shop")] });

    expect(store().diagram.nodes[id("Cart")]).toBeUndefined();
    expect(useViewStore.getState().currentId).toBeNull();
  });
});

describe("the connection", () => {
  it("lost and back: what changed meanwhile shows, and what was not confirmed goes again", async () => {
    store().updateBox(id("Cart"), { title: "Basket" });
    liveDiagram.flush();
    const sent = server.socket.changes()[0]!;
    server.greet = false;
    server.socket.drop();
    expect(doc().sync).toBe("saved"); // not for a quick reconnect
    server.make({ ...NONE, changed_boxes: [{ id: id("Web"), title: "Storefront" }] }); // nobody hears

    // Tries again after half a second; this time it takes a while.
    await vi.advanceTimersByTimeAsync(1000);
    expect(doc().sync).toBe("offline");
    expect(server.sockets).toHaveLength(2);
    server.hello();

    expect(doc().sync).toBe("saving"); // what was not confirmed has been on its way all along
    expect(box("Web").title).toBe("Storefront");
    expect(box("Cart").title).toBe("Basket");
    expect(server.socket.changes()).toEqual([sent]);
    server.answer();
    expect(doc()).toMatchObject({ sync: "saved", unsaved: false });
  });

  it("starts again from the server's diagram when a version is missed", async () => {
    server.version++; // a change the editor never hears of
    server.make({ ...NONE, changed_boxes: [{ id: id("Web"), title: "Storefront" }] });

    await vi.advanceTimersByTimeAsync(0);

    expect(server.sockets).toHaveLength(2);
    expect(box("Web").title).toBe("Storefront");
  });

  it("closed because the diagram was deleted says so", () => {
    server.socket.say({ type: "deleted", by: null });
    server.socket.drop(4404, "The diagram was deleted.");

    expect(doc().gone).toBe("The diagram was deleted.");
  });

  it("closed because the session ended signs out", () => {
    const signedOut = vi.fn();
    whenSignedOut(signedOut);
    server.socket.drop(4401, "You signed out.");
    whenSignedOut(null);

    expect(signedOut).toHaveBeenCalled();
  });

  it("renames come in", () => {
    server.version++;
    server.socket.say({ type: "renamed", version: server.version, name: "Shop v2", by: null });

    expect(doc()).toMatchObject({ name: "Shop v2", version: 2 });
  });
});

describe("presence", () => {
  const bob = {
    type: "presence" as const,
    connection: "c9",
    user_id: "u2",
    name: "Bob",
    color: 1,
    level: null,
    selection: null,
    cursor: { x: 1, y: 2 },
    dragging: null,
  };
  const told = () => server.socket.sent.filter((m) => m.type === "presence");

  it("knows who else is here, and who comes and goes", () => {
    server.socket.say(bob);
    expect(Object.keys(usePresenceStore.getState().people)).toEqual(["c9"]);
    expect(usePresenceStore.getState().me).toBe("c1");

    server.socket.say({ type: "left", connection: "c9" });
    expect(usePresenceStore.getState().people).toEqual({});
  });

  it("tells where I am, what is selected and where the pointer is, a few times a second", async () => {
    useViewStore.getState().setCurrent(id("Shop"));
    useViewStore.getState().selectBoxes([id("Cart")]);
    reportCursor({ x: 10.4, y: 20.6 });
    reportCursor({ x: 11, y: 21 });
    expect(told()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(50);

    expect(told()).toEqual([
      {
        type: "presence",
        level: id("Shop"),
        selection: { type: "boxes", ids: [id("Cart")] },
        cursor: { x: 11, y: 21 },
        dragging: null,
      },
    ]);
  });

  it("when a drag ends, sends the move before saying it ended", async () => {
    reportDragging({ [id("Cart")]: { x: 5.2, y: 5 } });
    await vi.advanceTimersByTimeAsync(50);
    expect(told().at(-1)!.dragging).toEqual({ [id("Cart")]: { x: 5, y: 5 } });

    store().moveBox(id("Cart"), { x: 5, y: 5 });
    reportDragging(null);

    expect(server.socket.sent.slice(-2).map((m) => m.type)).toEqual(["change", "presence"]);
    expect(told().at(-1)!.dragging).toBeNull();
  });

  it("after a lost connection, forgets who was here and tells where I am again", async () => {
    server.socket.say(bob);
    reportCursor({ x: 3, y: 4 });
    await vi.advanceTimersByTimeAsync(50);
    server.socket.drop();
    expect(usePresenceStore.getState().people).toEqual({});

    await vi.advanceTimersByTimeAsync(500);

    expect(told()).toEqual([expect.objectContaining({ cursor: { x: 3, y: 4 } })]);
  });
});
