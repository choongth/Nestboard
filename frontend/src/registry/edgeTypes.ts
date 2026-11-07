// Built-in connection types: what kind of link a line is (see docs/FEATURES.md
// and box-type-specs.md §8). Ids are part of the file format: add new ones
// freely, but never rename or remove one. To rename, change only the label.
//
// Every type has its own line style, so types can be told apart without
// colour. Direction convention: a line runs from the box doing the verb to
// the other box ("Reads from": reader → store), and arrowheads show which way
// the data or the request travels.

import { createRegistry, type CategoryDefinition, type ObjectTypeDefinition } from "./registry";

/** What sits at one end of a line. */
export type LineEnd = "none" | "arrow" | "open-arrow" | "dot";

export interface LineStyle {
  stroke: "solid" | "dashed" | "long-dashed" | "dotted" | "double";
  /** Whether the dashes move along the line, and how fast. */
  flow: "none" | "normal" | "fast";
  /** At the `from` end and the `to` end. */
  start: LineEnd;
  end: LineEnd;
}

export interface EdgeTypeDefinition extends ObjectTypeDefinition {
  /** Shown on the line's label: "Calls", "Reads from"… */
  verb: string;
  style: LineStyle;
}

/** Lines without a type are this one; also shown for unknown ids. */
export const GENERIC_EDGE_TYPE_ID = "generic";

// Colours are for the type's icon in pickers and labels (dark theme only);
// lines themselves keep the connection colour.
const categories: CategoryDefinition[] = [
  { id: "general", label: "General", color: "#94a3b8", order: 1 },
  { id: "communication", label: "Communication", color: "#818cf8", order: 2 },
  { id: "data", label: "Data", color: "#34d399", order: 3 },
];

const style = (stroke: LineStyle["stroke"], start: LineEnd, end: LineEnd, flow: LineStyle["flow"] = "none"): LineStyle => ({
  stroke,
  flow,
  start,
  end,
});

const types: EdgeTypeDefinition[] = [
  // General: today's look, so existing diagrams do not change.
  {
    id: GENERIC_EDGE_TYPE_ID,
    label: "Connection",
    verb: "Connects to",
    categoryId: "general",
    icon: "link-2",
    style: style("dashed", "none", "arrow", "normal"),
  },

  // Communication
  {
    id: "request",
    label: "Calls (sync request)",
    verb: "Calls",
    categoryId: "communication",
    icon: "phone-call",
    style: style("solid", "none", "arrow"),
  },
  {
    id: "async-message",
    label: "Sends message / event",
    verb: "Sends to",
    categoryId: "communication",
    icon: "mail",
    style: style("dashed", "none", "open-arrow"),
  },
  {
    id: "publish",
    label: "Publishes to",
    verb: "Publishes to",
    categoryId: "communication",
    icon: "send",
    style: style("dashed", "dot", "arrow"),
  },
  {
    // Drawn consumer → topic; the arrow points back at the consumer, which receives.
    id: "subscribe",
    label: "Consumes from",
    verb: "Consumes from",
    categoryId: "communication",
    icon: "inbox",
    style: style("dashed", "arrow", "none"),
  },
  {
    id: "stream",
    label: "Streams to (real-time)",
    verb: "Streams to",
    categoryId: "communication",
    icon: "radio",
    style: style("long-dashed", "none", "arrow", "fast"),
  },

  // Data: all dotted, told apart by their arrowheads.
  {
    // Drawn reader → store; the arrow points back at the reader, which receives.
    id: "read",
    label: "Reads from",
    verb: "Reads from",
    categoryId: "data",
    icon: "book-open",
    style: style("dotted", "arrow", "none"),
  },
  {
    id: "write",
    label: "Writes to",
    verb: "Writes to",
    categoryId: "data",
    icon: "pencil",
    style: style("dotted", "none", "arrow"),
  },
  {
    id: "read-write",
    label: "Reads & writes",
    verb: "Reads & writes",
    categoryId: "data",
    icon: "file-pen",
    style: style("dotted", "arrow", "arrow"),
  },
  {
    id: "replication",
    label: "Replicates to",
    verb: "Replicates to",
    categoryId: "data",
    icon: "copy",
    style: style("double", "none", "arrow"),
  },
];

export const edgeTypes = createRegistry(categories, types, GENERIC_EDGE_TYPE_ID);
