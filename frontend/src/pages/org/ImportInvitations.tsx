// Inviting many people at once from a CSV file (the Invitations tab, Admins only). Three steps in one dialog: pick a
// file, check the server's row-by-row preview, then invite and keep the links. Nestboard sends no email, and the links
// can't be shown again (only their hashes are stored), so the last step offers them as a CSV for a mail merge.

import { CircleAlert, CircleCheck, Copy, Download, FileSpreadsheet, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { ApiError } from "@/api/client";
import type { Organization } from "@/api/orgs";
import { importInvitations, type ImportedRow, type InvitationImport } from "@/api/people";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { neutralButton, quietButton } from "@/decisions/styles";
import { downloadFile } from "@/files/localFiles";
import { fileNameFor, linksCsv, linksText } from "./invitationLinks";

const MAX_PEOPLE = 100;
const TEMPLATE = "email,name,job title,role\nalice@example.com,Alice Tan,Architect,member\n";

type Step =
  | { kind: "pick" }
  | { kind: "preview"; fileName: string; csv: string; result: InvitationImport }
  | { kind: "done"; result: InvitationImport; kept: boolean };

/** The "Import from CSV…" button, and its dialog. `onInvited` reloads the invitation list. */
export function ImportInvitations({ org, onInvited }: { org: Organization; onInvited: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const owner = org.membership.role === "owner";

  const reset = () => {
    setStep({ kind: "pick" });
    setError(null);
    setBusy(false);
  };
  const close = () => {
    setOpen(false);
    reset();
  };
  // The links can't be shown again: closing before keeping them asks first.
  const requestClose = () => {
    if (step.kind === "done" && !step.kept && step.result.invited > 0) setConfirmClose(true);
    else close();
  };

  const check = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const csv = await file.text();
      const result = await importInvitations(org.id, csv, true);
      setStep({ kind: "preview", fileName: file.name, csv, result });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const invite = async (csv: string) => {
    setError(null);
    setBusy(true);
    try {
      const result = await importInvitations(org.id, csv, false);
      setStep({ kind: "done", result, kept: false });
      onInvited();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const keep = () => setStep((s) => (s.kind === "done" ? { ...s, kept: true } : s));

  return (
    <>
      <button type="button" className={quietButton} onClick={() => setOpen(true)}>
        <FileSpreadsheet className="size-4" />
        Import from CSV…
      </button>
      <Modal
        open={open}
        onOpenChange={(o) => (o ? setOpen(true) : requestClose())}
        title="Invite people from a CSV file"
        description="Each row gets its own invitation link, which works only for that row's email."
        showDescription
        width={760}
      >
        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
          {step.kind === "pick" && (
            <>
              <p className="leading-relaxed text-fg-muted">
                The first row names the columns. Up to {MAX_PEOPLE} people at once. Nestboard doesn't send email: once
                they're invited, download their links and send them yourself (a mail merge works well).
              </p>
              <table className="w-full text-left">
                <tbody className="[&_td]:border-t [&_td]:border-line [&_td]:py-1.5 [&_td]:pr-3 [&_td]:align-top">
                  <tr>
                    <td className="font-mono text-xs text-fg">email</td>
                    <td className="text-fg-muted">Required. Only this address can use the link</td>
                  </tr>
                  <tr>
                    <td className="font-mono text-xs text-fg">name</td>
                    <td className="text-fg-muted">Optional. Fills in their sign-up form; they can change it</td>
                  </tr>
                  <tr>
                    <td className="font-mono text-xs text-fg">job title</td>
                    <td className="text-fg-muted">Optional</td>
                  </tr>
                  <tr>
                    <td className="font-mono text-xs text-fg">role</td>
                    <td className="text-fg-muted">
                      Optional: member (if empty), admin or owner
                      {!owner && " (only owners can invite admins and owners)"}
                    </td>
                  </tr>
                </tbody>
              </table>
              <pre className="rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs text-fg-muted">
                {TEMPLATE}
              </pre>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                aria-label="CSV file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void check(file);
                }}
              />
              {error && <Problem text={error} />}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className={quietButton}
                  onClick={() => downloadFile(new Blob([TEMPLATE], { type: "text/csv" }), "invitations-template.csv")}
                >
                  <Download className="size-4" />
                  Download a template
                </button>
                <button type="button" className={neutralButton} disabled={busy} onClick={() => fileInput.current?.click()}>
                  <Upload className="size-4" />
                  {busy ? "Checking…" : "Choose a CSV file…"}
                </button>
              </div>
            </>
          )}

          {step.kind === "preview" && (
            <>
              <p className="text-fg-muted">
                <span className="text-fg">{step.fileName}</span>: {count(step.result.rows.length - step.result.skipped)}{" "}
                to invite
                {step.result.skipped > 0 && `, ${step.result.skipped} skipped (see why below)`}. Links work once, for 7
                days.
              </p>
              <Rows rows={step.result.rows} />
              {error && <Problem text={error} />}
              <div className="flex justify-end gap-2">
                <button type="button" className={quietButton} disabled={busy} onClick={reset}>
                  Choose another file
                </button>
                <button
                  type="button"
                  className={neutralButton}
                  disabled={busy || step.result.rows.length === step.result.skipped}
                  onClick={() => void invite(step.csv)}
                >
                  {busy ? "Inviting…" : `Invite ${count(step.result.rows.length - step.result.skipped)}`}
                </button>
              </div>
            </>
          )}

          {step.kind === "done" && (
            <>
              <div className="flex flex-col gap-1 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] p-3">
                <span className="text-emerald-200">Invited {count(step.result.invited)}.</span>
                <span className="text-xs text-emerald-200/80">
                  Their links are shown only now: download or copy them before you close this, then send each person
                  theirs.
                </span>
              </div>
              {step.result.skipped > 0 && (
                <>
                  <p className="text-fg-muted">{step.result.skipped} skipped:</p>
                  <Rows rows={step.result.rows.filter((r) => r.problem)} />
                </>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className={quietButton}
                  disabled={step.result.invited === 0}
                  onClick={() =>
                    void navigator.clipboard.writeText(linksText(step.result.rows)).then(keep, () => {})
                  }
                >
                  <Copy className="size-4" />
                  Copy all links
                </button>
                <button
                  type="button"
                  className={neutralButton}
                  disabled={step.result.invited === 0}
                  onClick={() => {
                    downloadFile(new Blob([linksCsv(step.result.rows)], { type: "text/csv" }), fileNameFor(org.name));
                    keep();
                  }}
                >
                  <Download className="size-4" />
                  Download links (CSV)
                </button>
                <button type="button" className={quietButton} onClick={requestClose}>
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Close without the links?"
        description="The links can't be shown again. To invite these people later, revoke their invitations and import the file again."
        confirmLabel="Close anyway"
        onConfirm={() => {
          setConfirmClose(false);
          close();
        }}
      />
    </>
  );
}

function Rows({ rows }: { rows: ImportedRow[] }) {
  return (
    <div className="scroll-thin max-h-[min(360px,45vh)] overflow-y-auto rounded-lg border border-line">
      <table className="w-full text-left text-[13px]">
        <thead className="sticky top-0 bg-surface-raised text-xs text-fg-subtle">
          <tr className="[&_th]:px-2 [&_th]:py-1.5 [&_th]:font-medium">
            <th>Line</th>
            <th>Email</th>
            <th>Name</th>
            <th>Job title</th>
            <th>Role</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.line}
              data-import-row={row.line}
              className="border-t border-line align-top [&_td]:px-2 [&_td]:py-1.5"
            >
              <td className="text-fg-subtle">{row.line}</td>
              <td className="break-all text-fg">{row.email || "—"}</td>
              <td className="text-fg-muted">{row.name ?? ""}</td>
              <td className="text-fg-muted">{row.title}</td>
              <td className="text-fg-muted capitalize">{row.role}</td>
              <td>
                {row.problem ? (
                  <span data-problem={row.problem.code} className="flex gap-1.5 text-amber-300">
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                    {row.problem.message}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-emerald-300">
                    <CircleCheck className="size-3.5 shrink-0" />
                    {row.invitation ? "Invited" : "Ready"}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <p role="alert" className="flex gap-1.5 text-danger">
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      {text}
    </p>
  );
}

function message(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

const count = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
