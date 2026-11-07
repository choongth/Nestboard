import { ArrowDown, Lock, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_BOX_TITLE } from "@/model/operations";
import { connectionsOn } from "@/model/lift";
import { boxTypes } from "@/registry/boxTypes";
import { edgeTypes } from "@/registry/edgeTypes";
import { boxTitles, joinPath } from "@/model/queries";
import { can, canConnect } from "@/model/rights";
import type { BoxNode, Diagram, Edge, NodeId } from "@/model/types";
import { useAccessStore } from "@/store/accessStore";
import { useDiagramStore } from "@/store/diagramStore";
import { useCurrentCanvasId } from "@/store/hooks";
import { singleSelectedBox, useViewStore } from "@/store/viewStore";
import { ArrangeTools } from "./ArrangeTools";
import { BoxAccess } from "./BoxAccess";
import { DeleteBoxesDialog } from "./DeleteBoxesDialog";
import { TechnologyField } from "./TechnologyField";
import { TextField } from "./TextField";
import { TypePicker } from "./TypePicker";
import { LinePreview } from "./LinePreview";

export function Sidebar() {
  const selection = useViewStore((s) => s.selection);
  const boxId = singleSelectedBox(selection);
  const box = useDiagramStore((s) => (boxId ? s.diagram.nodes[boxId] : undefined));
  const edge = useDiagramStore((s) => (selection?.type === "connection" ? s.diagram.edges[selection.id] : undefined));
  // Keyed so every field's local state resets when the selection changes.
  if (box) return <BoxPanel key={box.id} node={box} />;
  if (edge) return <ConnectionPanel key={edge.id} edge={edge} />;
  if (selection?.type === "boxes" && selection.ids.length > 1) return <MultiBoxPanel ids={selection.ids} />;
  return null;
}

/** Focuses the first field when the canvas asked for it (e.g. right after creating something). */
function useRequestedFocus(id: string) {
  const ref = useRef<HTMLInputElement>(null);
  const focusRequest = useViewStore((s) => s.focusRequest);
  const clearFocusRequest = useViewStore((s) => s.clearFocusRequest);
  useEffect(() => {
    if (focusRequest !== id) return;
    ref.current?.focus();
    ref.current?.select();
    clearFocusRequest();
  }, [focusRequest, id, clearFocusRequest]);
  return ref;
}

/** Can the user change this box, and delete it (which changes the box it sits in)? */
function useBoxRights(node: BoxNode) {
  const rights = useAccessStore((s) => s.rights);
  const diagram = useDiagramStore((s) => s.diagram);
  return { editable: can(rights, diagram, node.id, "editor"), deletable: can(rights, diagram, node.parentId, "editor") };
}

function BoxPanel({ node }: { node: BoxNode }) {
  const updateBox = useDiagramStore((s) => s.updateBox);
  const setBoxType = useDiagramStore((s) => s.setBoxType);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const titleRef = useRequestedFocus(node.id);
  const { editable, deletable } = useBoxRights(node);

  if (!editable) {
    return (
      <Panel heading="Box" footer={null}>
        <LockedNote>You can look at this box but not change it.</LockedNote>
        <ReadOnly label="Name" value={node.title} />
        <ReadOnly label="Type" value={boxTypes.resolve(node.typeId).type.label} />
        {node.technology && <ReadOnly label="Technology" value={node.technology} />}
        {node.description && <ReadOnly label="Description" value={node.description} />}
        <BoxAccess boxId={node.id} />
      </Panel>
    );
  }

  return (
    <Panel
      heading="Box"
      footer={deletable ? <DeleteButton label="Delete box" onClick={() => setConfirmOpen(true)} /> : null}
    >
      <TextField
        inputRef={titleRef}
        label="Name"
        value={node.title}
        placeholder={DEFAULT_BOX_TITLE}
        onChange={(title) => updateBox(node.id, { title })}
        // An empty name is not allowed; fall back to the default instead.
        onBeforeCommit={() => {
          if (!useDiagramStore.getState().diagram.nodes[node.id]?.title.trim()) {
            updateBox(node.id, { title: DEFAULT_BOX_TITLE });
          }
        }}
      />
      <TypePicker value={node.typeId} onChange={(typeId) => setBoxType(node.id, typeId)} />
      <TechnologyField node={node} />
      <TextField
        label="Description"
        value={node.description ?? ""}
        placeholder="What does it do?"
        multiline
        onChange={(v) => updateBox(node.id, { description: v || undefined })}
      />
      <BoxAccess boxId={node.id} />

      <DeleteBoxesDialog ids={[node.id]} open={confirmOpen} onOpenChange={setConfirmOpen} />
    </Panel>
  );
}

