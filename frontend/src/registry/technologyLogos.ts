// Logos for the Technology field. Names are matched loosely ("Postgres",
// "postgresql", "PostgreSQL 16" all find PostgreSQL); anything without a logo
// gets a two-letter monogram instead, so a chosen technology always shows
// something.
//
// Logos come from simple-icons (one colour, CC0) and, for brands it lacks
// (AWS, Azure, Twilio…), from SVG Logos (full colour, CC0). Only their names
// are here; the drawings are in logoDrawings.json, loaded the first time a
// logo is drawn (see logoDrawings.ts). Technologies with no logo of their own
// borrow their maker's (MAKER_LOGOS); docs/technology-logos.md lists those
// and the ones with none (NO_LOGO). The brands are their owners' trademarks,
// shown only to identify the technology.

/**
 * simple-icons logos: [slug, title (both as in simple-icons), other names
 * people write for it (compared after `normalise`)].
 */
export const SIMPLE_LOGOS: [string, string, ...string[]][] = [
  ["1password", "1Password"],
  ["actix", "Actix"],
  ["adyen", "Adyen"],
  ["airbyte", "Airbyte"],
  ["akamai", "Akamai"],
  ["algolia", "Algolia"],
  ["android", "Android"],
  ["angular", "Angular", "angularjs"],
  ["ansible", "Ansible"],
  ["anthropic", "Anthropic"],
  ["apache", "Apache"],
  ["apacheairflow", "Apache Airflow", "airflow"],
  ["apachecassandra", "Apache Cassandra", "cassandra"],
  ["apachedoris", "Apache Doris", "doris"],
  ["apachedruid", "Apache Druid", "druid"],
  ["apacheflink", "Apache Flink", "flink"],
  ["apachehive", "Apache Hive", "hive"],
  ["apachekafka", "Apache Kafka", "kafka"],
  ["apachenifi", "Apache NiFi", "nifi"],
  ["apachepulsar", "Apache Pulsar", "pulsar"],
  ["apachesolr", "Apache Solr", "solr"],
  ["apachespark", "Apache Spark", "spark"],
  ["apollographql", "Apollo GraphQL", "apollo"],
  ["arangodb", "ArangoDB"],
  ["argo", "Argo", "argocd", "argo cd"],
  ["astro", "Astro"],
  ["auth0", "Auth0"],
  ["authentik", "Authentik"],
  ["backblaze", "Backblaze"],
  ["betterauth", "Better Auth"],
  ["betterstack", "Better Stack"],
  ["bitbucket", "Bitbucket"],
  ["bitwarden", "Bitwarden"],
  ["braintrust", "Braintrust"],
  ["buildkite", "Buildkite"],
  ["bun", "Bun"],
  ["bunnydotnet", "bunny.net", "bunny"],
  ["caddy", "Caddy"],
  ["camunda", "Camunda"],
  ["celery", "Celery"],
  ["ceph", "Ceph"],
  ["cilium", "Cilium"],
  ["circleci", "CircleCI"],
  ["claude", "Claude"],
  ["clerk", "Clerk"],
  ["clickhouse", "ClickHouse"],
  ["cloudflare", "Cloudflare"],
  ["cloudflarepages", "Cloudflare Pages"],
  ["cloudflareworkers", "Cloudflare Workers"],
  ["cockroachlabs", "Cockroach Labs"],
  ["consul", "Consul"],
  ["containerd", "containerd"],
  ["coolify", "Coolify"],
  ["couchbase", "Couchbase"],
  ["crewai", "CrewAI"],
  ["databricks", "Databricks"],
  ["datadog", "Datadog"],
  ["deepseek", "DeepSeek"],
  ["deno", "Deno"],
  ["dify", "Dify"],
  ["digitalocean", "DigitalOcean"],
  ["django", "Django"],
  ["docker", "Docker"],
  ["dotnet", ".NET", "dotnet"],
  ["duckdb", "DuckDB"],
  ["dynatrace", "Dynatrace"],
  ["eclipsemosquitto", "Eclipse Mosquitto", "mosquitto"],
  ["elastic", "Elastic"],
  ["elasticsearch", "Elasticsearch"],
  ["electron", "Electron"],
  ["envoyproxy", "Envoy Proxy", "envoy"],
  ["expo", "Expo"],
  ["express", "Express", "expressjs", "express.js"],
  ["f5", "F5"],
  ["fastapi", "FastAPI"],
  ["fastify", "Fastify"],
  ["fastly", "Fastly"],
  ["firebase", "Firebase"],
  ["flask", "Flask"],
  ["flutter", "Flutter"],
  ["flux", "Flux", "fluxcd"],
  ["flydotio", "Fly.io"],
  ["fusionauth", "FusionAuth"],
  ["gin", "Gin"],
  ["github", "GitHub"],
  ["githubactions", "GitHub Actions"],
  ["gitlab", "GitLab"],
  ["go", "Go", "golang"],
  ["google", "Google"],
  ["googlebigquery", "Google BigQuery", "bigquery"],
  ["googlecloud", "Google Cloud", "gcp", "google cloud"],
  ["googlecloudspanner", "Google Cloud Spanner", "cloud spanner", "spanner"],
  ["googledataflow", "Google Dataflow", "dataflow"],
  ["googlegemini", "Google Gemini", "gemini"],
  ["googlemaps", "Google Maps"],
  ["grafana", "Grafana"],
  ["graphql", "GraphQL"],
  ["haystack", "Haystack"],
  ["helm", "Helm"],
  ["hetzner", "Hetzner"],
  ["hivemq", "HiveMQ"],
  ["hono", "Hono"],
  ["hubspot", "HubSpot"],
  ["huggingface", "Hugging Face"],
  ["influxdb", "InfluxDB"],
  ["intercom", "Intercom"],
  ["ios", "iOS"],
  ["istio", "Istio"],
  ["jaeger", "Jaeger"],
  ["jenkins", "Jenkins"],
  ["k3s", "K3s"],
  ["keycdn", "KeyCDN"],
  ["keycloak", "Keycloak"],
  ["knative", "Knative"],
  ["kong", "Kong"],
  ["kotlin", "Kotlin"],
  ["ktor", "Ktor"],
  ["kubernetes", "Kubernetes", "k8s"],
  ["kuma", "Kuma"],
  ["langchain", "LangChain"],
  ["langflow", "Langflow"],
  ["langgraph", "LangGraph"],
  ["laravel", "Laravel"],
  ["linkerd", "Linkerd"],
  ["mailchimp", "MailChimp"],
  ["mailgun", "Mailgun"],
  ["mariadb", "MariaDB"],
  ["meilisearch", "Meilisearch"],
  ["meta", "Meta"],
  ["milvus", "Milvus"],
  ["minio", "MinIO"],
  ["mistralai", "Mistral AI", "mistral"],
  ["modal", "Modal"],
  ["mongodb", "MongoDB", "mongo"],
  ["mysql", "MySQL"],
  ["n8n", "n8n"],
  ["natsdotio", "NATS.io", "nats"],
  ["neo4j", "Neo4j"],
  ["neon", "Neon"],
  ["nestjs", "NestJS"],
  ["netlify", "Netlify"],
  ["newrelic", "New Relic"],
  ["nextdotjs", "Next.js", "nextjs", "next"],
  ["nginx", "NGINX"],
  ["nodedotjs", "Node.js", "node", "nodejs"],
  ["nomad", "Nomad"],
  ["nuxt", "Nuxt", "nuxtjs"],
  ["nvidia", "NVIDIA"],
  ["okta", "Okta"],
  ["ollama", "Ollama"],
  ["openbao", "OpenBao"],
  ["openfaas", "OpenFaaS"],
  ["openrouter", "OpenRouter"],
  ["opensearch", "OpenSearch"],
  ["opentelemetry", "OpenTelemetry"],
  ["ory", "Ory"],
  ["pagerduty", "PagerDuty"],
  ["paypal", "PayPal"],
  ["planetscale", "PlanetScale"],
  ["podman", "Podman"],
  ["postgresql", "PostgreSQL", "postgres", "pg"],
  ["prefect", "Prefect"],
  ["presto", "Presto"],
  ["prometheus", "Prometheus"],
  ["pydantic", "Pydantic"],
  ["python", "Python"],
  ["qdrant", "Qdrant"],
  ["quarkus", "Quarkus"],
  ["qwen", "QWen"],
  ["qwik", "Qwik"],
  ["rabbitmq", "RabbitMQ"],
  ["railway", "Railway"],
  ["rancher", "Rancher"],
  ["ray", "Ray"],
  ["react", "React", "reactjs"],
  ["reactrouter", "React Router"],
  ["redis", "Redis"],
  ["remix", "Remix"],
  ["render", "Render"],
  ["replicate", "Replicate"],
  ["rubyonrails", "Ruby on Rails", "rails"],
  ["rust", "Rust"],
  ["scylladb", "ScyllaDB"],
  ["sentry", "Sentry"],
  ["shopify", "Shopify"],
  ["sidekiq", "Sidekiq"],
  ["snowflake", "Snowflake"],
  ["solid", "Solid", "solidjs"],
  ["spinnaker", "Spinnaker"],
  ["splunk", "Splunk"],
  ["springboot", "Spring Boot", "spring"],
  ["sqlite", "SQLite"],
  ["stripe", "Stripe"],
  ["supabase", "Supabase"],
  ["svelte", "Svelte", "sveltekit"],
  ["swift", "Swift"],
  ["tauri", "Tauri"],
  ["teamcity", "TeamCity"],
  ["tekton", "Tekton"],
  ["temporal", "Temporal"],
  ["teradata", "Teradata"],
  ["terraform", "Terraform"],
  ["tidb", "TiDB"],
  ["traefikmesh", "Traefik Mesh"],
  ["traefikproxy", "Traefik Proxy", "traefik"],
  ["travisci", "Travis CI"],
  ["trino", "Trino"],
  ["turso", "Turso"],
  ["typescript", "TypeScript"],
  ["upstash", "Upstash"],
  ["vault", "Vault", "hashicorp vault"],
  ["vercel", "Vercel"],
  ["vespa", "Vespa"],
  ["vllm", "vLLM"],
  ["vuedotjs", "Vue.js", "vue", "vuejs"],
  ["wasabi", "Wasabi"],
  ["zendesk", "Zendesk"],
];

