# JSON file format

**English** | [简体中文](./file-format.zh-CN.md)

The format Nestboard uses when it writes a diagram as a JSON file. It's used by:

- **Export to file…** / **Import from file…** in the editor's File menu
- the `document` when the backend creates a diagram (see the [backend notes](../server/README.md))
- the examples in the repository (`examples/`)

The format is defined in `frontend/src/model/types.ts` (`FileNode`, `FileEdge`, `SCHEMA_VERSION`) and read and checked in `frontend/src/model/serialize.ts`; the backend's checks and error messages match it.

## Three forms

The same diagram exists in three forms; this file is one of them:

- **The file** (this document): a nested tree, each box carrying its children and connections, easy to read and exchange
- **In the editor's memory**: a flat structure (`nodes: Record<id, Node>`, each node recording its `parentId`), which makes finding, moving and deleting subtrees and undo easy; the two are converted into each other when saving and opening files
- **On the server**: one row per box and per connection, and saving sends only what changed (see the [backend notes](../server/README.md))

## Structure

```ts
interface Document {
  schemaVersion: number; // currently 5
  root: Node;
}

interface Node {
  id: string;
  title: string;
  typeId?: string;    // the box's type (role), e.g. "load-balancer"; not set means Generic. Unknown values are kept as they are
  technology?: string;
  description?: string;
  position: { x: number; y: number }; // boxes have a fixed size, so no size is stored
  externals?: Record<string, { x: number; y: number }>; // where the user dragged external boxes (by box id) inside this box; the rest line up on the right
  children: Node[];
  edges: Edge[]; // connections whose ends' lowest common ancestor is this node (between children, or between boxes on different levels inside it)
}

interface Edge {
  id: string;
  from: string; // box id (on any level, but not an ancestor or descendant of the other end)
  to: string;   // box id
  typeId?: string; // connection type, e.g. "request"; not set means a plain Connection. Unknown values are kept as they are
  label?: string;
}
```

A minimal example: two boxes on the top level, joined by one connection.

```json
{
  "schemaVersion": 5,
  "root": {
    "id": "root",
    "title": "Root",
    "position": { "x": 0, "y": 0 },
    "children": [
      { "id": "web", "title": "Web app", "typeId": "client", "technology": "React",
        "position": { "x": 0, "y": 0 }, "children": [], "edges": [] },
      { "id": "api", "title": "Orders API", "typeId": "service",
        "position": { "x": 300, "y": 0 }, "children": [], "edges": [] }
    ],
    "edges": [
      { "id": "e1", "from": "web", "to": "api", "typeId": "request", "label": "Places orders" }
    ]
  }
}
```

## Rules

Opening a file checks these rules; if any is broken, the file doesn't open, and the message names the box or connection at fault:

- Every box and connection has an `id`, unique within the file. Ids are stable, so that a future version can support the same box appearing in several places
- Every box has `title`, `position`, `children` and `edges` (the last two may be empty arrays)
- Both ends of a connection must be boxes in the file; a box can't connect to itself, nor to its ancestors or descendants
- A connection is stored in its two ends' lowest common ancestor; one stored anywhere else is an error
- `typeId` can be any non-empty string: known ones are shown as their type, unknown ones (for example from a newer version) as Generic, but they're saved exactly as they are
- `technology` isn't checked against the type's technology list: the list only restricts what the interface lets you pick
- Positions in `externals` for boxes that aren't in the file are dropped
- Unknown fields are dropped and not written back

## Versions

`schemaVersion` goes up by one with every change to the format. So far, every version only **added** to the one before, so files from versions 1–5 all open directly, and are saved in the current version.

| Version | Added |
|---|---|
| 1 | nested boxes, and connections between boxes on the same level |
| 2 | box types (`Node.typeId`) |
| 3 | connections across levels (stored in their ends' lowest common ancestor) |
| 4 | connection types (`Edge.typeId`) |
| 5 | positions of external boxes (`Node.externals`) |

A file with a higher version than the current one (written by a newer Nestboard) doesn't open; the message asks you to update first. If a future version changes the structure (rather than only adding to it), it needs a migration in `serialize.ts` and a note in the table above.
