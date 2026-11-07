// The live connection to an open diagram (server/README.md, "实时连接"): a
// WebSocket that starts with the whole diagram, then carries every change as
// it is saved (here or anywhere else), the changes this tab makes, and who
// else is there.

import type { DiagramAccess } from "./access";
import type { BoxRecord, DiagramChanges, DiagramRecord, EdgeRecord } from "./diagrams";

/** Who saved a change; `connection` when it came over a live connection. */
export interface Sender {
  user_id: string;
  name: string;
  connection: string | null;
}

export type PresenceSelection = { type: "boxes"; ids: string[] } | { type: "connection"; id: string };

/** What someone is doing: all of it, each time it changes. */
export interface PresenceState {
  /** The box whose inside they are looking at (the root at the top level). */
  level: string | null;
  selection: PresenceSelection | null;
  /** Their pointer on that canvas. */
  cursor: { x: number; y: number } | null;
  /** Boxes they are dragging on that canvas, where they are now. */
  dragging: Record<string, { x: number; y: number }> | null;
}

export interface Presence extends PresenceState {
  type: "presence";
  connection: string;
  user_id: string;
  name: string;
  /** 0–11: the same for all of one person's tabs. */
  color: number;
}

export interface SavedChange {
  type: "change";
  /** One more than the last: every version after `hello`'s comes, once and in order. */
  version: number;
  by: Sender | null;
  /** The `id` this tab gave the change, when it is its own. */
  change_id: string | null;
  /** The boxes and connections added or changed, whole, as they now are. */
  boxes: BoxRecord[];
  edges: EdgeRecord[];
  /** Everything deleted, also what went with a deleted box. */
  removed_boxes: string[];
  removed_edges: string[];
  /** What the change named but left alone: not there (deleted meanwhile). */
  skipped_boxes: string[];
  skipped_edges: string[];
}

export type ServerMessage =
  | {
      type: "hello";
      connection: string;
      color: number;
      diagram: DiagramRecord;
      access: DiagramAccess;
      people: Presence[];
    }
  | SavedChange
  | { type: "refused"; id: string | null; error: { code: string; message: string; details?: unknown } }
  | Presence
  | { type: "left"; connection: string }
  | { type: "renamed"; version: number; name: string; by: Sender | null }
  | ({ type: "access" } & DiagramAccess)
  | { type: "deleted"; by: Sender | null };

export type ClientMessage = ({ type: "change"; id: string } & DiagramChanges) | ({ type: "presence" } & PresenceState);

/** Why the server closed the connection. */
export const CLOSED = {
  /** Not signed in, or signed out since. */
  SIGNED_OUT: 4401,
  /** The diagram is gone, or the user may no longer see it. */
  GONE: 4404,
} as const;

export interface LiveSocket {
  /** Sent once the connection is open; dropped before. */
  send: (message: ClientMessage) => void;
  /** Closes it without telling `closed`. */
  close: () => void;
}

export interface LiveHandlers {
  message: (message: ServerMessage) => void;
  closed: (code: number, reason: string) => void;
}

export type OpenLiveSocket = (diagramId: string, handlers: LiveHandlers) => LiveSocket;

export const openLiveSocket: OpenLiveSocket = (diagramId, handlers) => {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(
    `${scheme}://${window.location.host}/api/v1/diagrams/${encodeURIComponent(diagramId)}/live`,
  );
  socket.onmessage = (event: MessageEvent<string>) => handlers.message(JSON.parse(event.data) as ServerMessage);
  socket.onclose = (event) => handlers.closed(event.code, event.reason);
  return {
    send: (message) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    close: () => {
      socket.onmessage = null;
      socket.onclose = null;
      socket.close();
    },
  };
};
