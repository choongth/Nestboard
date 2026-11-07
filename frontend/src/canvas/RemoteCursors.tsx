import { useStore, ViewportPortal } from "@xyflow/react";
import { useMemo } from "react";
import type { NodeId } from "@/model/types";
import { others, presenceColor, usePresenceStore } from "@/store/presenceStore";

interface Cursor {
  connection: string;
  name: string;
  color: number;
  x: number;
  y: number;
}

/** Other people's pointers on this level, each with their name, in their colour. */
export function RemoteCursors({ level }: { level: NodeId }) {
  const key = usePresenceStore((s) =>
    JSON.stringify(
      others(s).flatMap((p) =>
        p.level === level && p.cursor
          ? [{ connection: p.connection, name: p.name, color: p.color, x: p.cursor.x, y: p.cursor.y }]
          : [],
      ),
    ),
  );
  const cursors = useMemo(() => JSON.parse(key) as Cursor[], [key]);
  // The same size at any zoom.
  const zoom = useStore((s) => s.transform[2]);

  if (cursors.length === 0) return null;
  return (
    <ViewportPortal>
      {cursors.map((cursor) => {
        const color = presenceColor(cursor.color);
        return (
          <div
            key={cursor.connection}
            data-remote-cursor={cursor.name}
            aria-hidden
            // Glides between the updates (a few each second, see files/presence.ts).
            className="pointer-events-none absolute top-0 left-0 z-[1000] transition-transform duration-75 ease-linear"
            style={{ transform: `translate(${cursor.x}px, ${cursor.y}px) scale(${1 / zoom})`, transformOrigin: "0 0" }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow">
              <path
                d="M2 2 L2 15 L6 11.5 L8.7 16.5 L11 15.4 L8.4 10.6 L13.5 10.3 Z"
                fill={color}
                stroke="#0b0d10"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            <span
              className="absolute top-4 left-3.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-black"
              style={{ backgroundColor: color }}
            >
              {cursor.name}
            </span>
          </div>
        );
      })}
    </ViewportPortal>
  );
}
