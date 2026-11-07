// Opening, creating, renaming and deleting diagrams on the server, plus
// Import / Export of local JSON files. Edits save themselves as they are made
// (see liveDiagram.ts). UI-free, so the menu, the shortcuts and the address
// bar all share them.

import { ApiError } from "@/api/client";
import { addDiscard } from "@/app/unsavedWork";
import { deleteDiagram, exportDiagramPdf, renameDiagram, type Paper } from "@/api/diagrams";
import { createEmptyDiagram } from "@/model/diagram";
import { parse, serialize } from "@/model/serialize";
import type { NodeId } from "@/model/types";
import { useDiagramStore } from "@/store/diagramStore";
import { UNTITLED, useDocumentStore } from "@/store/documentStore";
import { currentProject } from "@/store/sessionStore";
import { liveDiagram } from "./liveDiagram";
import { diagramNameFor, downloadFile, fileNameFor, pickFile, writeFile } from "./localFiles";

/** An empty diagram, here only: it goes to the server with its first change. */
export function newDiagram() {
  liveDiagram.startLocal(createEmptyDiagram(), UNTITLED, false);
}

/**
 * Opens a diagram of the current project from the server, live. Unsent
 * changes to the open one are the caller's concern (see finishWork).
 */
export function openDiagram(id: string): Promise<void> {
  return liveDiagram.open(id, (record) => {
    // Another project's diagram is not opened here, even if the user may see it.
    if (record.project_id !== currentProject().id)
      throw new ApiError(404, "diagram_not_found", `Diagram ${id} is not in this project.`);
  });
}

/** Ctrl+S: sends what has not gone yet, now (it goes by itself a moment later anyway). */
export function saveNow() {
  commitPendingEdit();
  liveDiagram.flush();
}

/** Renames on the server right away; a diagram not there yet takes the name with it. */
export async function rename(name: string): Promise<void> {
  const { id } = useDocumentStore.getState();
  if (id === null) {
    useDocumentStore.getState().setName(name);
    return;
  }
  const record = await renameDiagram(id, name);
  // Everyone with it open hears too; this tab need not wait for that.
  if (useDocumentStore.getState().id === id) useDocumentStore.getState().setName(record.name);
}

/** Deletes the open diagram for everyone (owners), and starts an empty one. */
export async function deleteOpenDiagram(): Promise<void> {
  const { id } = useDocumentStore.getState();
  if (id === null) return;
  liveDiagram.deletingOpen();
  try {
    await deleteDiagram(id);
  } catch (e) {
    liveDiagram.deletingOpen(false);
    throw e;
  }
  newDiagram();
}

export type ImportResult = { status: "imported" } | { status: "cancelled" } | { status: "error"; message: string };

/** Loads a .json file as a new diagram, which goes to the server at once. */
export async function importFile(): Promise<ImportResult> {
  const picked = await pickFile();
  if (!picked) return { status: "cancelled" };
  const result = parse(picked.text);
  if (!result.ok) return { status: "error", message: result.error };
  liveDiagram.startLocal(result.diagram, diagramNameFor(picked.name), true);
  return { status: "imported" };
}

/** Writes what is open to a .json file. */
export function exportFile(): Promise<boolean> {
  commitPendingEdit();
  const diagram = useDiagramStore.getState().diagram;
  return writeFile(serialize(diagram), fileNameFor(useDocumentStore.getState().name));
}

/**
 * Downloads the diagram as a PDF report: every level, or only those inside
 * `box`. The server makes it from what it has, so what is still on its way
 * (or a diagram not on the server yet) goes first; if it cannot, the export
 * fails.
 */
export async function exportPdf(options: { box: NodeId | null; paper: Paper }): Promise<void> {
  commitPendingEdit();
  liveDiagram.toServer();
  if (!(await liveDiagram.settle(10_000))) {
    throw new ApiError(0, "not_saved", "The diagram could not be saved, so it cannot be exported yet. Try again in a moment.");
  }
  const { id, name } = useDocumentStore.getState();
  if (id === null) throw new ApiError(0, "not_saved", "The diagram is not on the server yet.");
  const { blob, fileName } = await exportDiagramPdf(id, options);
  downloadFile(blob, fileName ?? fileNameFor(name, "pdf"));
}

/** A field being typed in holds its edit until blur; saving must include it. */
function commitPendingEdit() {
  if (typeof document === "undefined") return; // unit tests run without a page
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.blur();
}

// Giving up the diagram (leaving it, signing out) starts from an empty one.
addDiscard("diagram", newDiagram);
