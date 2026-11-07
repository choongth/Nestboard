import type { AdrStatus } from "@/api/adrs";
import { STATUS_BADGE, STATUS_LABEL } from "./status";

const SIZES = {
  small: "px-1.5 py-px text-[11px]",
  normal: "px-2 py-0.5 text-xs",
  /** Next to an ADR's title. */
  large: "px-2.5 py-1 text-[13px]",
};

export function StatusBadge({ status, size = "normal" }: { status: AdrStatus; size?: keyof typeof SIZES }) {
  return (
    <span
      data-status={status}
      className={`inline-flex shrink-0 items-center rounded-full border font-medium ${SIZES[size]} ${STATUS_BADGE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
