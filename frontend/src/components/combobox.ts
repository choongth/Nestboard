export const optionId = (listId: string, index: number) => `${listId}-${index}`;

/** ARIA attributes that make an input the combobox for a suggestion list. */
export function comboboxProps(listId: string, open: boolean, active: number) {
  return {
    role: "combobox",
    "aria-autocomplete": "list" as const,
    "aria-expanded": open,
    "aria-controls": open ? listId : undefined,
    "aria-activedescendant": open && active >= 0 ? optionId(listId, active) : undefined,
  };
}

/** Next highlighted option for ArrowDown/ArrowUp, wrapping around; -1 means none yet. */
export function stepActive(active: number, count: number, key: "ArrowDown" | "ArrowUp"): number {
  if (count === 0) return -1;
  if (key === "ArrowDown") return (active + 1) % count;
  return active <= 0 ? count - 1 : active - 1;
}
