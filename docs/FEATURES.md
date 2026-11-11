# Features

**English** | [简体中文](./FEATURES.zh-CN.md)

What Nestboard can do today, by area; for progress by version, see the [Roadmap](./ROADMAP.md).

## Editor

### Canvas

- Hold the left mouse button and drag on an empty part of the canvas to pan
- Scroll the mouse wheel to zoom the current level
- Every level's canvas extends without limit: wherever you drag a box, the usable area grows to include it
- Right-click an empty part of the canvas → **New box** (appears at the pointer)
- Right-click a box → **Cut**, **Copy**, **Duplicate**, **Delete**: when the box is part of the selection they act on the whole selection, otherwise the box alone is selected first; deleting follows the same rules as the `Delete` key. External boxes and connections have no right-click menu
- Left-click an empty part of the canvas to close the sidebar and clear the selection
- Hold `Shift` and drag on an empty part of the canvas to draw a selection rectangle: every box it touches is selected (a plain drag still pans)

### Navigation

- The breadcrumb shows the current path; click any part of it to jump straight to that level
- `Esc` clears the selection; with nothing selected, `Esc` goes back up a level

### Boxes

- All boxes have the same fixed size; resizing isn't supported yet
- Drag to move; dragging a box that isn't selected moves only that box and doesn't select it
- Alignment guides: while dragging, a box's left and right edges, centre lines, and top and bottom edges snap to the matching lines of other boxes on the level when within 6 screen pixels, and a guide line is shown; when two boxes' centres line up, only the centre line is shown. Several boxes dragged together align by their combined outline. Hold `Alt` while dragging to turn snapping off
- Equal spacing: while dragging, if a box's gap to its neighbour in the same row (or column) is close to the gap between two other boxes in that row, or the box is close to the exact middle between two neighbours, it snaps there and pink marks show every equal gap. When an alignment snap is also possible, the nearer one wins
- Click a box to open the sidebar (name, type, technology, description); **the title can only be edited in the sidebar**
- Double-click a box to zoom into it (with a short transition); once inside, the view fits all the boxes on that level, or uses the default view when there are none
- Inside a box, double-click the background to go back up a level (with the same transition)
- Delete a box (this deletes everything nested in it and its connections; asks first)
- A box with boxes inside shows how many
- A selected box has a white border

### Box types

See the [box type spec](./box-type-specs.md).

- 39 built-in types in 10 categories; new boxes are **Generic**
- The type picker in the sidebar is grouped by category, with icons, and searches by name or category
- On the box: the type's icon and label sit on the top border, the technology's logo at the top left, the title in the middle
- **Group / Boundary** has a dashed, see-through border, **Note** looks like a sticky note; an unknown type is drawn as Generic and shows its stored id
- Types with a technology list only allow technologies from that list (a dropdown with logos, over 400 technologies in all); other types take any text. Where the logos come from, and which technologies have none: [Technology logos](./technology-logos.md)
- One Backspace clears a chosen technology; changing the type clears the technology (one undo brings both back)
- Type changes are part of the undo history

### Multi-select

- `Shift` + click (or `Ctrl` + click) adds a box to the selection or removes it; a click without a modifier selects only that box
- `Ctrl+A` selects every box on the current level
- Drag any selected box to move all of them together, as one undo step
- With several boxes selected, the sidebar lists them (click one to select only it) and can delete them together
- Only boxes on the same level can be selected together; connections and external boxes are selected one at a time
- With several boxes selected, the sidebar's **Arrange** section lines them up in one click: align left, centre horizontally, align right, align top, centre vertically, align bottom (against the selection's combined outline); and distribute horizontally / vertically (at least 3 boxes; the two outermost stay put). Each is one undo step
- `Delete` / `Backspace` deletes the selected boxes or connection: deleting several boxes, or a box with boxes inside, asks first; a single empty box or a single connection goes straight away (and can be undone). In text fields these keys edit text as usual

### Copy and paste

