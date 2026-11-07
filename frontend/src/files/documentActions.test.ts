import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { DiagramRecord } from "@/api/diagrams";
import type { ProjectDetail } from "@/api/orgs";
import { buildTree } from "@/model/testUtils";
import { useAccessStore } from "@/store/accessStore";
import { useDiagramStore } from "@/store/diagramStore";
import { hasUnsavedChanges, useDocumentStore } from "@/store/documentStore";
import { useSessionStore } from "@/store/sessionStore";
import { useViewStore } from "@/store/viewStore";
import { deleteOpenDiagram, exportPdf, newDiagram, openDiagram, rename } from "./documentActions";
import { setLiveSocketOpener } from "./liveDiagram";
import { downloadFile } from "./localFiles";
import { FakeLiveServer } from "./testLiveServer";

// Tests run without a page to download into.
vi.mock("./localFiles", async (original) => ({ ...(await original<object>()), downloadFile: vi.fn() }));

const store = () => useDiagramStore.getState();
const doc = () => useDocumentStore.getState();

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

/** JSON `body`, or a file as `raw` with its `headers`. */
type Answer = { status: number; body?: unknown; raw?: BodyInit; headers?: Record<string, string> };

/** A stand-in for the backend's requests: records them and answers from `respond`. */
function fakeRequests(respond: (call: Call) => Answer | Promise<Answer>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const call = {
      method: init.method ?? "GET",
      path: url.replace("/api/v1", ""),
      body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined,
    };
    calls.push(call);
    const { status, body, raw, headers } = await respond(call);
    return new Response(raw ?? (body === undefined ? null : JSON.stringify(body)), { status, headers });
  });
  return calls;
}

const PROJECT: ProjectDetail = {
  id: "p1",
  org_id: "o1",
  name: "Checkout",
  version: 1,
  updated_at: "2026-10-27T00:00:00Z",
  role: "owner",
  organization: { id: "org-1", name: "Acme" },
};

const isCreate = ({ method, path }: Call) => method === "POST" && path === "/projects/p1/diagrams";

let server: FakeLiveServer;

/**
 * Creating a diagram puts what was sent on the live server (as d1), so the
 * connection that follows starts from it. While `hold` is set, answers wait.
 */
