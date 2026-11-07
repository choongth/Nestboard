// Built-in box types: the role a box plays in a system (spec: box-type-specs.md §4).
// Ids are part of the file format: add new ones freely, but never rename or
// remove one. To rename, change only the label.

import { createRegistry, type CategoryDefinition, type ObjectTypeDefinition } from "./registry";

export interface BoxTypeDefinition extends ObjectTypeDefinition {
  /** The only technologies a box of this type may use (see TECHNOLOGIES); none means any text. */
  suggestedTechnologies?: readonly string[];
}

/** New boxes have no type, which means this one. Also shown for unknown ids. */
export const GENERIC_TYPE_ID = "generic";

// Colours are tuned for the dark theme only, which is the only theme.
const categories: CategoryDefinition[] = [
  { id: "actors", label: "Actors", color: "#c084fc", order: 1 },
  { id: "clients", label: "Clients", color: "#38bdf8", order: 2 },
  { id: "traffic", label: "Traffic entry", color: "#fbbf24", order: 3 },
  { id: "compute", label: "Compute", color: "#818cf8", order: 4 },
  { id: "data", label: "Data", color: "#34d399", order: 5 },
  { id: "messaging", label: "Messaging", color: "#fb923c", order: 6 },
  { id: "ai", label: "AI", color: "#2dd4bf", order: 7 },
  { id: "platform", label: "Platform", color: "#f472b6", order: 8 },
  { id: "cross-cutting", label: "Cross-cutting", color: "#a3e635", order: 9 },
  { id: "general", label: "General", color: "#94a3b8", order: 10 },
];

/**
 * The technologies a box of each type may use, and the only ones (box-type-specs.md §5). Their
 * logos: technologyLogos.ts.
 */
