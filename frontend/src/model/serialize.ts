// Converts between the in-memory Diagram and the nested file format.

import { connectionProblem, getChildren, getEdgesOn, lowestCommonAncestor } from "./queries";
import {
  SCHEMA_VERSION,
  type BoxNode,
  type Diagram,
  type DiagramFile,
  type Edge,
  type EdgeId,
  type FileEdge,
  type FileNode,
  type NodeId,
} from "./types";

export function toFile(diagram: Diagram): DiagramFile {
  const build = (node: BoxNode): FileNode => {
    const out: FileNode = { id: node.id, title: node.title, position: { ...node.position }, children: [], edges: [] };
    if (node.typeId !== undefined) out.typeId = node.typeId;
    if (node.technology !== undefined) out.technology = node.technology;
    if (node.description !== undefined) out.description = node.description;
    if (node.externals !== undefined) {
      out.externals = Object.fromEntries(Object.entries(node.externals).map(([id, p]) => [id, { x: p.x, y: p.y }]));
    }
    out.children = getChildren(diagram, node.id).map(build);
    out.edges = getEdgesOn(diagram, node.id).map(({ id, from, to, typeId, label }) => {
      const edge: FileEdge = { id, from, to };
      if (typeId !== undefined) edge.typeId = typeId;
      if (label !== undefined) edge.label = label;
      return edge;
    });
    return out;
  };
  return { schemaVersion: SCHEMA_VERSION, root: build(diagram.nodes[diagram.rootId]!) };
}

export function serialize(diagram: Diagram): string {
  return JSON.stringify(toFile(diagram), null, 2) + "\n";
}

export type ParseResult = { ok: true; diagram: Diagram } | { ok: false; error: string };

/** Parses file text. Never throws: anything wrong comes back as a readable error. */
export function parse(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "The file is not valid JSON." };
  }
  return fromFile(data);
}

/** The oldest file format this version can still open. */
const OLDEST_READABLE_VERSION = 1;

class FileFormatError extends Error {}

export function fromFile(data: unknown): ParseResult {
  try {
    return { ok: true, diagram: readFile(data) };
  } catch (e) {
    if (e instanceof FileFormatError) return { ok: false, error: e.message };
    throw e;
  }
}

function readFile(data: unknown): Diagram {
  if (!isObject(data) || !("root" in data) || !("schemaVersion" in data)) {
    fail("This is not a Nestboard file.");
  }
  const version = data.schemaVersion;
  if (typeof version !== "number") fail("This is not a Nestboard file.");
  if (version > SCHEMA_VERSION) {
    fail(`This file was made by a newer version of Nestboard (format ${version}). Please update the app.`);
  }
  if (!Number.isInteger(version) || version < OLDEST_READABLE_VERSION) {
    fail(`Unsupported file format version: ${version}.`);
  }
  // Every readable version so far only adds to the one before (version 1
  // lacks box `typeId`; versions 1–2 only have connections between siblings;
  // versions 1–3 lack connection `typeId`; versions 1–4 lack box `externals`), so
  // one reader handles them all. A version that changes structure gets its
  // own migration here.

  const nodes: Record<NodeId, BoxNode> = {};
  const rawEdges: { raw: unknown; canvasId: NodeId; where: string }[] = [];

  // Iterative walk so a deeply nested file cannot overflow the call stack.
  const stack: { raw: unknown; parentId: NodeId | null; where: string }[] = [
    { raw: data.root, parentId: null, where: "root" },
  ];
  let rootId: NodeId | undefined;

  while (stack.length > 0) {
    const { raw, parentId, where } = stack.pop()!;
    const node = readNode(raw, parentId, where);
    if (nodes[node.id]) fail(`Duplicate box id "${node.id}".`);
    nodes[node.id] = node;
    rootId ??= node.id;

    const r = raw as Record<string, unknown>;
    (r.edges as unknown[]).forEach((e, i) => {
      rawEdges.push({ raw: e, canvasId: node.id, where: `${where}.edges[${i}]` });
    });
    // Pushed in reverse so children keep their file order in `nodes`.
    const children = r.children as unknown[];
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ raw: children[i], parentId: node.id, where: `${where}.children[${i}]` });
    }
  }

  // Spots for external boxes that are not in the file cannot be shown: dropped.
  for (const node of Object.values(nodes)) {
    if (!node.externals) continue;
    const known = Object.entries(node.externals).filter(([id]) => nodes[id]);
    if (known.length > 0) node.externals = Object.fromEntries(known);
    else delete node.externals;
  }

  // Connections are checked once every box is known, so a broken box is
  // reported as itself rather than as a connection pointing at it.
  const edges: Record<EdgeId, Edge> = {};
  for (const { raw, canvasId, where } of rawEdges) {
    const edge = readEdge(raw, canvasId, nodes, where);
    if (edges[edge.id]) fail(`Duplicate connection id "${edge.id}".`);
    edges[edge.id] = edge;
  }

  return { rootId: rootId!, nodes, edges };
}

