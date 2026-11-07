import { Box, UserPlus, UserRound, UsersRound, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  getDiagramAccess,
  listActivity,
  removeGrant,
  setGrant,
  type Activity,
  type Grant,
  type Subject,
} from "@/api/access";
import { getDiagram, listDiagrams } from "@/api/diagrams";
import type { ProjectRole } from "@/api/orgs";
import { DIAGRAM_PARAM } from "@/app/DiagramSession";
import { formatDateTime } from "@/app/dates";
import { ROLE_LABELS } from "@/app/roles";
import { useProjectPath } from "@/app/useProjectPath";
import { AccountMenu } from "@/components/AccountMenu";
import { GrantDialog } from "@/components/GrantDialog";
import { TimeArrow } from "@/components/TimeArrow";
import { HeaderNav } from "@/components/HeaderNav";
import { quietButton, scrollArea, sectionLabel } from "@/decisions/styles";
import { boxTitles, joinPath, walkBoxes } from "@/model/queries";
import { can, type Rights } from "@/model/rights";
import { fromRecord } from "@/model/records";
import type { Diagram } from "@/model/types";
import { useAccessStore } from "@/store/accessStore";
import { useSessionStore } from "@/store/sessionStore";

const ORDER: Record<ProjectRole, number> = { owner: 0, editor: 1, viewer: 2 };
const nameOf = (g: Grant) => g.user?.display_name ?? g.group?.name ?? "?";
const subjectOf = (g: Grant): Subject => (g.user ? { user_id: g.user.id } : { group_id: g.group!.id });
const byRoleThenName = (a: Grant, b: Grant) => ORDER[a.role] - ORDER[b.role] || nameOf(a).localeCompare(nameOf(b));

/** A diagram with grants on its boxes: its content (for where each box is) and your rights in it. */
interface DiagramInfo {
  id: string;
  name: string;
  diagram: Diagram | null;
  rights: Rights | null;
}

/**
 * Who works on the project: grants on the whole project, then grants on boxes
 * laid out along the box tree of each diagram, so it shows at a glance who is
 * in charge of what. Owners change it here; the activity log below says who
 * changed what.
 */
