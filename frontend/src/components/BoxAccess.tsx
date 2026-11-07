import { UserPlus, UsersRound, UserRound, X } from "lucide-react";
import { useState } from "react";
import { removeGrant, setGrant, type Grant } from "@/api/access";
import type { ProjectRole } from "@/api/orgs";
import { quietButton } from "@/decisions/styles";
import { can, roleAt } from "@/model/rights";
import type { NodeId } from "@/model/types";
import { useAccessStore } from "@/store/accessStore";
import { useDiagramStore } from "@/store/diagramStore";
import { useSessionStore } from "@/store/sessionStore";
import { ROLE_LABELS } from "@/app/roles";
import { GrantDialog } from "./GrantDialog";

const ORDER: Record<ProjectRole, number> = { owner: 0, editor: 1, viewer: 2 };

const subjectName = (g: Grant) => g.user?.display_name ?? g.group?.name ?? "?";

/**
 * Who has access to a box: the people and groups in charge of it (owners),
 * who can edit it, and who can look; plus what comes from the boxes above.
 * Owners of the box (or above it) change it here.
 */
export function BoxAccess({ boxId }: { boxId: NodeId }) {
  const diagram = useDiagramStore((s) => s.diagram);
  const { rights, grants, diagramId, refresh } = useAccessStore();
  const project = useSessionStore((s) => s.project);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = roleAt(rights, diagram, boxId);
  const manages = diagramId !== null && can(rights, diagram, boxId, "owner");

  const here = grants
    .filter((g) => g.diagram_id === diagramId && g.box_id === boxId)
    .sort((a, b) => ORDER[a.role] - ORDER[b.role] || subjectName(a).localeCompare(subjectName(b)));
  const above: { box: string; grant: Grant }[] = [];
  for (let node = diagram.nodes[diagram.nodes[boxId]?.parentId ?? ""]; node?.parentId; node = diagram.nodes[node.parentId]) {
    for (const g of grants) if (g.diagram_id === diagramId && g.box_id === node.id) above.push({ box: node.title, grant: g });
  }

  const run = (task: () => Promise<unknown>) => {
    setError(null);
    return task()
      .then(() => refresh())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <section aria-label="Access" className="flex flex-col gap-2 border-t border-line pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wider text-fg-subtle uppercase">Access</h3>
        <span className="text-xs text-fg-subtle">You: {ROLE_LABELS[mine]}</span>
      </div>
      {diagramId === null ? (
        <p className="text-xs leading-relaxed text-fg-subtle">Save the diagram to put people in charge of its boxes.</p>
      ) : (
        <>
          {here.length === 0 && above.length === 0 && (
            <p className="text-xs leading-relaxed text-fg-subtle">Nobody has access of their own here: the project's roles apply.</p>
          )}
          <ul className="flex flex-col gap-1">
            {here.map((g) => (
              <li key={g.id} className="flex items-center gap-2">
                <SubjectIcon grant={g} />
                <span className="min-w-0 flex-1 truncate text-fg">{subjectName(g)}</span>
                {manages ? (
                  <>
                    <select
                      aria-label={`Role of ${subjectName(g)}`}
                      value={g.role}
                      onChange={(e) =>
                        void run(() =>
                          setGrant(project!.id, subject(g), e.target.value as ProjectRole, { diagram_id: diagramId, box_id: boxId }),
                        )
                      }
                      className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs text-fg outline-none focus:border-fg"
                    >
                      {(["owner", "editor", "viewer"] as const).map((r) => (
                        <option key={r} value={r}>
                          {r === "owner" ? "In charge" : ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={`Remove ${subjectName(g)}`}
                      onClick={() => void run(() => removeGrant(project!.id, g.id))}
                      className="rounded p-0.5 text-fg-subtle hover:text-fg"
                    >
                      <X className="size-3.5" />
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-fg-subtle">{g.role === "owner" ? "In charge" : ROLE_LABELS[g.role]}</span>
                )}
              </li>
            ))}
          </ul>
          {above.length > 0 && (
            <ul className="flex flex-col gap-0.5" aria-label="From the boxes above">
              {above.map(({ box, grant }) => (
                <li key={grant.id} className="truncate text-xs text-fg-subtle">
                  {subjectName(grant)} · {grant.role === "owner" ? "in charge" : ROLE_LABELS[grant.role].toLowerCase()} of {box}
                </li>
              ))}
            </ul>
          )}
          {manages && (
            <button type="button" onClick={() => setAdding(true)} className={`${quietButton} self-start`}>
              <UserPlus className="size-4" />
              Give access…
            </button>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          {project && (
            <GrantDialog
              open={adding}
              onOpenChange={setAdding}
              title={`Access to ${diagram.nodes[boxId]?.title ?? "this box"}`}
              description="Covers the box and everything inside it. An owner is in charge: they decide its ADRs and can give others access inside it."
              orgId={project.org_id}
              initialRole="owner"
              onGrant={async (who, role) => {
                await setGrant(project.id, who, role, { diagram_id: diagramId, box_id: boxId });
                await refresh();
                setAdding(false);
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

const subject = (g: Grant) => (g.user ? { user_id: g.user.id } : { group_id: g.group!.id });

function SubjectIcon({ grant }: { grant: Grant }) {
  const Icon = grant.group ? UsersRound : UserRound;
  return <Icon aria-label={grant.group ? "Group" : "Person"} className="size-3.5 shrink-0 text-fg-subtle" />;
}