/**
 * Full-colour logos from SVG Logos: [its key in @iconify-json/logos, title,
 * other names]. Only square ones: a wide wordmark is unreadable this small.
 */
export const COLOR_LOGOS: [string, string, ...string[]][] = [
  ["apache-http", "Apache HTTP Server", "apache httpd", "httpd"],
  ["aws-api-gateway", "AWS API Gateway", "amazon api gateway"],
  ["aws-aurora", "Amazon Aurora", "aurora"],
  ["aws-batch", "AWS Batch"],
  ["aws-cloudfront", "CloudFront", "amazon cloudfront"],
  ["aws-cloudwatch", "Amazon CloudWatch", "cloudwatch"],
  ["aws-codepipeline", "AWS CodePipeline", "codepipeline"],
  ["aws-cognito", "Cognito", "amazon cognito"],
  ["aws-documentdb", "Amazon DocumentDB", "documentdb"],
  ["aws-dynamodb", "DynamoDB", "amazon dynamodb"],
  ["aws-ecs", "Amazon ECS", "ecs"],
  ["aws-eks", "Amazon EKS", "eks"],
  ["aws-elastic-beanstalk", "AWS Elastic Beanstalk", "elastic beanstalk"],
  ["aws-elasticache", "Amazon ElastiCache", "elasticache"],
  ["aws-elb", "Elastic Load Balancing", "aws elb", "elb"],
  ["aws-fargate", "AWS Fargate", "fargate"],
  ["aws-glue", "AWS Glue"],
  ["aws-kinesis", "Kinesis", "amazon kinesis"],
  ["aws-kms", "AWS KMS"],
  ["aws-lake-formation", "AWS Lake Formation"],
  ["aws-lambda", "AWS Lambda", "lambda"],
  ["aws-mq", "Amazon MQ"],
  ["aws-msk", "Amazon MSK", "msk"],
  ["aws-rds", "Amazon RDS", "rds"],
  ["aws-redshift", "Amazon Redshift", "redshift"],
  ["aws-route53", "Route 53", "amazon route 53"],
  ["aws-s3", "S3", "amazon s3"],
  ["aws-secrets-manager", "AWS Secrets Manager"],
  ["aws-sqs", "SQS", "amazon sqs"],
  ["aws-step-functions", "AWS Step Functions", "step functions"],
  ["aws-waf", "AWS WAF"],
  ["baseten-icon", "Baseten"],
  ["chroma", "Chroma", "chromadb"],
  ["cohere-icon", "Cohere"],
  ["couchdb-icon", "CouchDB", "apache couchdb"],
  ["dbt-icon", "dbt"],
  ["google-cloud-functions", "Cloud Functions", "google cloud functions"],
  ["google-cloud-run", "Cloud Run", "google cloud run"],
  ["grok-icon", "Grok"],
  ["harness-icon", "Harness"],
  ["hbase", "HBase", "apache hbase"],
  ["heroku-icon", "Heroku"],
  ["keydb-icon", "KeyDB"],
  ["lancedb-icon", "LanceDB"],
  ["langfuse-icon", "Langfuse"],
  ["memcached", "Memcached"],
  ["microsoft-azure", "Azure", "microsoft azure"],
  ["microsoft-icon", "Microsoft"],
  ["microsoft-teams", "Microsoft Teams"],
  ["openai-icon", "OpenAI"],
  ["openshift", "OpenShift", "red hat openshift"],
  ["phoenix", "Phoenix"],
  ["pinecone-icon", "Pinecone"],
  ["salesforce", "Salesforce"],
  ["segment-icon", "Segment"],
  ["sendgrid-icon", "SendGrid"],
  ["signoz", "SigNoz"],
  ["slack-icon", "Slack"],
  ["togetherai-icon", "Together AI"],
  ["twilio-icon", "Twilio"],
  ["typesense-icon", "Typesense"],
  ["valkey-icon", "Valkey"],
  ["weaviate-icon", "Weaviate"],
  ["workos-icon", "WorkOS"],
  ["xata-icon", "Xata"],
  ["yugabyte-icon", "YugabyteDB", "yugabyte"],
];

