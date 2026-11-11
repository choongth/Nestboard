# Organizations, projects and permissions: design spec

**English** | [简体中文](./access-design.zh-CN.md)

## 1. Goals and scope

Make Nestboard usable inside a company (even a multinational one): signing in is required; people and teams belong to organizations; diagrams and ADRs belong to projects; who can see and who can change things can be set down to **a single box**.

Modelled on IcePanel: a person or a group can be made the **owner** of a box (a service). An owner can hand parts of the box's inside on to others, level by level, along the same tree as the boxes' nesting.

Not included: single sign-on (SSO), sending email, billing. (Live collaboration, also left out here, came later in v0.9.)

## 2. Core principles

1. **One rule for permissions.** All access comes from "grants" (section 5); there's no separate scheme for projects, boxes and ADRs.
2. **Grants reach down the tree.** A grant on a box covers everything inside it; the highest applicable grant wins.
3. **Job titles aren't permissions.** Developer, Architect, CTO are for display only and never take part in permission checks.
4. **Organizations are fully isolated.** Someone outside an organization gets 404 for anything in it, as if it didn't exist.
5. **Permissions are decided by the backend only.** The frontend uses them to show boxes you can't change as locked, but the backend has the final say.

## 3. Levels

```
Nestboard instance (one server)
└── Organization      e.g. "Acme Corp"     members, job titles, groups
    ├── Group         e.g. "Engineering ▸ Platform" (can be nested)
    └── Project       e.g. "Checkout"      members, grants
        ├── Diagrams (one or more)
        └── ADRs      each belongs to the whole project, or to one box in it
```

- **Users** belong to the whole instance: one email, one password. A user can join **several organizations** (for example a consultant working for two clients).
- Groups, projects, diagrams, ADRs and grants each belong to exactly one organization.

## 4. Organizations

### 4.1 Roles

| Role | Can |
|---|---|
| **Org Owner** | everything an Admin can; delete the organization; appoint and remove Admins. An organization keeps at least one Owner |
| **Org Admin** | invite and remove members; set job titles; manage all groups; turn members' "can create projects" on or off; see the **names** of all projects; take over projects (4.3) |
| **Member** | see the projects they have grants on; create projects when "can create projects" is on |

- Only the **instance admin** can create organizations (the first user to sign up is the instance admin), becoming its first Org Owner. To hand it to the real owner: invite them as Owner, then leave.
- **Can create projects**: a switch per member, controlled by Admins. Owners and Admins always can; it's off for new members.
- Removing a member also deletes all their grants and group memberships in that organization.

### 4.2 Job titles

Everyone has one job title in each organization (free text, may be empty), set by Admins. It's shown in the member list and in ADR history; the owner mark on a box shows only the name.

### 4.3 Admins and project content

Admins can see every project's name, but **seeing its content takes a grant**. If a project's Owner has left, or something needs sorting out, an Admin can **take over**: make themselves the project's Owner. Taking over is recorded in the project's activity log (who and when), visible to the project's members.

## 5. Grants

```
grant = who (a user or a group) + scope (the whole project, or one box) + role (Viewer / Editor / Owner)
```

- A grant on a box covers the box and every level of boxes and connections inside it.
- A person's role on a box = the **highest** of all grants that apply to them (including through groups) on that box, on every box above it, and on the whole project.
- Only organization members can receive grants.
- Someone with grants only on boxes can still see the whole project, counting as a Viewer outside those boxes: otherwise they couldn't even see the boxes they own.
- An Owner on a box isn't a project Owner: "a project keeps at least one Owner" looks only at grants on the whole project.
- Grants live in the database and are **not written into diagram files**: exporting a diagram doesn't reveal who has access.

### 5.1 What each role can do

| | Viewer | Editor | Owner |
|---|---|---|---|
| View diagrams and ADRs | ✓ | ✓ | ✓ |
| Draw and change things within the scope | | ✓ | ✓ |
| Propose ADRs within the scope, change proposed ADRs | | ✓ | ✓ |
| Accept, reject, deprecate ADRs within the scope | | | ✓ |
| Grant access within the scope (assign owners) | | | ✓ |
| Create diagrams | | Editors of the whole project | ✓ |
| Delete diagrams, rename / delete the project | | | project Owners only |

- An Owner grant on a box makes its holder the box's **owner**; the box shows the owner's name or group name.
- Delegation can go as deep as needed: the owner of Payments can make someone else owner of Payments ▸ Ledger, but can't touch anything outside or above Payments.
- A project's creator becomes its Owner automatically. A project keeps at least one Owner (a user or a group).

### 5.2 Examples

| Person | Grant | Result |
|---|---|---|
| Project creator | project Owner | everything |
| Senior manager | project Owner | assigns the services each team owns; writes project-wide ADRs |
| Payments lead | Owner of the Payments box | changes the inside of Payments; writes and accepts Payments ADRs; assigns boxes inside Payments |
| Developer | Editor of the Payments ▸ Ledger box | can change only the inside of Ledger; can propose Ledger ADRs |
| Everyone else | project Viewer | read-only |

