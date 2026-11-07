// Keeps the open diagram live (see api/live.ts): every edit is sent as it is
// made, and changes saved elsewhere come in as they happen. The server
// decides: it makes the changes one after another, each on top of the last,
// and tells everyone each one in order. The editor shows three layers, each
// made on top of the one before:
//  - `confirmed`: the diagram as the server has it, up to `version`;
//  - `pending`: changes sent, not yet confirmed (they are, in order, later);
//  - edits not sent yet: from `base` to the diagram on screen.
// A change from someone else is made under all three, and on every step of
// the undo history, so undo only ever takes back your own changes.
//
// A diagram not on the server yet (new, or imported) goes there with its
// first change, and is live from then on.

import { ApiError, signedOut, UNREACHABLE } from "@/api/client";
import { createDiagram, type DiagramChanges, type DiagramRecord } from "@/api/diagrams";
import {
  CLOSED,
  openLiveSocket,
  type LiveHandlers,
  type LiveSocket,
  type OpenLiveSocket,
  type PresenceState,
  type SavedChange,
  type ServerMessage,
} from "@/api/live";
import { addFinish } from "@/app/unsavedWork";
import { applyChanges, asChanges } from "@/model/changes";
import { createEmptyDiagram } from "@/model/diagram";
import { newId } from "@/model/ids";
import { getPath } from "@/model/queries";
import { changesBetween, changesNothing, fromRecord } from "@/model/records";
import { toFile } from "@/model/serialize";
import type { Diagram } from "@/model/types";
import { rebaseHistory, replaceSilently, useDiagramStore } from "@/store/diagramStore";
import { useDocumentStore, type Sync } from "@/store/documentStore";
import { usePresenceStore } from "@/store/presenceStore";
import { currentProject } from "@/store/sessionStore";
import { useViewStore } from "@/store/viewStore";

/** Edits are sent at most this often: typing a name goes out a few times a second. */
const SEND_EVERY_MS = 250;
/** Changes on their way longer than this show as being saved. */
const SLOW_MS = 1000;
/** Waits before each try to reconnect; the last one repeats. */
const RETRY_MS = [500, 1000, 2000, 5000, 10_000];

interface Pending {
  id: string;
  changes: DiagramChanges;
  sent: boolean;
}

type Hello = Extract<ServerMessage, { type: "hello" }>;

let openSocket: OpenLiveSocket = openLiveSocket;

/** For tests: connections that go somewhere else. */
export function setLiveSocketOpener(open: OpenLiveSocket) {
  openSocket = open;
}

let accessChanged: () => void = () => {};

/**
 * `reload` fetches who may change what again: the server says it may have
 * changed (see app/AccessSession.tsx; the access store depends on this
 * module's chunk, not the other way round).
 */
export function whenAccessChanges(reload: () => void) {
  accessChanged = reload;
}

class LiveDiagram {
  /** The diagram on the server; `null` while it is only here. */
  private diagramId: string | null = null;
  private socket: LiveSocket | null = null;
  /** The connection has said hello: changes can be sent. */
  private ready = false;
  private confirmed: Diagram | null = null;
  private version = 0;
  private pending: Pending[] = [];
  private base: Diagram = useDiagramStore.getState().diagram;
  /** Changes every time the diagram is let go of, so late answers about it are ignored. */
  private generation = 0;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private creating = false;
  /** Since when changes have been unsaved; `null` when none are. */
  private unsavedSince: number | null = null;
  /** Since when the connection has not been ready (lost, or being made); `null` while it is. */
  private connectingSince: number | null = null;
  private slowTimer: ReturnType<typeof setTimeout> | null = null;
  private waiters = new Set<() => void>();
  /** A diagram being opened: its connection, until it says hello. */
  private opening: { socket: LiveSocket; give: () => void } | null = null;
  /** A diagram being deleted from here: its going away is no news. */
  private deleting: string | null = null;
  /** What this tab is doing, as last told (see presence.ts); told again after a lost connection. */
  private presence: PresenceState | null = null;