/**
 * Listed technologies with no logo of their own, drawn with their maker's
 * (or their family's): technology → a name the maker's logo answers to.
 * docs/technology-logos.md lists them, so they can be drawn better later.
 */
export const MAKER_LOGOS: Readonly<Record<string, string>> = {
  ".NET MAUI": ".NET",
  "Actix Web": "Actix",
  AlloyDB: "Google Cloud",
  "Amazon Aurora DSQL": "Amazon Aurora",
  "Amazon S3 Tables": "S3",
  "Amazon S3 Vectors": "S3",
  "Apache Beam": "Apache",
  "Apache Hudi": "Apache",
  "Apache Iceberg": "Apache",
  "Apache Paimon": "Apache",
  "Apache Polaris": "Apache",
  "Apollo Router": "Apollo GraphQL",
  "Argo Workflows": "Argo",
  "ASP.NET Core": ".NET",
  AutoGen: "Microsoft",
  "AWS ALB": "Elastic Load Balancing",
  "AWS NLB": "Elastic Load Balancing",
  "Azure AI Foundry": "Azure",
  "Azure AI Search": "Azure",
  "Azure API Management": "Azure",
  "Azure App Service": "Azure",
  "Azure Blob Storage": "Azure",
  "Azure Cache for Redis": "Azure",
  "Azure Container Apps": "Azure",
  "Azure Cosmos DB": "Azure",
  "Azure Data Factory": "Azure",
  "Azure DNS": "Azure",
  "Azure Event Hubs": "Azure",
  "Azure Front Door": "Azure",
  "Azure Functions": "Azure",
  "Azure Key Vault": "Azure",
  "Azure Kubernetes Service": "Azure",
  "Azure Load Balancer": "Azure",
  "Azure Logic Apps": "Azure",
  "Azure Monitor": "Azure",
  "Azure Pipelines": "Azure",
  "Azure Service Bus": "Azure",
  "Azure SQL Database": "Azure",
  "Azure Synapse Analytics": "Azure",
  "Backblaze B2": "Backblaze",
  "Bitbucket Pipelines": "Bitbucket",
  "Bitwarden Secrets Manager": "Bitwarden",
  "Claude Agent SDK": "Claude",
  "Cloudflare AI Gateway": "Cloudflare",
  "Cloudflare DNS": "Cloudflare",
  "Cloudflare Queues": "Cloudflare",
  "Cloudflare R2": "Cloudflare",
  CockroachDB: "Cockroach Labs",
  "Cohere Command": "Cohere",
  "Delta Lake": "Databricks",
  "Deno Deploy": "Deno",
  "DigitalOcean App Platform": "DigitalOcean",
  "DigitalOcean Spaces": "DigitalOcean",
  "Docker Swarm": "Docker",
  "Envoy AI Gateway": "Envoy Proxy",
  "F5 BIG-IP": "F5",
  "Firebase Authentication": "Firebase",
  Firestore: "Firebase",
  GCS: "Google Cloud",
  Gemma: "Google",
  "GitLab CI": "GitLab",
  "Google ADK": "Google",
  "Google App Engine": "Google Cloud",
  "Google Cloud Build": "Google Cloud",
  "Google Cloud CDN": "Google Cloud",
  "Google Cloud DNS": "Google Cloud",
  "Google Cloud Load Balancing": "Google Cloud",
  "Google Cloud Pub/Sub": "Google Cloud",
  "Google Cloud Service Mesh": "Google Cloud",
  "Google Cloud SQL": "Google Cloud",
  "Google Cloud Workflows": "Google Cloud",
  "Google Kubernetes Engine": "Google Cloud",
  "Google Secret Manager": "Google Cloud",
  GPT: "OpenAI",
  "Grafana Loki": "Grafana",
  "Grafana Tempo": "Grafana",
  "Hetzner Object Storage": "Hetzner",
  "Hugging Face TGI": "Hugging Face",
  "Kafka Streams": "Apache Kafka",
  "Kong AI Gateway": "Kong",
  "Kong Mesh": "Kong",
  "Kotlin Multiplatform": "Kotlin",
  LangSmith: "LangChain",
  Llama: "Meta",
  "Microsoft Agent Framework": "Microsoft",
  "Microsoft Entra ID": "Microsoft",
  "Microsoft Fabric": "Microsoft",
  "Microsoft SQL Server": "Microsoft",
  "MongoDB Atlas Vector Search": "MongoDB",
  "Netlify Functions": "Netlify",
  "NVIDIA Triton": "NVIDIA",
  "OpenAI Agents SDK": "OpenAI",
  pgvector: "PostgreSQL",
  Phi: "Microsoft",
  "Pydantic AI": "Pydantic",
  "Ray Serve": "Ray",
  "React Native": "React",
  "Semantic Kernel": "Microsoft",
  smolagents: "Hugging Face",
  "Spring Batch": "Spring Boot",
  "Supabase Auth": "Supabase",
  "Supabase Edge Functions": "Supabase",
  "Unity Catalog": "Databricks",
  "Upstash QStash": "Upstash",
  "Vercel AI Gateway": "Vercel",
  "Vercel AI SDK": "Vercel",
  "Vercel Functions": "Vercel",
  "Vertex AI": "Google Cloud",
  "Vertex AI Vector Search": "Google Cloud",
  Whisper: "OpenAI",
  "Zilliz Cloud": "Milvus",
};

