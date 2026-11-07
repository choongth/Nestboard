import { describe, expect, it } from "vitest";
import { addNode, deleteNodes, moveNodes, placeExternals, setEdgeLabel, updateNode } from "./operations";
import { canEditSomething, checkChange, roleAt, type Rights } from "./rights";
import { buildTree, connect } from "./testUtils";
import type { Diagram } from "./types";

// Shop ▸ Payments ▸ Ledger, Shop ▸ Orders, and Web; Web → Payments, Orders → Ledger.
const tree = buildTree({ Shop: { Payments: { Ledger: {} }, Orders: {} }, Web: {} });
const id = tree.id;
let base = connect(tree.diagram, id("Web"), id("Payments"));
base = connect(base, id("Orders"), id("Ledger"));
const edgeBetween = (from: string, to: string) =>
  Object.values(base.edges).find((e) => e.from === id(from) && e.to === id(to))!.id;

// Bob may edit Payments (and Ledger inside it), and only look at the rest.
const bob: Rights = { projectRole: "viewer", boxRoles: { [id("Payments")]: "editor" } };
const none = new Set<string>();

const allowed = (rights: Rights, after: Diagram, granted: ReadonlySet<string> = none) =>
  checkChange(rights, granted, base, after) === null;

describe("roles at a box", () => {
  it("a grant covers the box and everything inside it; the root is the project role", () => {
    expect(roleAt(bob, base, id("Ledger"))).toBe("editor");
    expect(roleAt(bob, base, id("Orders"))).toBe("viewer");
    expect(roleAt(bob, base, base.rootId)).toBe("viewer");
    expect(roleAt({ projectRole: "editor", boxRoles: { [id("Shop")]: "viewer" } }, base, id("Shop"))).toBe("editor");
  });

  it("knows whether someone can edit anything", () => {
    expect(canEditSomething(bob)).toBe(true);
    expect(canEditSomething({ projectRole: "viewer", boxRoles: { x: "viewer" } })).toBe(false);
  });
});

describe("what a change needs", () => {
  it("an editor of a box changes only inside it", () => {
    expect(allowed(bob, addNode(base, id("Ledger"), { x: 0, y: 0 }).diagram)).toBe(true);
    expect(allowed(bob, addNode(base, id("Orders"), { x: 0, y: 0 }).diagram)).toBe(false);
    expect(allowed(bob, updateNode(base, id("Payments"), { title: "Pay" }))).toBe(true); // names its own box
    expect(allowed(bob, updateNode(base, id("Orders"), { title: "No" }))).toBe(false);
    expect(allowed(bob, moveNodes(base, { [id("Ledger")]: { x: 50, y: 50 } }))).toBe(true);
    expect(allowed(bob, moveNodes(base, { [id("Payments")]: { x: 50, y: 50 } }))).toBe(false); // Shop's canvas
    expect(allowed(bob, deleteNodes(base, [id("Ledger")]))).toBe(true);
    expect(allowed(bob, deleteNodes(base, [id("Payments")]))).toBe(false);
  });

  it("a connection needs one end you may edit", () => {
    expect(allowed(bob, connect(base, id("Orders"), id("Payments")))).toBe(true); // both in Shop
    expect(allowed(bob, connect(base, id("Orders"), id("Web")))).toBe(false);
  });

  it("a connection between levels needs an editor of the box an end sits in", () => {
    // Ledger sits in Payments, which Bob edits.
    expect(allowed(bob, connect(base, id("Ledger"), id("Web")))).toBe(true);
    expect(allowed(bob, setEdgeLabel(base, edgeBetween("Orders", "Ledger"), "books"))).toBe(true);
    // Payments sits in Shop, Web at the top level: Bob edits neither.
    expect(allowed(bob, setEdgeLabel(base, edgeBetween("Web", "Payments"), "pays"))).toBe(false);
    expect(checkChange(bob, none, base, connect(base, id("Payments"), id("Web")))?.message).toBe(
      'The connection between "Payments" and "Web" crosses levels: it needs an editor of "Shop" or of the top level.',
    );
    // Editing Ledger itself is not enough to connect it outside Payments.
    const ledgerOnly: Rights = { projectRole: "viewer", boxRoles: { [id("Ledger")]: "editor" } };
    expect(allowed(ledgerOnly, connect(base, id("Ledger"), id("Orders")))).toBe(false);
    expect(allowed({ projectRole: "viewer", boxRoles: { [id("Shop")]: "editor" } }, connect(base, id("Payments"), id("Web")))).toBe(true);
  });

  it("a box with people in charge of it needs an owner above it", () => {
    const granted = new Set([id("Ledger")]);
    expect(allowed(bob, deleteNodes(base, [id("Ledger")]), granted)).toBe(false);
    expect(allowed({ projectRole: "viewer", boxRoles: { [id("Payments")]: "owner" } }, deleteNodes(base, [id("Ledger")]), granted)).toBe(
      true,
    );
    expect(allowed({ projectRole: "viewer", boxRoles: { [id("Ledger")]: "owner" } }, deleteNodes(base, [id("Ledger")]), granted)).toBe(
      false,
    );
  });

  it("project owners change anything; viewers nothing", () => {
    const owner: Rights = { projectRole: "owner", boxRoles: {} };
    expect(allowed(owner, deleteNodes(base, [id("Shop")]), new Set([id("Ledger")]))).toBe(true);
    expect(allowed({ projectRole: "viewer", boxRoles: {} }, updateNode(base, id("Web"), { title: "x" }))).toBe(false);
  });

  it("the refusal names the box by its name before the change", () => {
    const refusal = checkChange(bob, none, base, updateNode(base, id("Orders"), { title: "Mine" }));
    expect(refusal).toEqual({ boxId: id("Orders"), needs: "editor", message: 'You can\'t change "Orders".' });
  });
});

describe("moving external boxes", () => {
  // Inside Payments, Orders is an external box (Orders → Ledger leaves it).
  const spot = { x: 900, y: -100 };

  it("inside a box is for that box's editors", () => {
    expect(allowed(bob, placeExternals(base, id("Payments"), { [id("Orders")]: spot }))).toBe(true);
    expect(allowed(bob, placeExternals(base, id("Shop"), { [id("Web")]: spot }))).toBe(false);
    expect(checkChange(bob, none, base, placeExternals(base, id("Shop"), { [id("Web")]: spot }))?.message).toBe(
      'You can\'t move the boxes from other levels inside "Shop".',
    );
  });

  it("a spot that goes with its deleted box is no change to the box that held it", () => {
    const withSpot = placeExternals(base, id("Shop"), { [id("Ledger")]: spot });
    expect(checkChange(bob, none, withSpot, deleteNodes(withSpot, [id("Ledger")]))).toBeNull();
  });
});