  /** A diagram not on the server; `fresh`: content the server has never seen (imported), so it goes there now. */
  startLocal(diagram: Diagram, name: string, fresh: boolean) {
    this.opening?.give();
    this.stop();
    this.base = fresh ? createEmptyDiagram() : diagram;
    load(diagram, { id: null, name, version: null });
    if (fresh) this.flush();
    this.update();
  }

  /**
   * Opens a diagram on the server: resolves once it is on screen. `check`
   * may refuse it (throw) when it arrives. The open diagram stays until then,
   * and if opening fails. Opening another meanwhile gives this one up (it
   * resolves without opening anything).
   */
  open(id: string, check: (record: DiagramRecord) => void): Promise<void> {
    this.opening?.give();
    return new Promise((resolve, reject) => {
      const handlers: LiveHandlers = {
        message: (message) => {
          if (message.type !== "hello") return; // nothing comes before it
          this.opening = null;
          try {
            check(message.diagram);
          } catch (e) {
            socket.close();
            reject(e as Error);
            return;
          }
          this.stop();
          this.adoptSocket(id, socket, handlers);
          this.welcome(message, true);
          resolve();
        },
        closed: (code, reason) => {
          this.opening = null;
          if (code === CLOSED.SIGNED_OUT) signedOut();
          reject(openFailure(code, reason));
        },
      };
      const socket = openSocket(id, handlers);
      this.opening = {
        socket,
        give: () => {
          socket.close();
          resolve();
        },
      };
    });
  }

  /** The diagram on screen is now `record` on the server, created from `sent`: it is live from here. */
  private adopt(record: DiagramRecord, sent: Diagram) {
    this.stop();
    this.diagramId = record.id;
    this.confirmed = sent;
    this.base = sent;
    this.version = record.version;
    useDocumentStore.getState().setDocument({ id: record.id, name: record.name, version: record.version });
    this.connect();
    this.update();
  }

  /** A diagram only here goes to the server now, changed or not (e.g. to export it). */
  toServer() {
    if (this.diagramId === null) void this.create();
  }

  /** Sends what has not been sent yet, now. */
  flush() {
    if (this.sendTimer !== null) clearTimeout(this.sendTimer);
    this.sendTimer = null;
    const current = useDiagramStore.getState().diagram;
    if (this.diagramId === null) {
      if (current !== this.base) void this.create();
      return;
    }
    if (this.confirmed === null) return;
    const changes = changesBetween(this.base, current);
    this.base = current;
    if (!changesNothing(changes)) {
      this.pending.push({ id: newId(), changes, sent: false });
      this.sendPending();
    }
    this.update();
  }

  /**
   * Sends everything and waits up to `timeoutMs` for the server to have it;
   * whether it does. By default: a while when connected (a busy server can
   * take seconds), briefly when not (nothing can arrive until it is back).
   */
  settle(timeoutMs?: number): Promise<boolean> {
    this.flush();
    if (!this.unsaved()) return Promise.resolve(true);
    timeoutMs ??= this.ready || this.creating ? 10_000 : 1500;
    return new Promise((resolve) => {
      const done = (saved: boolean) => {
        this.waiters.delete(check);
        clearTimeout(timer);
        resolve(saved);
      };
      const check = () => {
        if (!this.unsaved()) done(true);
      };
      const timer = setTimeout(() => done(false), timeoutMs);
      this.waiters.add(check);
    });
  }

  /** The diagram on screen changed (an edit, undo...). */
  edited() {
    this.sendTimer ??= setTimeout(() => this.flush(), SEND_EVERY_MS);
    this.update();
  }

  unsaved(): boolean {
    return this.creating || this.pending.length > 0 || this.base !== useDiagramStore.getState().diagram;
  }

  /** Tells the others what this tab is doing (once the connection is open; else then). */
  sendPresence(state: PresenceState) {
    this.presence = state;
    if (this.ready && this.socket) this.socket.send({ type: "presence", ...state });
  }

