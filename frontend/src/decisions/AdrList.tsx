import { Box, FolderKanban, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Adr, AdrStatus } from "@/api/adrs";
import type { ScopeGroup } from "./scopes";
import { STATUSES, STATUS_LABEL } from "./status";
import { StatusBadge } from "./StatusBadge";
import { field, neutralButton, scrollArea, searchBox } from "./styles";

interface AdrListProps {
  adrs: Adr[];
  /** Still fetching: no "No ADRs yet" until it is known. */
  loading: boolean;
  selected: number | null;
  onSelect: (number: number) => void;
  onNew: () => void;
  /** Sorts decisions into the tree of what they are about (see scopes.ts). */
  groupByScope: (adrs: Adr[]) => ScopeGroup[];
  /** Why you can't write a new decision here, if you can't. */
  cannotPropose?: string;
}

/**
 * The left column: a button for a new ADR, then every ADR of the project as
 * a tree of what they are about (the whole project, then boxes), filterable.
 */
export function AdrList({ adrs, loading, selected, onSelect, onNew, groupByScope, cannotPropose }: AdrListProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AdrStatus | "all">("all");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return adrs.filter(
      (a) =>
        (status === "all" || a.status === status) &&
        (!q || a.title.toLowerCase().includes(q) || a.ref.toLowerCase().includes(q)),
    );
  }, [adrs, query, status]);
  const groups = useMemo(() => groupByScope(shown), [groupByScope, shown]);

  return (
    <nav aria-label="Decisions" className="flex min-h-0 w-80 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex flex-col gap-2 border-b border-line p-3">
        <button
          type="button"
          onClick={onNew}
          disabled={cannotPropose !== undefined}
          title={cannotPropose}
          className={`${neutralButton} justify-center`}
        >
          <Plus className="size-4" />
          New ADR
        </button>
        <label className={`${searchBox} bg-canvas`}>
          <Search className="size-4 text-fg-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ADRs"
            aria-label="Search ADRs"
            className="flex-1 bg-transparent text-fg outline-none placeholder:text-fg-subtle"
          />
        </label>
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value as AdrStatus | "all")}
          className={`${field} bg-canvas`}
        >
          <option value="all">All statuses ({adrs.length})</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]} ({adrs.filter((a) => a.status === s).length})
            </option>
          ))}
        </select>
      </div>

      <ul className={`${scrollArea} flex-1 p-1.5`}>
        {groups.map((group) => (
          <li key={group.key} aria-label={group.label} style={{ paddingLeft: `${group.depth * 12}px` }}>
            <span
              data-scope
              className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-xs font-medium text-fg-subtle"
              title={group.orphaned ? "This box has been deleted" : undefined}
            >
              {group.key === "project" ? <FolderKanban className="size-3.5 shrink-0" /> : <Box className="size-3.5 shrink-0" />}
              <span className={`truncate ${group.orphaned ? "line-through" : ""}`}>{group.label}</span>
              {group.diagramName && <span className="shrink-0 font-normal">in {group.diagramName}</span>}
              {group.orphaned && <span className="shrink-0 font-normal">deleted</span>}
            </span>
            <ul>
              {group.adrs.map((adr) => {
                const active = adr.number === selected;
                return (
                  <li key={adr.id}>
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => onSelect(adr.number)}
                      className={`flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
                        active ? "bg-accent-soft" : "hover:bg-surface-hover"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-fg-subtle">{adr.ref}</span>
                        <StatusBadge status={adr.status} size="small" />
                      </span>
                      <span className="line-clamp-2 text-fg">{adr.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
        {!loading && adrs.length === 0 && <li className="px-3 py-6 text-center text-fg-muted">No ADRs yet.</li>}
        {adrs.length > 0 && shown.length === 0 && (
          <li className="px-3 py-6 text-center text-fg-muted">No ADR matches.</li>
        )}
      </ul>
    </nav>
  );
}
