import { Command } from "cmdk";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover } from "radix-ui";
import { useId, useState, type ReactNode } from "react";
import { boxTypes } from "@/registry/boxTypes";
import type { ObjectTypeDefinition, Registry } from "@/registry/registry";
import { GROUP_HEADING_CLASS } from "./commandList";
import { TypeTile } from "./TypeTile";

interface TypePickerProps<T extends ObjectTypeDefinition> {
  /** The stored type id; may be missing (generic) or unknown to this version. */
  value: string | undefined;
  /** Called with the chosen type id, or `undefined` for generic. Not called when nothing changes. */
  onChange: (typeId: string | undefined) => void;
  /** Which types to offer: box types by default, or connection types. */
  registry?: Registry<T>;
  /** Accessible name of the list, e.g. "Box types". */
  listLabel?: string;
  /** Drawn at the end of each option, e.g. a sample of a connection's line. */
  renderExtra?: (type: T) => ReactNode;
}

/** A searchable dropdown of types (box or connection), grouped by category, with icons. */
export function TypePicker<T extends ObjectTypeDefinition>({
  value,
  onChange,
  registry = boxTypes as unknown as Registry<T>,
  listLabel = "Box types",
  renderExtra,
}: TypePickerProps<T>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const current = registry.resolve(value);

  const choose = (typeId: string) => {
    setOpen(false);
    // Generic (the fallback) is stored as no type, so a picked generic and a new item are identical.
    const next = typeId === registry.fallback.id ? undefined : typeId;
    if (next !== value) onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-fg-muted">
        Type
      </label>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          id={id}
          className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-canvas px-2 py-1.5 text-left outline-none transition-colors hover:border-line-strong focus-visible:border-fg-muted focus-visible:ring-2 focus-visible:ring-white/10 data-[state=open]:border-fg-muted"
        >
          <TypeTile icon={current.type.icon} color={current.category.color} size="sm" />
          {current.known ? (
            <span className="min-w-0 flex-1 truncate text-fg">{current.type.label}</span>
          ) : (
            <span className="min-w-0 flex-1 truncate" title={`Unknown type "${value}", shown as Generic`}>
              <span className="font-mono text-xs text-fg">{value}</span>
              <span className="ml-1.5 text-xs text-fg-subtle">unknown type</span>
            </span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" />
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            // Keeps the list on screen in a short window; it scrolls inside.
            collisionPadding={12}
            className="z-50 w-(--radix-popover-trigger-width) overflow-hidden rounded-lg border border-line bg-surface-raised shadow-xl shadow-black/40"
          >
            <Command
              label={listLabel}
              // The list is long; start with the current type highlighted.
              defaultValue={current.known ? current.type.id : undefined}
              className="flex max-h-[min(420px,var(--radix-popover-content-available-height))] flex-col"
            >
              <Command.Input
                placeholder="Search types…"
                className="border-b border-line bg-transparent px-3 py-2.5 text-fg outline-none placeholder:text-fg-subtle"
              />
              <Command.List className="min-h-0 overflow-y-auto p-1">
                <Command.Empty className="px-2 py-6 text-center text-fg-subtle">No matching type</Command.Empty>
                {registry.grouped().map(({ category, types }) => (
                  <Command.Group
                    key={category.id}
                    heading={category.label}
                    className={GROUP_HEADING_CLASS}
                  >
                    {types.map((type) => (
                      <Command.Item
                        key={type.id}
                        value={type.id}
                        // Search by name, and by category ("data" finds caches too).
                        keywords={[type.label, category.label]}
                        onSelect={choose}
                        className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-fg outline-none select-none data-[selected=true]:bg-surface-hover"
                      >
                        <TypeTile icon={type.icon} color={category.color} size="sm" />
                        <span className="min-w-0 flex-1 truncate">{type.label}</span>
                        {renderExtra?.(type)}
                        {current.known && type.id === current.type.id && (
                          <Check aria-label="Current type" className="size-4 shrink-0 text-fg" />
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>
            </Command>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
