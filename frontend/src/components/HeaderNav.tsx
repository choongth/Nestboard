import { AppMenu } from "./AppMenu";
import { PageSwitcher } from "./PageSwitcher";
import { ProjectCrumb } from "./ProjectCrumb";

/**
 * The left of a project page's header, from the top down: Nestboard (all
 * projects, organizations), the project, and the page within it.
 */
export function HeaderNav() {
  return (
    <nav aria-label="Where you are" className="flex shrink-0 items-center gap-1">
      <AppMenu />
      <span className="text-fg-subtle">/</span>
      <ProjectCrumb />
      <span className="text-fg-subtle">/</span>
      <PageSwitcher />
    </nav>
  );
}
