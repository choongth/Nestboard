// What the Technology field accepts and offers (box-type-specs.md §5). A type
// with a technology list only allows technologies from it; types without one
// (generic, group, note, actor) take free text, with suggestions from what
// this diagram already uses where that applies.

import type { Diagram, NodeId } from "@/model/types";
import { boxTypes } from "./boxTypes";

export interface SuggestionGroup {
  label: string;
  items: string[];
}

/** Types that are not system components get no suggestions at all. */
const NO_SUGGESTIONS = new Set(["generic", "group", "note"]);

/**
 * The technologies a box of this type may use, or `null` when the type has no
 * list and any text is allowed. Unknown types behave as generic: free text.
 */
export function allowedTechnologies(typeId: string | undefined): readonly string[] | null {
  const { type, known } = boxTypes.resolve(typeId);
  const list = known ? type.suggestedTechnologies : undefined;
  return list && list.length > 0 ? list : null;
}

/** Whether `technology` is one of `allowed`, ignoring case and spacing. */
export function findAllowed(allowed: readonly string[], technology: string): string | undefined {
  return allowed.find((t) => normalise(t) === normalise(technology));
}

/** Free-text suggestions for a box whose type has no list, before filtering by what has been typed. */
export function technologySuggestions(diagram: Diagram, nodeId: NodeId): SuggestionGroup[] {
  const node = diagram.nodes[nodeId];
  if (!node) return [];
  const { type, known } = boxTypes.resolve(node.typeId);
  // Unknown types are shown as generic, so they behave like it here too.
  if (!known || NO_SUGGESTIONS.has(type.id)) return [];

  const suggested = [...(type.suggestedTechnologies ?? [])];
  const taken = new Set(suggested.map(normalise));

  // Technologies on other boxes, most-used first; spelled as first written.
  const used = new Map<string, { text: string; count: number }>();
  for (const other of Object.values(diagram.nodes)) {
    if (other.id === nodeId || !other.technology?.trim()) continue;
    const key = normalise(other.technology);
    if (taken.has(key)) continue;
    const entry = used.get(key);
    if (entry) entry.count++;
    else used.set(key, { text: other.technology.trim(), count: 1 });
  }
  const usedItems = [...used.values()]
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .map((e) => e.text);

  return [
    { label: `Suggested for ${type.label}`, items: suggested },
    { label: "Used in this diagram", items: usedItems },
  ].filter((g) => g.items.length > 0);
}

/**
 * Narrows suggestions to those containing `query` (case-insensitive). An item
 * equal to the query is dropped: offering what is already typed adds nothing.
 */
export function filterSuggestions(groups: SuggestionGroup[], query: string): SuggestionGroup[] {
  const q = normalise(query);
  return groups
    .map((g) => ({ ...g, items: g.items.filter((item) => normalise(item).includes(q) && normalise(item) !== q) }))
    .filter((g) => g.items.length > 0);
}

function normalise(text: string) {
  return text.trim().toLowerCase();
}
