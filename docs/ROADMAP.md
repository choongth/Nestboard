# Roadmap

**English** | [简体中文](./ROADMAP.zh-CN.md)

- [x] v0.1: nested boxes, connections on the same level, zooming in and out, saving/opening JSON
- [x] v0.2: box types, technology picker with icons
- [x] v0.3: connections across levels, shown lifted (including external boxes)
- [x] v0.4: connection types

- [x] v0.5: multi-select, copy and paste, alignment guides
  - [x] Multi-select: `Shift` / `Ctrl` + click, `Shift` + drag to box-select, `Ctrl+A`, moving and deleting together, the `Delete` key
  - [x] Copy and paste: `Ctrl+C` / `Ctrl+X` / `Ctrl+V` / `Ctrl+D`, including nested boxes and the connections inside; pastes across levels and diagrams
  - [x] Alignment guides: while dragging, snap to the edges and centre lines of other boxes on the level, and to equal spacing; hold `Alt` to turn off
  - [x] Align and distribute buttons (in the sidebar when several boxes are selected)

- [x] v0.6: ADRs (architecture decision records)
  - [x] Backend: diagram storage, the ADR status flow, linking boxes and connections, relations between ADRs, version history, Markdown export (see the [backend notes](../server/README.md))
  - [x] Diagrams saved on the server (open / save / conflict handling; local JSON became import / export)
  - [x] Page switcher and the Decisions page
  
- [x] v0.7: user and group management: organizations, projects, groups and permissions (see the [design spec](./access-design.md))
  - [x] Step 1: empty the database; accounts, signing in and the instance admin (backend, see the [backend notes](../server/README.md))
  - [x] Step 2: organizations, member roles and job titles, the "can create projects" switch, invitation links, the instance admin's password reset links (backend)
  - [x] Step 3: nested groups, group leads, membership counted upwards (backend)
  - [x] Step 4: projects, project-level grants, diagrams moved into projects, every endpoint requires signing in and checks permissions; frontend: sign-in, invitations, password reset, home page (organizations and projects), editor and Decisions page inside a project
  - [x] Step 5: grants on boxes (owners), re-granting inside a box, permission checks at every change when a diagram is saved (backend)
  - [x] Step 6: ADRs belong to a project and have a scope (the whole project or one box); links within the scope; proposing, deciding and superseding checked against the scope; history records the author (backend; the frontend switched to project ADRs)
  - [x] Step 7: frontend: project switcher, People page, owners and locked boxes, read-only Viewers, ADR scope tree, organization members and groups, the instance admin's reset links
  - [x] Layout: the top bar became "Nestboard ▸ organization / project ▸ page"; the organizations page became a left sidebar + content on the right (still being refined)
  - [x] Organizations page (`/organizations`): organization list + Invitations / Members / Groups / Projects tabs; addresses use ids only, all under `/organizations/…`
  - [x] Filling the gaps: moving groups, deleting diagrams, renaming / deleting projects, renaming / deleting organizations; confirming before cutting boxes that have owners
  - [x] Step 8: docs (backend notes, features, roadmap)

- [x] v0.8: export as PDF
  - [x] Backend: one diagram per level, ordered depth first like a report; cover page (without the exporter's name), table of contents, headings and bookmarks nested by level, "Diagram n" numbering; drawn the way the editor draws (boxes, types, technology icons, connection styles, cross-level connections, external boxes), with searchable text; can export just the inside of one box; A4 / Letter (see the [backend notes](../server/README.md))
  - [x] Frontend: Export as PDF… in the File menu, with a choice to export only the inside of the current box and the paper size; unsaved changes are saved first (see [Features](./FEATURES.md))

- [x] v0.9: live collaboration
  - [x] Step 1: diagrams stored as separate rows for boxes and connections; saving sends and writes only the boxes and connections that changed; boxes can no longer be moved into another box (see the [backend notes](../server/README.md))
  - [x] Step 2 (backend): live connection (WebSocket); saves send only the changed fields and apply to the current diagram, the later change to a field wins, deleted items are skipped; every save, rename and delete is passed, in order, to everyone with the diagram open; what each person is doing is relayed (level, selection, pointer, dragging); permissions are rechecked when they change, and the connection closes when access is lost or the user signs out
  - [x] Step 3 (editor): changes save as you make them, no more Ctrl+S; a new diagram is stored on the server at its first change; others' changes arrive; undo only undoes your own changes; reconnecting after a dropped connection and resending changes; connection status (see [Features](./FEATURES.md))
  - [x] Step 4: who's here (avatars, their level, their selected boxes, click an avatar to go to their level), live pointers, boxes being dragged (see [Features](./FEATURES.md))
  - [x] Step 5: permissions, renames and deletions take effect live (locks and owners update at once; losing access or the diagram being deleted is explained, then it closes)
  - [x] Step 6: docs, and a check on the production stack (production build behind Caddy: live connection, two browsers seeing each other's changes, presence and pointers)

- [x] v1.0: Help: the editor's shortcuts and a getting-started guide (File menu → Help, or press `?`)

- [x] v1.1: invite up to 100 people at once from a CSV file (Invitations tab → Import from CSV…): a preview of every row, links locked to each email, names filled in on sign-up, links downloadable for a mail merge

- [ ] v1.2: AI integration / MCP