function readNode(raw: unknown, parentId: NodeId | null, where: string): BoxNode {
  if (!isObject(raw)) fail(`Box at ${where} is not an object.`);
  const { id, title, typeId, technology, description, position, externals, children, edges } = raw;
  if (typeof id !== "string" || id === "") fail(`Box at ${where} has no id.`);
  if (typeof title !== "string") fail(`Box "${id}" has no title.`);
  // Any non-empty string is accepted, known or not, and kept exactly as written.
  if (typeId !== undefined && (typeof typeId !== "string" || typeId === "")) fail(`Box "${id}" has an invalid type.`);
  if (technology !== undefined && typeof technology !== "string") fail(`Box "${id}" has an invalid technology.`);
  if (description !== undefined && typeof description !== "string") fail(`Box "${id}" has an invalid description.`);
  if (!isObject(position) || !isFiniteNumber(position.x) || !isFiniteNumber(position.y)) {
    fail(`Box "${id}" has an invalid position.`);
  }
  if (externals !== undefined) {
    const valid =
      isObject(externals) &&
      Object.values(externals).every((p) => isObject(p) && isFiniteNumber(p.x) && isFiniteNumber(p.y));
    if (!valid) fail(`Box "${id}" has invalid places for external boxes.`);
  }
  if (!Array.isArray(children)) fail(`Box "${id}" is missing its children list.`);
  if (!Array.isArray(edges)) fail(`Box "${id}" is missing its connections list.`);

  const node: BoxNode = { id, parentId, title, position: { x: position.x, y: position.y } };
  if (typeId !== undefined) node.typeId = typeId;
  if (technology !== undefined) node.technology = technology;
  if (description !== undefined) node.description = description;
  if (externals !== undefined) {
    const spots = externals as Record<string, { x: number; y: number }>;
    node.externals = Object.fromEntries(Object.entries(spots).map(([key, p]) => [key, { x: p.x, y: p.y }]));
  }
  return node;
}

function readEdge(raw: unknown, canvasId: NodeId, nodes: Record<NodeId, BoxNode>, where: string): Edge {
  if (!isObject(raw)) fail(`Connection at ${where} is not an object.`);
  const { id, from, to, typeId, label } = raw;
  if (typeof id !== "string" || id === "") fail(`Connection at ${where} has no id.`);
  const exists = (end: unknown): end is NodeId => typeof end === "string" && !!nodes[end];
  if (!exists(from) || !exists(to)) fail(`Connection "${id}" must join two boxes in this file.`);
  // Same rules as connecting in the editor; the root id is unused by them.
  const diagram: Diagram = { rootId: canvasId, nodes, edges: {} };
  const problem = connectionProblem(diagram, from, to);
  if (problem) fail(`Connection "${id}" is invalid: ${problem.toLowerCase()}.`);
  // Each connection is stored on the deepest box containing both ends.
  if (lowestCommonAncestor(diagram, from, to) !== canvasId) {
    fail(`Connection "${id}" is stored in the wrong box.`);
  }
  // Like box types: any non-empty string, known or not, kept exactly as written.
  if (typeId !== undefined && (typeof typeId !== "string" || typeId === "")) {
    fail(`Connection "${id}" has an invalid type.`);
  }
  if (label !== undefined && typeof label !== "string") fail(`Connection "${id}" has an invalid label.`);

  const edge: Edge = { id, parentId: canvasId, from, to };
  if (typeId !== undefined) edge.typeId = typeId;
  if (label !== undefined) edge.label = label;
  return edge;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fail(message: string): never {
  throw new FileFormatError(message);
}