  /** The open diagram is about to be deleted from here (`done` false: it was not after all). */
  deletingOpen(done = true) {
    this.deleting = done ? this.diagramId : null;
  }

  /** Lets go of the diagram on the server: no more changes go or come. */
  private stop() {
    this.generation++;
    for (const timer of [this.sendTimer, this.retryTimer, this.slowTimer]) if (timer !== null) clearTimeout(timer);
    this.sendTimer = this.retryTimer = this.slowTimer = null;
    this.socket?.close();
    this.socket = null;
    this.ready = false;
    this.diagramId = null;
    this.confirmed = null;
    this.pending = [];
    this.retries = 0;
    this.creating = false;
    this.deleting = null;
    this.presence = null;
    usePresenceStore.setState({ me: null, people: {} });
  }

  /** A diagram only here goes to the server, with what is on screen. */
  private async create() {
    if (this.creating) return;
    this.creating = true;
    this.update();
    const generation = this.generation;
    const sent = useDiagramStore.getState().diagram;
    try {
      const record = await createDiagram(currentProject().id, useDocumentStore.getState().name, toFile(sent));
      if (generation !== this.generation) return; // something else was opened meanwhile
      this.creating = false;
      this.adopt(record, sent);
    } catch (e) {
      if (generation !== this.generation) return;
      this.creating = false;
      // Tried again with the next change.
      useDocumentStore.getState().say(`Couldn't save the diagram: ${e instanceof Error ? e.message : String(e)}`);
      this.update();
    }
  }

  private connect() {
    const diagramId = this.diagramId!;
    const handlers: LiveHandlers = { message: () => {}, closed: () => {} };
    this.adoptSocket(diagramId, openSocket(diagramId, handlers), handlers);
  }

  /** Makes `socket` (for `diagramId`) the connection: what it says from now on comes here. */
  private adoptSocket(diagramId: string, socket: LiveSocket, handlers: LiveHandlers) {
    const generation = this.generation;
    this.diagramId = diagramId;
    this.socket = socket;
    this.ready = false;
    handlers.message = (message) => {
      if (generation === this.generation && this.socket === socket) this.receive(message);
    };
    handlers.closed = (code, reason) => {
      if (generation === this.generation && this.socket === socket) this.lost(code, reason);
    };
  }

  private receive(message: ServerMessage) {
    switch (message.type) {
      case "hello":
        this.welcome(message, false);
        break;
      case "change":
        this.saved(message);
        break;
      case "refused":
        this.refused(message.id, message.error.message);
        break;
      case "renamed":
        if (this.inOrder(message.version)) useDocumentStore.getState().setName(message.name);
        break;
      case "access":
        accessChanged();
        break;
      case "presence":
        usePresenceStore.setState((s) => ({ people: { ...s.people, [message.connection]: message } }));
        break;
      case "left":
        usePresenceStore.setState((s) => {
          const people = { ...s.people };
          delete people[message.connection];
          return { people };
        });
        break;
      default:
        // "deleted": the connection closes next, saying why.
        break;
    }
  }

  /**
   * The connection is open, with the diagram as the server has it: shown as
   * it is (`fresh`), or, after a lost connection (or just created), what
   * changed meanwhile is made like a change from someone else, and what was
   * not confirmed is sent again (sent twice, a change does no harm).
   */
  private welcome(hello: Hello, fresh: boolean) {
    const diagram = fromRecord(hello.diagram);
    this.version = hello.diagram.version;
    if (fresh || this.confirmed === null) {
      this.confirmed = diagram;
      this.base = diagram;
      this.pending = [];
      load(diagram, { id: hello.diagram.id, name: hello.diagram.name, version: this.version });
    } else {
      const missed = changesBetween(this.confirmed, diagram);
      this.confirmed = diagram;
      this.others(missed);
      for (const change of this.pending) change.sent = false;
      useDocumentStore.setState({ name: hello.diagram.name, version: this.version });
      // Who may change what may have changed meanwhile too.
      if (this.retries > 0) accessChanged();
    }
    this.ready = true;
    this.retries = 0;
    usePresenceStore.setState({
      me: hello.connection,
      people: Object.fromEntries(hello.people.map((p) => [p.connection, p])),
    });
    if (this.presence) this.socket?.send({ type: "presence", ...this.presence });
    this.sendPending();
    this.flush();
  }

