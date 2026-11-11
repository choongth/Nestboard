# Box types: design spec

**English** | [简体中文](./box-type-specs.zh-CN.md)

## 1. Goals and scope

**The target use of the first phase: learning system design and interviews.** People use the tool to draw systems made of "classic components" (load balancers, caches, message queues, databases and so on), and can see at a glance the role each box plays.

**Out of scope for this phase:** modelling the cloud resources of real projects (regions, VPCs, WAFs, secrets management, CI/CD and so on). These are for the second phase, see section 7.

## 2. Core principles

1. **Type ≠ technology.** The type describes the box's **role** in the system (the job); the technology describes the actual implementation (the person doing it). For example, the type is "Relational Database" and the technology is PostgreSQL. The two fields are stored separately but work together in the interface.
2. **Types are data, not a hard-coded enum.** A node stores only a string `typeId`. A type's name, category, icon and colour live in a "type registry". Built-in types and future user-defined types use the same mechanism.
3. **Forward compatible.** When a file contains a `typeId` this version doesn't know, the interface draws the box as Generic, but **saving must keep the original `typeId`**, never rewriting or dropping it.
4. **Types don't restrict nesting.** A box of any type can hold boxes of any type; there are no hard rules.
5. **In this phase, types only cover looks and classification.** No type-specific properties (such as a rate-limiting algorithm or a replica count).
6. **Never rely on colour alone.** Every type must have its own icon; colour only tells categories apart, for the sake of colour-blind users.

## 3. Data model

One optional field is added to the existing node model:

```ts
interface Node {
  id: string;
  title: string;
  typeId?: string;        // treated as "generic" when not set
  technology?: string;    // free text, see section 5
  description?: string;
  position: { x: number; y: number };
  children: Node[];
  edges: Edge[];
}
```

The type registry (built into the code in the first phase, not stored in saved files):

```ts
interface TypeDefinition {
  id: string;                       // stable kebab-case id, never changed once published
  label: string;                    // display name
  categoryId: string;               // its category, which sets the colour
  icon: string;                     // icon key
  suggestedTechnologies?: string[]; // what the technology picker offers
}

interface CategoryDefinition {
  id: string;
  label: string;
  color: string;                    // the category's main colour
  order: number;
}
```

**Constraints:**
- Once published, an `id` is part of the file format: **only add, never change or remove**. To rename, change only the `label`.
- The document's `schemaVersion` goes up, with a migration for old files (no `typeId`): treat them as `generic`.
- The registry's structure must be able to hold a second kind of object (connection types, see section 8), though that isn't implemented in this phase.

## 4. Built-in types (first phase)

39 in all: 36 domain types + 3 general ones. (There were 27 at first; the "AI" category and 12 types were added later.) The technology column gives a few examples only; each type's full list is `TECHNOLOGIES` in `frontend/src/registry/boxTypes.ts`. Icons are from [Lucide](https://lucide.dev/).

### Actors

| id | Label | Icon | Example technologies |
|---|---|---|---|
| `actor` | User / Actor | `user` | (none) |
| `external-system` | External System | `cloud-cog` | Stripe, Twilio, SendGrid |

### Clients

| id | Label | Icon | Example technologies |
|---|---|---|---|
| `client` | Client (Web, Mobile, CLI) | `monitor-smartphone` | React, iOS, Android |

### Traffic entry

| id | Label | Icon | Example technologies |
|---|---|---|---|
| `dns` | DNS | `globe` | Route 53, Cloudflare DNS |
| `cdn` | CDN | `network` | CloudFront, Cloudflare, Akamai |
| `load-balancer` | Load Balancer | `split` | Nginx, HAProxy, AWS ALB |
| `api-gateway` | API Gateway | `door-open` | Kong, AWS API Gateway, Envoy |
| `reverse-proxy` | Reverse Proxy | `arrow-left-right` | Nginx, Envoy, Traefik |
| `rate-limiter` | Rate Limiter | `gauge` | Redis, Envoy, Nginx |

