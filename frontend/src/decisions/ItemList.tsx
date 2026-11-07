import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Markdown } from "./Markdown";
import { quietButton } from "./styles";

interface ItemListProps {
  items: string[];
  /** Drawn before each item. */
  marker: ReactNode;
  /** Shown when there are no items. */
  empty: string;
  /** A "+ …" button under the list, when items can be added. */
  add?: { label: string; onClick: () => void };
}

/** A read-only list of decisions or consequences, each a short Markdown text. */
export function ItemList({ items, marker, empty, add }: ItemListProps) {
  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 ? (
        <p className="text-fg-subtle italic">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span aria-hidden className="mt-[0.3rem] flex w-4 shrink-0 justify-center">
                {marker}
              </span>
              <div className="min-w-0 flex-1">
                <Markdown text={item} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {add && (
        <button type="button" onClick={add.onClick} className={`${quietButton} -ml-2 self-start`}>
          <Plus className="size-4" />
          {add.label}
        </button>
      )}
    </div>
  );
}
