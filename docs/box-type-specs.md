# 框类型(Box Type)设计规格

> 状态:第一阶段已实现(v0.2)。第 10 节的验收标准由 `e2e/box-type-acceptance.spec.ts` 逐条验证。

## 1. 目标与范围

**第一阶段的目标场景:系统设计学习与面试。** 用户用这个工具画出"经典组件"组成的系统(负载均衡、缓存、消息队列、数据库等),一眼能看懂每个框扮演的角色。

**不在本阶段范围内:** 真实项目的云资源建模(区域、VPC、WAF、密钥管理、CI/CD 等)。这些放到第二阶段,见第 7 节。

## 2. 核心原则

1. **类型 ≠ 技术。** 类型描述框在系统中的**角色**(岗位),技术描述具体实现(人)。例如类型是"关系型数据库",技术是 PostgreSQL。两个字段独立存储,但在界面上联动。
2. **类型是数据,不是写死的枚举。** 节点只存一个字符串 `typeId`。类型的名称、类别、图标、颜色放在"类型注册表"里。内置类型和未来的用户自定义类型走同一套机制。
3. **向前兼容。** 文件里出现不认识的 `typeId` 时,界面按"通用"类型渲染,但**保存时必须保留原 `typeId`**,不能改写或丢弃。
4. **类型不限制嵌套。** 任何类型的框都可以放任何类型的子框,不设硬规则。
5. **本阶段类型只管视觉和分类。** 不做类型专属属性(如限流算法、副本数)。
6. **不单靠颜色传达信息。** 每个类型必须有独立的图标,颜色只用于类别区分,以兼顾色觉障碍用户。

## 3. 数据模型

在已有的节点模型上增加一个可选字段:

```ts
interface Node {
  id: string;
  title: string;
  typeId?: string;        // 未设置时按 "generic" 处理
  technology?: string;    // 自由文本,见第 5 节
  description?: string;
  position: { x: number; y: number };
  children: Node[];
  edges: Edge[];
}
```

类型注册表(第一阶段内置在代码中,不进入保存的文件):

```ts
interface TypeDefinition {
  id: string;                       // 稳定的 kebab-case 标识,发布后不得更改
  label: string;                    // 显示名称
  categoryId: string;               // 所属类别,决定颜色
  icon: string;                     // 图标标识
  suggestedTechnologies?: string[]; // 技术选择器的推荐项
}

interface CategoryDefinition {
  id: string;
  label: string;
  color: string;                    // 类别主色,需同时适配亮/暗主题
  order: number;
}
```

**设计约束:**
- `id` 一旦发布就是文件格式的一部分,**只增不改不删**。要更名只改 `label`。
- 文档的 `schemaVersion` 需要递增,并为旧文件(没有 `typeId`)提供迁移:缺省视为 `generic`。
- 注册表的结构要能容纳第二种对象(连线类型,见第 8 节),但本阶段不实现。

## 4. 内置类型清单(第一阶段)

共 39 个:36 个领域类型 + 3 个通用类型。(最初为 27 个,后来新增了"AI"类别和 12 个类型。)图标列为建议,请在项目所用的开源图标库中选取对应图标。"推荐技术"列只举几个例子;每个类型完整的技术清单见 `frontend/src/registry/boxTypes.ts` 的 `TECHNOLOGIES`。

### 参与者

| id | 名称 | 建议图标 | 推荐技术 |
|---|---|---|---|
| `actor` | 用户 / 角色 | 人形 | (无) |
| `external-system` | 外部系统 / 第三方服务 | 云加链接 | Stripe、Twilio、SendGrid |

### 客户端

| id | 名称 | 建议图标 | 推荐技术 |
|---|---|---|---|
| `client` | 客户端(Web / 移动 / CLI) | 显示器 | React、iOS、Android |

### 流量入口

| id | 名称 | 建议图标 | 推荐技术 |
|---|---|---|---|
| `dns` | DNS | 地球 | Route 53、Cloudflare DNS |
| `cdn` | CDN | 分发节点 | CloudFront、Cloudflare、Akamai |
| `load-balancer` | 负载均衡器 | 分流箭头 | Nginx、HAProxy、AWS ALB |
| `api-gateway` | API 网关 | 门/网关 | Kong、AWS API Gateway、Envoy |
| `reverse-proxy` | 反向代理 | 中转 | Nginx、Envoy、Traefik |
| `rate-limiter` | 限流器 | 漏斗/仪表 | Redis、Envoy、Nginx |

