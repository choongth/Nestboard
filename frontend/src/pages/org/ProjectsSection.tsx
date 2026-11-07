import { FolderKanban, Lock, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { takeOver } from "@/api/access";
import { createProject, type Organization, type Project } from "@/api/orgs";
import { projectPath } from "@/app/pages";
import { ROLE_LABELS } from "@/app/roles";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { NameDialog } from "@/components/NameDialog";
import { quietButton } from "@/decisions/styles";

const card = "flex h-28 flex-col justify-center gap-2 rounded-xl border border-line bg-surface p-4 outline-none";
const grid = "grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4";

/**
 * The organization's projects: a search box and a new project, then a card
 * for each project you may open (org admins also see the others, and may
 * take one over).
 */
export function ProjectsSection({ org, projects }: { org: Organization; projects: Project[] }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const q = query.trim().toLowerCase();
  const shown = projects.filter((p) => !q || p.name.toLowerCase().includes(q));

  return (
    <section aria-label="Projects" className="flex flex-col gap-6">
      <div className={grid}>
        <label className={`${card} cursor-text flex-row items-center justify-center focus-within:border-fg`}>
          <Search className="size-4 shrink-0 text-fg-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects"
            aria-label="Search projects"
            className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-subtle"
          />
        </label>
        {org.membership.can_create_projects && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={`${card} flex-row items-center justify-center font-medium text-fg hover:border-line-strong hover:bg-surface-hover focus-visible:border-fg`}
          >
            <Plus className="size-4" />
            New project
          </button>
        )}
      </div>

      {projects.length === 0 ? (
        <p className="text-fg-subtle">No projects yet.</p>
      ) : shown.length === 0 ? (
        <p className="text-fg-subtle">No project matches.</p>
      ) : (
        <ul className={grid}>
          {shown.map((project) => (
            <li key={project.id}>
              <ProjectCard
                org={org}
                project={project}
                onTakeOver={async () => {
                  await takeOver(project.id);
                  void navigate(projectPath(org.id, project.id));
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <NameDialog
          title={`New project in ${org.name}`}
          description="You become its owner, and can give others access."
          onClose={() => setCreating(false)}
          onCreate={async (name) => {
            const project = await createProject(org.id, name);
            void navigate(projectPath(org.id, project.id));
          }}
        />
      )}
    </section>
  );
}

function ProjectCard({ org, project, onTakeOver }: { org: Organization; project: Project; onTakeOver: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  if (project.role === null) {
    // Only org admins see projects they have no access to: they may take one over.
    return (
      <div className={card} title="You can see it as an org admin, but have no access to its content">
        <span className="flex items-center gap-2 font-medium text-fg-muted">
          <Lock className="size-4 text-fg-subtle" />
          {project.name}
        </span>
        <span className="flex items-center justify-between text-xs text-fg-subtle">
          No access
          <button type="button" onClick={() => setConfirming(true)} className={quietButton}>
            Take over…
          </button>
        </span>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={`Take over ${project.name}?`}
          description="You become an owner of the project. Its activity log records that you did, for everyone in it to see."
          confirmLabel="Take over"
          tone="accent"
          onConfirm={() => void onTakeOver()}
        />
      </div>
    );
  }
  return (
    <Link
      to={projectPath(org.id, project.id)}
      className={`${card} hover:border-line-strong hover:bg-surface-hover focus-visible:border-fg`}
    >
      <span className="flex items-center gap-2 font-medium text-fg">
        <FolderKanban className="size-4 text-fg-muted" />
        {project.name}
      </span>
      <span className="text-xs text-fg-subtle">{ROLE_LABELS[project.role]}</span>
    </Link>
  );
}
