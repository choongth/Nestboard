// The drawings of the technology logos named in technologyLogos.ts. They are
// in logoDrawings.json, which holds only the logos we use, copied from
// simple-icons and @iconify-json/logos by logoDrawings.test.ts. It is loaded
// the first time a logo is drawn, so it stays out of the first page load.

import { useEffect, useState } from "react";
import { contrastRatio, readableColor } from "./technologyLogos";

/** A one-colour logo: a 24×24 path, filled with its brand colour. */
export interface SimpleDrawing {
  path: string;
  /** The brand colour, as #rrggbb. */
  color: string;
}

/** A full-colour logo. */
export interface ColorDrawing {
  /** What goes inside an <svg viewBox="0 0 width height">. */
  body: string;
  width: number;
  height: number;
  /** Every colour it paints with, as #rrggbb; shapes with no fill count as black. */
  colors: string[];
}

export interface LogoDrawings {
  /** By slug in simple-icons. */
  simple: Record<string, SimpleDrawing>;
  /** By key in SVG Logos. */
  color: Record<string, ColorDrawing>;
}

/** What a full-colour logo with parts too dark for its background sits on. */
export const LOGO_BACKING = "#e8ecf2";

let drawings: LogoDrawings | null = null;
let loading: Promise<LogoDrawings> | null = null;

export function loadLogoDrawings(): Promise<LogoDrawings> {
  loading ??= import("./logoDrawings.json").then((m) => (drawings = m.default as LogoDrawings));
  return loading;
}

/** The logo drawings, or `null` until logoDrawings.json has loaded. */
export function useLogoDrawings(): LogoDrawings | null {
  const [, loaded] = useState(drawings !== null);
  useEffect(() => {
    if (drawings === null) void loadLogoDrawings().then(() => loaded(true));
  }, []);
  return drawings;
}

const readable = new Map<string, string>();

/** A one-colour logo's colour on `background`: its brand colour, lightened until it reads (3:1). */
export function logoColor(logo: SimpleDrawing, background: string): string {
  // Worked out once per colour and background: boxes redraw often.
  const key = `${logo.color} ${background}`;
  let color = readable.get(key);
  if (color === undefined) readable.set(key, (color = readableColor(logo.color, background)));
  return color;
}

/** Whether some of a full-colour logo would vanish on `background` (under 1.5:1), so it needs LOGO_BACKING behind it. */
export function needsBacking(logo: Pick<ColorDrawing, "colors">, background: string): boolean {
  return logo.colors.some((c) => contrastRatio(c, background) < 1.5);
}
