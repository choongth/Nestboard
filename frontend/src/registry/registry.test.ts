import { describe, expect, it } from "vitest";
import { createRegistry, type CategoryDefinition, type ObjectTypeDefinition } from "./registry";

const cat = (id: string, order: number): CategoryDefinition => ({ id, label: id, color: "#ffffff", order });
const type = (id: string, categoryId: string): ObjectTypeDefinition => ({ id, label: id, categoryId, icon: "box" });

const categories = [cat("second", 2), cat("first", 1), cat("unused", 3)];
const types = [type("plain", "first"), type("db", "second"), type("cache", "second")];
const registry = () => createRegistry(categories, types, "plain");

describe("createRegistry", () => {
  it("refuses inconsistent definitions", () => {
    expect(() => createRegistry(categories, [...types, type("db", "first")], "plain")).toThrow('Duplicate type id "db"');
    expect(() => createRegistry([...categories, cat("first", 9)], types, "plain")).toThrow("Duplicate category");
    expect(() => createRegistry(categories, [type("x", "nope")], "x")).toThrow('unknown category "nope"');
    expect(() => createRegistry(categories, [type("Not_Kebab", "first")], "Not_Kebab")).toThrow("kebab-case");
    expect(() => createRegistry([cat("Bad Id", 1)], [], "x")).toThrow("kebab-case");
    expect(() => createRegistry(categories, types, "missing")).toThrow('Fallback type "missing"');
  });

  it("lists categories in display order and groups types, skipping empty categories", () => {
    const r = registry();
    expect(r.categories.map((c) => c.id)).toEqual(["first", "second", "unused"]);
    expect(r.grouped().map((g) => [g.category.id, g.types.map((t) => t.id)])).toEqual([
      ["first", ["plain"]],
      ["second", ["db", "cache"]],
    ]);
  });
});

describe("resolve", () => {
  it("treats a missing id as the fallback type", () => {
    expect(registry().resolve(undefined)).toMatchObject({
      type: { id: "plain" },
      category: { id: "first" },
      known: true,
      storedId: undefined,
    });
  });

  it("returns known types with their category", () => {
    expect(registry().resolve("cache")).toMatchObject({ type: { id: "cache" }, category: { id: "second" }, known: true });
  });

  it("shows unknown ids as the fallback but keeps the stored id", () => {
    expect(registry().resolve("from-the-future")).toMatchObject({
      type: { id: "plain" },
      known: false,
      storedId: "from-the-future",
    });
  });
});