  /** A change saved: someone else's, or one of ours coming back. */
  private saved(change: SavedChange) {
    if (this.confirmed === null || !this.inOrder(change.version)) return;
    const before = this.confirmed;
    this.confirmed = applyChanges(before, asChanges(change));
    const mine = change.change_id === null ? -1 : this.pending.findIndex((p) => p.id === change.change_id);
    if (mine >= 0) {
      this.pending.splice(mine, 1);
      if (change.skipped_boxes.length + change.skipped_edges.length > 0) {
        useDocumentStore.getState().say("Some of your changes were not saved: what they changed had just been deleted.");
      }
    } else {
      this.others(changesBetween(before, this.confirmed));
    }
    this.checkDrift();
    this.update();
  }

  /** The server would not make one of our changes: it goes. */
  private refused(id: string | null, message: string) {
    useDocumentStore.getState().say(message);
    const index = id === null ? -1 : this.pending.findIndex((p) => p.id === id);
    if (index < 0 || this.confirmed === null) return;
    this.pending.splice(index, 1);
    // Remade from the server's diagram without it, keeping whatever is the same.
    const current = useDiagramStore.getState().diagram;
    const synced = this.base === current;
    const unsent = changesBetween(this.base, current);
    const base = this.pending.reduce((d, p) => applyChanges(d, p.changes), this.confirmed);
    const next = applyChanges(current, changesBetween(current, applyChanges(base, unsent)));
    this.base = synced ? next : applyChanges(this.base, changesBetween(this.base, base));
    this.show(current, next);
    this.update();
  }

  /**
   * Someone else's changes, made under ours: on the diagram at the last send,
   * on the one on screen, and on every undo step. Ours are then made again on
   * top, as the server will make them after these.
   */
  private others(theirs: DiagramChanges) {
    if (changesNothing(theirs)) return;
    const current = useDiagramStore.getState().diagram;
    const synced = this.base === current;
    const unsent = changesBetween(this.base, current);
    const patched = new WeakMap<object, object>();
    const ours = (diagram: Diagram) => this.pending.reduce((d, p) => applyChanges(d, p.changes), diagram);
    const next = applyChanges(ours(applyChanges(current, theirs, patched)), unsent);
    this.base = synced ? next : ours(applyChanges(this.base, theirs, patched));
    rebaseHistory((diagram) => applyChanges(diagram, theirs, patched));
    this.show(current, next);
  }

  /** With nothing on its way, the diagram on screen is the server's: if not, it is made so. */
  private checkDrift() {
    const current = useDiagramStore.getState().diagram;
    if (this.confirmed === null || this.pending.length > 0 || this.base !== current) return;
    const drift = changesBetween(current, this.confirmed);
    if (changesNothing(drift)) return;
    const next = applyChanges(current, drift);
    this.base = next;
    this.show(current, next);
  }

  /** Puts `next` on screen without an undo step, keeping the level and selection where they still exist. */
  private show(current: Diagram, next: Diagram) {
    if (next === current) return;
    replaceSilently(next);
    keepViewValid(current, next);
  }

  /** Whether a message with `version` is the next one; one missing means starting again from the server's diagram. */
  private inOrder(version: number): boolean {
    if (version <= this.version) return false;
    if (version > this.version + 1) {
      this.reconnect(0);
      return false;
    }
    this.version = version;
    useDocumentStore.setState({ version });
    return true;
  }

  private sendPending() {
    if (!this.ready || !this.socket) return;
    for (const change of this.pending) {
      if (change.sent) continue;
      this.socket.send({ type: "change", id: change.id, ...change.changes });
      change.sent = true;
    }
  }

