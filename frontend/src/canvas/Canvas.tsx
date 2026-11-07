import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  type Position,
  ReactFlow,
  SelectionMode,
  useConnection,
  useReactFlow,
  useStoreApi,
  type IsValidConnection,
  type NodeChange,
  type OnConnectEnd,
  type OnNodeDrag,
  type XYPosition,
  ViewportPortal,
} from "@xyflow/react";
import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  MousePointerClick,
  Plus,
  Scissors,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { ContextMenu } from "radix-ui";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ConnectToMenu } from "@/components/ConnectToMenu";
import { MOD } from "@/components/keys";
import { reportCursor, reportDragging } from "@/files/presence";
import { connectionsOn } from "@/model/lift";
import { can, canConnect, canEditSomething } from "@/model/rights";
import { boxTitles, childrenIndex, getChildCount, getPath, joinPath } from "@/model/queries";
import { BOX_HEIGHT, BOX_WIDTH, type Diagram, type NodeId, type Position as Spot } from "@/model/types";
import { inChargeOf, useAccessStore } from "@/store/accessStore";
import { useDiagramStore } from "@/store/diagramStore";
import { useCurrentCanvasId } from "@/store/hooks";
import { others, presenceColor, usePresenceStore } from "@/store/presenceStore";
import { selectedBoxIds, useViewStore } from "@/store/viewStore";
import { snapToGuides, SNAP_DISTANCE, type Gap, type Guide } from "./alignment";
import { BoxNode, type BoxFlowNode } from "./BoxNode";
import {
  copySelectionToClipboard,
  cutSelectionToClipboard,
  duplicateSelection,
  hasCopied,
  pasteCopied,
} from "./clipboard";
import { deleteSelection } from "./deleteSelection";
import { ConnectionEdge, type ConnectionFlowEdge } from "./ConnectionEdge";
import type { Side } from "./edgeGeometry";
import {
  ExternalBoxNode,
  PLACEHOLDER_ID,
  PlaceholderNode,
  type ExternalFlowNode,
  type PlaceholderFlowNode,
} from "./ExternalBoxNode";
import { LineMarkers } from "./LineMarkers";
import { EXTERNAL_HEIGHT, EXTERNAL_WIDTH, externalBoxes, externalIds, placeholderSpot } from "./externalLayout";
import { STAGE_ATTR, useNavigation } from "./navigation";
import { RemoteCursors } from "./RemoteCursors";

type FlowNode = BoxFlowNode | ExternalFlowNode | PlaceholderFlowNode;

const nodeTypes = { box: BoxNode, external: ExternalBoxNode, placeholder: PlaceholderNode };
const edgeTypes = { connection: ConnectionEdge };


// Per-node state React Flow needs that is not part of the document: its
// measured size, and its position while a drag is in progress.
type Live = Record<NodeId, { measured?: { width: number; height: number }; dragging?: XYPosition }>;

const isValidConnection: IsValidConnection = (c) => c.source !== c.target;

/** How far from the canvas edge the "External box…" placeholder is brought into view, in screen pixels. */
const PAN_MARGIN = 24;

/** React Flow's handle position as one of our sides. */
const toSide = (position: Position): Side => position as Side;

