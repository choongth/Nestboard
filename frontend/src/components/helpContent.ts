// What the editor's Help shows (HelpDialog.tsx). These lists are the only copy: when a shortcut or gesture changes,
// change it here too, and in docs/FEATURES.md.

import { Cable, Layers, MousePointerClick, Tag, Users, type LucideIcon } from "lucide-react";
import { IS_MAC } from "./keys";

/** A key as pressed; "Mod" is Ctrl, or ⌘ on Apple devices. */
export type Key = string;

interface Shortcut {
  action: string;
  /** Key combinations, any of which works ("or"). */
  keys?: Key[][];
  /** A mouse gesture, written out. */
  mouse?: string;
  /** Only does something for people who can edit. */
  editOnly?: boolean;
}

export const SHORTCUT_GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: "Moving around",
    items: [
      { action: "Go inside a box", mouse: "Double-click the box" },
      { action: "Go back up a level", mouse: "Double-click the background", keys: [["Esc"]] },
      { action: "Jump to any level above", mouse: "Click it in the breadcrumb" },
      { action: "Go to where an external box lives", mouse: "Double-click the external box" },
      { action: "Pan", mouse: "Drag the background" },
      { action: "Zoom", mouse: "Scroll the mouse wheel" },
    ],
  },
  {
    title: "Selecting",
    items: [
      { action: "Select a box or connection", mouse: "Click it" },
      { action: "Add to the selection", mouse: `Shift or ${IS_MAC ? "⌘" : "Ctrl"} + click` },
      { action: "Select with a rectangle", mouse: "Shift + drag the background" },
      { action: "Select every box on this level", keys: [["Mod", "A"]] },
      { action: "Clear the selection (with nothing selected, Esc goes up a level)", keys: [["Esc"]] },
    ],
  },
  {
    title: "Editing",
    items: [
      { action: "New box", mouse: "Right-click the background → New box", editOnly: true },
      { action: "Move boxes", mouse: "Drag a box (a selected one moves the whole selection)", editOnly: true },
      { action: "Move without snapping to guides", mouse: `Hold ${IS_MAC ? "Option" : "Alt"} while dragging`, editOnly: true },
      { action: "Delete the selection", keys: [["Delete"], ["Backspace"]], editOnly: true },
      { action: "Copy", keys: [["Mod", "C"]] },
      { action: "Cut", keys: [["Mod", "X"]], editOnly: true },
      { action: "Paste (or right-click the background → Paste)", keys: [["Mod", "V"]], editOnly: true },
      { action: "Duplicate", keys: [["Mod", "D"]], editOnly: true },
      { action: "Undo your last change", keys: [["Mod", "Z"]], editOnly: true },
      { action: "Redo", keys: [["Mod", "Y"], ["Mod", "Shift", "Z"]], editOnly: true },
      { action: "Clear a chosen technology", keys: [["Backspace"]], editOnly: true },
    ],
  },
  {
    title: "Connecting",
    items: [
      { action: "Connect two boxes", mouse: "Drag from a point on a box's edge onto another box", editOnly: true },
      {
        action: "Connect to a box on another level",
        mouse: "Inside a box, drag a line onto “External box…”",
        editOnly: true,
      },
      { action: "In “Connect to…”: move through the boxes", keys: [["↑"], ["↓"]], editOnly: true },
      { action: "In “Connect to…”: connect to the highlighted box", keys: [["Enter"]], editOnly: true },
      { action: "In “Connect to…”: open a box", keys: [["→"]], editOnly: true },
      { action: "In “Connect to…”: back up", keys: [["←"], ["Backspace"]], editOnly: true },
      { action: "In “Connect to…”: search every level", mouse: "Type its name", editOnly: true },
      { action: "In “Connect to…”: close without connecting", keys: [["Esc"]], editOnly: true },
    ],
  },
  {
    title: "Diagram",
    items: [
      { action: "Send changes now (they also save by themselves)", keys: [["Mod", "S"]], editOnly: true },
      { action: "Open another diagram", keys: [["Mod", "O"]] },
      { action: "Show this help", keys: [["?"]] },
    ],
  },
];

export const GETTING_STARTED: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Layers,
    title: "Every box is a canvas",
    text: "Double-click a box to go inside and draw what it is made of. Double-click the background, or press Esc, to come back up. The breadcrumb at the top shows where you are; click any part of it to jump there.",
  },
  {
    icon: MousePointerClick,
    title: "Add boxes and connect them",
    text: "Right-click the background and choose New box, then type its name. Hover a box to see its connection points and drag from one onto another box. If that box has boxes inside, a list lets you pick which one.",
  },
  {
    icon: Tag,
    title: "Say what each box is",
    text: "Select a box and pick its Type in the sidebar (Relational Database, Cache, AI Agent…), then its Technology from that type's list. Changing the type clears the technology.",
  },
  {
    icon: Cable,
    title: "Connections across levels",
    text: "A line can join boxes on different levels. Inside a box, lines that leave it end on faded external boxes; double-click one to go where it lives. To connect outwards, drag a line onto “External box…” and pick the far end.",
  },
  {
    icon: Users,
    title: "Working together",
    text: "Changes save as you make them, and everyone with the diagram open sees them at once, with their pointers. Undo only takes back your own changes. A lock means you can't change that box; its owner's name is at its bottom right.",
  },
];

/** "Mod" → "Ctrl" or "⌘". */
export function keyLabel(key: Key): string {
  if (key === "Mod") return IS_MAC ? "⌘" : "Ctrl";
  if (key === "Shift" && IS_MAC) return "⇧";
  if (key === "Alt" && IS_MAC) return "⌥";
  return key;
}
