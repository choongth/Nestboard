import { describe, expect, it } from "vitest";
import { edited } from "@/components/relativeTime";
import { diagramNameFor, fileNameFor } from "./localFiles";

describe("file names", () => {
  it("a diagram exports under its name", () => {
    expect(fileNameFor("Payments")).toBe("Payments.json");
    expect(fileNameFor("支付系统")).toBe("支付系统.json");
    expect(fileNameFor('a/b:c*"d"')).toBe("a-b-c-d-.json");
    expect(fileNameFor("  ")).toBe("diagram.json");
  });

  it("an imported file is named after the file", () => {
    expect(diagramNameFor("payments.json")).toBe("payments");
    expect(diagramNameFor("Shop.JSON")).toBe("Shop");
    expect(diagramNameFor("notes")).toBe("notes");
    expect(diagramNameFor(".json")).toBe("Imported diagram");
  });
});

describe("edited", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  it.each([
    ["2026-10-27T11:59:40Z", "Edited just now"],
    ["2026-10-27T11:55:00Z", "Edited 5 minutes ago"],
    ["2026-10-27T09:00:00Z", "Edited 3 hours ago"],
    ["2026-10-26T12:00:00Z", "Edited yesterday"],
    ["2026-10-13T12:00:00Z", "Edited 2 weeks ago"],
  ])("%s → %s", (iso, label) => {
    expect(edited(iso, now)).toBe(label);
  });
});
