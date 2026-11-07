import { describe, expect, it } from "vitest";
import { addEdge, deleteNodes, moveNodes, moveNode, placeExternals } from "@/model/operations";
import { buildTree } from "@/model/testUtils";
import { BOX_HEIGHT, BOX_WIDTH } from "@/model/types";
import { EXTERNAL_HEIGHT, EXTERNAL_WIDTH, externalBoxes, placeholderSpot } from "./externalLayout";

function shop() {
  const built = buildTree({ Shop: { Cart: {}, Wishlist: {} }, Payments: { Ledger: {} }, Users: {}, Admin: {} });
  const { id } = built;
  let diagram = moveNode(moveNode(built.diagram, id("Cart"), { x: 0, y: 0 }), id("Wishlist"), { x: 0, y: 300 });
  diagram = addEdge(diagram, id("Cart"), id("Ledger")).diagram; // Shop → Payments, from inside
  return { diagram, id, title: (nodeId: string) => diagram.nodes[nodeId]!.title };
}

describe("externalBoxes", () => {
  it("shows the exact far ends of lines leaving the canvas, and nothing else", () => {
    const { diagram, id, title } = shop();
    expect(externalBoxes(diagram, id("Shop")).map((b) => title(b.id))).toEqual(["Ledger"]);
  });

  it("lists a box connected twice once", () => {
    const { diagram: d, id, title } = shop();
    const diagram = addEdge(addEdge(d, id("Wishlist"), id("Ledger")).diagram, id("Cart"), id("Users")).diagram;
    expect(externalBoxes(diagram, id("Shop")).map((b) => title(b.id))).toEqual(["Ledger", "Users"]);
  });

  it("stacks them in a column right of the canvas's boxes", () => {
    const { diagram: d, id } = shop();
    const all = externalBoxes(addEdge(d, id("Cart"), id("Users")).diagram, id("Shop"));
    expect(all[0]!.position.x).toBeGreaterThan(BOX_WIDTH);
    expect(new Set(all.map((b) => b.position.x)).size).toBe(1);
    expect(all[1]!.position.y - all[0]!.position.y).toBeGreaterThan(EXTERNAL_HEIGHT);
  });

  it("has none at the root", () => {
    const { diagram } = shop();
    expect(externalBoxes(diagram, diagram.rootId)).toEqual([]);
  });
});

describe("the External box placeholder", () => {
  it("goes on the side a line is pulled from", () => {
    const { diagram, id } = shop();
    // Shop's boxes: Cart at (0, 0) and Wishlist at (0, 300), so they span x 0…BOX_WIDTH, y 0…300+BOX_HEIGHT.
    const at = (side: "left" | "right" | "top" | "bottom") => placeholderSpot(diagram, id("Shop"), side);
    expect(at("right").x).toBeGreaterThan(BOX_WIDTH);
    expect(at("left").x + EXTERNAL_WIDTH).toBeLessThan(0);
    expect(at("bottom").y).toBeGreaterThan(300 + BOX_HEIGHT);
    expect(at("top").y + EXTERNAL_HEIGHT).toBeLessThan(0);
  });

  it("on the right, goes below the column instead of on top of it", () => {
    const { diagram, id } = shop();
    const [ledger] = externalBoxes(diagram, id("Shop"));
    const spot = placeholderSpot(diagram, id("Shop"), "right");
    expect(spot.x).toBe(ledger!.position.x);
    expect(spot.y - ledger!.position.y).toBe(EXTERNAL_HEIGHT + 24);
    // Once Ledger is put elsewhere, the column is empty and it moves up.
    const moved = placeExternals(diagram, id("Shop"), { [id("Ledger")]: { x: -500, y: 40 } });
    expect(placeholderSpot(moved, id("Shop"), "right")).toEqual(ledger!.position);
  });
});

describe("external boxes the user has moved", () => {
  function moved() {
    const s = shop();
    let diagram = addEdge(s.diagram, s.id("Cart"), s.id("Users")).diagram;
    diagram = placeExternals(diagram, s.id("Shop"), { [s.id("Ledger")]: { x: -500, y: 40 } });
    return { ...s, diagram };
  }

  it("rest where they were put; the others fill the column on the right without a gap", () => {
    const { diagram, id } = moved();
    const [ledger, users] = externalBoxes(diagram, id("Shop"));
    expect(ledger!.position).toEqual({ x: -500, y: 40 });
    // Users takes the column's first place, as if Ledger had never been there.
    expect(users!.position).toEqual({ x: BOX_WIDTH + 160, y: 0 });
  });

  it("keep their spot when the canvas's own boxes move", () => {
    const { diagram, id } = moved();
    const after = moveNodes(diagram, { [id("Cart")]: { x: 900, y: 900 } });
    expect(externalBoxes(after, id("Shop"))[0]!.position).toEqual({ x: -500, y: 40 });
  });

  it("a spot is forgotten with the box it was for", () => {
    const { diagram, id } = moved();
    const after = deleteNodes(diagram, [id("Ledger")]);
    expect(after.nodes[id("Shop")]!.externals).toBeUndefined();
  });
});
