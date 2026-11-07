import { useCallback } from "react";
import { useLocation } from "react-router";
import { projectBase } from "./pages";

/** Turns a page path ("/decisions/7") into its address in the current project. */
export function useProjectPath(): (page: string) => string {
  const base = projectBase(useLocation().pathname);
  return useCallback((page: string) => base + page, [base]);
}
