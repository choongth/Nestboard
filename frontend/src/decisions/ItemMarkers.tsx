import { Minus, Plus } from "lucide-react";

/** The marker before a decision. */
export function DecisionMarker() {
  return <span className="size-1.5 rounded-full bg-fg-muted" />;
}

/** The marker before a positive consequence. */
export function PositiveMarker() {
  return <Plus className="size-4 text-emerald-300" />;
}

/** The marker before a negative consequence. */
export function NegativeMarker() {
  return <Minus className="size-4 text-rose-300" />;
}