export function PeoplePage() {
  const project = useSessionStore((s) => s.project)!;
  const grants = useAccessStore((s) => s.grants);
  const refreshGrants = useAccessStore((s) => s.refresh);
  const [diagrams, setDiagrams] = useState<DiagramInfo[]>([]);
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = project.role === "owner";

  useEffect(() => {
    document.title = `People · ${project.name} — Nestboard`;
  }, [project.name]);

  const boxDiagramIds = useMemo(
    () => [...new Set(grants.filter((g) => g.diagram_id).map((g) => g.diagram_id!))].sort(),
    [grants],
  );

  const load = useCallback(async () => {
    const [names, log] = await Promise.all([listDiagrams(project.id), listActivity(project.id)]);
    setActivity(log);
    const nameById = new Map(names.items.map((d) => [d.id, d.name]));
    setDiagrams(
      await Promise.all(
        boxDiagramIds.map(async (id): Promise<DiagramInfo> => {
          const [record, access] = await Promise.all([getDiagram(id).catch(() => null), getDiagramAccess(id).catch(() => null)]);
          return {
            id,
            name: nameById.get(id) ?? record?.name ?? "Deleted diagram",
            diagram: record ? fromRecord(record) : null,
            rights: access ? { projectRole: access.project_role, boxRoles: access.box_roles } : null,
          };
        }),
      ),
    );
  }, [project.id, boxDiagramIds]);

  useEffect(() => {
    void refreshGrants();
  }, [refreshGrants]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  const change = (task: () => Promise<unknown>) => {
    setError(null);
    return task()
      .then(() => refreshGrants())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const wide = grants.filter((g) => !g.box_id).sort(byRoleThenName);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
        <HeaderNav />
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <AccountMenu />
        </div>
      </header>

      {/* Three columns across the page, each scrolling on its own: who has
          the whole project, who has which box, and what changed. */}
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(260px,1fr)_minmax(360px,1.5fr)_minmax(260px,1fr)] bg-canvas">
        <Column
          label="Whole project"
          className="border-r border-line bg-surface"
          action={
            owner && (
              <button type="button" onClick={() => setAdding(true)} className={quietButton}>
                <UserPlus className="size-4" />
                Give access…
              </button>
            )
          }
        >
          <p className="text-fg-muted">
            You are {project.role === "owner" ? "an owner" : `a${project.role === "editor" ? "n" : ""} ${project.role}`}{" "}
            of {project.name}.
          </p>
          {error && <p className="text-danger">{error}</p>}
          <GrantList
            grants={wide}
            canManage={owner}
            onRole={(g, role) => change(() => setGrant(project.id, subjectOf(g), role))}
            onRemove={(g) => change(() => removeGrant(project.id, g.id))}
          />
        </Column>

        <Column label="Boxes">
          <p className="text-fg-subtle">
            A grant on a box covers it and everything inside it; an owner of a box is in charge of it.
          </p>
          {boxDiagramIds.length === 0 && (
            <p className="text-fg-muted">
              Nobody has access to a single box yet. Select a box in the editor to put someone in charge of it.
            </p>
          )}
          {diagrams.map((info) => (
            <DiagramGrants
              key={info.id}
              info={info}
              grants={grants.filter((g) => g.diagram_id === info.id)}
              projectOwner={owner}
              onRole={(g, role) =>
                change(() => setGrant(project.id, subjectOf(g), role, { diagram_id: info.id, box_id: g.box_id! }))
              }
              onRemove={(g) => change(() => removeGrant(project.id, g.id))}
            />
          ))}
        </Column>

        <Column label="Activity" className="border-l border-line bg-surface">
          {activity === null ? (
            <p className="text-fg-muted">Loading…</p>
          ) : (
            // Newest first, along an arrow pointing up: the way time runs.
            <div className="relative pl-5">
              <TimeArrow />
              <ol className="flex flex-col gap-3.5">
                {activity.map((a) => (
                  <li key={a.id} className="flex flex-col gap-1">
                    <span className="text-fg">{describe(a)}</span>
                    <time dateTime={a.created_at} className="text-[11.5px] text-fg-subtle">
                      {formatDateTime(a.created_at)}
                    </time>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Column>
      </main>

      <GrantDialog
        open={adding}
        onOpenChange={setAdding}
        title={`Access to ${project.name}`}
        description="Covers every diagram and decision of the project."
        orgId={project.org_id}
        onGrant={async (who, role) => {
          await setGrant(project.id, who, role);
          await Promise.all([refreshGrants(), load()]);
          setAdding(false);
        }}
      />
    </div>
  );
}

/** One of the page's columns: a heading (and an action) on top, the rest scrolling. */
function Column({
  label,
  action,
  className = "",
  children,
}: {
  label: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className={`flex min-h-0 min-w-0 flex-col ${className}`}>
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-5">
        <h2 className={sectionLabel}>{label}</h2>
        {action}
      </div>
      <div className={`${scrollArea} flex flex-1 flex-col gap-4 px-5 py-4`}>{children}</div>
    </section>
  );
}

/** The grants on one diagram's boxes, in the diagram's box order. */
function DiagramGrants({
  info,
  grants,
  projectOwner,
  onRole,
  onRemove,
}: {
  info: DiagramInfo;
  grants: Grant[];
  projectOwner: boolean;
  onRole: (g: Grant, role: ProjectRole) => void;
  onRemove: (g: Grant) => void;
}) {
  const toPage = useProjectPath();
  const { diagram, rights } = info;
  // Where each box sits, and its place in the tree (depth-first, as drawn).
  const order = useMemo(() => {
    const place = new Map<string, { path: string; depth: number; index: number }>();
    if (!diagram) return place;
    walkBoxes(diagram).forEach(({ node, depth }, index) => {
      place.set(node.id, { path: joinPath(boxTitles(diagram, node.id)), depth, index });
    });
    return place;
  }, [diagram]);

  const boxes = [...new Set(grants.map((g) => g.box_id!))].sort(
    (a, b) => (order.get(a)?.index ?? Infinity) - (order.get(b)?.index ?? Infinity),
  );
  const manages = (boxId: string) =>
    projectOwner || (diagram !== null && rights !== null && boxId in diagram.nodes && can(rights, diagram, boxId, "owner"));

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      <Link to={`${toPage("/editor")}?${DIAGRAM_PARAM}=${encodeURIComponent(info.id)}`} className="font-medium text-fg hover:underline">
        {info.name}
      </Link>
      <ul className="flex flex-col gap-3">
        {boxes.map((boxId) => {
          const here = grants.filter((g) => g.box_id === boxId).sort(byRoleThenName);
          const place = order.get(boxId);
          const orphaned = here.some((g) => g.orphaned) || !place;
          return (
            <li key={boxId} style={{ paddingLeft: `${(place?.depth ?? 0) * 16}px` }} className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-fg-muted">
                <Box className="size-3.5 shrink-0" />
                <span className={orphaned ? "line-through" : ""}>{place?.path ?? here[0]?.box_title ?? boxId}</span>
                {orphaned && <span className="text-xs text-fg-subtle">deleted</span>}
              </span>
              <GrantList
                grants={here}
                canManage={orphaned ? projectOwner : manages(boxId)}
                onBox
                onRole={onRole}
                onRemove={onRemove}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GrantList({
  grants,
  canManage,
  onBox,
  onRole,
  onRemove,
}: {
  grants: Grant[];
  canManage: boolean;
  onBox?: boolean;
  onRole: (g: Grant, role: ProjectRole) => void;
  onRemove: (g: Grant) => void;
}) {
  const label = (role: ProjectRole) => (onBox && role === "owner" ? "In charge" : ROLE_LABELS[role]);
  if (grants.length === 0) return <p className="text-fg-subtle">Nobody yet.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {grants.map((g) => (
        <li key={g.id} className="flex items-center gap-2">
          <Subject grant={g} />
          {canManage ? (
            <>
              <select
                aria-label={`Role of ${nameOf(g)}`}
                value={g.role}
                onChange={(e) => onRole(g, e.target.value as ProjectRole)}
                className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs text-fg outline-none focus:border-fg"
              >
                {(["owner", "editor", "viewer"] as const).map((r) => (
                  <option key={r} value={r}>
                    {label(r)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={`Remove ${nameOf(g)}`}
                onClick={() => onRemove(g)}
                className="rounded p-0.5 text-fg-subtle hover:text-fg"
              >
                <X className="size-3.5" />
              </button>
            </>
          ) : (
            <span className="text-xs text-fg-subtle">{label(g.role)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Subject({ grant }: { grant: Grant }): ReactNode {
  const Icon = grant.group ? UsersRound : UserRound;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <Icon aria-label={grant.group ? "Group" : "Person"} className="size-4 shrink-0 text-fg-subtle" />
      <span className="truncate text-fg">{nameOf(grant)}</span>
      {grant.user && <span className="truncate text-xs text-fg-subtle">{grant.user.email}</span>}
      {grant.group && <span className="text-xs text-fg-subtle">group</span>}
    </span>
  );
}

/** One line of the activity log, e.g. "Alice gave Bob Editor on Payments". */
function describe(a: Activity): string {
  const who = a.actor?.display_name ?? "Someone";
  const { name = "?", role, box } = a.details;
  const on = box ? ` on ${box}` : "";
  switch (a.kind) {
    case "created":
      return `${who} created the project`;
    case "taken_over":
      return `${who} took over the project`;
    case "grant_set":
      if (role === "owner" && box) return `${who} put ${name} in charge of ${box}`;
      return `${who} made ${name} ${ROLE_LABELS[role ?? "viewer"]}${on}`;
    case "grant_removed":
      return `${who} took away ${name}'s ${role ? ROLE_LABELS[role].toLowerCase() : ""} access${on}`;
  }
}
