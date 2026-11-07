import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { BOX_BACKGROUND } from "@/canvas/boxStyle";
import type { BoxNode } from "@/model/types";
import { boxTypes } from "@/registry/boxTypes";
import {
  allowedTechnologies,
  findAllowed,
  technologySuggestions,
  type SuggestionGroup,
} from "@/registry/technologySuggestions";
import { useDiagramStore } from "@/store/diagramStore";
import { comboboxProps, stepActive } from "./combobox";
import { Field, INPUT_CLASS, SuggestionPopover } from "./SuggestionPopover";
import { TechMark } from "./TechMark";
import { TextField } from "./TextField";

/**
 * The box's technology. A type with a technology list only allows picking
 * from it; types without one (generic, group, note, actor) take free text.
 */
export function TechnologyField({ node }: { node: BoxNode }) {
  const allowed = allowedTechnologies(node.typeId);
  const updateBox = useDiagramStore((s) => s.updateBox);
  const diagram = useDiagramStore((s) => s.diagram);
  const freeSuggestions = useMemo(
    () => (allowed ? [] : technologySuggestions(diagram, node.id)),
    [allowed, diagram, node.id],
  );

  if (!allowed) {
    return (
      <TextField
        label="Technology"
        value={node.technology ?? ""}
        suggestions={freeSuggestions}
        placeholder="e.g. PostgreSQL, React"
        onChange={(v) => updateBox(node.id, { technology: v || undefined })}
      />
    );
  }
  return (
    <TechnologyPicker
      // Reset typing state when the box or its list changes.
      key={`${node.id}:${node.typeId}`}
      node={node}
      allowed={allowed}
      onPick={(technology) => updateBox(node.id, { technology })}
    />
  );
}

interface TechnologyPickerProps {
  node: BoxNode;
  allowed: readonly string[];
  /** Called with the new technology, or `undefined` to clear it. Each call is one undo step. */
  onPick: (technology: string | undefined) => void;
}

/**
 * A searchable dropdown over the type's technologies. Typing only filters the
 * list; nothing is saved until an item is picked, and unmatched text is
 * dropped on leaving the field. Backspace on a chosen technology clears it.
 */
function TechnologyPicker({ node, allowed, onPick }: TechnologyPickerProps) {
  const id = useId();
  const listId = useId();
  const typeLabel = boxTypes.resolve(node.typeId).type.label;
  const value = node.technology ?? "";
  /** What is being typed; `null` while the field just shows the chosen technology. */
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const q = query?.trim().toLowerCase() ?? "";
  const items = q ? allowed.filter((t) => t.toLowerCase().includes(q)) : [...allowed];
  const groups: SuggestionGroup[] = items.length ? [{ label: `${typeLabel} technologies`, items }] : [];
  const showList = open && items.length > 0;
  const notOnList = value !== "" && !findAllowed(allowed, value);

  const leave = () => (document.activeElement as HTMLElement | null)?.blur();
  const pick = (item: string) => {
    if (item !== value) onPick(item);
    setQuery(null);
    leave();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Escape that closed the list (handled by the popover) stops there.
    if (event.defaultPrevented) return;
    if ((event.key === "Backspace" || event.key === "Delete") && query === null && value) {
      // A chosen technology goes in one keystroke, not letter by letter.
      event.preventDefault();
      onPick(undefined);
      setOpen(true);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => stepActive(i, items.length, event.key as "ArrowDown" | "ArrowUp"));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = (showList && items[active]) || (query ? findAllowed(allowed, query) : undefined);
      if (item) pick(item);
      else leave();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      leave();
    }
  };

  return (
    <Field id={id} label="Technology">
      <SuggestionPopover
        open={showList}
        onClose={() => setOpen(false)}
        inputId={id}
        listId={listId}
        label="Technology suggestions"
        groups={groups}
        active={active}
        onActiveChange={setActive}
        onPick={pick}
        renderBefore={(item) => <TechMark technology={item} background={BOX_BACKGROUND} size={18} decorative />}
      >
        <div className="relative">
          {query === null && value && (
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2">
              <TechMark technology={value} background={BOX_BACKGROUND} size={18} decorative />
            </span>
          )}
          <input
            id={id}
            type="text"
            autoComplete="off"
            value={query ?? value}
            placeholder={`Choose a ${typeLabel.toLowerCase()} technology`}
            className={`${INPUT_CLASS} ${query === null && value ? "pl-9" : ""} ${notOnList && query === null ? "text-fg-muted" : ""}`}
            onFocus={(e) => {
              setOpen(true);
              e.currentTarget.select();
            }}
            onBlur={() => {
              setOpen(false);
              setQuery(null); // unmatched typing is dropped
              setActive(-1);
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(e.target.value.trim() ? 0 : -1);
            }}
            onKeyDown={onKeyDown}
            {...comboboxProps(listId, showList, active)}
          />
        </div>
      </SuggestionPopover>
      {notOnList && (
        <p data-not-on-list className="text-xs leading-relaxed text-fg-subtle">
          “{value}” isn’t on the {typeLabel} list. Pick one, or press Backspace to clear it.
        </p>
      )}
    </Field>
  );
}
