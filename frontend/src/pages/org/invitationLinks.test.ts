import { describe, expect, it } from "vitest";
import type { ImportedRow } from "@/api/people";
import { csvCell, fileNameFor, linksCsv, linksText } from "./invitationLinks";

const ORIGIN = "https://nestboard.example";

function row(line: number, email: string, extra: Partial<ImportedRow> = {}): ImportedRow {
  return {
    line,
    email,
    name: null,
    title: "",
    role: "member",
    problem: null,
    invitation: { token: `t${line}`, expires_at: "2026-11-18T10:00:00Z" } as ImportedRow["invitation"],
    ...extra,
  };
}

describe("links from a CSV import", () => {
  const rows = [
    row(2, "bob@example.com", { name: "Lee, Bob", title: "Dev", role: "admin" }),
    row(3, "nope", { problem: { code: "invalid_email", message: "Not an email." }, invitation: null }),
    row(4, "carol@example.com"),
  ];

  it("lists each invited person with their link, for a mail merge", () => {
    expect(linksCsv(rows, ORIGIN)).toBe(
      "email,name,job title,role,link,expires\r\n" +
        'bob@example.com,"Lee, Bob",Dev,admin,https://nestboard.example/invite/t2,2026-11-18\r\n' +
        "carol@example.com,,,member,https://nestboard.example/invite/t4,2026-11-18\r\n",
    );
  });

  it("copies as one line per person", () => {
    expect(linksText(rows, ORIGIN)).toBe(
      "bob@example.com: https://nestboard.example/invite/t2\ncarol@example.com: https://nestboard.example/invite/t4",
    );
  });

  it("quotes cells that need it, and keeps spreadsheets from running cells as formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-1+2")).toBe("'-1+2");
    expect(csvCell("@sum, x")).toBe("\"'@sum, x\"");
  });

  it("names the file after the organization", () => {
    expect(fileNameFor("Acme Corp")).toBe("acme-corp-invitations.csv");
    expect(fileNameFor("数据")).toBe("organization-invitations.csv");
  });
});
