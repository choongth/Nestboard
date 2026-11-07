/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ICON_TILE_TINT } from "@/canvas/boxStyle";
import { TYPE_ICONS } from "@/components/typeIcons";
import { boxTypes, GENERIC_TYPE_ID } from "./boxTypes";

// Read from disk: Vitest does not load CSS, even as raw text.
const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

/**
 * Every id ever published. Ids are part of saved files, so this list may only
 * grow: if a test here fails because an id is missing, restore it (change the
 * label instead of the id to rename a type).
 */
const PUBLISHED_TYPE_IDS = [
  "actor",
  "external-system",
  "client",
  "dns",
  "cdn",
  "load-balancer",
  "api-gateway",
  "reverse-proxy",
  "rate-limiter",
  "service",
  "worker",
  "serverless-function",
  "relational-db",
  "nosql-db",
  "cache",
  "object-storage",
  "search-engine",
  "data-warehouse",
  "message-queue",
  "event-stream",
  "container",
  "orchestrator",
  "auth-service",
  "monitoring",
  "generic",
  "group",
  "note",
  "workflow-engine",
  "data-processing",
  "lakehouse",
  "vector-db",
  "ai-model",
  "ai-agent",
  "model-serving",
  "llm-gateway",
  "service-mesh",
  "hosting-platform",
  "ci-cd",
  "secrets-manager",
];
const PUBLISHED_CATEGORY_IDS = [
  "actors",
  "clients",
  "traffic",
  "compute",
  "data",
  "messaging",
  "platform",
  "cross-cutting",
  "general",
  "ai",
];
const GENERAL_TYPES = ["generic", "group", "note"];

describe("built-in box types", () => {
  it("never loses a published id", () => {
    for (const id of PUBLISHED_TYPE_IDS) expect(boxTypes.get(id), id).toBeDefined();
    for (const id of PUBLISHED_CATEGORY_IDS) expect(boxTypes.category(id), id).toBeDefined();
  });

  it("has 39 types: 36 domain types and 3 general ones", () => {
    expect(boxTypes.types).toHaveLength(39);
    expect(boxTypes.types.filter((t) => t.categoryId === "general").map((t) => t.id)).toEqual(GENERAL_TYPES);
  });

  it("falls back to generic, the default for new boxes", () => {
    expect(boxTypes.fallback.id).toBe(GENERIC_TYPE_ID);
    expect(boxTypes.resolve(undefined).type.id).toBe(GENERIC_TYPE_ID);
    expect(boxTypes.resolve("not-a-real-type")).toMatchObject({ type: { id: GENERIC_TYPE_ID }, known: false });
  });

  it("gives every type its own icon, which the UI can draw", () => {
    const icons = boxTypes.types.map((t) => t.icon);
    expect(new Set(icons).size).toBe(icons.length);
    for (const t of boxTypes.types) expect(TYPE_ICONS[t.icon], `${t.id} → ${t.icon}`).toBeDefined();
    const components = boxTypes.types.map((t) => TYPE_ICONS[t.icon]);
    expect(new Set(components).size).toBe(components.length);
  });

  it("suggests technologies for every type except actors and the general ones", () => {
    for (const t of boxTypes.types) {
      const expectNone = t.id === "actor" || GENERAL_TYPES.includes(t.id);
      expect(t.suggestedTechnologies?.length ?? 0, t.id).toSatisfy((n: number) => (expectNone ? n === 0 : n > 0));
    }
  });

  it("labels the Docker type unambiguously", () => {
    expect(boxTypes.get("container")!.label).toBe("Docker Container");
  });
});

describe("category colours on the dark theme", () => {
  const token = (name: string) => {
    const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "i"));
    if (!match) throw new Error(`--color-${name} not found in index.css`);
    return match[1]!;
  };

  it("are all different", () => {
    const colors = boxTypes.categories.map((c) => c.color.toLowerCase());
    expect(new Set(colors).size).toBe(colors.length);
  });

  // WCAG 2.1 §1.4.11: graphics need 3:1 against what they sit on. Boxes sit on
  // the canvas and are filled with surface-raised.
  it.each(["surface-raised", "canvas"])("meet 3:1 contrast against --color-%s", (background) => {
    for (const c of boxTypes.categories) {
      expect(contrast(c.color, token(background)), `${c.id} ${c.color}`).toBeGreaterThanOrEqual(3);
    }
  });

  // The icon is drawn in the category colour on a tile tinted with that same
  // colour: in the type label on the box's top border (over the canvas), and
  // in the type picker (over raised surfaces).
  it.each(["canvas", "surface-raised"])("stand out as icons on their tinted tile over --color-%s", (background) => {
    for (const c of boxTypes.categories) {
      const tile = mix(c.color, token(background), ICON_TILE_TINT);
      expect(contrast(c.color, tile), `${c.id} icon on ${tile}`).toBeGreaterThanOrEqual(3);
    }
  });

  // The type label is small text on the box's top border, over the canvas.
  it("are readable as small label text on the canvas (4.5:1)", () => {
    for (const c of boxTypes.categories) {
      expect(contrast(c.color, token("canvas")), c.id).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/** `top` at `alpha` opacity over `bottom`, as a hex colour. */
function mix(top: string, bottom: string, alpha: number): string {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [t, b] = [rgb(top), rgb(bottom)];
  return "#" + t.map((v, i) => Math.round(v * alpha + b[i]! * (1 - alpha)).toString(16).padStart(2, "0")).join("");
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
