// A stand-in for the backend's live connections (api/live.ts), for unit tests:
// it keeps one diagram, makes changes the way the real one does
// (model/changes.ts), and tells every open connection about each, in order.

import type { DiagramChanges, DiagramRecord } from "@/api/diagrams";
import type { ClientMessage, LiveHandlers, LiveSocket, OpenLiveSocket, SavedChange, ServerMessage } from "@/api/live";
import { applyChanges } from "@/model/changes";
import { toBoxRecord, toEdgeRecord } from "@/model/records";
import type { Diagram } from "@/model/types";

export class FakeSocket implements LiveSocket {
  readonly sent: ClientMessage[] = [];
  /** How many of `sent` the server has dealt with. */
  answered = 0;
  open = true;

  constructor(
    readonly diagramId: string,
    readonly handlers: LiveHandlers,
  ) {}

  send(message: ClientMessage) {
    if (this.open) this.sent.push(message);
  }

  close() {
    this.open = false;
  }

  /** What the server says to this tab. */
  say(message: ServerMessage) {
    if (this.open) this.handlers.message(message);
  }

  /** The server closes it (or the network goes). */
  drop(code = 1006, reason = "") {
    this.open = false;
    this.handlers.closed(code, reason);
  }

  /** The changes it sent. */
  changes() {
    return this.sent.filter((m) => m.type === "change");
  }
}

export class FakeLiveServer {
  readonly sockets: FakeSocket[] = [];
  /** Opened connections say hello at once (else: `hello()`). */
  greet = true;

  constructor(
    public diagram: Diagram,
    public version = 1,
    public id = "d1",
    public name = "Shop",
    public projectId = "p1",
  ) {}

  open: OpenLiveSocket = (diagramId, handlers) => {
    const socket = new FakeSocket(diagramId, handlers);
    this.sockets.push(socket);
    if (diagramId !== this.id) queueMicrotask(() => socket.drop(4404, `Diagram ${diagramId} does not exist.`));
    else if (this.greet) queueMicrotask(() => this.hello(socket));
    return socket;
  };

  /** The connection opened last. */
  get socket(): FakeSocket {
    return this.sockets.at(-1)!;
  }

  record(): DiagramRecord {
    return {
      id: this.id,
      project_id: this.projectId,
      name: this.name,
      version: this.version,
      created_at: "2026-11-04T00:00:00Z",
      updated_at: "2026-11-04T00:00:00Z",
      root_id: this.diagram.rootId,
      boxes: Object.values(this.diagram.nodes).map(toBoxRecord),
      edges: Object.values(this.diagram.edges).map(toEdgeRecord),
    };
  }

  hello(socket = this.socket) {
    socket.say({
      type: "hello",
      connection: `c${this.sockets.indexOf(socket) + 1}`,
      color: 0,
      diagram: this.record(),
      access: { project_role: "owner", box_roles: {} },
      people: [],
    });
  }

  /** Makes changes (someone else's, or from `from` with its `changeId`) and tells every open connection. */
  make(changes: DiagramChanges, changeId: string | null = null, tell = this.sockets): SavedChange {
    const before = this.diagram;
    this.diagram = applyChanges(before, changes);
    this.version++;
    const boxes = new Set([...changes.added_boxes, ...changes.changed_boxes].map((b) => b.id));
    const edges = new Set([...changes.added_edges, ...changes.changed_edges].map((e) => e.id));
    const saved: SavedChange = {
      type: "change",
      version: this.version,
      by: { user_id: "u1", name: changeId ? "Me" : "Bob", connection: null },
      change_id: changeId,
      boxes: [...boxes].filter((id) => this.diagram.nodes[id]).map((id) => toBoxRecord(this.diagram.nodes[id]!)),
      edges: [...edges].filter((id) => this.diagram.edges[id]).map((id) => toEdgeRecord(this.diagram.edges[id]!)),
      removed_boxes: Object.keys(before.nodes).filter((id) => !this.diagram.nodes[id]),
      removed_edges: Object.keys(before.edges).filter((id) => !this.diagram.edges[id]),
      skipped_boxes: [...boxes].filter((id) => !this.diagram.nodes[id]),
      skipped_edges: [...edges].filter((id) => !this.diagram.edges[id]),
    };
    for (const socket of tell) socket.say(saved);
    return saved;
  }

  /** Makes every change sent on open connections so far, in order. */
  answer() {
    for (const socket of this.sockets) {
      while (socket.open && socket.answered < socket.sent.length) {
        const message = socket.sent[socket.answered++]!;
        if (message.type === "change") this.make(message, message.id);
      }
    }
  }

  /** Refuses the next change sent on `socket`, telling only it. */
  refuse(socket = this.socket, message = "You may not change that.") {
    const change = socket.sent.slice(socket.answered).find((m) => m.type === "change");
    socket.answered = socket.sent.length;
    socket.say({ type: "refused", id: change?.type === "change" ? change.id : null, error: { code: "outside_your_part", message } });
  }
}
