# Nestboard

> 一个开源的图表编辑器:框,可以放在框**里面**。

大多数绘图工具只给你一张平铺的画布:一页一张图。想在多个细节层次上描述一个系统,你只能把多张图并排画出来,再手动互相链接。

**Nestboard** 把图表看作一棵树。每个框同时也是一块画布。双击一个框,放大进入它,画出它的内部;双击背景,再退回上一层。

> **状态: v1.0 已完成。** 尚未发布,可在本地运行(见下文)。

---

## 为什么做它

- **天然嵌套。** 上下文 → 容器 → 组件 → 代码只是层级结构的一个例子。微服务、DDD 限界上下文、组织架构、网络拓扑,本质上都是"事物之中还有事物"的树。
- **不绑定 C4。** 工具只提供任意深度的嵌套,每一层叫什么由你决定。
- **可视化优先。** 不需要学习任何 DSL,直接在画布上画。
- **开源,本地优先。** 你的图就是一个普通的 JSON 文件,可以放进 Git 做版本管理。

灵感来自 [IcePanel](https://icepanel.io) 的"放大进入一个框"的体验,但本项目开源,并且支持双击导航。

## 核心概念

把它想成文件系统:每个框是一个文件夹,"放大进入"就是 `cd`,面包屑就是你当前所在的路径。

```
根画布
├── 框 A
│   ├── 框 A1
│   └── 框 A2
│       └── 框 A2a
└── 框 B
```

每个节点拥有自己的子节点,以及子节点之间的连线。两个框之间的连线,存放在它们最近公共祖先所在的那一层。

## 功能

> 详见[功能](./docs/FEATURES.md)、[路线图](./docs/ROADMAP.md)、[框类型设计规格](./docs/box-type-specs.md)和[连线类型设计规格](./docs/edge-type-specs.md)。

## 本地运行

仓库分为两部分:`frontend/`(编辑器等网页界面)和 `server/`(后端,保存图表和 ADR)。图表保存在后端,所以先启动后端,再启动前端。

后端在 `server/` 目录,用 Docker 运行 PostgreSQL,详见[后端说明](./server/README.md):

```bash
docker compose up -d --wait   # 数据库 + 后端,接口文档在 http://localhost:8000/api/v1/docs
```

前端需要 Node.js 22 或更高版本。开发服务器会把 `/api` 转发到 `http://localhost:8000` 的后端(可用环境变量 `NESTBOARD_API_URL` 改为其他地址):

```bash
cd frontend
npm install
npm run dev        # 启动开发服务器
npm test           # 单元测试(Vitest)
npm run test:e2e   # 端到端测试(Playwright,默认使用本机的 Microsoft Edge)
npm run build      # 生产构建
```

第一次打开前端(<http://localhost:5173>)时,按提示创建第一个账号:它是这个 Nestboard 的实例管理员,可以新建组织;在组织里新建项目后,就能开始画图。其他人通过组织的邀请链接加入。

端到端测试会自动在 8001 端口另起一个后端,使用测试数据库 `nestboard_test`;运行前只需数据库在运行(`docker compose up -d db`),并按后端说明建好 `server/.venv`。测试针对构建好的前端运行(开发模式构建,输出到 `frontend/dist-e2e`,端口 5179),而不是开发服务器:开发服务器在多个浏览器同时加载页面时会严重变慢。两组测试同时运行时(例如两个人或两个 AI 会话在同一份代码上),第二组请用不同的端口和输出目录,例如 `E2E_PORT=5189 E2E_API_PORT=8011 npx playwright test --output=test-results-2`。需要查看测试后端的请求日志时,设置 `E2E_SERVER_LOGS=1`。测试开始前会在测试数据库里登录账号 `e2e@example.com`(第一次运行时创建它),并准备好组织 `E2E` 和项目 `E2E project`(按名称查找),所有测试都在这个项目里、以已登录的状态运行;需要互不影响的测试(如 ADR 编号)各自新建一个项目;如果 `nestboard_test` 里有其他账号,先运行一次后端测试(结束时会清空它)。

`examples/box-types-gallery.json` 和 `examples/connection-types-gallery.json` 分别包含所有框类型和所有连线类型,可用文件菜单中的"从文件导入"打开查看。

## 生产环境(本地试用)

`docker-compose.prod.yml` 像正式部署一样运行全部三部分:数据库、后端,以及用 [Caddy](https://caddyserver.com/) 提供网页的前端。浏览器只连接 Caddy:它提供构建好的网页(预先压缩为 Brotli 和 gzip;`/assets` 下带哈希的文件长期缓存,页面本身每次检查更新),并把 `/api` 转给后端,包括打开的图表的实时连接(WebSocket,Caddy 会自动转发;如果前面再加别的代理,它也必须允许 WebSocket)。数据库和后端不对外开放端口:三个容器在 Docker 为这个项目建立的内部网络里,用服务名互相访问(Caddy 转发到 `api:8000`,后端连接 `db:5432`),只有 Caddy 的 8080 端口开放到本机。

```bash
cp .env.example .env    # 然后在 .env 里填一个数据库密码
docker compose -f docker-compose.prod.yml up -d --build --wait   # 打开 http://localhost:8080
docker compose -f docker-compose.prod.yml down                   # 停止(数据保留在 nestboard-prod_pgdata)
```

它的项目名是 `nestboard-prod`(容器为 `nestboard-prod-db-1`、`nestboard-prod-api-1`、`nestboard-prod-web-1`),数据库用自己的数据卷,所以可以和开发用的 `nestboard` 同时运行,互不影响。第一次打开时,按提示创建这个环境自己的管理员账号。`.env` 里有密码,不要分享或提交它。

换成正式域名时:把 `frontend/Caddyfile` 里的 `:80` 改成域名,开放 80 和 443 端口,并在 `.env` 里设置 `NESTBOARD_SITE`(https 地址)和 `NESTBOARD_COOKIE_SECURE=true`;Caddy 会自动申请 HTTPS 证书。

### 什么时候用哪个环境

| | 开发环境(`nestboard`) | 生产环境(`nestboard-prod`) |
|---|---|---|
| 用途 | 日常写代码:前端 `npm run dev`(<http://localhost:5173>,保存即刷新),后端在 Docker 或本机运行 | 看用户实际拿到的样子:正式构建、按需加载、压缩、缓存、Caddy 的转发 |
| 什么时候用 | 每天,改代码和跑测试的时候 | 一个功能完成前做最后检查、测量性能(开发构建慢好几倍,数字不准)、给别人演示、存放要保留的数据 |
| 数据 | 随时可丢的测试数据;有些数据库迁移会清空它 | 要保留的数据,更新前先备份 |

两个环境完全独立:数据库、账号都不共享。注意开发环境的后端容器也是按启动时的代码构建的,改了后端代码要用 `docker compose up -d --build` 重新构建(或者按后端说明在本机运行,代码改动自动重载)。

### 把改动带到生产环境

生产环境不会自动更新:每次构建时,它用的是文件夹里当时的代码。所以:

1. 在开发环境里完成一组改动,单元测试和端到端测试都通过,并且 `frontend` 里的 `npm run build`(正式构建)也成功:端到端测试用的是开发模式构建,代码的拆分方式和正式构建不同,有些问题只在正式构建里出现。不要在改到一半时更新生产环境,否则它会拿到半成品。

  ```bash
  docker compose up -d --build --wait
  ```

2. 如果生产环境里有要保留的数据,先备份(后端启动时会自动执行数据库迁移,而有些迁移会清空数据)。备份在数据库容器里生成,再复制出来,这样在 PowerShell 里也能用(用 `>` 把输出写进文件时,PowerShell 会改变文件的编码,备份就坏了):

   ```bash
   docker compose -f docker-compose.prod.yml exec db pg_dump -U nestboard -Fc -f /tmp/nestboard.dump nestboard
   docker compose -f docker-compose.prod.yml cp db:/tmp/nestboard.dump ./nestboard.dump
   ```

   备份里有所有人的数据(包括密码的哈希),和 `.env` 一样不要分享或提交。

3. 重新构建并启动(数据保留):

   ```bash
   docker compose -f docker-compose.prod.yml up -d --build --wait
   ```

4. 打开 <http://localhost:8080>,把改动的地方点一遍。

需要从备份恢复时(会替换数据库里现有的数据):

```bash
docker compose -f docker-compose.prod.yml cp ./nestboard.dump db:/tmp/nestboard.dump
docker compose -f docker-compose.prod.yml exec db pg_restore -U nestboard -d nestboard --clean --if-exists /tmp/nestboard.dump
```

### 以后:版本管理

现在"生产环境"只是"上次构建时文件夹的样子":记不下运行的是哪个版本,出了问题也不容易退回上一版。用 Git 这样的版本管理就能解决:每次发布打一个标签(tag),只从标签更新生产环境,新版本有问题就退回上一个标签。项目目前还没有使用 Git;等有真实用户使用生产环境之前,应该先把它建起来。

## 数据模型(草案)

下面是**保存到 JSON 文件**时的嵌套格式。在内存中,编辑器使用扁平结构(`nodes: Record<id, Node>`,每个节点记录 `parentId`),便于查找、移动、删除子树和撤销;保存和打开文件时两者互相转换。服务器上的图表不存这个文件,而是每个框、每条连线各存一行,保存时只发送改动的部分(见[后端说明](server/README.md))。每个节点的 `id` 是稳定的,以便将来支持"同一个框出现在多处"的引用。

```ts
interface Node {
  id: string;
  title: string;
  typeId?: string;    // 框的类型(角色),如 "load-balancer";未设置即"通用"。不认识的值原样保留
  technology?: string;
  description?: string;
  position: { x: number; y: number }; // 框尺寸固定,因此不存储 size
  externals?: Record<string, { x: number; y: number }>; // 用户在这个框里面把外部框(按框 id)拖到的位置;没有的排在右侧
  children: Node[];
  edges: Edge[]; // 两端的最近公共祖先是该节点的连线(同层子节点之间,或其内部不同层级的框之间)
}

interface Edge {
  id: string;
  from: string; // 框 id(可在任意层级,但不能是另一端的祖先或后代)
  to: string;   // 框 id
  typeId?: string; // 连线类型,如 "request";未设置即"通用"。不认识的值原样保留
  label?: string;
}

interface Document {
  schemaVersion: number; // 当前为 5(新增外部框的位置);版本 1–4 的旧文件仍可打开
  root: Node;
}
```

## 技术栈

- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/)
- [@xyflow/react](https://reactflow.dev/),用于画布和图交互
- [Zustand](https://zustand.docs.pmnd.rs/) + [zundo](https://github.com/charkour/zundo),用于状态管理和撤销/重做
- [Tailwind CSS](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/),用于界面(界面语言:英文,仅暗色主题)
- [cmdk](https://cmdk.paco.me/),用于可搜索的类型选择器
- [Lucide](https://lucide.dev/),用于界面和类型图标
- [Simple Icons](https://simpleicons.org/)(CC0)和 [SVG Logos](https://github.com/gilbarbara/logos)(CC0),用于技术标志;各品牌标志归其所有者
- [Vitest](https://vitest.dev/) 用于单元测试,[Playwright](https://playwright.dev/) 用于端到端测试
- 后端:Python 3.12、[FastAPI](https://fastapi.tiangolo.com/)、[SQLAlchemy](https://www.sqlalchemy.org/) + [Alembic](https://alembic.sqlalchemy.org/)、[PostgreSQL](https://www.postgresql.org/)(Docker),测试用 [pytest](https://pytest.org/)

## 参与贡献

项目刚刚起步,欢迎在 Issues 中提出想法和讨论。核心功能就位后,会补充贡献指南。

## 许可证

[MIT](LICENSE)