/** Several boxes selected: what they are, and deleting them together. */
function MultiBoxPanel({ ids }: { ids: readonly NodeId[] }) {
  const selectBoxes = useViewStore((s) => s.selectBoxes);
  const nodes = useDiagramStore((s) => s.diagram.nodes);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const boxes = ids.map((id) => nodes[id]).filter((n) => n !== undefined);

  return (
    <Panel
      heading={`${boxes.length} boxes`}
      footer={<DeleteButton label={`Delete ${boxes.length} boxes`} onClick={() => setConfirmOpen(true)} />}
    >
      <ArrangeTools ids={boxes.map((box) => box.id)} />
      <ul data-selected-boxes className="flex flex-col gap-1">
        {boxes.map((box) => (
          <li key={box.id}>
            <button
              type="button"
              onClick={() => selectBoxes([box.id])}
              title="Select only this box"
              className="w-full truncate rounded-md px-2 py-1.5 text-left font-medium text-fg hover:bg-surface-hover"
            >
              {box.title}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-relaxed text-fg-subtle">
        Drag any of them to move them together. Shift+click a box to add or remove it.
      </p>

      <DeleteBoxesDialog ids={ids} open={confirmOpen} onOpenChange={setConfirmOpen} />
    </Panel>
  );
}

function ConnectionPanel({ edge }: { edge: Edge }) {
  const select = useViewStore((s) => s.select);
  const setLabel = useDiagramStore((s) => s.setConnectionLabel);
  const setType = useDiagramStore((s) => s.setConnectionType);
  const deleteConnection = useDiagramStore((s) => s.deleteConnection);
  const diagram = useDiagramStore((s) => s.diagram);
  const canvasId = useCurrentCanvasId();
  const labelRef = useRequestedFocus(edge.id);
  // How the line is drawn on the canvas on screen: lifted when its ends are deeper.
  const shown = useMemo(() => {
    const { lines, external } = connectionsOn(diagram, canvasId);
    const line = lines.find((l) => l.edgeId === edge.id);
    if (line) return line;
    // Or drawn to an external box, when its far end is outside this level.
    const out = external.find((e) => e.edgeId === edge.id);
    if (!out) return undefined;
    const [from, to] = out.direction === "out" ? [out.inside, out.outside] : [out.outside, out.inside];
    return { from, to, lifted: out.lifted };
  }, [diagram, canvasId, edge.id]);
  // When it is not drawn here (e.g. just made from inside a box to a box
  // elsewhere): where it is drawn, on the box it is stored in.
  const drawnElsewhere = useMemo(
    () => (shown ? undefined : connectionsOn(diagram, edge.parentId).lines.find((l) => l.edgeId === edge.id)),
    [shown, diagram, edge.parentId, edge.id],
  );
  const title = (id: string) => diagram.nodes[id]?.title ?? "";
  const rights = useAccessStore((s) => s.rights);
  // A connection is yours to change if you may edit either end.
  const editable = canConnect(rights, diagram, edge.from, edge.to);

  if (!editable) {
    return (
      <Panel heading="Connection" footer={null}>
        <LockedNote>You can edit neither end of this connection, so you can't change it.</LockedNote>
        <div data-connection-ends className="flex flex-col gap-1 rounded-lg border border-line bg-canvas px-3 py-2">
          <ConnectionEnd diagram={diagram} id={edge.from} />
          <ArrowDown className="ml-0.5 size-4 shrink-0 text-connection" />
          <ConnectionEnd diagram={diagram} id={edge.to} />
        </div>
        <ReadOnly label="Type" value={edgeTypes.resolve(edge.typeId).type.label} />
        {edge.label && <ReadOnly label="Label" value={edge.label} />}
      </Panel>
    );
  }

  return (
    <Panel
      heading="Connection"
      footer={
        // Not confirmed: it removes nothing else, and undo brings it back.
        <DeleteButton
          label="Delete connection"
          onClick={() => {
            select(null);
            deleteConnection(edge.id);
          }}
        />
      }
    >
      <div data-connection-ends className="flex flex-col gap-1 rounded-lg border border-line bg-canvas px-3 py-2">
        <ConnectionEnd diagram={diagram} id={edge.from} />
        <ArrowDown className="ml-0.5 size-4 shrink-0 text-connection" />
        <ConnectionEnd diagram={diagram} id={edge.to} />
      </div>
      {shown?.lifted && (
        <p data-lifted-note className="text-xs leading-relaxed text-fg-subtle">
          Drawn here between {title(shown.from)} and {title(shown.to)}, which contain its ends.
        </p>
      )}
      {drawnElsewhere && (
        <p data-lifted-note className="text-xs leading-relaxed text-fg-subtle">
          Not drawn on this level: it is drawn on {title(edge.parentId)}, between {title(drawnElsewhere.from)} and{" "}
          {title(drawnElsewhere.to)}.
        </p>
      )}
      <TypePicker
        registry={edgeTypes}
        listLabel="Connection types"
        value={edge.typeId}
        onChange={(typeId) => setType(edge.id, typeId)}
        renderExtra={(type) => <LinePreview style={type.style} />}
      />
      <TextField
        inputRef={labelRef}
        label="Label"
        value={edge.label ?? ""}
        placeholder="e.g. Reads from, Sends events to"
        onChange={(label) => setLabel(edge.id, label)}
      />
    </Panel>
  );
}

/** One end of a connection: its title, after the boxes it is nested in (root left out). */
function ConnectionEnd({ diagram, id }: { diagram: Diagram; id: string }) {
  const path = diagram.nodes[id] ? boxTitles(diagram, id) : [];
  const containers = path.slice(0, -1);
  return (
    <div className="min-w-0 truncate">
      {containers.length > 0 && <span className="text-fg-subtle">{joinPath(containers)} › </span>}
      <span className="font-medium text-fg">{path.at(-1)}</span>
    </div>
  );
}

function LockedNote({ children }: { children: ReactNode }) {
  return (
    <p data-locked-note className="flex items-start gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-xs leading-relaxed text-fg-muted">
      <Lock className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <span className="break-words whitespace-pre-wrap text-fg">{value}</span>
    </div>
  );
}

function Panel({ heading, footer, children }: { heading: string; footer: ReactNode; children: ReactNode }) {
  const select = useViewStore((s) => s.select);
  return (
    <aside className="absolute top-3 right-3 bottom-3 z-10 flex w-80 flex-col rounded-xl border border-line bg-surface shadow-2xl shadow-black/40">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-xs font-semibold tracking-wider text-fg-subtle uppercase">{heading}</h2>
        <button
          type="button"
          onClick={() => select(null)}
          aria-label="Close"
          className="rounded-md p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">{children}</div>
      {footer && <footer className="border-t border-line p-3">{footer}</footer>}
    </aside>
  );
}

function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 font-medium text-danger hover:bg-danger/10"
    >
      <Trash2 className="size-4" />
      {label}
    </button>
  );
}
