import {
  LOGO_BACKING,
  logoColor,
  needsBacking,
  useLogoDrawings,
  type ColorDrawing,
  type SimpleDrawing,
} from "@/registry/logoDrawings";
import { technologyMark } from "@/registry/technologyLogos";

interface TechMarkProps {
  technology: string | undefined;
  /** Hex colour behind the mark; dark brand colours are lightened against it. */
  background: string;
  /** Edge length in pixels. */
  size: number;
  /** Hide from screen readers when the name is written right beside it. */
  decorative?: boolean;
}

/**
 * A technology's logo, or a two-letter monogram when it has none. Nothing
 * when no technology is set. Logos are empty for the moment it takes to load
 * their drawings, the first time one is shown.
 */
export function TechMark({ technology, background, size, decorative }: TechMarkProps) {
  const mark = technologyMark(technology);
  const drawings = useLogoDrawings();
  if (!mark) return null;
  return (
    <span
      data-tech-logo={mark.kind}
      title={decorative ? undefined : technology}
      aria-hidden={decorative || undefined}
      className="flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      {mark.kind === "monogram" ? (
        <span
          aria-label={technology}
          className="flex h-full w-full items-center justify-center rounded-md bg-surface-hover font-bold tracking-wide text-fg-muted"
          style={{ fontSize: Math.round(size * 0.38) }}
        >
          {mark.text}
        </span>
      ) : mark.kind === "logo" ? (
        drawings && <SimpleLogo title={mark.title} drawing={drawings.simple[mark.slug]!} background={background} size={size} />
      ) : (
        drawings && <ColorLogo title={mark.title} drawing={drawings.color[mark.key]!} background={background} size={size} />
      )}
    </span>
  );
}

type DrawingProps<T> = { title: string; drawing: T; background: string; size: number };

function SimpleLogo({ title, drawing, background, size }: DrawingProps<SimpleDrawing>) {
  return (
    <svg role="img" aria-label={title} viewBox="0 0 24 24" width={size} height={size} fill={logoColor(drawing, background)}>
      <path d={drawing.path} />
    </svg>
  );
}

function ColorLogo({ title, drawing, background, size }: DrawingProps<ColorDrawing>) {
  const backed = needsBacking(drawing, background);
  // On a backing, the logo shrinks to leave a margin round it.
  const inner = backed ? Math.round(size * 0.78) : size;
  return (
    <span
      className="flex h-full w-full items-center justify-center rounded-[4px]"
      style={backed ? { backgroundColor: LOGO_BACKING } : undefined}
    >
      <svg
        role="img"
        aria-label={title}
        viewBox={`0 0 ${drawing.width} ${drawing.height}`}
        width={inner}
        height={inner}
        // The drawings are our own copy of SVG Logos (logoDrawings.json), not user input.
        dangerouslySetInnerHTML={{ __html: drawing.body }}
      />
    </span>
  );
}
