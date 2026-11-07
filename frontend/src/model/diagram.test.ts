import { describe, expect, it } from "vitest";
import { createEmptyDiagram, ROOT_TITLE } from "./diagram";

describe("createEmptyDiagram", () => {
  it("contains only a root node with no parent", () => {
    const diagram = createEmptyDiagram();
    const nodes = Object.values(diagram.nodes);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ id: diagram.rootId, parentId: null, title: ROOT_TITLE });
    expect(diagram.edges).toEqual({});
  });

  it("gives each diagram a fresh root id", () => {
    expect(createEmptyDiagram().rootId).not.toBe(createEmptyDiagram().rootId);
  });
});
