import { Plus, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { field, quietButton } from "./styles";

interface ItemsEditorProps {
  /** e.g. "decision": names the buttons ("New decision", "Remove decision 2"). */
  noun: string;
  items: string[];
  onChange: (items: string[]) => void;
  /** Drawn before each item (a bullet, a + or a −). */
  marker: ReactNode;
  placeholder: string;
  /** Focus this item once rendered, e.g. one just added from the read view. */
  focusIndex?: number;
  /** The text box style, e.g. green-when-focused for positive consequences. */
  boxClass?: string;
}

/**
 * A list of short texts, edited like a list: Enter starts a new item below,
 * Shift+Enter breaks the line, Backspace in an empty item removes it.
 */
export function ItemsEditor({
  noun,
  items,
  onChange,
  marker,
  placeholder,
  focusIndex,
  boxClass = field,
}: ItemsEditorProps) {
  const boxes = useRef<(HTMLTextAreaElement | null)[]>([]);
  const pendingFocus = useRef<number | null>(focusIndex ?? null);

  useEffect(() => {
    if (pendingFocus.current === null) return;
    boxes.current[pendingFocus.current]?.focus();
    pendingFocus.current = null;
  });

  const insert = (at: number) => {
    pendingFocus.current = at;
    onChange([...items.slice(0, at), "", ...items.slice(at)]);
  };
  const remove = (at: number, focusAfter: number | null) => {
    pendingFocus.current = focusAfter;
    onChange(items.filter((_, i) => i !== at));
  };

  return (
    <div className="flex flex-col gap-1.5">
      {items.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {items.map((item, i) => (
            <li key={i} className="group flex items-start gap-2">
              <span aria-hidden className="mt-2 flex w-4 shrink-0 justify-center">
                {marker}
              </span>
              <textarea
                ref={(el) => {
                  boxes.current[i] = el;
                }}
                aria-label={`${capitalize(noun)} ${i + 1}`}
                rows={1}
                value={item}
                placeholder={placeholder}
                onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    insert(i + 1);
                  } else if (e.key === "Backspace" && item === "") {
                    e.preventDefault();
                    remove(i, i > 0 ? i - 1 : items.length > 1 ? 0 : null);
                  }
                }}
                className={`${boxClass} field-sizing-content min-h-9 resize-none leading-relaxed`}
              />
              <button
                type="button"
                aria-label={`Remove ${noun} ${i + 1}`}
                onClick={() => remove(i, null)}
                className="mt-1.5 rounded p-1 text-fg-subtle opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-surface-hover hover:text-fg focus-visible:opacity-100"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => insert(items.length)} className={`${quietButton} self-start`}>
        <Plus className="size-4" />
        New {noun}
      </button>
    </div>
  );
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
