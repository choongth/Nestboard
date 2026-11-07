import { Tooltip } from "radix-ui";
import { useMemo } from "react";
import { useNavigation } from "@/canvas/navigation";
import type { Diagram } from "@/model/types";
import { useDiagramStore } from "@/store/diagramStore";
import { others, presenceColor, usePresenceStore } from "@/store/presenceStore";

/** Beyond this many people the rest show as "+n". */
const SHOWN = 5;

interface Person {
  userId: string;
  name: string;
  color: number;
  /** The box whose inside they are looking at. */
  level: string | null;
}

/**
 * Who else has the diagram open: one round avatar each, in their colour (one
 * per person, however many tabs). Click one to go to the level they are on.
 */
export function PeopleHere() {
  // Only who and where: their pointer moving often is no reason to redraw.
  const key = usePresenceStore((s) => {
    const people = new Map<string, Person>();
    for (const p of others(s).sort((a, b) => a.connection.localeCompare(b.connection))) {
      if (!people.has(p.user_id)) people.set(p.user_id, { userId: p.user_id, name: p.name, color: p.color, level: p.level });
    }
    return JSON.stringify([...people.values()]);
  });
  const people = useMemo(() => JSON.parse(key) as Person[], [key]);
  const diagram = useDiagramStore((s) => s.diagram);
  const { goTo } = useNavigation();

  if (people.length === 0) return null;
  const shown = people.slice(0, SHOWN);
  const more = people.slice(SHOWN);
  return (
    <div role="group" aria-label="Also here" className="flex items-center -space-x-1">
      {shown.map((person) => {
        const color = presenceColor(person.color);
        const where = whereIs(diagram, person.level);
        return (
          <Tooltip.Root key={person.userId}>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                aria-label={`${person.name}, ${where}. Go there`}
                data-person={person.name}
                onClick={() => person.level && void goTo(person.level)}
                className="flex size-7 items-center justify-center rounded-full border-2 bg-surface text-[11px] font-semibold ring-2 ring-surface outline-none focus-visible:ring-white/40"
                style={{ borderColor: color, color, backgroundImage: `linear-gradient(${color}26, ${color}26)` }}
              >
                {initials(person.name)}
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="bottom"
                sideOffset={6}
                className="z-50 rounded-md border border-line bg-surface-raised px-2 py-1 text-xs text-fg shadow-lg shadow-black/40"
              >
                <span className="font-medium">{person.name}</span> <span className="text-fg-muted">· {where}</span>
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        );
      })}
      {more.length > 0 && (
        <span
          title={more.map((p) => p.name).join(", ")}
          className="flex size-7 items-center justify-center rounded-full border-2 border-line-strong bg-surface text-[11px] font-semibold text-fg-muted ring-2 ring-surface"
        >
          +{more.length}
        </span>
      )}
    </div>
  );
}

function whereIs(diagram: Diagram, level: string | null): string {
  if (level === null || level === diagram.rootId || !diagram.nodes[level]) return "at the top level";
  return `inside ${diagram.nodes[level].title || "a box"}`;
}

/** "Ada Lovelace" → "AL", "ada" → "A". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0]![0]! + words.at(-1)![0]! : (words[0]?.[0] ?? "?")).toUpperCase();
}