- `Ctrl+C` copies the selected boxes, `Ctrl+X` cuts, `Ctrl+V` pastes, `Ctrl+D` duplicates next to the original (without touching the clipboard). Cutting boxes that have (or contain boxes that have) owners or grants of their own asks first: the boxes are copied, but the pasted boxes don't carry those grants
- A copy includes every level of boxes inside, and the connections with both ends in what was copied (cross-level ones included); connections to anything outside it are left out
- Paste onto the current level: centred on the pointer when it's over the canvas, otherwise next to the original position. Pasting again at the same place offsets each copy by 24 px
- You can paste onto another level (go into another box, then paste), into another tab or into another diagram; every box and connection gets a new id
- Right-click an empty part of the canvas → **Paste**: pastes the boxes last copied in this tab where you right-clicked
- A paste is one undo step and selects what was pasted
- Copy and paste in text fields work on text as usual; pasting something that isn't Nestboard boxes onto the canvas does nothing

### Connections

- Hovering a box shows connection points at the middle of each side; drag from any of them onto another box (a point or anywhere on it) and let go to connect
- If the target box has boxes inside, letting go opens a "Connect to…" list: first the box itself and the boxes inside it, one level at a time; click the arrow on the right (or press →) to open a box and see the boxes inside it, as deep as you like; the path at the top goes back up a level (as do ← and Backspace). ↑ / ↓ move through the list, Enter connects to the highlighted box, Esc closes the list without connecting. Typing searches every level (showing relative paths). If the target box has nothing inside, it connects straight away
- Letting go over an empty part of the canvas doesn't connect
- Cross-level connections: a box can't connect to itself, nor to a box nested inside it (or one that contains it)
- On a level above, a cross-level connection is "lifted" and drawn, fainter, between the boxes that contain its ends; connections with both ends inside the same box aren't shown on the level above
- Several connections between the same pair of boxes are drawn side by side, not on top of each other
- Selecting a lifted connection shows its real ends and their paths in the sidebar; if the connection isn't drawn on the current level, the sidebar says which level it's drawn on
- Inside a box, connections that leave the level end on "external boxes": an external box is the box at the other end itself (not the box above that contains it), see-through with a dashed border, with its path written underneath (e.g. "Finance › Ledger"; a top-level box shows as "Root › Users")
- While you drag a connection inside a box, a single "External box…" box appears on the side the line is pulled from (pulled from the left point it sits on the left, from the top point above, and so on), and the canvas pans to show it if needed; external boxes that already have connections stay where they are. Letting go on it opens the "Connect to…" list, starting from the top level and listing boxes on other levels (the box you're in and the boxes inside it aren't listed; the boxes above that contain the current level can be opened but not connected to). The chosen box appears where "External box…" was; the connection and the position are one undo step
- "External box…" only appears for people who can edit the current level: someone who owns only Cart inside Shop can't connect Cart to anything outside Shop
- External boxes with connections can be dragged anywhere; the position is saved with the diagram (undoable, and used in the PDF export too). For connections drawn on other levels, the external boxes at their far ends (ones never placed) line up on the right of the canvas. Only people who can edit a box can move the external boxes inside it
- The "Connect to…" list also appears on the side the line is pulled from (switching to the other side when there isn't room on screen)
- Dropping a connection on an external box follows the same rule: a list if it has boxes inside, otherwise it connects straight away; picking a box inside it from the list puts the new external box where you let go
- Click an external box to see it in the sidebar; double-click it to jump to its level with it selected
- The line style depends on the connection type (see "Connection types" below); a plain connection is an animated dashed line with an arrow; connections attach to the facing sides of their two boxes and re-route when a box moves
- Each connection can have a text label; click the connection or its label to select it, then edit or delete it in the sidebar

### Connection types

See the [connection type spec](./edge-type-specs.md).

- 10 built-in types in 3 categories: General (Connection), Communication (Calls, Sends message / event, Publishes to, Consumes from, Streams to) and Data (Reads from, Writes to, Reads & writes, Replicates to)
- Each type has its own line style: solid / dashed / long-dashed / dotted / double, flowing or not, and filled arrows, open arrows or dots at the ends; colour isn't needed to tell them apart
- New connections are plain **Connection**s and look as before
- With a connection selected, the type picker in the sidebar is grouped by category, with icons, search and line samples
- A typed connection shows the type's icon before its label; without a label it shows the type's verb (such as "Calls" or "Reads from")
- Lifted connections and connections to external boxes keep their line styles; changing the type leaves the label alone and is part of the undo history

### Undo and redo

- `Ctrl+Z` undoes, `Ctrl+Y` / `Ctrl+Shift+Z` redoes; the top bar has undo/redo buttons too (moving between levels isn't part of the undo history). Undo only undoes your own changes: changes others made at the same time stay
- Undo/redo jumps to the level where the change happened and briefly highlights the boxes or connections it changed

### Help

- **Help** in the File menu (just above Delete diagram…, shown to everyone), or press `?` on the canvas; typing `?` into a text field doesn't open it
- Shortcuts tab: every shortcut and mouse action, grouped into Moving around, Selecting, Editing, Connecting and Diagram; Macs show ⌘ / ⇧
- Getting started tab: five cards: every box is a canvas, adding boxes and connecting them, types and technologies, connections across levels, working together
- People who can only look (Viewers) see a note, and items that need edit rights are marked "Editors only"
- The shortcut list lives only in `frontend/src/components/helpContent.ts`: when a shortcut changes, update it there too

## Saving, files and export

### Saving as you go, and editing together

Diagrams are stored on the server; see "实时连接" (live connection) in the [backend notes](../server/README.md).

- No need to save: every change reaches the server shortly after you make it (about a quarter of a second), and typing is sent as you type. A new diagram is created on the server at its first change (after which the address includes its id)
- People with the same diagram open see each other's changes at once: renames, moves, new boxes, deletions. If someone moves a box while you rename it, both changes are kept; for changes to the same field, the one that reaches the server last wins
- If someone deletes the level you're looking at, you go to the nearest level that still exists; if something you're changing is deleted by someone else, your change is skipped and a note at the bottom says why
- When the connection drops, an offline icon appears next to the File menu and the tab title gets a "●"; changes wait in the browser, are sent automatically once you're back online, and others' changes from the meantime are shown
- Creating or opening another diagram, leaving the project or signing out first waits for changes still on their way (up to ten seconds while connected, enough even when the server is busy); only when they can't be sent (usually because the connection dropped) does it ask first. Closing the tab with unsent changes warns you
- When a change has been on its way for more than a second, a spinning icon appears next to the File menu. `Ctrl+S` sends changes at once, but you normally don't need it
- When someone changes your permissions (granting or removing access on a box, changes to groups or the organization), locks and owners update at once, without reloading; when someone renames the diagram, the File menu and the tab title show the new name at once
- When the diagram is deleted by someone else, or you lose access to it, a note says why and it's replaced by a blank diagram
- On the right of the top bar are the other people who have this diagram open: one round avatar each (their initials), each in their own colour; someone with several tabs open still shows once, and you don't see yourself. Hovering says which level they're on; clicking takes you there
- For people on the same level: the boxes they've selected (or are dragging) show a border in their colour with their name; their pointers are shown on the canvas with their names; when they drag a box you see it move, landing where they let go. These are only relayed, never saved

### Opening and files

- `Ctrl+O` opens a diagram in the current project (most recently changed first, searchable); the File menu can also create and rename diagrams; project Owners can **delete a diagram** (the project's ADRs stay; ADRs about its boxes show them as deleted)
- The address includes the diagram id (like `…/editor?diagram=…`): reloading, copying the link, back and forward all open that diagram
- When the server can't be reached, or a link points to a deleted diagram, a note explains it, and nothing you're editing is lost
- **Import from file…** / **Export to file…** in the File menu read and write local JSON files. An imported diagram is stored on the server as a new diagram straight away
- Chromium browsers use the system's file dialogs; Firefox / Safari download the file instead, and import through a file picker

### Export as PDF

**Export as PDF…** in the File menu; available to everyone in the project, Viewers included.

- Laid out like a report: a cover page (project, diagram name, export date, without the exporter's name), a table of contents, then one page per level
- Pages go depth first: after the root level, every level inside one box comes before the next box; boxes on the same level go top to bottom, left to right, as on the canvas. Headings get smaller by level, PDF bookmarks are nested by level too, and every diagram is numbered (Diagram 1, Diagram 2…)
- Drawn the way the editor draws: box types, technology icons, connection styles, cross-level connections and external boxes; box names and connection text can be searched and copied in the PDF
- When inside a box, you can choose to export only the inside of that box; paper is A4 or US Letter; diagrams that are too wide get landscape pages
- The server makes the PDF from the diagram it has stored, so it first waits for changes still on their way (a new diagram not yet on the server is stored first)

## Accounts, projects and permissions

### Top bar and pages

- The left of the top bar goes from big to small: the **Nestboard** menu / organization / project / page. The page menu (after the project): Editor (`…/editor`), Decisions (`…/decisions`, the ADRs), People (`…/people`, who owns what). Every page has its own address, and the browser's back / forward work; switching pages doesn't close the diagram being edited
- All pages are inside a project, at addresses like `/organizations/<organization id>/projects/<project id>/editor` (ids, so the address doesn't reveal names); the top bar shows the full "organization / project" name, and clicking it switches projects (asking first when there are unsaved changes)
- The account menu at the top right shows who's signed in and signs out (signing back in returns you to the same page)

### Accounts and organizations

See the [organizations, projects and permissions spec](./access-design.md).

- You have to sign in. A brand-new Nestboard creates the first account (the instance admin) the first time it's opened; after that, people can only sign up or join through an organization's invitation link (`/invite/…`)
- Sign-in page: email and password; a wrong password says so, and repeated wrong attempts have to wait. For a forgotten password, the instance admin makes a reset link (`/reset-password/…`)
- **Organizations page** (`/organizations`, the home page when you open Nestboard): the left sidebar lists your organizations and is searchable; the instance admin can create a **New organization**. With an organization chosen (`/organizations/<organization id>`), four tabs sit at the top right: **Invitations** (Admins only), **Members**, **Groups** and **Projects**, with Projects first; `#members`, `#groups` and `#invitations` in the address choose a tab. With no organization chosen, it asks you to pick one first
  - Projects: search projects, **New project** (when allowed; the creator becomes its Owner), and a card for each project; Org Admins also see projects they have no access to (marked No access) and can **Take over** (becoming Owner, which is recorded in the project's activity)
  - Members: job titles, roles, the switch that lets a member create projects, removing members or leaving
  - Invitations: make an invitation link (with a role, a job title, and optionally a fixed email address), copy it and send it; links can be revoked. **Import from CSV…** invites up to 100 people at once: the CSV's columns are email (required), name, job title and role; every row is previewed first (rows with a problem are marked with the reason and skipped), then each person gets a link only their own email can use, with their name filled in on the sign-up form. The links are shown only this once: download them as a CSV (ready for a mail merge) or copy them all; closing before keeping them asks first. The **What can each role do?** button lists what Owners, Admins and Members can each do, to help choose a role. Joining through an invitation opens that organization
  - Groups: the group tree on the left (with each group's head count), the chosen group on the right: where it sits, its people and leads, and the groups under it; leads and Admins can add and remove people, make leads, create groups under it, rename it, **move** it (under another group or to the top level, taking the groups under it along) and delete it
- With only one organization, opening Nestboard goes straight into it
- Click **Nestboard** to open a menu: **All organizations** and each organization you're in. Click the project name to switch to another project in the organization; project Owners can also **rename** or **delete the project** there. Leaving a project while changes couldn't reach the server (offline) asks first
- Organization Owners click **⋯** next to the chosen organization on the left of the organizations page to **rename** or **delete the organization**. Deleting a project or an organization asks you to type its name, and deletes everything in it
- The instance admin opens **Accounts and reset links** (`/admin`) from the account menu: it lists every account and makes one-time password reset links

### Permissions and owners

Everything here is within one project.

- **People** page (`…/people`): three columns filling the page, each scrolling on its own. Left: grants on the whole project; middle: grants on boxes, arranged by diagram and box level, so you can see at a glance who owns what; right: the activity log (who made whom an owner, who took over the project, and so on). Owners can grant, change roles and remove access here
- In the editor, a box's Owner is shown as its **owner** (the name at the box's bottom right). Boxes you can't change show a lock; on a canvas you can't change, boxes can't be dragged and the right-click menu offers no New box
- Changes you aren't allowed to make don't happen, and a note at the bottom says why (such as "You can't delete "Orders""); the server checks again, and any change it refuses is rolled back with the reason
- With a box selected, the sidebar's **Access** section lists its owner, Editors, Viewers and grants inherited from boxes above; if you're an Owner of the box (or of one above it), you can grant access, change roles and remove access. Boxes and connections you can't change are shown read-only in the sidebar
- Viewers don't see menu items such as new, rename and import; people with grants on boxes can change what they own, but can't create diagrams
- Diagrams belong to a project: opening and creating happen in the current project; entering another project starts with a blank diagram

## Decisions page

Architecture decision records (ADRs) in the Nygard format; they belong to the current project and are numbered within it. Opening the Decisions page doesn't require saving the diagram first.

### List and scopes

- The list on the left is a tree grouped by **scope**: whole-project ADRs at the top, then those about boxes in the current diagram (indented by box level), then boxes in other diagrams and deleted boxes
- A new ADR asks what it's **About**: only scopes you can edit are listed. A proposed ADR can be moved to another scope with **Move…**
- The buttons follow your role on the ADR's scope: Editors can edit, link and delete; Owners can accept, reject, deprecate and supersede; Viewers can only read. Linking lists only the boxes and connections within the scope
- The Decisions page opens straight onto the ADRs: the **New ADR** button at the top of the left sidebar, below it every ADR (number, title, status), filterable by status and searchable by title or number; the chosen ADR on the right (the first one when none is chosen), at an address like `/decisions/7?diagram=…`. The top right holds only **Export all**

### Writing an ADR

- A new ADR opens for editing straight away. Each ADR has: a title; **Context** (Markdown, tables included); **Decision** (listed point by point, added with **+ New decision**); and **Consequences**, in two groups, **Positive** (above) and **Negative** (below), each with its own add button
- In the lists: `Enter` adds the next point, `Shift+Enter` starts a new line, `Backspace` in an empty point deletes it, blank points are dropped on save; `Ctrl+Enter` saves. A proposed ADR can also take new points while you read it, with **+ New decision** / **+ Positive** / **+ Negative**

### Status and superseding

- Status: proposed → accepted / rejected; accepted → deprecated. Accepting or rejecting asks first; once accepted, the text can't change: to change the decision, supersede it
- **Supersede**: creates a new ADR from the accepted one (copying its text and links); when the new one is accepted, the old one becomes superseded automatically

### Links, history and export

- **Links**: pick the boxes and connections in the open diagram that the decision is about (links to the project's other diagrams are kept); clicking a linked box opens its diagram, goes to its level and selects it. When a box is deleted, the link stays, marked as deleted
- **Related decisions**: supersedes, amends, relates to; shown at both ends (such as "Superseded by ADR-0002")
- **History**: each version's status, summary of changes, time and author (with job title); below the title it says who proposed it and who accepted or rejected it; exported Markdown says so too
- Export one decision as a Markdown file, or all of them (zip), ready to drop into a repository's `docs/adr/`
- When someone else changed the same decision at the same time, a note says so and the latest version is shown, without overwriting their change
- With unsaved changes to an ADR, switching to another ADR, switching pages or pressing the browser's back button asks first whether to discard them; closing or reloading the tab warns too

## Not included yet

**AI integration** and **MCP**. See the [Roadmap](./ROADMAP.md).
