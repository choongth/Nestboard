// Diagram storage on the server (see server/README.md, "图表"). Diagrams
// live in projects; their boxes and connections are records of their own.

import type { DiagramFile, NodeId, Position } from "@/model/types";
import { request, requestFile } from "./client";

export interface DiagramSummary {
  id: string;
  project_id: string;
  name: string;
  version: number;
  created_at: string;
  updated_at: string;
}

/** A box as the server keeps it. `null` is a field the box does not have. */
export interface BoxRecord {
  id: NodeId;
  /** `null` only for the root canvas. Never changes. */
  parent_id: NodeId | null;
  title: string;
  type_id?: string | null;
  technology?: string | null;
  description?: string | null;
  position: Position;
  externals?: Record<NodeId, Position>;
}

export interface EdgeRecord {
  id: string;
  from: NodeId;
  to: NodeId;
  type_id?: string | null;
  label?: string | null;
}

export interface DiagramRecord extends DiagramSummary {
  root_id: NodeId;
  /** In the order they were added, the root first. */
  boxes: BoxRecord[];
  edges: EdgeRecord[];
}

/** A change to a box: its id and the fields that change. A spot set to `null` is forgotten. */
export type BoxPatch = { id: NodeId } & Partial<Omit<BoxRecord, "id" | "parent_id" | "externals">> & {
    externals?: Record<NodeId, Position | null>;
  };

/** A change to a connection: its id and the fields that change. */
export type EdgePatch = { id: string } & Partial<Omit<EdgeRecord, "id">>;

/**
 * One save (sent on the live connection, see api/live.ts): boxes and
 * connections added (whole), changed (only what changes) and deleted, made on
 * top of the diagram as the server has it.
 */
export interface DiagramChanges {
  added_boxes: BoxRecord[];
  changed_boxes: BoxPatch[];
  removed_boxes: NodeId[];
  added_edges: EdgeRecord[];
  changed_edges: EdgePatch[];
  removed_edges: string[];
}

export interface DiagramPage {
  items: DiagramSummary[];
  total: number;
  limit: number;
  offset: number;
}

const project = (id: string) => `/projects/${encodeURIComponent(id)}/diagrams`;

export const listDiagrams = (projectId: string, limit = 200, offset = 0) =>
  request<DiagramPage>("GET", `${project(projectId)}?limit=${limit}&offset=${offset}`);

export const getDiagram = (id: string) => request<DiagramRecord>("GET", `/diagrams/${encodeURIComponent(id)}`);

/** A new diagram holding `document` (the file format, e.g. what is open in the editor). */
export const createDiagram = (projectId: string, name: string, document: DiagramFile) =>
  request<DiagramRecord>("POST", project(projectId), { name, document });

/** Renames whatever version the diagram is at: people may be changing it meanwhile. */
export const renameDiagram = (id: string, name: string) =>
  request<DiagramSummary>("PATCH", `/diagrams/${encodeURIComponent(id)}`, { name });

/** Project owners only. The project's ADRs stay; grants on its boxes go. */
export const deleteDiagram = (id: string) => request<void>("DELETE", `/diagrams/${encodeURIComponent(id)}`);

export type Paper = "a4" | "letter";

/**
 * The saved diagram as a PDF report (see server/README.md, "PDF 导出的规则"):
 * every level, or only those inside `box`. Fails with "box_not_found" for a
 * box the saved version does not have.
 */
export function exportDiagramPdf(id: string, options: { box: NodeId | null; paper: Paper }) {
  const query = new URLSearchParams({ paper: options.paper });
  if (options.box !== null) query.set("box", options.box);
  return requestFile(`/diagrams/${encodeURIComponent(id)}/export.pdf?${query}`);
}