export function Canvas() {
  const canvasId = useCurrentCanvasId();
  const diagram = useDiagramStore((s) => s.diagram);
  const addBox = useDiagramStore((s) => s.addBox);
  const moveBoxes = useDiagramStore((s) => s.moveBoxes);
  const placeExternals = useDiagramStore((s) => s.placeExternals);
  const addConnection = useDiagramStore((s) => s.addConnection);
  const selection = useViewStore((s) => s.selection);
  const select = useViewStore((s) => s.select);
  const selectBoxes = useViewStore((s) => s.selectBoxes);
  const highlight = useViewStore((s) => s.highlight);
  const { screenToFlowPosition } = useReactFlow();
  const { enter, exitTo, reveal } = useNavigation();
  // While a line is being dragged from a box, an "External box…" placeholder
  // appears on the side it is pulled from, for connecting to any box on
  // another level (see externalLayout.ts). Not from an external box: both
  // ends would be outside this level.
  const connecting = useConnection((c) => c.inProgress);
  const pullSide = useConnection((c): Side | null =>
    c.inProgress && c.fromNode.type !== "external" ? toSide(c.fromHandle.position) : null,
  );
  const isRoot = canvasId === diagram.rootId;
  const canvasTitle = diagram.nodes[canvasId]?.title ?? "";
  // What you may change here: boxes you can't edit are locked, and boxes on
  // a canvas you can't edit stay where they are.
  const rights = useAccessStore((s) => s.rights);
  const grants = useAccessStore((s) => s.grants);
  const diagramId = useAccessStore((s) => s.diagramId);
  const inCharge = useMemo(() => inChargeOf(grants, diagramId), [grants, diagramId]);
  const canvasEditable = can(rights, diagram, canvasId, "editor");
  const connectable = canEditSomething(rights);

  const [live, setLive] = useState<Live>({});
  const { watchers, remoteDragging } = useOthersOn(canvasId);

  // Boxes this tab is dragging, for the others to watch move (see files/presence.ts).
  useEffect(() => {
    const moving = Object.entries(live).flatMap(([id, l]) => (l.dragging ? [[id, l.dragging] as const] : []));
    reportDragging(moving.length > 0 ? Object.fromEntries(moving) : null);
  }, [live]);

  const selectedBoxes = useMemo(() => new Set(selectedBoxIds(selection)), [selection]);

  const nodes = useMemo<BoxFlowNode[]>(() => {
    const children = childrenIndex(diagram);
    return (children.get(canvasId) ?? []).map((n) => ({
      id: n.id,
      type: "box",
      // Being dragged here, or by someone else (until they let go).
      position: live[n.id]?.dragging ?? remoteDragging[n.id] ?? n.position,
      width: BOX_WIDTH,
      height: BOX_HEIGHT,
      measured: live[n.id]?.measured,
      selected: selectedBoxes.has(n.id),
      draggable: canvasEditable,
      data: {
        title: n.title,
        typeId: n.typeId,
        technology: n.technology,
        childCount: children.get(n.id)?.length ?? 0,
        highlightKey: highlight?.ids.has(n.id) ? highlight.key : undefined,
        locked: !can(rights, diagram, n.id, "editor"),
        inCharge: inCharge[n.id],
        connectable,
        watchers: watchers.get(n.id),
      },
    }));
  }, [
    diagram,
    canvasId,
    selectedBoxes,
    live,
    highlight,
    canvasEditable,
    rights,
    inCharge,
    connectable,
    watchers,
    remoteDragging,
  ]);

  // Boxes from the levels around this one that this level connects to.
  const externals = useMemo<ExternalFlowNode[]>(
    () =>
      externalBoxes(diagram, canvasId).map(({ id, position }) => {
        const n = diagram.nodes[id]!;
        return {
          id,
          type: "external",
          position: live[id]?.dragging ?? remoteDragging[id] ?? position,
          width: EXTERNAL_WIDTH,
          height: EXTERNAL_HEIGHT,
          measured: live[id]?.measured,
          // Whoever edits this level may move them about.
          draggable: canvasEditable,
          selected: selectedBoxes.has(id),
          data: {
            title: n.title,
            typeId: n.typeId,
            location: externalLocation(diagram, id),
            highlightKey: highlight?.ids.has(id) ? highlight.key : undefined,
          },
        };
      }),
    [diagram, canvasId, selectedBoxes, live, highlight, canvasEditable, remoteDragging],
  );

  // Connecting outside this level is for whoever edits it (see canConnect).
  const placeholder = useMemo<PlaceholderFlowNode | null>(
    () =>
      pullSide && !isRoot && canvasEditable
        ? {
            id: PLACEHOLDER_ID,
            type: "placeholder",
            position: placeholderSpot(diagram, canvasId, pullSide),
            width: EXTERNAL_WIDTH,
            height: EXTERNAL_HEIGHT,
            draggable: false,
            selectable: false,
            data: {},
          }
        : null,
    [diagram, canvasId, pullSide, isRoot, canvasEditable],
  );
  const allNodes = useMemo<FlowNode[]>(
    () => [...nodes, ...externals, ...(placeholder ? [placeholder] : [])],
    [nodes, externals, placeholder],
  );

  // When the placeholder appears for a drag, pan just enough to bring it on
  // screen (it can land past the edge, e.g. above boxes that fill it).
  const rf = useStoreApi();
  const { getViewport, setViewport } = useReactFlow();
  useEffect(() => {
    if (!placeholder) return;
    const { zoom, x, y } = getViewport();
    const { width, height } = rf.getState();
    const left = placeholder.position.x * zoom + x;
    const top = placeholder.position.y * zoom + y;
    const right = (placeholder.position.x + EXTERNAL_WIDTH) * zoom + x;
    const bottom = (placeholder.position.y + EXTERNAL_HEIGHT) * zoom + y;
    const shift = (lo: number, hi: number, size: number) =>
      lo < PAN_MARGIN ? PAN_MARGIN - lo : hi > size - PAN_MARGIN ? size - PAN_MARGIN - hi : 0;
    const dx = shift(left, right, width);
    const dy = shift(top, bottom, height);
    if (dx !== 0 || dy !== 0) void setViewport({ x: x + dx, y: y + dy, zoom }, { duration: 200 });
    // Only when a drag starts or changes side, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connecting, pullSide]);

  // Lines between boxes on this canvas, including lines between deeper boxes,
  // lifted to the boxes here that contain their ends.
  const edges = useMemo<ConnectionFlowEdge[]>(() => {
    const { lines, external } = connectionsOn(diagram, canvasId);
    // Lines leaving this level are drawn to an external box for their far end.
    const leaving = external.map((e) => ({
      edgeId: e.edgeId,
      from: e.direction === "out" ? e.inside : e.outside,
      to: e.direction === "out" ? e.outside : e.inside,
      lifted: e.lifted,
      parallel: e.parallel,
    }));
    return [...lines, ...leaving].map((line) => {
        const edge = diagram.edges[line.edgeId]!;
        const selected = selection?.type === "connection" && selection.id === edge.id;
        return {
          id: edge.id,
          type: "connection",
          source: line.from,
          target: line.to,
          selected,
          // Lifted lines are a summary of deeper detail: drawn fainter until selected.
          className: line.lifted && !selected ? "nb-lifted" : undefined,
          data: {
            label: edge.label,
            typeId: edge.typeId,
            parallel: line.parallel,
            lifted: line.lifted,
            highlightKey: highlight?.ids.has(edge.id) ? highlight.key : undefined,
          },
        };
      });
  }, [diagram, canvasId, selection, highlight]);

  // True while a selection rectangle is being dragged (Shift + drag on the background).
  const selecting = useRef(false);

  // Alignment while dragging: the guides and equal gaps on screen, the shift last applied to
  // the dragged boxes, and whether Alt is held (which turns snapping off).
  const [guides, setGuides] = useState<{ guides: Guide[]; gaps: Gap[] }>(NO_GUIDES);
  const snapShift = useRef({ x: 0, y: 0 });
  const snapOff = useRef(false);
  useEffect(() => {
    const track = (event: PointerEvent) => {
      snapOff.current = event.altKey;
    };
    window.addEventListener("pointermove", track, { capture: true });
    return () => window.removeEventListener("pointermove", track, { capture: true });
  }, []);

  // Selection and removal are driven by our own stores, so only size and
  // in-progress drag updates are taken from React Flow, plus which boxes a
  // selection rectangle covers while one is being dragged.
  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    if (selecting.current) {
      const { nodes } = useDiagramStore.getState().diagram;
      const view = useViewStore.getState();
      const ids = new Set(selectedBoxIds(view.selection));
      let touched = false;
      for (const c of changes) {
        // External boxes live on other levels and are never part of it.
        if (c.type !== "select" || nodes[c.id]?.parentId !== canvasId) continue;
        if (c.selected) ids.add(c.id);
        else ids.delete(c.id);
        touched = true;
      }
      if (touched) view.selectBoxes([...ids]);
    }

    // Boxes being dragged snap into line with the others on this level (see
    // alignment.ts). React Flow keeps tracking the pointer unsnapped, so the
    // shift is applied here, and again when the drag ends.
    const moves = changes.flatMap((c) =>
      c.type === "position" && c.position && c.dragging ? [{ id: c.id, position: c.position }] : [],
    );
    let shift = { x: 0, y: 0 };
    const { nodes } = useDiagramStore.getState().diagram;
    // External boxes (from other levels) are moved freely, without snapping.
    if (moves.length > 0 && moves.every((m) => nodes[m.id]?.parentId === canvasId)) {
      const dragged = new Set(moves.map((c) => c.id));
      const at = moves.map((c) => c.position);
      const x = Math.min(...at.map((p) => p.x));
      const y = Math.min(...at.map((p) => p.y));
      const moving = {
        x,
        y,
        width: Math.max(...at.map((p) => p.x)) + BOX_WIDTH - x,
        height: Math.max(...at.map((p) => p.y)) + BOX_HEIGHT - y,
      };
      const others = Object.values(nodes)
        .filter((n) => n.parentId === canvasId && !dragged.has(n.id))
        .map((n) => ({ ...n.position, width: BOX_WIDTH, height: BOX_HEIGHT }));
      const zoom = rf.getState().transform[2];
      const snap = snapOff.current ? { offset: shift, ...NO_GUIDES } : snapToGuides(moving, others, SNAP_DISTANCE / zoom);
      shift = snap.offset;
      snapShift.current = shift;
      setGuides({ guides: snap.guides, gaps: snap.gaps });
    }

    setLive((prev) => {
      let next = prev;
      for (const c of changes) {
        if (c.type === "dimensions" && c.dimensions) {
          next = { ...next, [c.id]: { ...next[c.id], measured: c.dimensions } };
        } else if (c.type === "position" && c.position && c.dragging) {
          const dragging = { x: c.position.x + shift.x, y: c.position.y + shift.y };
          next = { ...next, [c.id]: { ...next[c.id], dragging } };
        }
      }
      return next;
    });
  }, [canvasId, rf]);

  // Dragging a selected box moves every selected box with it, as one undo step.
  // An external box dropped somewhere stays there (saved with this canvas).
  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback(
    (_event, _node, dragged) => {
      const { x, y } = snapShift.current;
      snapShift.current = { x: 0, y: 0 };
      setGuides(NO_GUIDES);
      const boxes = dragged.filter((n) => n.type !== "external");
      const externals = dragged.filter((n) => n.type === "external");
      if (boxes.length > 0) {
        moveBoxes(Object.fromEntries(boxes.map((n) => [n.id, { x: n.position.x + x, y: n.position.y + y }])));
      }
      if (externals.length > 0) {
        placeExternals(canvasId, Object.fromEntries(externals.map((n) => [n.id, { ...n.position }])));
      }
      setLive((prev) => {
        const next = { ...prev };
        for (const n of dragged) next[n.id] = { ...next[n.id], dragging: undefined };
        return next;
      });
    },
    [moveBoxes, placeExternals, canvasId],
  );

  // Shift / Ctrl / ⌘ + click adds a box to the selection or takes it out.
  // External boxes are always selected on their own.
  const onNodeClick = useCallback(
    (event: MouseEvent, node: FlowNode) => {
      const adding = (event.shiftKey || event.ctrlKey || event.metaKey) && node.type !== "external";
      if (!adding) {
        selectBoxes([node.id]);
        return;
      }
      const { nodes } = useDiagramStore.getState().diagram;
      const current = selectedBoxIds(useViewStore.getState().selection).filter((id) => nodes[id]?.parentId === canvasId);
      selectBoxes(current.includes(node.id) ? current.filter((id) => id !== node.id) : [...current, node.id]);
    },
    [canvasId, selectBoxes],
  );

  /**
   * `spot`: where `to` goes when it becomes a new external box here. One
   * already shown keeps its place; nothing moves by itself.
   */
  const connect = useCallback(
    (from: NodeId, to: NodeId, spot?: Spot) => {
      const current = useDiagramStore.getState().diagram;
      const outside = !getPath(current, to).some((n) => n.id === canvasId);
      const place =
        spot && outside && canvasEditable && !externalIds(current, canvasId).includes(to)
          ? { canvasId, position: spot }
          : undefined;
      const id = addConnection(from, to, place);
      select({ type: "connection", id }, { focus: true });
    },
    [addConnection, select, canvasId, canvasEditable],
  );

  const mayConnect = useCallback(
    (from: NodeId) => (to: NodeId) => canConnect(rights, useDiagramStore.getState().diagram, from, to),
    [rights],
  );

  // A box with boxes inside, or the placeholder (`into: null`), asks which
  // box to connect to (see ConnectToMenu). `spot`: where the box picked goes.
  const [connectTo, setConnectTo] = useState<{
    from: NodeId;
    into: NodeId | null;
    at: XYPosition;
    side: Side;
    spot: Spot;
    allowed: (to: NodeId) => boolean;
  } | null>(null);

  // A line dropped on a box (on one of its points or anywhere on it): connect
  // straight away when the box is empty; when it holds boxes, ask whether to
  // connect to it or to one inside it. Dropped on the placeholder: ask which
  // box on another level. Dropped on empty canvas: nothing.
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      if (!state.fromNode) return;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      if (!point) return;
      const target =
        state.isValid && state.toNode
          ? state.toNode.id
          : document.elementFromPoint(point.clientX, point.clientY)?.closest<HTMLElement>(".react-flow__node")?.dataset
              .id;
      if (!target || target === state.fromNode.id) return;
      const from = state.fromNode.id;
      // The list opens on the side the line was pulled from.
      const side = state.fromHandle ? toSide(state.fromHandle.position) : "bottom";
      const current = useDiagramStore.getState().diagram;
      const at = { x: point.clientX, y: point.clientY };
      if (target === PLACEHOLDER_ID) {
        const spot = placeholderSpot(current, canvasId, side);
        setConnectTo({ from, into: null, at, side, spot, allowed: mayConnect(from) });
        return;
      }
      // A box picked from inside an external box goes where the line was let go.
      const dropped = screenToFlowPosition(at);
      const spot = { x: Math.round(dropped.x - EXTERNAL_WIDTH / 2), y: Math.round(dropped.y - EXTERNAL_HEIGHT / 2) };
      if (getChildCount(current, target) === 0) connect(from, target);
      else setConnectTo({ from, into: target, at, side, spot, allowed: mayConnect(from) });
    },
    [connect, canvasId, mayConnect, screenToFlowPosition],
  );

  // Where the context menu was opened, in canvas coordinates.
  const menuAt = useRef<XYPosition>({ x: 0, y: 0 });

  // Which menu the right-click opens: the canvas's, or the one for the selected boxes.
  const [menuFor, setMenuFor] = useState<"canvas" | "boxes">("canvas");

  const onContextMenu = (event: MouseEvent) => {
    const target = event.target as Element;
    // A box's menu acts on the selection: on all of it when the box is in it,
    // or else on that box alone, which it selects first.
    const box = target.closest<HTMLElement>(".react-flow__node-box");
    if (box?.dataset.id) {
      const id = box.dataset.id;
      if (!selectedBoxIds(useViewStore.getState().selection).includes(id)) selectBoxes([id]);
      setMenuFor("boxes");
      return;
    }
    // External boxes (they live on another level) and connections have no menu.
    if (target.closest(".react-flow__node, .react-flow__edge, .react-flow__edgelabel-renderer")) {
      event.preventDefault();
      return;
    }
    setMenuFor("canvas");
    menuAt.current = screenToFlowPosition({ x: event.clientX, y: event.clientY });
  };

  const createBox = () => {
    const { x, y } = menuAt.current;
    const id = addBox(canvasId, { x: Math.round(x - BOX_WIDTH / 2), y: Math.round(y - BOX_HEIGHT / 2) });
    selectBoxes([id], { focus: true });
  };

  return (
    // Non-modal so its focus trap does not pull focus back from the new
    // box's name field while the menu is still closing.
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger asChild onContextMenu={onContextMenu}>
        <div
          {...{ [STAGE_ATTR]: "" }}
          className="absolute inset-0"
          // React Flow keeps canvas presses to itself, so the "Connect to…"
          // list never hears about them; close it here instead. The list is
          // drawn outside this element, so presses inside it are not affected.
          onPointerDownCapture={(event) => {
            if (connectTo && event.currentTarget.contains(event.target as Node)) setConnectTo(null);
          }}
          // Where the pointer is, for the others to see (see files/presence.ts).
          onPointerMove={(event) => reportCursor(screenToFlowPosition({ x: event.clientX, y: event.clientY }))}
          onPointerLeave={() => reportCursor(null)}
          onDoubleClick={(event) => {
            // Only the empty background, not boxes or controls, goes up a level.
            if ((event.target as Element).classList.contains("react-flow__pane")) void exitTo();
          }}
        >
          <ReactFlow<FlowNode, ConnectionFlowEdge>
            nodes={allNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            // Dragging a box does not select it; dragging a selected one moves the whole selection.
            selectNodesOnDrag={false}
            // Shift + drag on the background draws a selection rectangle; a
            // plain drag still pans. Boxes it touches are selected.
            selectionKeyCode="Shift"
            selectionMode={SelectionMode.Partial}
            onSelectionStart={() => {
              selecting.current = true;
              select(null);
            }}
            onSelectionEnd={() => {
              selecting.current = false;
            }}
            // Ctrl / ⌘ + click adds to the selection (see onNodeClick).
            multiSelectionKeyCode={["Control", "Meta"]}
            // An external box lives on another level: double-click goes there.
            onNodeDoubleClick={(_event, node) => void (node.type === "external" ? reveal(node.id) : enter(node.id))}
            onEdgeClick={(_event, edge) => select({ type: "connection", id: edge.id })}
            onPaneClick={() => select(null)}
            // Any of a box's four points can start or end a connection.
            connectionMode={ConnectionMode.Loose}
            connectionRadius={28}
            isValidConnection={isValidConnection}
            onConnectEnd={onConnectEnd}
            // Double-click on the background is reserved for "go up one level".
            zoomOnDoubleClick={false}
            // Delete / Backspace are handled by useSelectionShortcuts, which asks first when needed.
            deleteKeyCode={null}
            attributionPosition="bottom-left"
            minZoom={0.1}
            maxZoom={2}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="var(--color-canvas-dot)" />
            <AlignmentGuides {...guides} />
            <RemoteCursors level={canvasId} />
          </ReactFlow>

          <LineMarkers />
          {nodes.length === 0 && <EmptyHint insideTitle={isRoot ? undefined : canvasTitle} />}

          {connectTo && (
            <ConnectToMenu
              diagram={diagram}
              from={connectTo.from}
              into={connectTo.into}
              canvasId={canvasId}
              allowed={connectTo.allowed}
              at={connectTo.at}
              side={connectTo.side}
              onClose={() => setConnectTo(null)}
              onPick={(to) => {
                setConnectTo(null);
                connect(connectTo.from, to, connectTo.spot);
              }}
            />
          )}
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content
          // Likewise, do not refocus the canvas on close.
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="min-w-44 rounded-lg border border-line bg-surface-raised p-1 shadow-xl shadow-black/40"
        >
          {menuFor === "boxes" ? (
            <>
              <MenuItem icon={Scissors} label="Cut" shortcut={`${MOD}X`} onSelect={cutSelectionToClipboard} />
              <MenuItem icon={Copy} label="Copy" shortcut={`${MOD}C`} onSelect={copySelectionToClipboard} />
              <MenuItem icon={CopyPlus} label="Duplicate" shortcut={`${MOD}D`} onSelect={duplicateSelection} />
              <ContextMenu.Separator className="my-1 h-px bg-line" />
              <MenuItem icon={Trash2} label="Delete" shortcut="Del" danger onSelect={deleteSelection} />
            </>
          ) : (
            <>
              {canvasEditable ? (
                <>
                  <MenuItem icon={Plus} label="New box" onSelect={createBox} />
                  <PasteItem onSelect={() => pasteCopied(canvasId, menuAt.current)} />
                </>
              ) : (
                <p className="max-w-56 px-2 py-1.5 text-xs leading-relaxed text-fg-subtle">
                  You can look here but not add boxes: ask an owner of {isRoot ? "the project" : `“${canvasTitle}”`}.
                </p>
              )}
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/**
 * Where an external box lives, as a path ending at it: "Finance › Ledger".
 * The root is left out, except for top-level boxes ("Root › Users"), whose
 * path would otherwise just repeat their name.
 */
function externalLocation(diagram: Diagram, id: NodeId): string {
  const path = boxTitles(diagram, id);
  return joinPath(path.length > 1 ? path : [diagram.nodes[diagram.rootId]!.title, ...path]);
}

const NO_GUIDES: { guides: Guide[]; gaps: Gap[] } = { guides: [], gaps: [] };

export interface Watcher {
  name: string;
  color: string;
}

/**
 * What others on this level are doing with its boxes: who has which selected
 * (or is dragging it), and where boxes being dragged are now. Their pointers
 * moving is no reason to redraw the boxes, so only these are compared.
 */
function useOthersOn(level: NodeId) {
  const key = usePresenceStore((s) =>
    JSON.stringify(
      others(s).flatMap((p) => {
        if (p.level !== level) return [];
        const selected = p.selection?.type === "boxes" ? p.selection.ids : [];
        const ids = [...new Set([...selected, ...Object.keys(p.dragging ?? {})])];
        return [{ name: p.name, color: p.color, ids, dragging: p.dragging }];
      }),
    ),
  );
  return useMemo(() => {
    const watchers = new Map<NodeId, Watcher[]>();
    const remoteDragging: Record<NodeId, XYPosition> = {};
    type Doing = { name: string; color: number; ids: NodeId[]; dragging: Record<NodeId, XYPosition> | null };
    const people = JSON.parse(key) as Doing[];
    for (const person of people) {
      const watcher = { name: person.name, color: presenceColor(person.color) };
      for (const id of person.ids) watchers.set(id, [...(watchers.get(id) ?? []), watcher]);
      Object.assign(remoteDragging, person.dragging);
    }
    return { watchers, remoteDragging };
  }, [key]);
}
/** Half the length of the ticks closing each equal-gap marker, in canvas units. */
const GAP_TICK = 5;

/**
 * What a dragged box lines up with, drawn in canvas coordinates: a guide line
 * for each aligned edge or centre, and a marker with end ticks across each of
 * the equal gaps it is spaced by.
 */
function AlignmentGuides({ guides, gaps }: { guides: Guide[]; gaps: Gap[] }) {
  if (guides.length === 0 && gaps.length === 0) return null;
  // A segment along the gap's axis, or across it at `along`.
  const segment = (axis: "x" | "y", along: [number, number], at: number) =>
    axis === "x"
      ? { x1: along[0], x2: along[1], y1: at, y2: at }
      : { x1: at, x2: at, y1: along[0], y2: along[1] };
  const stroke = { stroke: "var(--color-accent)", strokeWidth: 1, vectorEffect: "non-scaling-stroke" } as const;
  // Gaps in their own colour and a little heavier, as they often lie along an alignment guide.
  const gapStroke = { ...stroke, stroke: "var(--color-spacing)", strokeWidth: 1.5 } as const;
  return (
    <ViewportPortal>
      <svg data-alignment-guides className="pointer-events-none absolute top-0 left-0 z-[2000] overflow-visible" width={1} height={1}>
        {guides.map((g) => (
          <line
            key={`${g.axis}${g.at}`}
            data-guide={g.axis}
            x1={g.axis === "x" ? g.at : g.from}
            x2={g.axis === "x" ? g.at : g.to}
            y1={g.axis === "x" ? g.from : g.at}
            y2={g.axis === "x" ? g.to : g.at}
            {...stroke}
          />
        ))}
        {gaps.map((g) => {
          const cross: "x" | "y" = g.axis === "x" ? "y" : "x";
          return (
            <g key={`${g.axis}${g.from}:${g.at}`} data-gap={g.axis}>
              <line {...segment(g.axis, [g.from, g.to], g.at)} {...gapStroke} />
              <line {...segment(cross, [g.at - GAP_TICK, g.at + GAP_TICK], g.from)} {...gapStroke} />
              <line {...segment(cross, [g.at - GAP_TICK, g.at + GAP_TICK], g.to)} {...gapStroke} />
            </g>
          );
        })}
      </svg>
    </ViewportPortal>
  );
}

/**
 * Pastes what was last copied in this tab. Mounted each time the menu opens,
 * so it is only enabled once something has been copied.
 */
function PasteItem({ onSelect }: { onSelect: () => void }) {
  return <MenuItem icon={ClipboardPaste} label="Paste" shortcut={`${MOD}V`} disabled={!hasCopied()} onSelect={onSelect} />;
}

function MenuItem({
  icon: Icon,
  label,
  shortcut,
  danger,
  disabled,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <ContextMenu.Item
      onSelect={onSelect}
      disabled={disabled}
      className={[
        "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none data-disabled:text-fg-subtle data-highlighted:bg-surface-hover",
        danger ? "text-danger" : "text-fg",
      ].join(" ")}
    >
      <Icon className="size-4" />
      {label}
      {shortcut && <span className="ml-auto pl-4 text-xs text-fg-subtle">{shortcut}</span>}
    </ContextMenu.Item>
  );
}

function EmptyHint({ insideTitle }: { insideTitle?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface/80 px-6 py-5 text-center backdrop-blur">
        <MousePointerClick className="size-6 text-accent" />
        <div>
          <p className="font-medium text-fg">
            {insideTitle ? <>Nothing inside “{insideTitle}” yet</> : "This canvas is empty"}
          </p>
          <p className="mt-1 text-fg-muted">Right-click anywhere to create a box.</p>
          {insideTitle && <p className="mt-1 text-fg-muted">Double-click the background or press Esc to go back.</p>}
        </div>
      </div>
    </div>
  );
}