/** Listed technologies with no logo in either set: they get two letters. docs/technology-logos.md lists them too. */
export const NO_LOGO: readonly string[] = [
  "ActiveMQ",
  "Agno",
  "Akeyless",
  "Amazon Bedrock",
  "Amazon Bedrock Agents",
  "Amazon EMR",
  "Amazon Nova",
  "Amazon SageMaker",
  "Apigee",
  "Arize Phoenix",
  "AutoMQ",
  "Axiom",
  "Axum",
  "Beanstalkd",
  "BullMQ",
  "Conductor",
  "Confluent",
  "CoreDNS",
  "CyberArk Conjur",
  "Dagster",
  "Debezium",
  "Descope",
  "DocuSign",
  "Dokku",
  "Doppler",
  "Dragonfly",
  "Dremio",
  "DSPy",
  "Echo",
  "Ehcache",
  "EMQX",
  "Encore",
  "Fiber",
  "Firebolt",
  "Fireworks AI",
  "Fivetran",
  "Flowise",
  "Gravitee",
  "Groq",
  "Hangfire",
  "HAProxy",
  "Hatchet",
  "Hazelcast",
  "Helicone",
  "Honeycomb",
  "IBM MQ",
  "Infisical",
  "Inngest",
  "Kestra",
  "KrakenD",
  "KServe",
  "LiteLLM",
  "llama.cpp",
  "LlamaIndex",
  "Manticore Search",
  "Mastra",
  "Micronaut",
  "Momento",
  "MotherDuck",
  "NS1",
  "Oracle Database",
  "ParadeDB",
  "Plaid",
  "Portkey",
  "PowerDNS",
  "Quickwit",
  "Redpanda",
  "Resque",
  "Restate",
  "RQ",
  "SGLang",
  "Starburst",
  "StarRocks",
  "Strands Agents",
  "Stytch",
  "Tigris",
  "Trigger.dev",
  "Turbopuffer",
  "Tyk",
  "Varnish",
  "Voyage AI",
  "WarpStream",
  "Windmill",
  "Zabbix",
  "ZeroMQ",
  "Zitadel",
];