const TECHNOLOGIES: Readonly<Record<string, readonly string[]>> = {
  "external-system": [
    "Stripe", "PayPal", "Adyen", "Plaid", "Twilio", "SendGrid", "Mailgun", "Mailchimp", "Salesforce", "HubSpot",
    "Zendesk", "Intercom", "Slack", "Microsoft Teams", "Shopify", "Google Maps", "OpenAI", "GitHub", "Segment",
    "DocuSign", "Anthropic", "Google Gemini", "Hugging Face",
  ],
  client: [
    "React", "Vue.js", "Angular", "Svelte", "Next.js", "Nuxt", "iOS", "Android", "Flutter", "React Native",
    "Electron", "Tauri", "Astro", "Remix", "React Router", "SolidJS", "Qwik", "Expo", "Kotlin Multiplatform",
    ".NET MAUI",
  ],
  dns: [
    "Route 53", "Cloudflare DNS", "Google Cloud DNS", "Azure DNS", "NS1", "CoreDNS", "PowerDNS",
  ],
  cdn: [
    "CloudFront", "Cloudflare", "Akamai", "Fastly", "Google Cloud CDN", "Azure Front Door", "bunny.net", "KeyCDN",
  ],
  "load-balancer": [
    "Nginx", "HAProxy", "AWS ALB", "AWS NLB", "Google Cloud Load Balancing", "Azure Load Balancer", "F5 BIG-IP",
    "Envoy", "Traefik",
  ],
  "api-gateway": [
    "Kong", "AWS API Gateway", "Envoy", "Apigee", "Azure API Management", "Tyk", "KrakenD", "Gravitee",
    "Apollo Router",
  ],
  "reverse-proxy": [
    "Nginx", "Envoy", "Traefik", "HAProxy", "Caddy", "Apache HTTP Server", "Varnish",
  ],
  "rate-limiter": [
    "Redis", "Envoy", "Nginx", "Kong", "Cloudflare", "AWS WAF",
  ],
  service: [
    "Spring Boot", "Quarkus", "Micronaut", "Express", "NestJS", "Fastify", "Node.js", "Django", "FastAPI", "Flask",
    "Ruby on Rails", "Laravel", "ASP.NET Core", "Go", "Gin", "Rust", "Phoenix", "Ktor", "Hono", "Bun", "Deno",
    "Axum", "Actix Web", "Echo", "Fiber", "Encore",
  ],
  worker: [
    "Celery", "Sidekiq", "BullMQ", "Resque", "RQ", "Hangfire", "Temporal", "Apache Airflow", "AWS Batch",
    "Spring Batch", "Trigger.dev", "Hatchet",
  ],
  "serverless-function": [
    "AWS Lambda", "Cloud Functions", "Cloud Run", "Azure Functions", "Cloudflare Workers", "Vercel Functions",
    "Netlify Functions", "Deno Deploy", "Knative", "OpenFaaS", "Supabase Edge Functions", "Modal",
  ],
  "workflow-engine": [
    "Temporal", "Apache Airflow", "Dagster", "Prefect", "AWS Step Functions", "Argo Workflows", "Camunda", "Inngest",
    "Conductor", "Restate", "Kestra", "Windmill", "Azure Logic Apps", "Google Cloud Workflows",
  ],
  "relational-db": [
    "PostgreSQL", "MySQL", "MariaDB", "SQLite", "Microsoft SQL Server", "Oracle Database", "Amazon Aurora",
    "Amazon RDS", "Google Cloud SQL", "Azure SQL Database", "Cloud Spanner", "CockroachDB", "YugabyteDB", "TiDB",
    "PlanetScale", "Neon", "Supabase", "AlloyDB", "Amazon Aurora DSQL", "Turso", "Xata",
  ],
  "nosql-db": [
    "MongoDB", "DynamoDB", "Cassandra", "ScyllaDB", "Couchbase", "CouchDB", "Firestore", "Azure Cosmos DB",
    "Amazon DocumentDB", "Neo4j", "ArangoDB", "HBase", "InfluxDB",
  ],
  cache: [
    "Redis", "Memcached", "Valkey", "KeyDB", "Dragonfly", "Hazelcast", "Amazon ElastiCache", "Azure Cache for Redis",
    "Ehcache", "Upstash", "Momento",
  ],
  "object-storage": [
    "S3", "GCS", "MinIO", "Azure Blob Storage", "Cloudflare R2", "Backblaze B2", "DigitalOcean Spaces", "Ceph",
    "Wasabi", "Tigris", "Hetzner Object Storage",
  ],
  "search-engine": [
    "Elasticsearch", "OpenSearch", "Apache Solr", "Algolia", "Meilisearch", "Typesense", "Vespa", "Azure AI Search",
    "Manticore Search", "Quickwit", "ParadeDB",
  ],
  "data-warehouse": [
    "Snowflake", "Google BigQuery", "Amazon Redshift", "ClickHouse", "Databricks", "Azure Synapse Analytics",
    "Apache Druid", "DuckDB", "Teradata", "Trino", "Presto", "Apache Hive", "MotherDuck", "StarRocks", "Apache Doris",
    "Firebolt",
  ],
  "data-processing": [
    "Apache Spark", "Apache Flink", "Apache Beam", "Google Dataflow", "AWS Glue", "Amazon EMR", "Kafka Streams", "dbt",
    "Airbyte", "Fivetran", "Apache NiFi", "Debezium", "Azure Data Factory", "Databricks",
  ],
  lakehouse: [
    "Apache Iceberg", "Delta Lake", "Apache Hudi", "Apache Paimon", "Databricks", "Dremio", "Starburst",
    "AWS Lake Formation", "Amazon S3 Tables", "Unity Catalog", "Apache Polaris", "Microsoft Fabric",
  ],
  "message-queue": [
    "RabbitMQ", "SQS", "Amazon MQ", "ActiveMQ", "Azure Service Bus", "Google Cloud Pub/Sub", "NATS", "ZeroMQ",
    "IBM MQ", "Beanstalkd", "EMQX", "Eclipse Mosquitto", "HiveMQ", "Upstash QStash", "Cloudflare Queues",
  ],
  "event-stream": [
    "Kafka", "Kinesis", "Pulsar", "Redpanda", "Confluent", "Amazon MSK", "Azure Event Hubs", "Google Cloud Pub/Sub",
    "NATS", "WarpStream", "AutoMQ",
  ],
  "vector-db": [
    "Pinecone", "Weaviate", "Qdrant", "Milvus", "Zilliz Cloud", "Chroma", "pgvector", "LanceDB", "Turbopuffer",
    "MongoDB Atlas Vector Search", "Redis", "Elasticsearch", "OpenSearch", "Vespa", "Azure AI Search",
    "Vertex AI Vector Search", "Amazon S3 Vectors",
  ],
  "ai-model": [
    "Claude", "GPT", "Gemini", "Gemma", "Llama", "Mistral", "DeepSeek", "Qwen", "Grok", "Cohere Command",
    "Amazon Nova", "Phi", "Voyage AI", "Whisper",
  ],
  "ai-agent": [
    "LangChain", "LangGraph", "LlamaIndex", "CrewAI", "Microsoft Agent Framework", "Semantic Kernel", "AutoGen",
    "OpenAI Agents SDK", "Claude Agent SDK", "Google ADK", "Vercel AI SDK", "Mastra", "Pydantic AI", "Haystack", "DSPy",
    "smolagents", "Agno", "Strands Agents", "Amazon Bedrock Agents", "Dify", "Langflow", "Flowise", "n8n",
  ],
  "model-serving": [
    "vLLM", "Ollama", "llama.cpp", "SGLang", "Hugging Face TGI", "NVIDIA Triton", "Ray Serve", "KServe",
    "Amazon Bedrock", "Amazon SageMaker", "Azure AI Foundry", "Vertex AI", "Together AI", "Groq", "Fireworks AI",
    "Replicate", "Modal", "Baseten",
  ],
  "llm-gateway": [
    "LiteLLM", "OpenRouter", "Portkey", "Helicone", "Cloudflare AI Gateway", "Kong AI Gateway", "Vercel AI Gateway",
    "Envoy AI Gateway",
  ],
  container: [
    "Docker", "Podman", "containerd",
  ],
  orchestrator: [
    "Kubernetes", "Nomad", "Amazon ECS", "Amazon EKS", "AWS Fargate", "Google Kubernetes Engine",
    "Azure Kubernetes Service", "OpenShift", "Docker Swarm", "Rancher", "K3s",
  ],
  "service-mesh": [
    "Istio", "Linkerd", "Cilium", "Consul", "Kuma", "Kong Mesh", "Traefik Mesh", "Google Cloud Service Mesh",
  ],
  "hosting-platform": [
    "Vercel", "Netlify", "Heroku", "Render", "Fly.io", "Railway", "Google App Engine", "AWS Elastic Beanstalk",
    "Azure App Service", "Azure Container Apps", "Cloudflare Pages", "DigitalOcean App Platform", "Coolify", "Dokku",
  ],
  "ci-cd": [
    "GitHub Actions", "GitLab CI", "Jenkins", "CircleCI", "Argo CD", "Flux", "Buildkite", "Azure Pipelines",
    "AWS CodePipeline", "Google Cloud Build", "Tekton", "TeamCity", "Spinnaker", "Harness", "Bitbucket Pipelines",
    "Travis CI",
  ],
  "auth-service": [
    "Keycloak", "Auth0", "Cognito", "Okta", "Microsoft Entra ID", "Firebase Authentication", "Clerk", "Ory",
    "FusionAuth", "authentik", "WorkOS", "Stytch", "Descope", "Zitadel", "Supabase Auth", "Better Auth",
  ],
  "secrets-manager": [
    "HashiCorp Vault", "OpenBao", "AWS Secrets Manager", "AWS KMS", "Azure Key Vault", "Google Secret Manager",
    "Doppler", "Infisical", "1Password", "Bitwarden Secrets Manager", "CyberArk Conjur", "Akeyless",
  ],
  monitoring: [
    "Prometheus", "Grafana", "Datadog", "New Relic", "Dynatrace", "Splunk", "Elastic", "Jaeger", "OpenTelemetry",
    "Sentry", "Grafana Loki", "Amazon CloudWatch", "Azure Monitor", "Honeycomb", "Zabbix", "PagerDuty",
    "Grafana Tempo", "SigNoz", "Better Stack", "Axiom", "Langfuse", "LangSmith", "Arize Phoenix", "Braintrust",
  ],
};

