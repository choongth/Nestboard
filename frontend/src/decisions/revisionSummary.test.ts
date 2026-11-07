import { describe, expect, it } from "vitest";
import type { AdrSnapshot } from "@/api/adrs";
import { revisionSummary } from "./revisionSummary";

const base: AdrSnapshot = {
  title: "Use PostgreSQL",
  status: "proposed",
  context: "",
  decisions: [],
  positive_consequences: [],
  negative_consequences: [],
  links: [],
  relations: [],
};

describe("revision summary", () => {
  it("the first revision is the creation", () => {
    expect(revisionSummary(undefined, base)).toEqual(["Created"]);
  });

  it("names status changes and edited sections", () => {
    expect(revisionSummary(base, { ...base, status: "accepted" })).toEqual(["Proposed → Accepted"]);
    expect(revisionSummary(base, { ...base, context: "Why" })).toEqual(["Edited context"]);
    expect(revisionSummary(base, { ...base, title: "T", context: "C", decisions: ["D"] })).toEqual([
      "Edited title, context and decisions",
    ]);
  });

  it("names which consequences changed; reordering a list is a change", () => {
    expect(revisionSummary(base, { ...base, negative_consequences: ["Slow"] })).toEqual([
      "Edited negative consequences",
    ]);
    const two = { ...base, positive_consequences: ["A", "B"] };
    expect(revisionSummary(two, { ...two, positive_consequences: ["B", "A"] })).toEqual([
      "Edited positive consequences",
    ]);
    expect(revisionSummary(two, { ...two })).toEqual(["No visible change"]);
  });

  it("notices links and relations, in any order", () => {
    const linked = { ...base, links: [{ kind: "box" as const, id: "a" }, { kind: "box" as const, id: "b" }] };
    expect(revisionSummary(base, linked)).toEqual(["Changed links"]);
    expect(revisionSummary(linked, { ...linked, links: [...linked.links].reverse() })).toEqual(["No visible change"]);
    expect(revisionSummary(base, { ...base, relations: [{ kind: "amends", adr_id: "x" }] })).toEqual([
      "Changed relations",
    ]);
  });

  it("notices a move to another scope; older revisions without one are about the whole project", () => {
    const inBox = { ...base, scope: { diagram_id: "d", box_id: "payments" } };
    expect(revisionSummary(base, inBox)).toEqual(["Moved to another scope"]);
    expect(revisionSummary(inBox, { ...inBox, scope: null })).toEqual(["Moved to another scope"]);
    expect(revisionSummary(base, { ...base, scope: null })).toEqual(["No visible change"]);
  });

  it("older revisions without links or relations count as empty", () => {
    const old = { ...base } as Partial<AdrSnapshot>;
    delete old.links;
    delete old.relations;
    expect(revisionSummary(old as AdrSnapshot, base)).toEqual(["No visible change"]);
  });
});
