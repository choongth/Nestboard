import type { HTMLAttributes } from "react";
import { iconTileBackground } from "@/canvas/boxStyle";
import { TypeIconGlyph } from "./typeIcons";

const SIZES = {
  /** In a box's label. */
  xs: { tile: "size-4 rounded", glyph: "size-3", strokeWidth: 2.25 },
  /** In lists: type pickers, "Connect to". */
  sm: { tile: "size-6 rounded-md", glyph: "size-3.5", strokeWidth: undefined },
  /** On an external box. */
  md: { tile: "size-7 rounded-md", glyph: "size-4", strokeWidth: undefined },
} as const;

/** A type's icon on a tile tinted with its category's colour. */
export function TypeTile({
  icon,
  color,
  size,
  className,
  ...props
}: { icon: string; color: string; size: keyof typeof SIZES } & HTMLAttributes<HTMLSpanElement>) {
  const s = SIZES[size];
  return (
    <span
      aria-hidden
      className={["flex shrink-0 items-center justify-center", s.tile, className].filter(Boolean).join(" ")}
      style={{ backgroundColor: iconTileBackground(color), color }}
      {...props}
    >
      <TypeIconGlyph icon={icon} className={s.glyph} strokeWidth={s.strokeWidth} />
    </span>
  );
}
