// Core data model. Two shapes:
//  - In memory (`Diagram`): flat maps keyed by id. Every node knows its parent,
//    every edge knows the canvas it lives on. Cheap lookups, moves, subtree
//    deletes and undo snapshots.
//  - On disk (`DiagramFile`): the nested tree described in README.md, so a saved
//    file reads naturally and diffs well in Git.

export type NodeId = string;
export type EdgeId = string;

export interface Position {
  x: number;
  y: number;
}

export interface BoxNode {
  /** Stable for the node's lifetime; never reused. Leaves room for references later. */
  id: NodeId;
  /** `null` only for the root canvas. */
  parentId: NodeId | null;
  title: string;
  /**
   * The box's role, e.g. "load-balancer". Absent means the generic type. Any
   * string is kept as-is, including ids this version does not know, so files
   * from newer versions or other tools round-trip without losing it.
   */
  typeId?: string;
  technology?: string;
  description?: string;
  /** Position on the parent's canvas. Boxes have a fixed size in v0.1. */
  position: Position;
  /**
   * Where the user put external boxes on this box's canvas (the far ends of
   * connections leaving it), by their id. Ones not listed rest in a column on
   * the right. Never empty: no spots is `undefined`.
   */
  externals?: Record<NodeId, Position>;
}

export interface Edge {
  id: EdgeId;
  /**
   * Where the edge is stored: the lowest common ancestor of `from` and `to`.
   * For siblings that is their parent, whose canvas draws the edge directly;
   * for boxes on different levels, ancestor canvases show it lifted.
   */
  parentId: NodeId;
  from: NodeId;
  to: NodeId;
  /**
   * The kind of connection, e.g. "request" or "replication". Absent means the
   * generic type. Like box types, any string is kept as-is, known or not.
   */
  typeId?: string;
  label?: string;
}

export interface Diagram {
  rootId: NodeId;
  nodes: Record<NodeId, BoxNode>;
  edges: Record<EdgeId, Edge>;
}

// ---- File format ----

/**
 * Bumped whenever the file gains something an older Nestboard would drop on
 * save. Older versions refuse newer files instead of silently losing data.
 *   1: boxes, nesting, connections.
 *   2: adds the optional box `typeId`. Version 1 files read as-is (no types).
 *   3: connections may join boxes on different levels. Older files read as-is.
 *   4: adds the optional connection `typeId`. Older files read as-is (no types).
 *   5: adds the optional box `externals`: where external boxes were moved on
 *      its canvas. Older files read as-is (every external box in the column).
 */
export const SCHEMA_VERSION = 5;

export interface FileNode {
  id: NodeId;
  title: string;
  typeId?: string;
  technology?: string;
  description?: string;
  position: Position;
  /** See BoxNode.externals. Written only when there are spots. */
  externals?: Record<NodeId, Position>;
  children: FileNode[];
  /**
   * Edges whose lowest common ancestor is this node: between its direct
   * children, or (from format 3) between boxes nested anywhere inside it.
   */
  edges: FileEdge[];
}

export interface FileEdge {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  typeId?: string;
  label?: string;
}

export interface DiagramFile {
  schemaVersion: number;
  root: FileNode;
}

// ---- Layout constants ----

export const BOX_WIDTH = 240;
export const BOX_HEIGHT = 140;
