import { useEffect, useState, type ReactNode } from "react";
import type { Adr, AdrListField, AdrSections } from "@/api/adrs";
import { useDecisionsStore } from "./decisionsStore";
import { DecisionMarker, NegativeMarker, PositiveMarker } from "./ItemMarkers";
import { ItemsEditor } from "./ItemsEditor";
import { field, negativeField, neutralButton, positiveField, quietButton, sectionLabel } from "./styles";

interface AdrEditorProps {
  adr: Adr;
  /** Start with a new, empty item at the end of this list, focused. */
  addTo?: AdrListField;
  /** The page's header for this ADR, with the title box where the title goes. */
  renderHeader: (titleField: ReactNode) => ReactNode;
  /** Gets only what changed; resolves once saved, a rejection's message is shown. */
  onSave: (changes: Partial<AdrSections>) => Promise<void>;
  onCancel: () => void;
}

const LISTS: AdrListField[] = ["decisions", "positive_consequences", "negative_consequences"];

/** Writing a proposed decision: its title, context, decisions and consequences. */
export function AdrEditor({ adr, addTo, renderHeader, onSave, onCancel }: AdrEditorProps) {
  const [draft, setDraft] = useState<AdrSections>(() => {
    const start: AdrSections = {
      title: adr.title,
      context: adr.context,
      decisions: [...adr.decisions],
      positive_consequences: [...adr.positive_consequences],
      negative_consequences: [...adr.negative_consequences],
    };
    if (addTo) start[addTo] = [...start[addTo], ""];
    return start;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = draft.title.replace(/\s+/g, " ").trim();
  const cleaned = Object.fromEntries(
    LISTS.map((key) => [key, draft[key].map((item) => item.trim()).filter(Boolean)]),
  ) as Pick<AdrSections, AdrListField>;
  const changes: Partial<AdrSections> = {};
  if (title !== adr.title) changes.title = title;
  if (draft.context !== adr.context) changes.context = draft.context;
  for (const key of LISTS) {
    if (JSON.stringify(cleaned[key]) !== JSON.stringify(adr[key])) changes[key] = cleaned[key];
  }
  const dirty = Object.keys(changes).length > 0;

  // Tell the page (and the tab) there is unsaved work, so leaving asks first.
  const setDraftDirty = useDecisionsStore((s) => s.setDraftDirty);
  useEffect(() => setDraftDirty(dirty), [dirty, setDraftDirty]);
  useEffect(() => () => setDraftDirty(false), [setDraftDirty]);

  const save = () => {
    if (!title || busy) return;
    if (!dirty) return onCancel();
    setBusy(true);
    setError(null);
    onSave(changes).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    });
  };

  const list = (key: AdrListField) => ({
    items: draft[key],
    onChange: (items: string[]) => setDraft({ ...draft, [key]: items }),
    focusIndex: addTo === key ? draft[key].length - 1 : undefined,
  });

  return (
    <form
      aria-label="Edit decision"
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          save();
        }
      }}
    >
      {renderHeader(
        <input
          autoFocus={!addTo}
          aria-label="Title"
          placeholder="Title"
          maxLength={200}
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className={`${field} min-w-0 flex-1 py-1 text-[15px] font-semibold`}
        />,
      )}

      <label className="flex flex-col gap-1.5">
        <span className={sectionLabel}>Context</span>
        <textarea
          value={draft.context}
          onChange={(e) => setDraft({ ...draft, context: e.target.value })}
          placeholder="What is the issue that motivates this decision?"
          rows={4}
          className={`${field} field-sizing-content min-h-24 resize-y leading-relaxed`}
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className={`${sectionLabel} mb-2`}>Decision</legend>
        <ItemsEditor
          noun="decision"
          marker={<DecisionMarker />}
          placeholder="What did we decide?"
          {...list("decisions")}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className={`${sectionLabel} mb-2`}>Consequences</legend>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-medium text-emerald-300">Positive</legend>
          <ItemsEditor
            noun="positive consequence"
            marker={<PositiveMarker />}
            placeholder="What becomes easier?"
            boxClass={positiveField}
            {...list("positive_consequences")}
          />
        </fieldset>
        <fieldset className="mt-2 flex flex-col gap-2">
          <legend className="mb-2 font-medium text-rose-300">Negative</legend>
          <ItemsEditor
            noun="negative consequence"
            marker={<NegativeMarker />}
            placeholder="What becomes harder, or costs us?"
            boxClass={negativeField}
            {...list("negative_consequences")}
          />
        </fieldset>
      </fieldset>

      {error && <p className="text-danger">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-fg-subtle">
          Markdown supported · Enter adds an item · Ctrl+Enter saves
        </span>
        <button type="button" onClick={onCancel} className={quietButton}>
          Cancel
        </button>
        <button type="submit" disabled={!title || busy} className={neutralButton}>
          Save
        </button>
      </div>
    </form>
  );
}