## 6. Groups

- Groups belong to the organization and can be used in several projects.
- **Groups can be nested**: each group has at most one parent group (e.g. Engineering ▸ Platform ▸ Payments), at most 10 levels, with no cycles.
- **Membership counts upwards**: members of Payments also count as members of Platform and Engineering. So a grant to Engineering covers the people in all the groups under it.
- Each group has **leads**: a lead can manage the group and every group under it: members and leads, name and description, the groups below. Org Admins can manage all groups.
- **Creating, moving and deleting** a group changes the level above it, so it takes the right to manage that level (Org Admin for top-level groups). Moving needs that right on both the level it leaves and the level it joins; the groups under it move along.
- Group names under the same parent (including the top level) must differ, ignoring case.
- A group with groups under it can't be deleted until those are moved or deleted. Deleting a group doesn't remove its members from the organization.
- Every member of the organization can see all groups and who's in them; anyone can leave a group on their own. Leaving the organization also leaves all its groups.

## 7. Saving diagrams

Saving sends only the boxes and connections that changed, and every change must fall within a scope where you're Editor or Owner; otherwise the whole save is refused, naming the box. What each kind of change requires is in "保存图表时的检查" (checks when saving a diagram) in the [backend notes](../server/README.md). In the editor:

- Opening a diagram also fetches your role on every box, so boxes you can't change are shown locked instead of failing at save time; "External box…" only appears while dragging a connection for people who can edit the current level.
- Cut and paste creates new boxes, and grants don't travel with them; the editor warns before cutting boxes that have owners.

## 8. ADRs

- ADRs belong to the **project** and are numbered within it (ADR-0001…); each ADR has a **scope**: the whole project, or one box in one diagram.
- Within a scope, Editors can propose ADRs and Owners can accept, reject and deprecate them (section 5.1).
- An ADR **can only link boxes and connections within its scope**: the scope's box itself, the boxes inside it, and connections with at least one end in it. Project-wide ADRs can link boxes and connections in any of the project's diagrams.
- A proposed ADR can be moved to another scope: this needs Editor on both the old and the new scope, and every existing link must be within the new scope. Once accepted or rejected, the scope can't change. Superseding an ADR gives the new ADR the same scope.
- When the scope's box (or diagram) is deleted, the ADR stays (it's the record of a decision) with its scope marked "deleted"; from then on only roles on the whole project count. Deleting a diagram doesn't delete ADRs; deleting the project does.
- The Decisions page shows the scopes as a tree: project-wide ADRs at the top, the rest grouped by box level below.
- **Relations**: "relates to" and "amends" can be set on any ADR you can see; **superseding** an ADR takes Owner on that ADR's scope (checked when setting the relation, when creating from it, and when accepting the ADR that supersedes it).
- Every history version records **who** made it, such as "Accepted by Alice (Architect)"; names and job titles are kept as they were at the time. Exported Markdown says who proposed it and who accepted or rejected it.
- The existing ADR rules (status flow, locking, keeping links, export and so on) are unchanged (see the [backend notes](../server/README.md)).
- Existing ADRs were migrated to project scope and renumbered within the project (by diagram creation time, then by their old number within each diagram).

## 9. Accounts and signing in

- Email + password. Passwords are hashed with argon2; the session lives in an httpOnly cookie; repeated failed sign-ins get progressively slower.
- The first user to sign up becomes the **instance admin**. After that there's no open sign-up: people join only through invitations.
- **Invitation links**: an Org Admin makes a link and sends it themselves (no mail server needed). Opening it lets you sign up or sign in and join the organization. Links expire and can be revoked. Up to 100 people can also be invited at once from a CSV file (one email per row, each link usable only by that email); the Admin still sends the links themselves.
- **Password reset**: only the instance admin can make reset links (one-time, valid 1 to 72 hours). Org Admins can't: a person may belong to other organizations too, and being able to reset their password would mean being able to get into those. Self-service reset can come once email is connected.

## 10. Pages

- Sign in, sign up (only through an invitation link), accept an invitation.
- **Left of the top bar**: the Nestboard menu (all organizations, each organization's page) / organization / project (switches projects) / page (Editor / Decisions / People).
- **Organizations page** (`/organizations`, also the home page): your organizations on the left; with one chosen, the tabs Invitations (Admins) / Members / Groups / Projects on the right, Projects first, with **New project** when allowed. With only one organization, it opens straight away.
- **People** (inside a project): members, groups and grants, shown as a tree following the box levels, so you can see at a glance who owns what.
- **The box sidebar**: the "Access" section lists the owner and other grants; Owners can assign owners there.
- All pages live under `/organizations/…` and use ids rather than names: addresses look like `/organizations/<organization id>/projects/<project id>/editor?diagram=…`, revealing neither the organization's nor the project's name.

## 11. Status

All done (v0.7, see the [Roadmap](./ROADMAP.md)). The existing diagrams and ADRs were cleared when it went live.
