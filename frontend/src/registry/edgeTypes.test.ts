/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TYPE_ICONS } from "@/components/typeIcons";
import { edgeTypes, GENERIC_EDGE_TYPE_ID } from "./edgeTypes";
import { contrastRatio } from "./technologyLogos";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const token = (name: string) => css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "i"))![1]!;

/**
 * Every id ever published. Ids are part of saved files, so this list may only
 * grow: if a test fails because one is missing, restore it (change the label
 * to rename a type).
 */
const PUBLISHED_TYPE_IDS = [
  "generic",
  "request",
  "async-message",
  "publish",
  "subscribe",
  "stream",
  "read",
  "write",
  "read-write",
  "replication",
];
const PUBLISHED_CATEGORY_IDS = ["general", "communication", "data"];

describe("built-in connection types", () => {
  it("never loses a published id", () => {
    for (const id of PUBLISHED_TYPE_IDS) expect(edgeTypes.get(id), id).toBeDefined();
    for (const id of PUBLISHED_CATEGORY_IDS) expect(edgeTypes.category(id), id).toBeDefined();
  });

  it("has the 10 agreed types in 3 groups, in order", () => {
    expect(edgeTypes.grouped().map((g) => [g.category.id, g.types.map((t) => t.id)])).toEqual([
      ["general", ["generic"]],
      ["communication", ["request", "async-message", "publish", "subscribe", "stream"]],
      ["data", ["read", "write", "read-write", "replication"]],
    ]);
  });

  it("falls back to generic, the default for new lines", () => {
    expect(edgeTypes.fallback.id).toBe(GENERIC_EDGE_TYPE_ID);
    expect(edgeTypes.resolve(undefined).type.id).toBe(GENERIC_EDGE_TYPE_ID);
    expect(edgeTypes.resolve("from-the-future")).toMatchObject({ type: { id: GENERIC_EDGE_TYPE_ID }, known: false });
  });

  it("keeps generic looking like lines did before types existed", () => {
    expect(edgeTypes.get(GENERIC_EDGE_TYPE_ID)!.style).toEqual({ stroke: "dashed", flow: "normal", start: "none", end: "arrow" });
  });

  it("gives every type its own line style, so none relies on colour", () => {
    const signatures = edgeTypes.types.map((t) => JSON.stringify(t.style));
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("gives every type its own icon, which the UI can draw", () => {
    const icons = edgeTypes.types.map((t) => t.icon);
    expect(new Set(icons).size).toBe(icons.length);
    for (const t of edgeTypes.types) expect(TYPE_ICONS[t.icon], `${t.id} → ${t.icon}`).toBeDefined();
  });

  it("shows which way things travel: every type has at least one arrowhead", () => {
    for (const t of edgeTypes.types) {
      const arrows = [t.style.start, t.style.end].filter((e) => e === "arrow" || e === "open-arrow");
      expect(arrows.length, t.id).toBeGreaterThan(0);
    }
  });

  it("gives every type a verb for its label", () => {
    for (const t of edgeTypes.types) expect(t.verb.trim(), t.id).not.toBe("");
  });
});

describe("connection category colours on the dark theme", () => {
  it("are all different", () => {
    const colors = edgeTypes.categories.map((c) => c.color.toLowerCase());
    expect(new Set(colors).size).toBe(colors.length);
  });

  it.each(["surface-raised", "canvas"])("read as small text against --color-%s (4.5:1)", (background) => {
    for (const c of edgeTypes.categories) {
      expect(contrastRatio(c.color, token(background)), c.id).toBeGreaterThanOrEqual(4.5);
    }
  });
});
