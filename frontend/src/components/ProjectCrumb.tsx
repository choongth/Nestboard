import { Building2, Check, ChevronsUpDown, FolderKanban, PencilLine, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import { useNavigate } from "react-router";
import { deleteProject, listProjects, renameProject, type Project } from "@/api/orgs";
import { orgPath, projectPath } from "@/app/pages";
import { newDiagram } from "@/files/documentActions";
import { useSessionStore } from "@/store/sessionStore";
import { DeleteByNameDialog } from "./DeleteByNameDialog";
import { RenameDialog } from "./RenameDialog";
import { useLeaveGuard } from "./useLeaveGuard";

const item =
  "flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-fg outline-none select-none data-highlighted:bg-surface-hover";

/**
 * "Acme / Checkout": the project being worked in. Opens a menu to switch to
 * another of the organization's projects; its owners also rename or delete it.
 */
export function ProjectCrumb() {
  const project = useSessionStore((s) => s.project);
  const setProject = useSessionStore((s) => s.setProject);
  const navigate = useNavigate();
  const { go, dialog } = useLeaveGuard();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [managing, setManaging] = useState<"rename" | "delete" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!project) return null;
  const org = project.organization;

  return (
    <>
      <DropdownMenu.Root
        onOpenChange={(open) => {
          if (open) {
            listProjects(project.org_id).then(
              (all) => setProjects(all.filter((p) => p.role !== null)),
              () => setProjects([]),
            );
          }
        }}
      >
        <DropdownMenu.Trigger
          title="Switch project"
          // Both names always in full; the header shortens other things first.
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 whitespace-nowrap text-fg-muted outline-none hover:bg-surface-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-white/25 data-[state=open]:bg-surface-hover"
        >
          <span>{org.name}</span>
          <span className="text-fg-subtle">/</span>
          <span className="font-medium text-fg">{project.name}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-fg-subtle" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className="z-50 max-h-[70vh] min-w-64 overflow-y-auto rounded-lg border border-line bg-surface-raised p-1 shadow-xl shadow-black/40"
          >
            <DropdownMenu.Label className="flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-xs font-medium text-fg-subtle">
              <Building2 className="size-3.5" />
              Projects in {org.name}
            </DropdownMenu.Label>
            {projects === null && <p className="px-2 py-1.5 text-fg-subtle">Loading…</p>}
            {projects?.map((p) => (
              <DropdownMenu.Item
                key={p.id}
                onSelect={() => p.id !== project.id && go(projectPath(project.org_id, p.id))}
                className={item}
              >
                <FolderKanban className="size-4 text-fg-muted" />
                <span className="flex-1 truncate">{p.name}</span>
                {p.id === project.id && <Check aria-label="Current project" className="size-4 text-accent-hover" />}
              </DropdownMenu.Item>
            ))}
            {project.role === "owner" && (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-line" />
                <DropdownMenu.Item onSelect={() => setManaging("rename")} className={item}>
                  <PencilLine className="size-4 text-fg-muted" />
                  Rename project…
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => setManaging("delete")} className={`${item} text-danger`}>
                  <Trash2 className="size-4" />
                  Delete project…
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {dialog}
      {problem && (
        <span role="alert" className="text-xs text-danger">
          {problem}
        </span>
      )}
      <RenameDialog
        open={managing === "rename"}
        onOpenChange={(open) => !open && setManaging(null)}
        title="Rename project"
        label="Project name"
        current={project.name}
        onRename={(name) => {
          setProblem(null);
          renameProject(project.id, project.version, name).then(setProject, (e: unknown) =>
            setProblem(e instanceof Error ? e.message : String(e)),
          );
        }}
      />
      <DeleteByNameDialog
        open={managing === "delete"}
        onOpenChange={(open) => !open && setManaging(null)}
        title={`Delete ${project.name}?`}
        description="Its diagrams, decisions and everyone's access to it are deleted for good. This cannot be undone."
        name={project.name}
        onDelete={async () => {
          await deleteProject(project.id);
          // Whatever was open belonged to it.
          newDiagram();
          setProject(null);
          void navigate(orgPath(project.org_id), { replace: true });
        }}
      />
    </>
  );
}
