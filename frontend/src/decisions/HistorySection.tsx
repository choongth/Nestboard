import { useEffect, useState } from "react";
import { adrRevisions, authorName, type AdrRevision } from "@/api/adrs";
import { formatDateTime } from "@/app/dates";
import { TimeArrow } from "@/components/TimeArrow";
import { revisionSummary } from "./revisionSummary";
import { StatusBadge } from "./StatusBadge";
import { sectionLabel } from "./styles";

/**
 * Every version of the decision, newest first, along a thin arrow pointing
 * up (the way time runs), with who made it. Give it `key={adr.version}` so a
 * change reloads it.
 */
export function HistorySection({ adrId }: { adrId: string }) {
  const [revisions, setRevisions] = useState<AdrRevision[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adrRevisions(adrId).then(
      (r) => !cancelled && setRevisions(r),
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [adrId]);

  return (
    <section aria-label="History" className="flex flex-col gap-3">
      <h2 className={sectionLabel}>History</h2>
      {error && <p className="text-danger">{error}</p>}
      {!error && !revisions && <p className="text-fg-muted">Loading…</p>}
      {revisions && (
        <div className="relative pl-5">
          <TimeArrow />
          <ol className="flex flex-col gap-3.5">
            {revisions
              .map((r, i) => ({ r, summary: revisionSummary(revisions[i - 1]?.snapshot, r.snapshot) }))
              .reverse()
              .map(({ r, summary }) => (
                <li key={r.revision} className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <StatusBadge status={r.snapshot.status} size="small" />
                    <span className="text-fg-muted">{summary.join(" · ")}</span>
                  </span>
                  <span className="text-[11.5px] text-fg-subtle">
                    <time dateTime={r.created_at}>{formatDateTime(r.created_at)}</time>
                    {r.author && <> · {authorName(r.author)}</>}
                  </span>
                </li>
              ))}
          </ol>
        </div>
      )}
    </section>
  );
}