/** A logo, by where its drawing comes from: its slug in simple-icons, or its key in SVG Logos. */
export type LogoSource = { set: "simple"; slug: string; title: string } | { set: "color"; key: string; title: string };

/** Every logo with all the names it answers to, makers' borrowed names included (for src/serverFiles.test.ts). */
export const ALL_LOGOS: { logo: LogoSource; names: string[] }[] = [
  ...SIMPLE_LOGOS.map(([slug, title, ...aliases]) => ({
    logo: { set: "simple" as const, slug, title },
    names: [title, slug, ...aliases],
  })),
  ...COLOR_LOGOS.map(([key, title, ...aliases]) => ({ logo: { set: "color" as const, key, title }, names: [title, ...aliases] })),
];

const byName = new Map<string, { logo: LogoSource; names: string[] }>();
for (const entry of ALL_LOGOS) for (const name of entry.names) byName.set(normalise(name), entry);
for (const [technology, maker] of Object.entries(MAKER_LOGOS)) {
  const entry = byName.get(normalise(maker));
  if (!entry) throw new Error(`No logo named "${maker}" for ${technology}`);
  entry.names.push(technology);
  byName.set(normalise(technology), entry);
}

export type TechnologyMark =
  | { kind: "logo"; title: string; slug: string }
  | { kind: "color"; title: string; key: string }
  | { kind: "monogram"; text: string };

