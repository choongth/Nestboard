import type { AdrSnapshot } from "@/api/adrs";
import { STATUS_LABEL } from "./status";

/** Each part of an ADR, and how a summary names it. */
const PARTS = [
  ["title", "title"],
  ["context", "context"],
  ["decisions", "decisions"],
  ["positive_consequences", "positive consequences"],
  ["negative_consequences", "negative consequences"],
] as const;

/** What one revision changed compared to the one before, in a few words. */
export function revisionSummary(previous: AdrSnapshot | undefined, current: AdrSnapshot): string[] {
  if (!previous) return ["Created"];
  const changes: string[] = [];
  if (previous.status !== current.status) {
    changes.push(`${STATUS_LABEL[previous.status]} → ${STATUS_LABEL[current.status]}`);
  }
  const edited = PARTS.filter(([key]) => JSON.stringify(previous[key] ?? null) !== JSON.stringify(current[key] ?? null));
  if (edited.length) changes.push(`Edited ${list(edited.map(([, name]) => name))}`);
  if (JSON.stringify(previous.scope ?? null) !== JSON.stringify(current.scope ?? null)) changes.push("Moved to another scope");
  if (!sameSet(previous.links, current.links, (l) => `${l.kind}:${l.id}`)) changes.push("Changed links");
  if (!sameSet(previous.relations, current.relations, (r) => `${r.kind}:${r.adr_id}`)) changes.push("Changed relations");
  return changes.length ? changes : ["No visible change"];
}

function sameSet<T>(a: T[] = [], b: T[] = [], key: (item: T) => string) {
  const left = new Set(a.map(key));
  return left.size === new Set(b.map(key)).size && b.every((item) => left.has(key(item)));
}

/** "title", "title and context", "title, context and decisions". */
function list(items: readonly string[]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
