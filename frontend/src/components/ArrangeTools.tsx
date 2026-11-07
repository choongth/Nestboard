import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  type LucideIcon,
} from "lucide-react";
import { alignBoxes, distributeBoxes, type AlignTo } from "@/model/arrange";
import type { Diagram, NodeId, Position } from "@/model/types";
import { useDiagramStore } from "@/store/diagramStore";

const ALIGN: { to: AlignTo; label: string; icon: LucideIcon }[] = [
  { to: "left", label: "Align left", icon: AlignStartVertical },
  { to: "centre", label: "Align horizontal centres", icon: AlignCenterVertical },
  { to: "right", label: "Align right", icon: AlignEndVertical },
  { to: "top", label: "Align top", icon: AlignStartHorizontal },
  { to: "middle", label: "Align vertical centres", icon: AlignCenterHorizontal },
  { to: "bottom", label: "Align bottom", icon: AlignEndHorizontal },
];

const DISTRIBUTE: { axis: "x" | "y"; label: string; icon: LucideIcon }[] = [
  { axis: "x", label: "Distribute horizontally", icon: AlignHorizontalDistributeCenter },
  { axis: "y", label: "Distribute vertically", icon: AlignVerticalDistributeCenter },
];

/**
 * Lines up or evenly spaces the selected boxes, each as one undo step.
 * Distributing needs three boxes: the outer two stay put.
 */
export function ArrangeTools({ ids }: { ids: readonly NodeId[] }) {
  const moveBoxes = useDiagramStore((s) => s.moveBoxes);
  const apply = (arrange: (diagram: Diagram) => Record<NodeId, Position>) =>
    moveBoxes(arrange(useDiagramStore.getState().diagram));

  return (
    <div data-arrange-tools className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-fg-muted">Arrange</span>
      <div className="flex flex-wrap items-center gap-0.5">
        {ALIGN.map(({ to, label, icon }) => (
          <ToolButton key={to} label={label} icon={icon} onClick={() => apply((d) => alignBoxes(d, ids, to))} />
        ))}
        <span aria-hidden className="mx-1 h-5 w-px bg-line" />
        {DISTRIBUTE.map(({ axis, label, icon }) => (
          <ToolButton
            key={axis}
            label={ids.length < 3 ? `${label} (needs 3 boxes)` : label}
            icon={icon}
            disabled={ids.length < 3}
            onClick={() => apply((d) => distributeBoxes(d, ids, axis))}
          />
        ))}
      </div>
    </div>
  );
}

function ToolButton({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
    >
      <Icon className="size-4" />
    </button>
  );
}
