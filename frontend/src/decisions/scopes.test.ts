import { describe, expect, it } from "vitest";
import type { Adr } from "@/api/adrs";
import { buildTree } from "@/model/testUtils";
import { scopeOptions, scopeTree } from "./scopes";

// Shop ▸ Payments ▸ Ledger, Shop ▸ Orders, and Web.
const { diagram, id } = buildTree({ Shop: { Payments: { Ledger: {} }, Orders: {} }, Web: {} });
const open = { id: "d1", diagram };

const adr = (number: number, scope: Adr["scope"]): Adr =>
  ({ id: `a${number}`, number, ref: `ADR-${number}`, title: `T${number}`, scope }) as Adr;
const about = (box: string, extra: Partial<NonNullable<Adr["scope"]>> = {}) => ({
  diagram_id: "d1",
  box_id: id(box),
  title: box,
  orphaned: false,
  ...extra,
});

describe("the tree of scopes", () => {
  it("whole project first, then the open diagram's boxes in tree order, other diagrams, deleted boxes", () => {
    const groups = scopeTree(
      [
        adr(1, about("Orders")),
        adr(2, { diagram_id: "d2", box_id: "x", title: "Billing", orphaned: false }),
        adr(3, about("Ledger")),
        adr(4, null),
        adr(5, { diagram_id: "d1", box_id: "gone", title: "Old", orphaned: true }),
        adr(6, about("Ledger")),
      ],
      open,
      { d2: "Back office" },
    );

    expect(groups.map((g) => [g.label, g.depth, g.diagramName, g.adrs.map((a) => a.number)])).toEqual([
      ["Whole project", 0, undefined, [4]],
      ["Shop › Payments › Ledger", 2, undefined, [3, 6]],
      ["Shop › Orders", 1, undefined, [1]],
      ["Billing", 0, "Back office", [2]],
      ["Old", 0, undefined, [5]],
    ]);
    expect(groups.at(-1)!.orphaned).toBe(true);
  });
});

describe("the scopes you may write about", () => {
  it("a project editor: the whole project and every box", () => {
    const options = scopeOptions({ projectRole: "editor", boxRoles: {} }, open);
    expect(options.map((o) => o.label)).toEqual([
      "Whole project",
      "Shop",
      "Shop › Payments",
      "Shop › Payments › Ledger",
      "Shop › Orders",
      "Web",
    ]);
  });

  it("an editor of a box: that box and what is inside it", () => {
    const options = scopeOptions({ projectRole: "viewer", boxRoles: { [id("Payments")]: "editor" } }, open);
    expect(options.map((o) => o.label)).toEqual(["Shop › Payments", "Shop › Payments › Ledger"]);
    expect(options[0]).toMatchObject({ diagram_id: "d1", box_id: id("Payments") });
  });

  it("boxes of a diagram not saved yet can't be a scope", () => {
    expect(scopeOptions({ projectRole: "editor", boxRoles: {} }, { id: null, diagram }).map((o) => o.label)).toEqual([
      "Whole project",
    ]);
  });
});
