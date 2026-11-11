// The links from a CSV import, ready to send: as a CSV file for a mail merge, or as text to paste.

import type { ImportedRow } from "@/api/people";

const linkOf = (row: ImportedRow, origin: string) => `${origin}/invite/${row.invitation!.token}`;

/** The invited rows with their links, for a mail merge. */
export function linksCsv(rows: ImportedRow[], origin = window.location.origin): string {
  const lines = [["email", "name", "job title", "role", "link", "expires"]];
  for (const row of rows) {
    if (!row.invitation) continue;
    const expires = row.invitation.expires_at.slice(0, 10);
    lines.push([row.email, row.name ?? "", row.title, row.role, linkOf(row, origin), expires]);
  }
  return lines.map((cells) => cells.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** "email: link", one per line. */
export function linksText(rows: ImportedRow[], origin = window.location.origin): string {
  return rows
    .filter((r) => r.invitation)
    .map((r) => `${r.email}: ${linkOf(r, origin)}`)
    .join("\n");
}

/**
 * One CSV cell: quoted when needed, and a leading = + - @ neutralised so a spreadsheet doesn't run it as a formula.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** "Acme Corp" → "acme-corp-invitations.csv". */
export function fileNameFor(orgName: string): string {
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "organization"}-invitations.csv`;
}