### 计算

| id | 名称 | 建议图标 | 推荐技术 |
|---|---|---|---|
| `service` | 服务 / 应用 | 方块/服务器 | Spring Boot、Express、Django |
| `worker` | 后台任务处理器 | 齿轮 | Celery、Sidekiq、BullMQ |
| `serverless-function` | 函数(Serverless) | 闪电/λ | AWS Lambda、Cloud Functions |
| `workflow-engine` | 工作流引擎 | 流程图 | Temporal、Apache Airflow、AWS Step Functions |

### 数据

| id | 名称 | 建议图标 | 推荐技术 |
|---|---|---|---|
| `relational-db` | 关系型数据库 | 圆柱体 | PostgreSQL、MySQL |
| `nosql-db` | NoSQL 数据库 | 圆柱体(区别于关系型) | MongoDB、DynamoDB、Cassandra |
| `cache` | 缓存 | 闪电/时钟 | Redis、Memcached |
| `object-storage` | 对象存储 | 桶 | S3、GCS、MinIO |
| `search-engine` | 搜索引擎 | 放大镜 | Elasticsearch、OpenSearch |
| `data-warehouse` | 数据仓库 | 仓库 | Snowflake、Google BigQuery、Amazon Redshift、ClickHouse |
| `data-processing` | 数据处理 / ETL | 漏斗 | Apache Spark、Apache Flink、dbt |
| `lakehouse` | 湖仓 / 表格式 | 水滴 | Apache Iceberg、Delta Lake、Apache Hudi |

### 消息

| id | 名称 | 建议图标 | 推荐技术 |
|---|---|---|---|
| `message-queue` | 消息队列 | 队列 | RabbitMQ、SQS |
| `event-stream` | 事件流 | 水流/波形 | Kafka、Kinesis、Pulsar |

### AI

| id | 名称 | 建议图标 | 推荐技术 |
|---|---|---|---|
| `vector-db` | 向量数据库 | 散点图 | Pinecone、Qdrant、pgvector |
| `ai-model` | 大模型 / AI 模型(LLM / AI Model) | 大脑 | Claude、GPT、Gemini、Llama |
| `ai-agent` | AI 智能体(AI Agent) | 机器人 | LangChain、LangGraph、CrewAI |
| `model-serving` | 模型服务 / 推理 | 芯片 | vLLM、Ollama、Amazon Bedrock |
| `llm-gateway` | LLM 网关 | 路由器 | LiteLLM、OpenRouter、Portkey |

类型描述角色:框代表"智能体",LangChain、CrewAI 等智能体框架是它的技术;`ai-model` 的技术按模型系列列出,模型部署在哪里用 `model-serving` 表示。

### 平台

| id | 名称 | 建议图标 | 推荐技术 |
|---|---|---|---|
| `container` | Docker 容器 | 集装箱 | Docker |
| `orchestrator` | 编排器 | 舵轮 | Kubernetes、Nomad |
| `service-mesh` | 服务网格 | 路径点 | Istio、Linkerd、Cilium |
| `hosting-platform` | 托管平台 / PaaS | 火箭 | Vercel、Netlify、Heroku、Fly.io |
| `ci-cd` | CI/CD | 无限符号 | GitHub Actions、GitLab CI、Jenkins、Argo CD |

### 横切关注点

| id | 名称 | 建议图标 | 推荐技术 |
|---|---|---|---|
| `auth-service` | 认证 / 身份服务 | 钥匙/盾牌 | Keycloak、Auth0、Cognito |
| `secrets-manager` | 密钥管理 | 保险箱 | HashiCorp Vault、AWS Secrets Manager、Azure Key Vault |
| `monitoring` | 监控 / 可观测性 | 折线图 | Prometheus、Grafana、Datadog |

### 通用

| id | 名称 | 说明 |
|---|---|---|
| `generic` | 通用框 | **新建框的默认类型**;也是未知 `typeId` 的回落类型 |
| `group` | 分组 / 边界 | 纯粹用来圈出一组组件的框,视觉上用更淡的底色和虚线边框 |
| `note` | 备注 | 便签样式,用于写说明,不代表系统组件 |

**命名注意:** "容器"一词有歧义。类型标签统一写"Docker 容器";在文案和代码注释里,把"能包含子框"称为**嵌套**,不要称为"容器"。

