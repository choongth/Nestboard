import { describe, expect, it } from "vitest";
import { buildTree, connect } from "@/model/testUtils";
import { linkTargets } from "./linkTargets";

describe("link targets", () => {
  it("lists boxes in tree order with their path, then connections", () => {
    const { diagram: tree, id } = buildTree({ Web: {}, Payments: { API: {}, Ledger: {} } });
    let diagram = connect(tree, id("Web"), id("Payments"), "pays");
    diagram = connect(diagram, id("API"), id("Ledger"));
    diagram = connect(diagram, id("Web"), id("API"));

    const targets = linkTargets(diagram).map((t) => [t.kind, t.title, t.path]);

    expect(targets).toEqual([
      ["box", "Web", ""],
      ["box", "Payments", ""],
      ["box", "API", "Payments"],
      ["box", "Ledger", "Payments"],
      // Named like the server names them: the label, else "From → To".
      ["connection", "pays", ""],
      ["connection", "Web → API", ""],
      ["connection", "API → Ledger", "Payments"],
    ]);
  });

  it("an empty diagram has nothing to link; the root is never offered", () => {
    const { diagram } = buildTree({});
    expect(linkTargets(diagram)).toEqual([]);
  });
});