  private lost(code: number, reason: string) {
    this.socket = null;
    this.ready = false;
    // Who was here is not known any more; hello says again.
    usePresenceStore.setState({ me: null, people: {} });
    if (code === CLOSED.SIGNED_OUT) {
      signedOut();
    } else if (code === CLOSED.GONE) {
      const expected = this.deleting !== null && this.deleting === this.diagramId;
      this.stop();
      if (!expected) useDocumentStore.setState({ gone: reason || "The diagram is no longer there." });
    } else {
      this.reconnect(RETRY_MS[Math.min(this.retries, RETRY_MS.length - 1)]!);
    }
    this.update();
  }

  private reconnect(afterMs: number) {
    this.socket?.close();
    this.socket = null;
    this.ready = false;
    this.retries++;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.diagramId !== null) this.connect();
    }, afterMs);
    this.update();
  }

  /**
   * Tells the editor how saving goes. Only what lasts is shown: changes on
   * their way, or a connection being made, for SLOW_MS or more (not every
   * edit, connect or quick reconnect).
   */
  private update() {
    const unsaved = this.unsaved();
    const now = Date.now();
    if (!unsaved) this.unsavedSince = null;
    else this.unsavedSince ??= now;
    const connecting = this.diagramId !== null && !this.ready;
    if (!connecting) this.connectingSince = null;
    else this.connectingSince ??= now;
    const since = Math.min(this.unsavedSince ?? Infinity, this.connectingSince ?? Infinity);
    if (since !== Infinity && now - since < SLOW_MS && this.slowTimer === null) {
      this.slowTimer = setTimeout(
        () => {
          this.slowTimer = null;
          this.update();
        },
        SLOW_MS - (now - since),
      );
    }
    const lasting = (start: number | null) => start !== null && now - start >= SLOW_MS;
    let sync: Sync = "saved";
    if (this.diagramId === null) sync = "local";
    else if (lasting(this.connectingSince)) sync = "offline";
    else if (this.ready && lasting(this.unsavedSince)) sync = "saving";
    const state = useDocumentStore.getState();
    if (state.sync !== sync || state.unsaved !== unsaved) useDocumentStore.setState({ sync, unsaved });
    for (const waiter of [...this.waiters]) waiter();
  }
}

/** Puts a diagram on screen in place of the open one: fresh undo history, back at the root, nothing selected. */
function load(diagram: Diagram, doc: { id: string | null; name: string; version: number | null }) {
  useDiagramStore.getState().replaceDiagram(diagram);
  useDiagramStore.temporal.getState().clear();
  useDocumentStore.getState().loaded(doc);
  useViewStore.getState().setCurrent(null);
}

/** The level on screen and the selection, where they were deleted: the nearest level left, and what is left. */
function keepViewValid(before: Diagram, after: Diagram) {
  const view = useViewStore.getState();
  if (view.currentId && !after.nodes[view.currentId]) {
    const above = getPath(before, view.currentId)
      .map((node) => node.id)
      .reverse()
      .find((id) => after.nodes[id]);
    view.setCurrent(above === undefined || above === after.rootId ? null : above);
    return;
  }
  const { selection } = view;
  if (selection?.type === "connection") {
    if (!after.edges[selection.id]) view.select(null);
  } else if (selection) {
    const kept = selection.ids.filter((id) => after.nodes[id]);
    if (kept.length !== selection.ids.length) view.selectBoxes(kept);
  }
}

function openFailure(code: number, reason: string): ApiError {
  if (code === CLOSED.GONE) return new ApiError(404, "diagram_not_found", reason);
  if (code === CLOSED.SIGNED_OUT) return new ApiError(401, "not_signed_in", reason);
  return new ApiError(0, UNREACHABLE, "Can't reach the Nestboard server. Is it running?");
}

export const liveDiagram = new LiveDiagram();

useDiagramStore.subscribe((state, previous) => {
  if (state.diagram !== previous.diagram) liveDiagram.edited();
});

addFinish("diagram", () => liveDiagram.settle());