/**
 * What to show for a technology: a one-colour logo, a full-colour one, a
 * monogram if it has neither, or `null` when no technology is set. Logos
 * are named here and drawn from logoDrawings.json (see logoDrawings.ts).
 */
export function technologyMark(technology: string | undefined): TechnologyMark | null {
  const text = technology?.trim();
  if (!text) return null;
  const logo = findLogo(text);
  if (logo?.set === "simple") return { kind: "logo", title: logo.title, slug: logo.slug };
  if (logo) return { kind: "color", title: logo.title, key: logo.key };
  return { kind: "monogram", text: monogram(text) };
}

/** Exact name first; otherwise the leading words ("PostgreSQL 16", "Redis Cluster"). */
export function findLogo(text: string): LogoSource | undefined {
  const words = text.trim().split(/\s+/);
  for (let n = words.length; n > 0; n--) {
    const entry = byName.get(normalise(words.slice(0, n).join(" ")));
    if (entry) return entry.logo;
  }
  return undefined;
}

/** Whether a technology's own name (or its maker's, see MAKER_LOGOS) has a logo, rather than its leading words. */
export function hasNamedLogo(technology: string): boolean {
  return byName.has(normalise(technology));
}

/** "HAProxy" → "HA", "AWS Lambda" → "AL", "SQS" → "SQ". */
export function monogram(text: string): string {
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length === 0) return "?";
  const letters = words.length >= 2 ? words[0]![0]! + words[1]![0]! : words[0]!.slice(0, 2);
  return letters.toUpperCase();
}

/** Mixes `color` toward white until it reaches 3:1 contrast on `background`. */
export function readableColor(color: string, background: string): string {
  for (let white = 0; white <= 1; white += 0.05) {
    const mixed = mixHex(color, "#ffffff", white);
    if (contrastRatio(mixed, background) >= 3) return mixed;
  }
  return "#ffffff";
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mixHex(a: string, b: string, amountOfB: number): string {
  const [ca, cb] = [rgb(a), rgb(b)];
  return "#" + ca.map((v, i) => Math.round(v * (1 - amountOfB) + cb[i]! * amountOfB).toString(16).padStart(2, "0")).join("");
}

function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