## 5. 类型与技术的联动

- **有技术清单的类型只能从清单中选择技术。** 技术字段是一个可搜索的下拉列表:输入只用于筛选,不会直接保存;选中某一项才写入。离开字段时,未匹配的输入会被丢弃。清单即该类型的 `suggestedTechnologies`(来自 `TECHNOLOGIES`)。
- **没有技术清单的类型(`generic`、`group`、`note`、`actor`)保留自由文本。** 其中 `actor` 会提示本图中已使用过的技术;`generic` / `group` / `note` 不显示推荐项。未知类型按 `generic` 处理。
- 已选中的技术**按一次 Backspace(或 Delete)即整体清除**,计为一次撤销步骤;自由文本仍按字符删除。
- 更改类型**会清空**已填写的技术:技术属于当初选它的类型,即使新类型的清单里也有它。类型和技术的变化计为同一个撤销步骤,一次撤销即可同时恢复。再次选择当前类型不算更改,技术保留。
- 文件中的技术不经校验,所以框仍可能带着不在其类型清单里的技术(例如手工编辑的文件)。这时字段保留它并提示"不在该类型的清单中",用户可另选或按 Backspace 清除。
- 选择限制只在界面上生效:文件中的技术值原样读写,不做校验。
- 框上用技术的标志(logo)表示技术:单色标志来自 Simple Icons,它没有的品牌用 SVG Logos 的全彩标志;两者都没有的,借用厂商的标志或显示两个字母的缩写块,见[技术的标志](./technology-logos.md)。没有选择技术时不显示。

## 6. 界面行为

- **侧边栏**:增加"类型"选择器,位于名称下方、技术上方。使用**按类别分组的下拉列表**,带搜索,选项旁显示图标。
- **新建框**:默认类型为 `generic`,不弹窗询问类型。
- **框的渲染**:所有框都是圆角矩形。类型标签位于框的上边缘左侧(压在边框线上);框内左上角是类别颜色的图标块,右上角是嵌套数量标记;标题居中、字号较大。框上**不显示**技术和描述,二者只在侧边栏中查看和编辑。
- **`group` 的特殊外观**:更淡、半透明的底色和虚线边框,提示它主要是个分组边界。
- **`note` 的特殊外观**:便签样式(暗黄底色、折角)。
- **`generic`**:不显示类型标签,让新建的框保持简洁。
- **未知类型**:按 `generic` 渲染,并在标签处显示原始 `typeId`,方便用户察觉。
- 类型选择**计入撤销历史**(同其他节点属性的修改)。

## 7. 第二阶段预留(真实项目架构)

以下类型本阶段**不实现**,但注册表的设计不应阻碍它们的加入:

- 基础设施:虚拟机/节点、集群、网络(VPC)、区域、可用区
- 安全:WAF/防火墙
- 工程:配置中心、定时任务
- 其他:通知服务

(原列出的密钥管理、CI/CD、数据仓库已经加入,见第 4 节。)

加入时遵循第 3 节的约束:只新增 id,不改动已有 id。

## 8. 后续预留:连线类型

连线同样需要类型(同步请求、异步消息、读写、复制等)。它与框类型使用结构相同的注册表,建议在实现注册表时让它能泛化为"对象类型注册表"。**本阶段不实现**,也不要为此增加 `Edge` 的字段。

## 9. 明确不做

- 用户自定义类型(框架已预留:注册表 + 稳定 id,但不提供入口)
- 类型专属属性
- 类型对嵌套关系的约束
- 由类型自动推断连线规则

## 10. 验收标准

1. 新建框默认为"通用框";侧边栏可切换到清单中的任一类型,画布上图标、颜色即时变化。
2. 类型选择器按类别分组,支持按名称搜索。
3. 保存再打开文件后,所有框的类型保持不变。
4. 旧文件(无 `typeId`)能正常打开,所有框显示为通用框。
5. 手动把文件里某个框的 `typeId` 改成不存在的值:打开不报错,该框显示为通用样式并标出原始值;再保存后该 `typeId` 仍原样保留。
6. 更改类型后,已填的"技术"被清空;一次撤销可同时恢复类型和技术。
7. 类型切换可以撤销和重做。
8. 在暗色主题下(本项目只有暗色主题),所有类别颜色都清晰可辨,且每个类型都能凭图标区分。