function backend(hold?: Promise<void>, more: (call: Call) => Answer | undefined = () => undefined) {
  return fakeRequests(async (call) => {
    // What the editor sent: what it had when the request went.
    const sent = store().diagram;
    await hold;
    if (isCreate(call)) {
      server.diagram = sent;
      server.name = String(call.body?.name);
      return { status: 201, body: server.record() satisfies DiagramRecord };
    }
    return more(call) ?? { status: 404, body: { error: { code: "not_found", message: "?" } } };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  useSessionStore.getState().setProject(PROJECT);
  useAccessStore.setState({ rights: { projectRole: "owner", boxRoles: {} } });
  const { diagram } = buildTree({ Shop: { Cart: {} }, Web: {} });
  server = new FakeLiveServer(diagram);
  setLiveSocketOpener(server.open);
  newDiagram();
});
afterEach(() => {
  newDiagram();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a new diagram", () => {
  it("is untitled, saved nowhere and with nothing to save, at the root, with no history", () => {
    const id = store().addBox(store().diagram.rootId, { x: 0, y: 0 });
    useViewStore.getState().setCurrent(id);
    newDiagram();

    expect(doc()).toMatchObject({ id: null, name: "Untitled", version: null, sync: "local", unsaved: false });
    expect(useViewStore.getState().currentId).toBeNull();
    expect(useDiagramStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("goes to the server with its first change, then edits made meanwhile go live", async () => {
    let answer!: () => void;
    const calls = backend(new Promise((resolve) => (answer = resolve)));
    store().addBox(store().diagram.rootId, { x: 0, y: 0 });
    expect(doc()).toMatchObject({ sync: "local", unsaved: true });

    await vi.advanceTimersByTimeAsync(250);
    expect(calls.map((c) => [c.method, c.path, c.body?.name])).toEqual([["POST", "/projects/p1/diagrams", "Untitled"]]);
    const later = store().addBox(store().diagram.rootId, { x: 300, y: 0 });
    answer();
    await vi.advanceTimersByTimeAsync(0);

    expect(doc()).toMatchObject({ id: "d1", version: 1 });
    expect(server.socket.changes().map((c) => c.added_boxes.map((b) => b.id))).toEqual([[later]]);
    server.answer();
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("that cannot reach the server stays here, says so, and tries again with the next change", async () => {
    let up = false;
    fakeRequests(() => (up ? { status: 201, body: server.record() } : { status: 502 }));
    store().addBox(store().diagram.rootId, { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(250);
    expect(doc()).toMatchObject({ id: null, unsaved: true });
    expect(doc().notice?.message).toContain("Couldn't save the diagram");

    up = true;
    store().addBox(store().diagram.rootId, { x: 300, y: 0 });
    await vi.advanceTimersByTimeAsync(250);
    expect(doc().id).toBe("d1");
  });
});

describe("opening", () => {
  it("shows the server's diagram, with nothing unsaved, and counts a load", async () => {
    const loads = doc().loads;

    await openDiagram("d1");

    expect(doc()).toMatchObject({ id: "d1", name: "Shop", version: 1, loads: loads + 1, sync: "saved", unsaved: false });
    expect(Object.keys(store().diagram.nodes)).toEqual(Object.keys(server.diagram.nodes));
  });

  it("refuses another project's diagram, and the open one stays", async () => {
    await openDiagram("d1");
    const open = store().diagram;
    server.projectId = "p2";

    await expect(openDiagram("d1")).rejects.toMatchObject({ code: "diagram_not_found" });
    expect(store().diagram).toBe(open);
  });

  it("reports a missing diagram with its code", async () => {
    const error = await openDiagram("nope").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: "diagram_not_found" });
  });

  it("a server that cannot be reached gives a readable error", async () => {
    server.greet = false;
    const opening = openDiagram("d1");
    server.socket.drop(1006);

    await expect(opening).rejects.toMatchObject({
      code: "unreachable",
      message: "Can't reach the Nestboard server. Is it running?",
    });
  });
});

describe("renaming", () => {
  it("a diagram not on the server takes the name there with it", async () => {
    const calls = backend();
    await rename("Payments");
    expect(calls).toHaveLength(0);

    store().addBox(store().diagram.rootId, { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(250);
    expect(calls[0]!.body).toMatchObject({ name: "Payments" });
  });

  it("one on the server is renamed whatever version it is at", async () => {
    await openDiagram("d1");
    const calls = fakeRequests(() => ({ status: 200, body: { ...server.record(), name: "Payments", version: 2 } }));

    await rename("Payments");

    expect(calls).toEqual([{ method: "PATCH", path: "/diagrams/d1", body: { name: "Payments" } }]);
    expect(doc().name).toBe("Payments");
  });
});

describe("deleting", () => {
  it("deletes the open diagram and starts an empty one, without saying it went away", async () => {
    await openDiagram("d1");
    const calls = fakeRequests(() => {
      // The live connection closes before the answer comes.
      server.socket.drop(4404, "The diagram was deleted.");
      return { status: 204 };
    });

    await deleteOpenDiagram();

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["DELETE /diagrams/d1"]);
    expect(doc()).toMatchObject({ id: null, gone: null });
  });
});

describe("exporting a PDF", () => {
  const pdf = (call: Call): Answer | undefined =>
    call.path.startsWith("/diagrams/d1/export.pdf")
      ? {
          status: 200,
          raw: "%PDF-1.7",
          headers: { "content-disposition": "attachment; filename=\"__.pdf\"; filename*=UTF-8''%E6%94%AF%E4%BB%98.pdf" },
        }
      : undefined;

  beforeEach(() => vi.mocked(downloadFile).mockClear());

  it("waits for changes on their way, then downloads the server's PDF under its name", async () => {
    await openDiagram("d1");
    const calls = backend(undefined, pdf);
    store().addBox(store().diagram.rootId, { x: 0, y: 0 });

    const exporting = exportPdf({ box: null, paper: "a4" });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(0); // the change has not arrived yet
    server.answer();
    await exporting;

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /diagrams/d1/export.pdf?paper=a4"]);
    const [blob, name] = vi.mocked(downloadFile).mock.calls[0]!;
    expect(name).toBe("支付.pdf");
    expect(await blob.text()).toBe("%PDF-1.7");
  });

  it("sends a diagram not on the server there first, and can export one box on letter paper", async () => {
    const calls = backend(undefined, pdf);

    await exportPdf({ box: "b 1", paper: "letter" });

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /projects/p1/diagrams",
      "GET /diagrams/d1/export.pdf?paper=letter&box=b+1",
    ]);
  });

  it("the server's refusal comes back with its code", async () => {
    await openDiagram("d1");
    fakeRequests(() => ({ status: 404, body: { error: { code: "box_not_found", message: "No box." } } }));

    await expect(exportPdf({ box: "gone", paper: "a4" })).rejects.toMatchObject({ code: "box_not_found" });
    expect(downloadFile).not.toHaveBeenCalled();
  });
});