### Compute

| id | Label | Icon | Example technologies |
|---|---|---|---|
| `service` | Service / Application | `server` | Spring Boot, Express, Django |
| `worker` | Background Worker | `cog` | Celery, Sidekiq, BullMQ |
| `serverless-function` | Serverless Function | `lambda` | AWS Lambda, Cloud Functions |
| `workflow-engine` | Workflow Engine | `workflow` | Temporal, Apache Airflow, AWS Step Functions |

### Data

| id | Label | Icon | Example technologies |
|---|---|---|---|
| `relational-db` | Relational Database | `database` | PostgreSQL, MySQL |
| `nosql-db` | NoSQL Database | `cylinder` | MongoDB, DynamoDB, Cassandra |
| `cache` | Cache | `zap` | Redis, Memcached |
| `object-storage` | Object Storage | `archive` | S3, GCS, MinIO |
| `search-engine` | Search Engine | `search` | Elasticsearch, OpenSearch |
| `data-warehouse` | Data Warehouse | `warehouse` | Snowflake, Google BigQuery, Amazon Redshift, ClickHouse |
| `data-processing` | Data Processing / ETL | `funnel` | Apache Spark, Apache Flink, dbt |
| `lakehouse` | Lakehouse / Table Format | `droplets` | Apache Iceberg, Delta Lake, Apache Hudi |

### Messaging

| id | Label | Icon | Example technologies |
|---|---|---|---|
| `message-queue` | Message Queue | `rows-3` | RabbitMQ, SQS |
| `event-stream` | Event Stream | `waves` | Kafka, Kinesis, Pulsar |

### AI

| id | Label | Icon | Example technologies |
|---|---|---|---|
| `vector-db` | Vector Database | `chart-scatter` | Pinecone, Qdrant, pgvector |
| `ai-model` | LLM / AI Model | `brain` | Claude, GPT, Gemini, Llama |
| `ai-agent` | AI Agent | `bot` | LangChain, LangGraph, CrewAI |
| `model-serving` | Model Serving / Inference | `cpu` | vLLM, Ollama, Amazon Bedrock |
| `llm-gateway` | LLM Gateway | `router` | LiteLLM, OpenRouter, Portkey |

Types describe roles: the box is the "agent", and agent frameworks such as LangChain and CrewAI are its technology; `ai-model` lists technologies by model family, and where a model runs is shown with `model-serving`.

### Platform

| id | Label | Icon | Example technologies |
|---|---|---|---|
| `container` | Docker Container | `container` | Docker |
| `orchestrator` | Orchestrator | `ship-wheel` | Kubernetes, Nomad |
| `service-mesh` | Service Mesh | `waypoints` | Istio, Linkerd, Cilium |
| `hosting-platform` | Hosting Platform / PaaS | `rocket` | Vercel, Netlify, Heroku, Fly.io |
| `ci-cd` | CI/CD | `infinity` | GitHub Actions, GitLab CI, Jenkins, Argo CD |

### Cross-cutting

| id | Label | Icon | Example technologies |
|---|---|---|---|
| `auth-service` | Auth / Identity Service | `key-round` | Keycloak, Auth0, Cognito |
| `secrets-manager` | Secrets Manager | `vault` | HashiCorp Vault, AWS Secrets Manager, Azure Key Vault |
| `monitoring` | Monitoring / Observability | `chart-line` | Prometheus, Grafana, Datadog |

### General

| id | Label | Icon | Notes |
|---|---|---|---|
| `generic` | Generic | `box` | **the type of new boxes**; also what unknown `typeId`s fall back to |
| `group` | Group / Boundary | `square-dashed` | a box just for drawing a line around a set of components, shown with a fainter fill and a dashed border |
| `note` | Note | `sticky-note` | a sticky note for writing remarks; not a part of the system |

**About naming:** "container" is ambiguous. The type is always labelled "Docker Container"; in text and code comments, a box that "can hold boxes" is called **nested**, never a "container".

