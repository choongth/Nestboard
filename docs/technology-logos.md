# 技术的标志

框上用标志(logo)表示它的技术。每种框类型可选的技术见 `frontend/src/registry/boxTypes.ts` 的 `TECHNOLOGIES`;每个技术用哪个标志见 `frontend/src/registry/technologyLogos.ts`。

## 标志从哪里来

1. **Simple Icons**(`simple-icons`,CC0):单色标志,按框的底色调亮品牌色,保证看得清。大多数技术用它。
2. **SVG Logos**(`@iconify-json/logos`,CC0):全彩标志,用于 Simple Icons 没有的品牌(AWS、Azure、Twilio 等)。只用方形的,横向的文字标志(wordmark)缩小后看不清。有部分颜色太暗、在框上看不清的,会垫一块浅色底。
3. **借用厂商的标志**:技术本身没有标志时,用它厂商(或所属产品系列)的标志,见下表。
4. **两个字母**:都没有时,显示技术名称的两个字母,见最后一张表。

两个库都只在开发时使用:用到的标志由 `logoDrawings.test.ts` 复制到 `logoDrawings.json`,网页第一次画标志时才加载这个文件,所以不会让打开网页变慢;代码里只保留技术名称。

品牌标志归其所有者,只用来标明是哪种技术。PDF 导出用同样的标志(`server/app/pdf_export/visuals.json`)。

增加技术时:在 `TECHNOLOGIES` 中加入名称;有自己的标志就加到 `technologyLogos.ts`,再重新生成 `logoDrawings.json`(`UPDATE_LOGO_DRAWINGS=1 npx vitest run src/registry/logoDrawings.test.ts`);借用厂商的加到 `MAKER_LOGOS`,没有标志的加到 `NO_LOGO`,并更新本文的表格。测试会检查每个技术都属于其中一种,并且下面两张表与代码一致。

## 借用厂商标志的技术

这些技术画的是厂商或产品系列的标志,将来可以找更合适的画法。

| 技术 | 借用的标志 |
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

## 没有标志的技术

这些技术显示两个字母。

| 技术 | 原因 |
|---|---|
| ActiveMQ | 两个标志库都没有 |
| Agno | 两个标志库都没有 |
| Akeyless | 两个标志库都没有 |
| Amazon Bedrock | 两个标志库都没有;AWS 的标志只有横向的文字标志 |
| Amazon Bedrock Agents | 两个标志库都没有;AWS 的标志只有横向的文字标志 |
| Amazon EMR | 两个标志库都没有;AWS 的标志只有横向的文字标志 |
| Amazon Nova | 两个标志库都没有;AWS 的标志只有横向的文字标志 |
| Amazon SageMaker | 两个标志库都没有;AWS 的标志只有横向的文字标志 |
| Apigee | SVG Logos 只有横向的文字标志 |
| Arize Phoenix | 两个标志库都没有 |
| AutoMQ | 两个标志库都没有 |
| Axiom | 两个标志库都没有 |
| Axum | 两个标志库都没有 |
| Beanstalkd | 两个标志库都没有 |
| BullMQ | 两个标志库都没有 |
| Conductor | 两个标志库都没有 |
| Confluent | 两个标志库都没有 |
| CoreDNS | 两个标志库都没有 |
| CyberArk Conjur | 两个标志库都没有 |
| Dagster | 两个标志库都没有 |
| Debezium | 两个标志库都没有 |
| Descope | 两个标志库都没有 |
| DocuSign | 两个标志库都没有 |
| Dokku | 两个标志库都没有 |
| Doppler | 两个标志库都没有 |
| Dragonfly | 两个标志库都没有 |
| Dremio | 两个标志库都没有 |
| DSPy | 两个标志库都没有 |
| Echo | 两个标志库都没有 |
| Ehcache | 两个标志库都没有 |
| EMQX | 两个标志库都没有 |
| Encore | 两个标志库都没有 |
| Fiber | 两个标志库都没有 |
| Firebolt | 两个标志库都没有 |
| Fireworks AI | SVG Logos 只有横向的文字标志 |
| Fivetran | 两个标志库都没有 |
| Flowise | 两个标志库都没有 |
| Gravitee | 两个标志库都没有 |
| Groq | SVG Logos 只有横向的文字标志 |
| Hangfire | 两个标志库都没有 |
| HAProxy | 两个标志库都没有 |
| Hatchet | 两个标志库都没有 |
| Hazelcast | 两个标志库都没有 |
| Helicone | 两个标志库都没有 |
| Honeycomb | 两个标志库都没有 |
| IBM MQ | 两个标志库都没有;IBM 的标志只有横向的文字标志 |
| Infisical | 两个标志库都没有 |
| Inngest | 两个标志库都没有 |
| Kestra | 两个标志库都没有 |
| KrakenD | 两个标志库都没有 |
| KServe | 两个标志库都没有 |
| LiteLLM | 两个标志库都没有 |
| llama.cpp | 两个标志库都没有 |
| LlamaIndex | 两个标志库都没有 |
| Manticore Search | 两个标志库都没有 |
| Mastra | 两个标志库都没有 |
| Micronaut | 两个标志库都没有 |
| Momento | 两个标志库都没有 |
| MotherDuck | 两个标志库都没有 |
| NS1 | 两个标志库都没有 |
| Oracle Database | 两个标志库都没有;Oracle 的标志只有横向的文字标志 |
| ParadeDB | 两个标志库都没有 |
| Plaid | 两个标志库都没有 |
| Portkey | 两个标志库都没有 |
| PowerDNS | 两个标志库都没有 |
| Quickwit | 两个标志库都没有 |
| Redpanda | 两个标志库都没有 |
| Resque | 两个标志库都没有 |
| Restate | 两个标志库都没有 |
| RQ | 两个标志库都没有 |
| SGLang | 两个标志库都没有 |
| Starburst | 两个标志库都没有 |
| StarRocks | 两个标志库都没有 |
| Strands Agents | 两个标志库都没有;AWS 的标志只有横向的文字标志 |
| Stytch | SVG Logos 只有横向的文字标志 |
| Tigris | 两个标志库都没有 |
| Trigger.dev | 两个标志库都没有 |
| Turbopuffer | 两个标志库都没有 |
| Tyk | 两个标志库都没有 |
| Varnish | 两个标志库都没有 |
| Voyage AI | 两个标志库都没有 |
| WarpStream | 两个标志库都没有 |
| Windmill | 两个标志库都没有 |
| Zabbix | SVG Logos 只有横向的文字标志 |
| ZeroMQ | 两个标志库都没有 |
| Zitadel | 两个标志库都没有 |
