// Where external boxes are placed. The far ends of connections leaving this
// canvas are always shown, and never move by themselves: where the user has
// put them (saved with the diagram, see BoxNode.externals), or else in a
// column right of the canvas's own boxes. While a line is being dragged from
// a box, one "External box…" placeholder appears on the side the line is
// pulled from; dropping on it opens a list of the boxes on other levels, and
// the one picked takes the placeholder's place.
//
// The server's PDF export draws canvases at rest the same way: keep
// server/app/pdf_export/canvas.py in step (src/serverFiles.test.ts checks).

import { connectionsOn } from "@/model/lift";
import { getChildrenBounds } from "@/model/queries";
import { BOX_HEIGHT, BOX_WIDTH, type Diagram, type NodeId, type Position } from "@/model/types";
import type { Side } from "./edgeGeometry";

export const EXTERNAL_WIDTH = 200;
export const EXTERNAL_HEIGHT = 72;
const GAP = 24;
/** Space between the canvas's own boxes and the external ones. */
const MARGIN = 160;

export interface ExternalBox {
  id: NodeId;
  position: Position;
}

/** The `i`-th place in a column left or right of the canvas's boxes, or in a row above or below them. */
function place(diagram: Diagram, canvasId: NodeId, i: number, side: Side): Position {
  const b = getChildrenBounds(diagram, canvasId) ?? { x: 0, y: 0, width: BOX_WIDTH, height: BOX_HEIGHT };
  const down = b.y + i * (EXTERNAL_HEIGHT + GAP);
  const across = b.x + i * (EXTERNAL_WIDTH + GAP);
  switch (side) {
    case "right":
      return { x: b.x + b.width + MARGIN, y: down };
    case "left":
      return { x: b.x - MARGIN - EXTERNAL_WIDTH, y: down };
    case "bottom":
      return { x: across, y: b.y + b.height + MARGIN };
    case "top":
      return { x: across, y: b.y - MARGIN - EXTERNAL_HEIGHT };
  }
}

/** The far ends of the connections leaving a canvas, nearest level first; none at the root. */
export function externalIds(diagram: Diagram, canvasId: NodeId): NodeId[] {
  return [...new Set(connectionsOn(diagram, canvasId).external.map((e) => e.outside))];
}

/** Ones the user has not put anywhere fill the column on the right in turn. */
export function externalBoxes(diagram: Diagram, canvasId: NodeId): ExternalBox[] {
  const saved = diagram.nodes[canvasId]?.externals ?? {};
  let next = 0;
  return externalIds(diagram, canvasId).map((id) => {
    const spot = saved[id];
    return { id, position: spot ? { ...spot } : place(diagram, canvasId, next++, "right") };
  });
}

/** Where the "External box…" placeholder goes for a line pulled from `side`: on the right, after the column. */
export function placeholderSpot(diagram: Diagram, canvasId: NodeId, side: Side): Position {
  const saved = diagram.nodes[canvasId]?.externals ?? {};
  const inColumn = side === "right" ? externalIds(diagram, canvasId).filter((id) => !saved[id]).length : 0;
  return place(diagram, canvasId, inColumn, side);
}