## 5. Types and technologies together

- **Types with a technology list only allow technologies from that list.** The technology field is a searchable dropdown: typing only filters, it's never saved directly; only picking an item writes it. Leaving the field drops unmatched input. The list is the type's `suggestedTechnologies` (from `TECHNOLOGIES`).
- **Types without a technology list (`generic`, `group`, `note`, `actor`) keep free text.** `actor` suggests technologies already used in the diagram; `generic` / `group` / `note` suggest nothing. Unknown types are treated as `generic`.
- **One Backspace (or Delete) clears a chosen technology** as a whole, as one undo step; free text still deletes character by character.
- Changing the type **clears** the technology: a technology belongs to the type it was chosen for, even when the new type's list has it too. The type and technology change are one undo step, so one undo brings both back. Choosing the current type again isn't a change, and the technology stays.
- Technologies in files aren't checked, so a box can still arrive with a technology that isn't on its type's list (for example in a hand-edited file). The field then keeps it and notes that it isn't on the type's list; the user can pick another or clear it with Backspace.
- The restriction applies in the interface only: technology values in files are read and written as they are, without checks.
- A box shows its technology as a logo: one-colour logos come from Simple Icons, brands it lacks get a full-colour logo from SVG Logos; technologies in neither borrow their maker's logo or show a two-letter block, see [Technology logos](./technology-logos.md). With no technology chosen, nothing is shown.

## 6. Interface behaviour

- **Sidebar**: a "Type" picker below the name and above the technology. A **dropdown grouped by category**, searchable, with icons next to the options.
- **New boxes**: type `generic`; no dialog asks for a type.
- **Drawing boxes**: every box is a rounded rectangle. The type label sits at the left of the top edge (on the border line); inside, at the top left, a tile with the icon in the category's colour, and at the top right the nested-count badge; the title is centred and larger. Technology and description are **not** shown on the box; they're viewed and edited in the sidebar only.
- **`group`'s look**: a fainter, see-through fill and a dashed border, hinting that it's mainly a boundary.
- **`note`'s look**: a sticky note (dark yellow fill, folded corner).
- **`generic`**: no type label, so new boxes stay clean.
- **Unknown types**: drawn as `generic`, with the stored `typeId` shown in the label so the user notices.
- Choosing a type **is part of the undo history** (like changes to the node's other properties).

## 7. Reserved for the second phase (real project architecture)

These types **aren't implemented** in this phase, but the registry's design must not stand in their way:

- Infrastructure: virtual machine / node, cluster, network (VPC), region, availability zone
- Security: WAF / firewall
- Engineering: configuration service, scheduled jobs
- Other: notification service

(Secrets management, CI/CD and data warehouse, listed here originally, have since been added; see section 4.)

Adding them follows the constraints in section 3: only new ids, never changes to existing ones.

## 8. Reserved for later: connection types

Connections need types too (synchronous request, asynchronous message, read/write, replication and so on). They use a registry with the same structure as box types; build the registry so it can generalise into an "object type registry". **Not implemented in this phase**, and don't add fields to `Edge` for it.

## 9. Explicitly not doing

- User-defined types (the groundwork is there: registry + stable ids, but there's no way in)
- Type-specific properties
- Types restricting nesting
- Deriving connection rules from types

## 10. Acceptance criteria

1. New boxes are Generic; the sidebar can switch to any type in the list, and the icon and colour change on the canvas at once.
2. The type picker is grouped by category and searchable by name.
3. After saving and reopening a file, every box keeps its type.
4. Old files (no `typeId`) open normally, with every box Generic.
5. Hand-edit a box's `typeId` in a file to a value that doesn't exist: it opens without errors, the box is drawn Generic and shows the stored value; saving again keeps that `typeId` exactly.
6. Changing the type clears the chosen technology; one undo brings back both the type and the technology.
7. Type changes can be undone and redone.
8. On the dark theme (the project's only theme), every category colour is clearly distinguishable, and every type can be told apart by its icon.
