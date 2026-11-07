import { useSearchParams } from "react-router";

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Where to go after signing in: `?next=` if it is an address in this app. */
export function useNext(): string {
  const next = useSearchParams()[0].get("next");
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/";
}