const types: BoxTypeDefinition[] = [
  // Actors
  { id: "actor",
    label: "User / Actor",
    categoryId: "actors",
    icon: "user"
  },
  {
    id: "external-system",
    label: "External System",
    categoryId: "actors",
    icon: "cloud-cog",
  },

  // Clients
  {
    id: "client",
    label: "Client (Web, Mobile, CLI)",
    categoryId: "clients",
    icon: "monitor-smartphone",
  },

  // Traffic entry
  { id: "dns",
    label: "DNS",
    categoryId: "traffic",
    icon: "globe"
  },
  {
    id: "cdn",
    label: "CDN",
    categoryId: "traffic",
    icon: "network",
  },
  {
    id: "load-balancer",
    label: "Load Balancer",
    categoryId: "traffic",
    icon: "split",
  },
  {
    id: "api-gateway",
    label: "API Gateway",
    categoryId: "traffic",
    icon: "door-open",
  },
  {
    id: "reverse-proxy",
    label: "Reverse Proxy",
    categoryId: "traffic",
    icon: "arrow-left-right",
  },
  {
    id: "rate-limiter",
    label: "Rate Limiter",
    categoryId: "traffic",
    icon: "gauge",
  },

  // Compute
  {
    id: "service",
    label: "Service / Application",
    categoryId: "compute",
    icon: "server",
  },
  {
    id: "worker",
    label: "Background Worker",
    categoryId: "compute",
    icon: "cog",
  },
  {
    id: "serverless-function",
    label: "Serverless Function",
    categoryId: "compute",
    icon: "lambda",
  },
  {
    id: "workflow-engine",
    label: "Workflow Engine",
    categoryId: "compute",
    icon: "workflow",
  },

  // Data
  {
    id: "relational-db",
    label: "Relational Database",
    categoryId: "data",
    icon: "database",
  },
  {
    id: "nosql-db",
    label: "NoSQL Database",
    categoryId: "data",
    icon: "cylinder",
  },
  { id: "cache",
    label: "Cache",
    categoryId: "data",
    icon: "zap"
  },
  {
    id: "object-storage",
    label: "Object Storage",
    categoryId: "data",
    icon: "archive",
  },
  {
    id: "search-engine",
    label: "Search Engine",
    categoryId: "data",
    icon: "search",
  },
  { id: "data-warehouse",
    label: "Data Warehouse",
    categoryId: "data",
    icon: "warehouse"
  },
  {
    id: "data-processing",
    label: "Data Processing / ETL",
    categoryId: "data",
    icon: "funnel",
  },
  {
    id: "lakehouse",
    label: "Lakehouse / Table Format",
    categoryId: "data",
    icon: "droplets",
  },

  // Messaging
  {
    id: "message-queue",
    label: "Message Queue",
    categoryId: "messaging",
    icon: "rows-3",
  },
  {
    id: "event-stream",
    label: "Event Stream",
    categoryId: "messaging",
    icon: "waves",
  },

  // AI
  {
    id: "vector-db",
    label: "Vector Database",
    categoryId: "ai",
    icon: "chart-scatter",
  },
  {
    id: "ai-model",
    label: "LLM / AI Model",
    categoryId: "ai",
    icon: "brain",
  },
  {
    id: "ai-agent",
    label: "AI Agent",
    categoryId: "ai",
    icon: "bot",
  },
  {
    id: "model-serving",
    label: "Model Serving / Inference",
    categoryId: "ai",
    icon: "cpu",
  },
  {
    id: "llm-gateway",
    label: "LLM Gateway",
    categoryId: "ai",
    icon: "router",
  },

  // Platform ("container" is the Docker kind; a box that holds boxes is "nested")
  { id: "container",
    label: "Docker Container",
    categoryId: "platform",
    icon: "container"
  },
  {
    id: "orchestrator",
    label: "Orchestrator",
    categoryId: "platform",
    icon: "ship-wheel",
  },
  {
    id: "service-mesh",
    label: "Service Mesh",
    categoryId: "platform",
    icon: "waypoints",
  },
  {
    id: "hosting-platform",
    label: "Hosting Platform / PaaS",
    categoryId: "platform",
    icon: "rocket",
  },
  {
    id: "ci-cd",
    label: "CI/CD",
    categoryId: "platform",
    icon: "infinity",
  },

  // Cross-cutting
  {
    id: "auth-service",
    label: "Auth / Identity Service",
    categoryId: "cross-cutting",
    icon: "key-round",
  },
  {
    id: "secrets-manager",
    label: "Secrets Manager",
    categoryId: "cross-cutting",
    icon: "vault",
  },
  {
    id: "monitoring",
    label: "Monitoring / Observability",
    categoryId: "cross-cutting",
    icon: "chart-line",
  },

  // General: no suggested technologies (spec §5)
  { id: GENERIC_TYPE_ID, label: "Generic", categoryId: "general", icon: "box" },
  { id: "group", label: "Group / Boundary", categoryId: "general", icon: "square-dashed" },
  { id: "note", label: "Note", categoryId: "general", icon: "sticky-note" },
].map((t) => (TECHNOLOGIES[t.id] ? { ...t, suggestedTechnologies: TECHNOLOGIES[t.id] } : t));

export const boxTypes = createRegistry(categories, types, GENERIC_TYPE_ID);
