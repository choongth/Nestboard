# Connection types: design spec

**English** | [简体中文](./edge-type-specs.zh-CN.md)

## 1. Goals and scope

Like [box types](./box-type-specs.md), the first phase serves **learning system design and interviews**: show at a glance what relationship a connection is (synchronous call, asynchronous message, read/write, replication and so on), rather than just "connected".

## 2. Core principles

1. **Type ≠ label.** The type describes the **kind** of relationship ("Calls"); the label is what the user writes ("POST /orders"). They're stored separately and can both be present.
2. **Types are data.** A connection stores only a string `typeId`; names, categories, icons and line styles live in the type registry (`frontend/src/registry/edgeTypes.ts`), which uses the same registry mechanism as box types.
3. **Forward compatible.** An unknown `typeId` is drawn as a plain connection but **kept exactly** on save.
4. **Never rely on colour alone.** Each type has its own combination of line style (stroke + flow + end markers) and its own icon; the lines themselves all use the connection colour.
5. **Types don't restrict connections.** Any type can join any two boxes; nothing is checked or inferred from box types.

## 3. Data model

```ts
interface Edge {
  id: string;
  from: string;
  to: string;
  typeId?: string; // treated as "generic" when not set; unknown values are kept as they are
  label?: string;
}
```

- The file format version went up to **4**; files from versions 1–3 open as before (none of their connections have types) and are saved as version 4. (The format is now at version 5; see [JSON file format](./file-format.md).)
- Choosing "Connection" (the plain type) writes no `typeId`, exactly like a new connection.
- The backend (`server/app/diagram_format.py`) and the frontend (`frontend/src/model/serialize.ts`) use the same rules and error messages; a format change must be made in both.

## 4. Direction

A connection points from "the side that acts" to "the other side" (e.g. "Reads from": reader → database). The arrow shows which way data or requests flow, so "Reads from" and "Consumes from" put their arrow at the **start**, pointing back at the reader / consumer.

## 5. Built-in types (first phase)

10 types in 3 categories. Once published, an `id` is part of the file format: **only add, never change or remove**; to rename, change only the display name.

| Category | id | Label | Verb on the label | Stroke | Flow | Start | End |
|---|---|---|---|---|---|---|---|
| General | `generic` | Connection | Connects to | dashed | normal | — | filled arrow |
| Communication | `request` | Calls (sync request) | Calls | solid | — | — | filled arrow |
| Communication | `async-message` | Sends message / event | Sends to | dashed | — | — | open arrow |
| Communication | `publish` | Publishes to | Publishes to | dashed | — | dot | filled arrow |
| Communication | `subscribe` | Consumes from | Consumes from | dashed | — | filled arrow | — |
| Communication | `stream` | Streams to (real-time) | Streams to | long-dashed | fast | — | filled arrow |
| Data | `read` | Reads from | Reads from | dotted | — | filled arrow | — |
| Data | `write` | Writes to | Writes to | dotted | — | — | filled arrow |
| Data | `read-write` | Reads & writes | Reads & writes | dotted | — | filled arrow | filled arrow |
| Data | `replication` | Replicates to | Replicates to | double | — | — | filled arrow |

- The plain "Connection" keeps the look connections had before types existed, so existing diagrams don't change.
- All data types use dotted lines and are told apart by their end markers.

## 6. Interface behaviour

- **Sidebar**: with a connection selected, the "Type" picker sits below the information about its ends and above the label; grouped by category, with icons and search, and a **sample of the line style** to the right of each option.
- **Canvas**: connections are drawn with their type's line style and end markers; a selected connection gets brighter.
- **Label**: a typed connection shows the type's icon before its label; when the user hasn't written a label, the type's verb is shown (in italics) so the type is visible on the canvas. A plain connection without a label shows no label.
- **Lifted / external connections**: keep their own line styles, only fainter (as with cross-level connections since v0.3).
- **Unknown types**: drawn as a plain connection; the type picker shows the stored `typeId`, marked "unknown type".
- Choosing a type **is part of the undo history**; changing the type leaves the label alone.

## 7. Reserved for later

- **Protocol field** (HTTP, gRPC, AMQP, Kafka…): like the box's "technology" field, with a list per type and logos. Not in the first phase.
- New types follow the constraints in section 5: only new ids, and a line style combination no other type uses (checked by a unit test).

## 8. Explicitly not doing

- User-defined connection types
- Restricting or inferring connection types from box types
- Telling connection types apart by colour

## 9. Acceptance criteria

1. New connections are plain "Connection"s and look as they did before types existed; the sidebar can switch to any type in the list, and the line style and end markers change on the canvas at once.
2. The type picker is grouped by category, with icons and line samples, and is searchable by name.
3. After saving and reopening a file, every connection keeps its type (the backend keeps them too, covered by backend tests).
4. Old files (versions 1–3, connections without `typeId`) open normally, with every connection plain.
5. Hand-edit a connection's `typeId` in a file to a value that doesn't exist: it opens without errors, is drawn as a plain connection, and the picker shows the stored value; saving again keeps that `typeId` exactly.
6. Changing the type doesn't lose the label.
7. Type changes can be undone and redone.
8. Every type's line style combination is different (without relying on colour); lifted connections and connections to external boxes keep their own line styles.
9. A typed connection without a label shows the type's icon and verb on the canvas; with a label, the icon and the label.
