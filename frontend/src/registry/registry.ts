// A registry of object types grouped into categories. Box types use it now;
// connection types and user-defined types are meant to reuse it later.
// Types are data: a box only stores a type id string, everything else
// (label, icon, colour) is looked up here.

export interface CategoryDefinition {
  /** Stable kebab-case id. */
  id: string;
  label: string;
  /** Category colour, shown alongside the type's icon (never as the only cue). */
  color: string;
  /** Position in pickers, ascending. */
  order: number;
}

export interface ObjectTypeDefinition {
  /** Stable kebab-case id. Part of the file format once published: never renamed or removed. */
  id: string;
  label: string;
  categoryId: string;
  /** Icon key, mapped to an actual icon by the UI. */
  icon: string;
}

export interface ResolvedType<T extends ObjectTypeDefinition> {
  /** The definition to display: the type itself, or the fallback when unknown. */
  type: T;
  category: CategoryDefinition;
  /** False when the stored id is not in this registry (e.g. a file from a newer version). */
  known: boolean;
  /** The id as stored; `undefined` means none was set. Kept so the UI can show it. */
  storedId: string | undefined;
}

export interface Registry<T extends ObjectTypeDefinition> {
  /** Categories in display order. */
  readonly categories: readonly CategoryDefinition[];
  /** Every type, in definition order. */
  readonly types: readonly T[];
  readonly fallback: T;
  get(id: string): T | undefined;
  category(id: string): CategoryDefinition;
  /** What to show for a stored id: missing or unknown ids resolve to the fallback. */
  resolve(storedId: string | undefined): ResolvedType<T>;
  /** Categories in display order with their types, for pickers. Empty categories are left out. */
  grouped(): { category: CategoryDefinition; types: T[] }[];
}

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Builds a registry, refusing inconsistent data up front rather than failing at render time. */
export function createRegistry<T extends ObjectTypeDefinition>(
  categories: readonly CategoryDefinition[],
  types: readonly T[],
  fallbackId: string,
): Registry<T> {
  const categoryById = new Map<string, CategoryDefinition>();
  for (const c of categories) {
    if (!KEBAB_CASE.test(c.id)) throw new Error(`Category id "${c.id}" is not kebab-case`);
    if (categoryById.has(c.id)) throw new Error(`Duplicate category id "${c.id}"`);
    categoryById.set(c.id, c);
  }

  const typeById = new Map<string, T>();
  for (const t of types) {
    if (!KEBAB_CASE.test(t.id)) throw new Error(`Type id "${t.id}" is not kebab-case`);
    if (typeById.has(t.id)) throw new Error(`Duplicate type id "${t.id}"`);
    if (!categoryById.has(t.categoryId)) throw new Error(`Type "${t.id}" has unknown category "${t.categoryId}"`);
    typeById.set(t.id, t);
  }

  const fallback = typeById.get(fallbackId);
  if (!fallback) throw new Error(`Fallback type "${fallbackId}" is not defined`);

  const sortedCategories = [...categories].sort((a, b) => a.order - b.order);
  const category = (id: string) => categoryById.get(id)!;

  return {
    categories: sortedCategories,
    types,
    fallback,
    get: (id) => typeById.get(id),
    category,
    resolve(storedId) {
      const found = storedId === undefined ? fallback : typeById.get(storedId);
      const type = found ?? fallback;
      return { type, category: category(type.categoryId), known: storedId === undefined || !!found, storedId };
    },
    grouped: () =>
      sortedCategories
        .map((c) => ({ category: c, types: types.filter((t) => t.categoryId === c.id) }))
        .filter((g) => g.types.length > 0),
  };
}
