// Reading and writing diagram files on the user's disk (Import / Export).
// Chromium browsers use the File System Access API; elsewhere exporting
// downloads the file and importing uses a plain file input.

const FILE_TYPES: FilePickerAcceptType[] = [
  { description: "Nestboard diagram", accept: { "application/json": [".json"] } },
];

export interface PickedFile {
  text: string;
  name: string;
}

/** Lets the user choose a .json file; `null` if they cancel. */
export async function pickFile(): Promise<PickedFile | null> {
  try {
    return window.showOpenFilePicker ? await pickWithFileSystemAccess() : await pickWithInput();
  } catch (e) {
    if (isAbort(e)) return null;
    throw e;
  }
}

/** Saves `text` under a name the user confirms; `false` if they cancel. */
export async function writeFile(text: string, suggestedName: string): Promise<boolean> {
  if (!window.showSaveFilePicker) {
    download(text, suggestedName);
    return true;
  }
  let handle: FileSystemFileHandle;
  try {
    handle = await window.showSaveFilePicker({ suggestedName, types: FILE_TYPES });
  } catch (e) {
    if (isAbort(e)) return false;
    throw e;
  }
  const stream = await handle.createWritable();
  await stream.write(text);
  await stream.close();
  return true;
}

/** "Payments" → "Payments.json" (or another extension), keeping only characters file systems accept. */
export function fileNameFor(name: string, extension = "json"): string {
  const safe = name.replace(/[\\/:*?"<>|]+/g, "-").trim();
  return `${safe || "diagram"}.${extension}`;
}

/** "payments.json" → "payments". */
export function diagramNameFor(fileName: string): string {
  return fileName.replace(/\.json$/i, "").trim() || "Imported diagram";
}

async function pickWithFileSystemAccess(): Promise<PickedFile | null> {
  const [handle] = await window.showOpenFilePicker!({ types: FILE_TYPES, excludeAcceptAllOption: false });
  if (!handle) return null;
  const file = await handle.getFile();
  return { text: await file.text(), name: handle.name };
}

function pickWithInput(): Promise<PickedFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then((text) => resolve({ text, name: file.name }), reject);
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

function download(text: string, fileName: string) {
  downloadFile(new Blob([text], { type: "application/json" }), fileName);
}

/** Hands `blob` to the browser as a download named `fileName`. */
export function downloadFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isAbort(e: unknown) {
  return e instanceof DOMException && e.name === "AbortError";
}
