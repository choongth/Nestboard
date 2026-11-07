import { describe, expect, it } from "vitest";
import { updateNode } from "@/model/operations";
import { buildTree } from "@/model/testUtils";
import type { BoxNode } from "@/model/types";
import { allowedTechnologies, filterSuggestions, findAllowed, technologySuggestions } from "./technologySuggestions";

/** A diagram with one box per spec, e.g. { LB: { typeId: "load-balancer" } }. */
function diagramWith(boxes: Record<string, Partial<Pick<BoxNode, "typeId" | "technology">>>) {
  const spec = Object.fromEntries(Object.keys(boxes).map((title) => [title, {}]));
  const { diagram: d, id } = buildTree(spec);
  let diagram = d;
  for (const [title, details] of Object.entries(boxes)) diagram = updateNode(diagram, id(title), details);
  return { diagram, id };
}

describe("technologySuggestions", () => {
  it("offers the type's suggestions first, then technologies used elsewhere", () => {
    const { diagram, id } = diagramWith({
      LB: { typeId: "load-balancer" },
      A: { technology: "Kong" },
      B: { technology: "Caddy" },
      C: { technology: "kong " }, // same technology, other spelling
    });
    expect(technologySuggestions(diagram, id("LB"))).toEqual([
      { label: "Suggested for Load Balancer", items: allowedTechnologies("load-balancer") },
      { label: "Used in this diagram", items: ["Kong", "Caddy"] }, // most-used first, first spelling kept
    ]);
  });

  it("does not repeat a used technology the type already suggests, or the box's own", () => {
    const { diagram, id } = diagramWith({
      LB: { typeId: "load-balancer", technology: "Traefik" },
      A: { technology: "nginx" },
    });
    const groups = technologySuggestions(diagram, id("LB"));
    expect(groups.map((g) => g.label)).toEqual(["Suggested for Load Balancer"]);
  });

  it("still offers diagram history for types without suggestions of their own", () => {
    const { diagram, id } = diagramWith({ User: { typeId: "actor" }, A: { technology: "iOS" } });
    expect(technologySuggestions(diagram, id("User"))).toEqual([{ label: "Used in this diagram", items: ["iOS"] }]);
  });

  it.each(["generic", "group", "note"])("offers nothing for %s boxes", (typeId) => {
    const { diagram, id } = diagramWith({
      X: { typeId: typeId === "generic" ? undefined : typeId },
      A: { technology: "Redis" },
    });
    expect(technologySuggestions(diagram, id("X"))).toEqual([]);
  });

  it("offers nothing for unknown types, which behave as generic", () => {
    const { diagram, id } = diagramWith({ X: { typeId: "from-the-future" }, A: { technology: "Redis" } });
    expect(technologySuggestions(diagram, id("X"))).toEqual([]);
  });
});

describe("filterSuggestions", () => {
  const groups = [
    { label: "Suggested", items: ["Nginx", "HAProxy", "AWS ALB"] },
    { label: "Used", items: ["Envoy"] },
  ];

  it("keeps everything for an empty query", () => {
    expect(filterSuggestions(groups, "  ")).toEqual(groups);
  });

  it("matches anywhere in the name, ignoring case, and drops empty groups", () => {
    expect(filterSuggestions(groups, "a")).toEqual([{ label: "Suggested", items: ["HAProxy", "AWS ALB"] }]);
    expect(filterSuggestions(groups, "VOY")).toEqual([{ label: "Used", items: ["Envoy"] }]);
  });

  it("drops an item that exactly matches what is typed", () => {
    expect(filterSuggestions(groups, "nginx")).toEqual([]);
  });
});

describe("allowedTechnologies", () => {
  it("restricts a type with a list to that list", () => {
    expect(allowedTechnologies("load-balancer")).toEqual(["Nginx", "HAProxy", "AWS ALB", "AWS NLB", "Google Cloud Load Balancing", "Azure Load Balancer", "F5 BIG-IP", "Envoy", "Traefik"]);
    expect(allowedTechnologies("data-warehouse")).toContain("Snowflake");
  });

  it.each([undefined, "generic", "group", "note", "actor", "from-the-future"])("allows free text for %s", (typeId) => {
    expect(allowedTechnologies(typeId)).toBeNull();
  });

  it("matches typed text to an allowed technology, ignoring case and spacing", () => {
    const allowed = allowedTechnologies("load-balancer")!;
    expect(findAllowed(allowed, " nginx ")).toBe("Nginx");
    expect(findAllowed(allowed, "aws alb")).toBe("AWS ALB");
    expect(findAllowed(allowed, "Kong")).toBeUndefined();
  });
});
