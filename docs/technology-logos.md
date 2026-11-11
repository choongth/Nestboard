# Technology logos

**English** | [简体中文](./technology-logos.zh-CN.md)

A box shows its technology as a logo. The technologies each box type allows are `TECHNOLOGIES` in `frontend/src/registry/boxTypes.ts`; which logo each technology uses is in `frontend/src/registry/technologyLogos.ts`.

## Where the logos come from

1. **Simple Icons** (`simple-icons`, CC0): one-colour logos, with the brand colour lightened against the box's background so they stay readable. Most technologies use these.
2. **SVG Logos** (`@iconify-json/logos`, CC0): full-colour logos, for brands Simple Icons doesn't have (AWS, Azure, Twilio and others). Only square ones are used: a wide wordmark is unreadable at this size. Some that are too dark to see on a box get a light backing.
3. **The maker's logo**: when a technology has no logo of its own, it uses its maker's (or its product family's), listed below.
4. **Two letters**: when there's neither, two letters of the technology's name are shown, listed in the last table.

Both sets are used at development time only: the logos in use are copied into `logoDrawings.json` by `logoDrawings.test.ts`, and the page loads that file the first time it draws a logo, so it doesn't slow down opening the page; the code keeps only the technologies' names.

Brand logos belong to their owners and are used only to identify the technology. The PDF export uses the same logos (`server/app/pdf_export/visuals.json`).

To add a technology: add its name to `TECHNOLOGIES`; if it has its own logo, add it to `technologyLogos.ts` and regenerate `logoDrawings.json` (`UPDATE_LOGO_DRAWINGS=1 npx vitest run src/registry/logoDrawings.test.ts`); if it borrows its maker's, add it to `MAKER_LOGOS`; if it has none, add it to `NO_LOGO`; then update the tables in this document (in both languages). The tests check that every technology falls into one of these, and that the two tables below match the code.

## Technologies drawn with their maker's logo

These are drawn with their maker's or product family's logo; a better drawing can be found for them later.

| Technology | Logo used |
|---|---|
| .NET MAUI | .NET |
| Actix Web | Actix |
| AlloyDB | Google Cloud |
| Amazon Aurora DSQL | Amazon Aurora |
| Amazon S3 Tables | S3 |
| Amazon S3 Vectors | S3 |
| Apache Beam | Apache |
| Apache Hudi | Apache |
| Apache Iceberg | Apache |
| Apache Paimon | Apache |
| Apache Polaris | Apache |
| Apollo Router | Apollo GraphQL |
| Argo Workflows | Argo |
| ASP.NET Core | .NET |
| AutoGen | Microsoft |
| AWS ALB | Elastic Load Balancing |
| AWS NLB | Elastic Load Balancing |
| Azure AI Foundry | Azure |
| Azure AI Search | Azure |
| Azure API Management | Azure |
| Azure App Service | Azure |
| Azure Blob Storage | Azure |
| Azure Cache for Redis | Azure |
| Azure Container Apps | Azure |
| Azure Cosmos DB | Azure |
| Azure Data Factory | Azure |
| Azure DNS | Azure |
| Azure Event Hubs | Azure |
| Azure Front Door | Azure |
| Azure Functions | Azure |
| Azure Key Vault | Azure |
| Azure Kubernetes Service | Azure |
| Azure Load Balancer | Azure |
| Azure Logic Apps | Azure |
| Azure Monitor | Azure |
| Azure Pipelines | Azure |
| Azure Service Bus | Azure |
| Azure SQL Database | Azure |
| Azure Synapse Analytics | Azure |
| Backblaze B2 | Backblaze |
| Bitbucket Pipelines | Bitbucket |
| Bitwarden Secrets Manager | Bitwarden |
| Claude Agent SDK | Claude |
| Cloudflare AI Gateway | Cloudflare |
| Cloudflare DNS | Cloudflare |
| Cloudflare Queues | Cloudflare |
| Cloudflare R2 | Cloudflare |
| CockroachDB | Cockroach Labs |
| Cohere Command | Cohere |
| Delta Lake | Databricks |
| Deno Deploy | Deno |
| DigitalOcean App Platform | DigitalOcean |
| DigitalOcean Spaces | DigitalOcean |
| Docker Swarm | Docker |
| Envoy AI Gateway | Envoy Proxy |
| F5 BIG-IP | F5 |
| Firebase Authentication | Firebase |
| Firestore | Firebase |
| GCS | Google Cloud |
| Gemma | Google |
| GitLab CI | GitLab |
| Google ADK | Google |
| Google App Engine | Google Cloud |
| Google Cloud Build | Google Cloud |
| Google Cloud CDN | Google Cloud |
| Google Cloud DNS | Google Cloud |
| Google Cloud Load Balancing | Google Cloud |
| Google Cloud Pub/Sub | Google Cloud |
| Google Cloud Service Mesh | Google Cloud |
| Google Cloud SQL | Google Cloud |
| Google Cloud Workflows | Google Cloud |
| Google Kubernetes Engine | Google Cloud |
| Google Secret Manager | Google Cloud |
| GPT | OpenAI |
| Grafana Loki | Grafana |
| Grafana Tempo | Grafana |
| Hetzner Object Storage | Hetzner |
| Hugging Face TGI | Hugging Face |
| Kafka Streams | Apache Kafka |
| Kong AI Gateway | Kong |
| Kong Mesh | Kong |
| Kotlin Multiplatform | Kotlin |
| LangSmith | LangChain |
| Llama | Meta |
| Microsoft Agent Framework | Microsoft |
| Microsoft Entra ID | Microsoft |
| Microsoft Fabric | Microsoft |
| Microsoft SQL Server | Microsoft |
| MongoDB Atlas Vector Search | MongoDB |
| Netlify Functions | Netlify |
| NVIDIA Triton | NVIDIA |
| OpenAI Agents SDK | OpenAI |
| pgvector | PostgreSQL |
| Phi | Microsoft |
| Pydantic AI | Pydantic |
| Ray Serve | Ray |
| React Native | React |
| Semantic Kernel | Microsoft |
| smolagents | Hugging Face |
| Spring Batch | Spring Boot |
| Supabase Auth | Supabase |
| Supabase Edge Functions | Supabase |
| Unity Catalog | Databricks |
| Upstash QStash | Upstash |
| Vercel AI Gateway | Vercel |
| Vercel AI SDK | Vercel |
| Vercel Functions | Vercel |
| Vertex AI | Google Cloud |
| Vertex AI Vector Search | Google Cloud |
| Whisper | OpenAI |
| Zilliz Cloud | Milvus |

## Technologies without a logo

These show two letters.

| Technology | Why |
|---|---|
| ActiveMQ | in neither logo set |
| Agno | in neither logo set |
| Akeyless | in neither logo set |
| Amazon Bedrock | in neither logo set; AWS's logo is only a wide wordmark |
| Amazon Bedrock Agents | in neither logo set; AWS's logo is only a wide wordmark |
| Amazon EMR | in neither logo set; AWS's logo is only a wide wordmark |
| Amazon Nova | in neither logo set; AWS's logo is only a wide wordmark |
| Amazon SageMaker | in neither logo set; AWS's logo is only a wide wordmark |
| Apigee | SVG Logos has only a wide wordmark |
| Arize Phoenix | in neither logo set |
| AutoMQ | in neither logo set |
| Axiom | in neither logo set |
| Axum | in neither logo set |
| Beanstalkd | in neither logo set |
| BullMQ | in neither logo set |
| Conductor | in neither logo set |
| Confluent | in neither logo set |
| CoreDNS | in neither logo set |
| CyberArk Conjur | in neither logo set |
| Dagster | in neither logo set |
| Debezium | in neither logo set |
| Descope | in neither logo set |
| DocuSign | in neither logo set |
| Dokku | in neither logo set |
| Doppler | in neither logo set |
| Dragonfly | in neither logo set |
| Dremio | in neither logo set |
| DSPy | in neither logo set |
| Echo | in neither logo set |
| Ehcache | in neither logo set |
| EMQX | in neither logo set |
| Encore | in neither logo set |
| Fiber | in neither logo set |
| Firebolt | in neither logo set |
| Fireworks AI | SVG Logos has only a wide wordmark |
| Fivetran | in neither logo set |
| Flowise | in neither logo set |
| Gravitee | in neither logo set |
| Groq | SVG Logos has only a wide wordmark |
| Hangfire | in neither logo set |
| HAProxy | in neither logo set |
| Hatchet | in neither logo set |
| Hazelcast | in neither logo set |
| Helicone | in neither logo set |
| Honeycomb | in neither logo set |
| IBM MQ | in neither logo set; IBM's logo is only a wide wordmark |
| Infisical | in neither logo set |
| Inngest | in neither logo set |
| Kestra | in neither logo set |
| KrakenD | in neither logo set |
| KServe | in neither logo set |
| LiteLLM | in neither logo set |
| llama.cpp | in neither logo set |
| LlamaIndex | in neither logo set |
| Manticore Search | in neither logo set |
| Mastra | in neither logo set |
| Micronaut | in neither logo set |
| Momento | in neither logo set |
| MotherDuck | in neither logo set |
| NS1 | in neither logo set |
| Oracle Database | in neither logo set; Oracle's logo is only a wide wordmark |
| ParadeDB | in neither logo set |
| Plaid | in neither logo set |
| Portkey | in neither logo set |
| PowerDNS | in neither logo set |
| Quickwit | in neither logo set |
| Redpanda | in neither logo set |
| Resque | in neither logo set |
| Restate | in neither logo set |
| RQ | in neither logo set |
| SGLang | in neither logo set |
| Starburst | in neither logo set |
| StarRocks | in neither logo set |
| Strands Agents | in neither logo set; AWS's logo is only a wide wordmark |
| Stytch | SVG Logos has only a wide wordmark |
| Tigris | in neither logo set |
| Trigger.dev | in neither logo set |
| Turbopuffer | in neither logo set |
| Tyk | in neither logo set |
| Varnish | in neither logo set |
| Voyage AI | in neither logo set |
| WarpStream | in neither logo set |
| Windmill | in neither logo set |
| Zabbix | SVG Logos has only a wide wordmark |
| ZeroMQ | in neither logo set |
| Zitadel | in neither logo set |
