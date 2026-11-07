// Visual constants for boxes that tests also need, so the two cannot drift.

/** How strongly the category colour tints the icon tile (0–1), over the box background. */
export const ICON_TILE_TINT = 0.18;

/** Background for an icon tile: the category colour, faintly, over whatever is behind. */
export const iconTileBackground = (color: string) =>
  `color-mix(in srgb, ${color} ${Math.round(ICON_TILE_TINT * 100)}%, transparent)`;

/** Box fills, as hex for colour maths (logo contrast). Must match index.css; a test checks. */
export const BOX_BACKGROUND = "#242831"; // --color-surface-raised
export const NOTE_BACKGROUND = "#2c281c"; // --color-note
