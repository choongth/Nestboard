import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { filterSuggestions, type SuggestionGroup } from "@/registry/technologySuggestions";
import { useDiagramStore } from "@/store/diagramStore";
import { comboboxProps, stepActive } from "./combobox";
import { Field, INPUT_CLASS, SuggestionPopover } from "./SuggestionPopover";

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Runs inside the edit's undo step, just before it is recorded. */
  onBeforeCommit?: () => void;
  placeholder?: string;
  multiline?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  /**
   * Offered in a list under the field while it has focus, narrowed by what is
   * typed. The field still accepts any text. Single-line fields only.
   */
  suggestions?: SuggestionGroup[];
}

/** Edits live; everything typed before the field loses focus is one undo step. */
export function TextField({
  label,
  value,
  onChange,
  onBeforeCommit,
  placeholder,
  multiline,
  inputRef,
  suggestions,
}: TextFieldProps) {
  const id = useId();
  const listId = useId();
  const beginTransaction = useDiagramStore((s) => s.beginTransaction);
  const commitRef = useRef<(() => void) | null>(null);

  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const groups = suggestions ? filterSuggestions(suggestions, value) : [];
  const items = groups.flatMap((g) => g.items);
  const showList = listOpen && items.length > 0;

  // If the panel goes away mid-edit, still record the edit.
  useEffect(
    () => () => {
      commitRef.current?.();
      commitRef.current = null;
    },
    [],
  );

  const handleChange = (next: string) => {
    // The undo step opens at the first keystroke, not on focus, so merely
    // clicking into a field records nothing.
    commitRef.current ??= beginTransaction();
    onChange(next);
    setListOpen(true);
    setActive(-1);
  };
  const onBlur = () => {
    setListOpen(false);
    if (!commitRef.current) return;
    onBeforeCommit?.();
    commitRef.current();
    commitRef.current = null;
  };
  /** Fills in a suggestion; it joins whatever was typed into the same undo step. */
  const accept = (item: string) => {
    handleChange(item);
    // Focus never left the field (options keep it there), so this commits the edit.
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // Escape that closed the suggestion list (handled by the popover) stops there.
    if (event.defaultPrevented) return;
    if (showList && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setActive((i) => stepActive(i, items.length, event.key as "ArrowDown" | "ArrowUp"));
      return;
    }
    if (showList && event.key === "Enter" && active >= 0) {
      event.preventDefault();
      accept(items[active]!);
      return;
    }
    if (event.key === "Escape" || (event.key === "Enter" && !multiline)) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  const common = { id, value, placeholder, onBlur, onKeyDown };

  if (multiline) {
    return (
      <Field id={id} label={label}>
        <textarea
          {...common}
          rows={5}
          className={`${INPUT_CLASS} resize-none`}
          onChange={(e) => handleChange(e.target.value)}
        />
      </Field>
    );
  }

  return (
    <Field id={id} label={label}>
      <SuggestionPopover
        open={showList}
        onClose={() => setListOpen(false)}
        inputId={id}
        listId={listId}
        label={`${label} suggestions`}
        groups={groups}
        active={active}
        onActiveChange={setActive}
        onPick={accept}
      >
        <input
          {...common}
          ref={inputRef}
          type="text"
          className={INPUT_CLASS}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setListOpen(true)}
          {...(suggestions && comboboxProps(listId, showList, active))}
        />
      </SuggestionPopover>
    </Field>
  );
}
