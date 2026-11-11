# Nestboard 后端

管理账号和登录,保存项目中的图表和架构决策记录(ADR)。编辑器通过它打开和保存图表,决策页面通过它管理 ADR。

- 技术栈:Python 3.12、[FastAPI](https://fastapi.tiangolo.com/)、[SQLAlchemy 2](https://www.sqlalchemy.org/)(异步,asyncpg)、[Alembic](https://alembic.sqlalchemy.org/)、PostgreSQL 18(Docker)
- 接口文档:启动后访问 <http://localhost:8000/api/v1/docs>,机器可读的描述在 `/api/v1/openapi.json`

## 本地运行

需要 Docker 和 Python 3.12。

```bash
# 在仓库根目录
docker compose up -d db          # 只启动数据库(首次启动会同时创建测试数据库 nestboard_test)
docker compose up -d --wait      # 或者:数据库 + 后端,一起在容器里运行

# 在 server/ 目录,本机开发(代码改动自动重载)
py -3.12 -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"     # macOS / Linux 用 .venv/bin/python
.venv/Scripts/alembic upgrade head                  # 建表 / 升级表结构
.venv/Scripts/python -m uvicorn app.main:app --reload

.venv/Scripts/python -m pytest                      # 测试(需要数据库在运行)
.venv/Scripts/python -m ruff check . && .venv/Scripts/python -m ruff format --check .
```

后端容器启动时会自动执行 `alembic upgrade head`。`docker compose down -v` 会连同数据一起删除。

修改数据模型(`app/models/`)后,用 `alembic revision --autogenerate -m "说明"` 生成迁移,检查生成的文件后再提交。

## 配置

都通过环境变量设置(前缀 `NESTBOARD_`),也可以写在 `server/.env` 里,参见 `.env.example`。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NESTBOARD_DATABASE_URL` | `postgresql+asyncpg://nestboard:nestboard@localhost:5432/nestboard` | 数据库 |
| `NESTBOARD_TEST_DATABASE_URL` | 同上,库名 `nestboard_test` | 测试用的数据库 |
| `NESTBOARD_CORS_ORIGINS` | `["http://localhost:5173"]` | 允许跨域访问的前端地址 |
| `NESTBOARD_MAX_REQUEST_BYTES` | `5000000` | 请求体上限,超过返回 413 |
| `NESTBOARD_SESSION_DAYS` | `30` | 登录状态多少天不使用就失效 |
| `NESTBOARD_COOKIE_SECURE` | `false` | 登录 cookie 只通过 HTTPS 发送。**通过 HTTPS 访问服务器时必须打开** |

## 接口一览

所有路径都以 `/api/v1` 开头。每个接口的参数、请求和返回格式见自动生成的接口文档(`/api/v1/docs`);这里只列出有哪些接口、谁可以用。除了注明的以外都需要登录。

**账号与登录**:`GET /auth/status`(还没有任何账号时 `needs_setup` 为 true,不需要登录)、`POST /auth/setup`(创建第一个账号,即实例管理员;之后返回 409 `already_set_up`)、`POST /auth/login`、`POST /auth/logout`、`GET`/`PATCH /auth/me`(未登录返回 401 `not_signed_in`)、`POST /auth/me/password`(同一账号的其他登录全部退出)、`GET`/`POST /password-resets/{token}`(用重置链接设置新密码,不需要登录)。

**实例管理员**(其他人返回 403 `not_allowed`):`GET /admin/users`、`POST /admin/users/{user_id}/password-resets`。

**组织**(不是成员时一律返回 404 `organization_not_found`)

| 接口 | 谁可以 |
|---|---|
| `POST /orgs` | 实例管理员;创建者成为 Owner |
| `GET /orgs`(我所在的组织) | 任何人 |
| `GET /orgs/{id}`、`GET /orgs/{id}/members` | 成员 |
| `PATCH /orgs/{id}`(改名)、`DELETE /orgs/{id}`(连同其中的一切) | Owner |
| `PATCH /orgs/{id}/members/{user_id}` | 改角色:Owner;职位、"可以创建项目":Admin |
| `DELETE /orgs/{id}/members/{user_id}` | 自己(退出);Admin 移除 Member;Owner 移除任何人 |
| `GET /orgs/{id}/invitations`、`DELETE /orgs/{id}/invitations/{invitation_id}` | Admin |
| `POST /orgs/{id}/invitations` | Admin 邀请 Member;Owner 邀请任何角色 |
| `POST /orgs/{id}/invitations/import`(用 CSV 一次邀请最多 100 人,见下) | 同上:Admin 导入 Member;Admin、Owner 角色的行需要 Owner |

**用 CSV 批量邀请**:请求体 `{"csv": "…", "dry_run": false, "expires_in_days": 7}`。第一行是列名:`email`(必填)、`name`、`job title`、`role`(member / admin / owner,空着为 member);逗号、分号或制表符分隔;可以带 Excel 的 BOM。每行生成一个**只能由该邮箱使用**的一次性链接,`name` 用来预填注册表单。有问题的行跳过并说明原因(`missing_email`、`invalid_email`、`invalid_name`、`invalid_title`、`unknown_role`、`too_many_cells`、`duplicate_email`、`already_member`、`already_invited`、`role_needs_owner`),其余的在同一个事务里一起创建;每个 token 只在这次响应里出现。`dry_run` 只检查不创建,用于预览。整个文件不能用时(没有 email 列、未知的列、空文件、超过 100 行)返回 422 `csv_invalid`。

**邀请链接**(链接中的 `token` 就是凭证):`GET /invitations/{token}`(不需要登录)、`POST /invitations/{token}/accept`(已登录的人加入)、`POST /invitations/{token}/sign-up`(注册、加入并登录)。

**组**(路径都以 `/orgs/{id}` 开头;"管理者"指 Org Admin,或这个组及其上层任一组的组长)

| 接口 | 谁可以 |
|---|---|
| `GET /groups`、`GET /groups/{group_id}`、`GET /groups/{group_id}/members`、`GET /members/{user_id}/groups` | 成员 |
| `POST /groups` | 顶层:Org Admin;下层:上层组的管理者 |
| `PATCH /groups/{group_id}` | 管理者;移动还需管理离开和进入的那一层 |
| `DELETE /groups/{group_id}`(不能有下层组) | 上一层的管理者 |
| `PUT /groups/{group_id}/members/{user_id}`(加入,或改变是否组长) | 管理者 |
| `DELETE /groups/{group_id}/members/{user_id}` | 自己(退出);管理者 |

**项目**(没有角色的人访问一律返回 404 `project_not_found`)

| 接口 | 谁可以 |
|---|---|
| `GET /orgs/{id}/projects` | 组织成员,只看到有角色的项目;Org Admin 能看到所有项目的名称 |
| `POST /orgs/{id}/projects` | 有"可以创建项目"的成员;创建者成为项目 Owner |
| `GET /projects/{id}`、`GET /projects/{id}/grants`、`GET /projects/{id}/activity` | 项目中任何角色 |
| `PATCH /projects/{id}`(改名)、`DELETE /projects/{id}`(连同其中的图表和 ADR) | Owner |
| `POST /projects/{id}/take-over`(把自己设为 Owner,记入活动记录) | Org Admin |
| `PUT /projects/{id}/grants` | 整个项目:Owner;框(带 `diagram_id` 和 `box_id`,只授权这个框及其里面):这个框、它上层框或项目的 Owner |
| `DELETE /projects/{id}/grants/{grant_id}` | 能给出这个授权的人;已删除的框上的授权:项目 Owner |

**图表**(不在你有角色的项目中的图表一律返回 404 `diagram_not_found`)

| 接口 | 谁可以 |
|---|---|
| `GET /projects/{id}/diagrams`、`GET /diagrams/{id}`、`GET /diagrams/{id}/access`(你在每个框上的角色) | Viewer |
| `GET /diagrams/{id}/export.pdf`(见"PDF 导出的规则") | Viewer |
| `POST /projects/{id}/diagrams`(`document` 是编辑器的文件格式,例如导入的文件;不给就是空白图表) | 整个项目的 Editor(只有框上授权不够) |
| `PATCH /diagrams/{id}`(改名) | Editor |
| `POST /diagrams/{id}/changes`(保存改动,见下) | 每处改动都在你能编辑的范围内(见"项目与权限的规则";否则 403 `outside_your_part`,`details.box_id` 指出是哪个框) |
| `/diagrams/{id}/live`(WebSocket,实时连接,见"实时连接") | Viewer;通过它保存改动的规则同上 |
| `DELETE /diagrams/{id}` | Owner;项目的 ADR 保留,关于其中框的范围和指向它的关联标为 `orphaned` |

图表的框、连线和外部框的位置各存一行(`boxes`、`edges`、`external_spots` 表),图表本身(`diagrams` 表)只有名称和 `version`。保存只写改动的那几行。

- 框:`{id, parent_id, title, type_id, technology, description, position: {x, y}, externals}`。`parent_id` 是它所在的框,只有根画布为 null。`type_id` 是任意非空文字(编辑器不认识的类型也原样保留),null 为通用类型;`technology` 是**一个**技术(例如 "PostgreSQL")。`externals` 是这个框的画布上外部框被拖到的位置,按框 id;指向不存在的框的位置会被丢掉。
- 连线:`{id, from, to, type_id, label}`。显示它的画布(两端共同所在的最深的框)由框推算,不存储。
- 读取时框和连线按添加的顺序排列(根画布在最前),也就是编辑器保持的顺序。框的 id 由编辑器生成,只在一张图表内唯一(另存副本时 id 不变)。
- 保存改动:`added_boxes` / `added_edges` 是新建的框和连线,发送完整内容;`changed_boxes` / `changed_edges` 是修改,只发送 `id` 和改了的字段(没给的字段不变;`null` 清空可选字段;`externals` 只给改动的外部框位置,`null` 表示忘掉这个位置);`removed_boxes` 是删除的框,连同其中的一切和接触它们的连线;`removed_edges` 是删除的连线。没提到的保持不变。
- 改动做在图表**当前**的样子上,所以多人可以同时修改:同一个字段,后到的改动生效。改动或连接的框、连线在此期间已被别人删除时,这一项跳过(返回的 `skipped_boxes` / `skipped_edges` 列出它们,新建在已删除的框里的框也算);删除已经不在的东西什么都不做;新建一个已经存在的框或连线就是把它替换成发来的内容,所以同一个改动发两次(例如断线后重发)也没有坏处。带上 `version` 时,只在图表仍是这个版本时保存,否则返回 409 `version_conflict`。
- 规则与编辑器相同:除根画布外每个框都在某个框里,最多嵌套 40 层;连线连接两个框,不能连自己,也不能连自己里面的框。另外,**框不能移到另一个框里**(`parent_id` 不变,修改里也没有这个字段;编辑器的剪切粘贴是删除后新建),一次保存也不能自相矛盾(例如修改它正在删除的框)。违反规则返回 422 `invalid_change`,整次保存什么都不改。
- 每次保存都是图表的一个新版本,同一张图表的保存一个接一个进行。打开着这张图表的每个人都会按顺序收到每次保存(见"实时连接"),不管它来自实时连接还是这个接口。
- 新建时的 `document` 就是编辑器保存的 JSON 文件(嵌套格式,见[JSON 文件格式](../docs/file-format.zh-CN.md))。后端的检查规则和报错信息与编辑器打开文件时完全一致;旧版本格式会升级为当前版本,不认识的字段会被丢弃,和编辑器保存时的行为相同。

**ADR**(ADR 属于项目。"范围的 Editor / Owner"指在 ADR 的范围上有这个角色,见"ADR 的范围"。返回 ADR 的接口都带 `scope`、`proposed_by`、`decided_by` 和你在它范围上的角色 `my_role`)

| 接口 | 谁可以 |
|---|---|
| `GET /projects/{id}/adrs`(可按 `status`、`diagram_id`、`box_id`、`connection_id` 筛选)、`GET /projects/{id}/adrs/{编号}`(7 即 ADR-0007)、`GET /projects/{id}/adrs/export.zip`、`GET /adrs/{id}`、`GET /adrs/{id}/markdown`、`GET /adrs/{id}/revisions` | Viewer |
| `POST /projects/{id}/adrs`(带 `diagram_id` 和 `box_id` 时范围是这个框,否则是整个项目)、`PATCH /adrs/{id}`、`PUT /adrs/{id}/links`、`DELETE /adrs/{id}` | 范围的 Editor |
| `POST /adrs/{id}/transition`(改变状态) | 范围的 Owner;接受一条取代其他 ADR 的 ADR,还要是被取代的那些 ADR 范围的 Owner |
| `PUT /adrs/{id}/scope`(只限提议中的;现有关联都必须在新范围内,否则 422 `link_outside_scope`) | 原范围和新范围的 Editor |
| `PUT /adrs/{id}/relations` | 范围的 Editor;新的 `supersedes` 关系还要是被取代的 ADR 范围的 Owner |
| `POST /adrs/{id}/supersede`(以这条为底稿新建一条取代它的 ADR) | 这条 ADR 范围的 Owner |

## 实时连接

打开图表的浏览器标签页连接 WebSocket `/api/v1/diagrams/{id}/live`(用登录 cookie)。只接受本站页面(`Origin` 与地址相同,或在 `NESTBOARD_CORS_ORIGINS` 里)和不带 `Origin` 的程序;别的网站的页面在握手时就被拒绝(HTTP 403)。每条消息是一个 JSON 对象,`type` 说明是哪种。

**服务器发来的**

| `type` | 什么时候 | 内容 |
|---|---|---|
| `hello` | 连接后的第一条 | `diagram`(和 `GET /diagrams/{id}` 一样)、`access`(和 `GET /diagrams/{id}/access` 一样)、这个连接的 `connection` 和 `color`(0–11,同一个人的多个标签页颜色相同)、`people`(其他在场的人,每人一条 `presence` 的内容) |
| `change` | 每次保存之后,发给每个人(包括保存的人) | `version`(连续递增;`hello` 之后的每个版本都会收到,而且只收到一次)、`by`(`user_id`、`name`,从实时连接保存时还有 `connection`)、`change_id`(从实时连接保存时是客户端给的 id)、`boxes` / `edges`(这次新建或修改的框和连线的完整当前内容)、`removed_boxes` / `removed_edges`(删除的一切,包括随框一起删除的)、`skipped_boxes` / `skipped_edges` |
| `refused` | 自己发的消息没有保存 | `id`(那次改动的 id;不是改动的消息为 null)、`error`(和接口的错误格式相同) |
| `presence` | 别人进来,或他们在做的事变了 | `connection`、`user_id`、`name`、`color`、`level`(在看哪个框的里面)、`selection`、`cursor`(指针在那层画布上的位置)、`dragging`(正在拖、还没保存的框的位置) |
| `left` | 别人关闭了图表 | `connection` |
| `renamed` | 图表改名 | `version`、`name`、`by` |
| `access` | 你的权限可能变了(授权、组、组织成员身份) | 和 `GET /diagrams/{id}/access` 一样 |
| `deleted` | 图表被删除,随后连接关闭 | `by` |

**浏览器发出的**

- `{"type": "change", "id": "...", ...}`:要保存的改动,格式和 `POST /diagrams/{id}/changes` 一样,但没有 `version`。
- `{"type": "presence", "level", "selection", "cursor", "dragging"}`:自己在做的事,每次发全部;只转给别人,不保存。`selection` 是 `{"type": "boxes", "ids": [...]}` 或 `{"type": "connection", "id": "..."}`。

**连接关闭的原因**(关闭代码):4401 没有登录或已退出(退出登录、改密码、重置密码时,那些登录的连接会关闭);4404 图表不存在或你不再能看到它(被删除、失去权限、离开组织);4408 接收太慢、落后太多(重新连接即可,会从当前的图表重新开始);1009 消息超过大小限制。

连接只保存在这一个后端进程的内存里。以后要运行多个后端进程时,它们需要互相转告保存(例如用 Postgres 的 LISTEN / NOTIFY)。

## PDF 导出的规则

每一层(根层,或一个框的内部)是一张图。PDF 像写报告一样排列它们:

1. 封面:项目名、图表名、导出范围和图数、导出日期(如 "02 Nov 2026")。**不写导出人**,封面和 PDF 属性里都没有,因为 PDF 会被转发。
2. 目录页(Table of Contents),永远是第二页;图表为空时写 "There are no boxes to show."。
3. 每张图一页,**深度优先**:根层之后,先排完一个框内部的所有图(包括更深的嵌套),再排它的下一个兄弟框。同一层的框按画布上的阅读顺序:从上到下分行,每行从左到右(纵向相差不到半个框高的算同一行)。里面没有框的框不单独成页。
4. 标题级别:根层和根层的框都是一级标题,再往里每深一层小一级(六级以下字号不再变小,但目录和 PDF 书签仍然按层嵌套)。只导出一个框时,从这个框开始算。标题下面是所在位置(如 `Root › Service 1`),图下面是编号说明(`Diagram 3: Service 1.1`)。
5. 每张图按编辑器里静止时的样子画(深色画布、框的类型标签、技术图标、嵌套数量、连线样式、跨层连线和外部框),在页面内尽量放大,但不超过编辑器的 75%;横过来更大时用横向页面。框名和连线文字是 PDF 里真正的文字,可以搜索和复制。

前端是画图的标准,后端的画法移植自前端并用前端生成的数据检查:

- `app/pdf_export/visuals.json`(类型、颜色、图标、技术 logo、连线样式)和 `tests/fixtures/editor_layout.json`(编辑器对示例画布的布局结果)由 `frontend/src/serverFiles.test.ts` 生成。前端的类型、样式或布局有变化时,这个测试会失败,在 `frontend/` 下运行 `UPDATE_SERVER_FILES=1 npx vitest run src/serverFiles.test.ts` 重新生成,然后后端的 `tests/test_pdf_canvas.py` 会检查移植是否仍然一致。
- 字体:Inter 随代码提供(`app/pdf_export/fonts/`,SIL Open Font License);中日韩文字用系统字体(Noto Sans CJK、Microsoft YaHei 或 PingFang)。Docker 镜像安装了 `fonts-noto-cjk`;本机开发时 Windows 和 macOS 自带的字体就够用。
- 1000 个框的图表大约 2 秒、1.6 MB,在单独的线程中生成,不会阻塞其他请求。

## ADR 的规则

以 Michael Nygard 的格式为基础:标题、状态、背景(`context`,一段 Markdown)、决定(`decisions`,一条条列出),以及后果,分为正面(`positive_consequences`)和负面(`negative_consequences`)两个列表。列表中每一项是一段简短的 Markdown,不能为空,每个列表最多 100 项。编号在每个项目内从 1 递增,删除后也不会复用。

**状态**

```
proposed ──> accepted ──> deprecated
   │            └───────> superseded(只能由新的 ADR 取代,不能手动设置)
   └──────> rejected
```

- 只有 proposed 状态的 ADR 能修改正文、修改与其他 ADR 的关系、或被删除。一旦接受或否决,它就是历史记录;要改变决定,就写一条新的 ADR 来取代它。
- 被其他 ADR 引用的 ADR 不能删除。

**ADR 的范围**

- 每条 ADR 的范围是**整个项目**(`scope` 为 null),或项目中某张图表的**一个框**及其里面(`scope: {diagram_id, box_id, title, orphaned}`)。根画布不是框。提议中的 ADR 可以移到另一个范围(需要原范围和新范围的 Editor);它现有的关联都必须在新范围内,已删除的目标不算。接受或否决后范围不能再改。
- 能做什么看你在范围上的角色,和保存图表时一样计算:整个项目的角色,与这个框及其所有上层框上的授权中最高的那个。范围的 Editor 提议、修改、关联、删除;范围的 Owner 接受、否决、废弃。所以一个框的负责人能决定这个框的 ADR,但碰不到范围之外的。
- **取代**一条 ADR 需要它所在范围的 Owner:设置新的 `supersedes` 关系、用 `supersede` 新建取代它的 ADR、接受取代它的 ADR,都要检查。`relates_to` 和 `amends` 只需要自己范围的 Editor。
- 范围的框(或整张图表)被删除后,ADR 保留,范围标为 `orphaned`,显示新建时框的名称;此后只看整个项目的角色。

**关联框和连线**

- 任何状态都可以修改关联(图会重画,决定不变)。
- 每个关联指明图表(`diagram_id`)。整个项目范围的 ADR 可以关联项目中任何图表的框和连线;框范围的 ADR 只能关联这个框本身、它里面的框,以及至少一端在其中的连线(422 `link_outside_scope`)。
- 新关联的框或连线必须存在于项目的图表中(422 `unknown_link_target`);根画布不是框,不能关联。
- 关联的框(或图表)被删除后,关联仍然保留,标记为 `orphaned`,并显示它最后的名称。把读到的关联原样提交回来(包括 orphaned 的,以及框移出范围后的)不会报错。

**历史与作者**

- 每次改动都保存为一个历史版本,记录做了什么(`action`:`created`、`edited`、`linked`、`scoped`、`related`、`accepted`、`rejected`、`deprecated`、`superseded`)和**由谁**完成(`author: {user_id, name, title}`)。名称和职位按当时的样子保存,之后改名、换职位或离开组织都不影响记录。
- 被取代的 ADR 的 `superseded` 版本,作者是接受新 ADR 的人。
- ADR 本身带 `proposed_by`(第一个版本的作者)和 `decided_by`(接受或否决它的人)。在加入作者之前的版本,作者为 null。

**ADR 之间的关系**

- `supersedes`(取代)、`amends`(修订)、`relates_to`(相关)。每对 ADR 之间最多一种关系,且必须在同一个项目内(可以跨范围)。
- `supersedes` 和 `amends` 的对象必须是 accepted 状态。
- 取代在**接受**时生效:新 ADR 被接受的同一个事务里,它取代的 ADR 变为 superseded。新 ADR 被否决,则旧 ADR 不受影响。两条 ADR 争相取代同一条时,先被接受的生效,另一条会被拒绝接受。

**导出**

Markdown 文件遵循 [adr-tools](https://github.com/npryce/adr-tools) 的约定:文件名如 `0002-use-postgresql.md`,标题为 `# 2. Use PostgreSQL`,状态一节写明谁提议、谁决定(如 `Proposed by Bob (Developer). Accepted by Alice (Architect).`),并列出关系(如 `Superseded by [3. …](0003-….md)`)。决定写成项目列表;后果分为 `### Positive` 和 `### Negative` 两个列表(没有内容的一类不写)。有关联的框或连线时,末尾附"Diagram elements"一节。导出的 zip 可以直接放进代码仓库的 `docs/adr/` 目录。

## 账号的规则

- **第一个账号**通过 `/auth/setup` 创建,成为实例管理员。之后不开放自由注册;其他人通过组织的邀请链接注册并加入(见"组织的规则")。
- 邮箱不区分大小写,保存为小写。密码 8 到 200 个字符,首尾空格算作密码的一部分。
- 密码用 argon2id 散列保存。邮箱不存在和密码错误返回同样的错误(401 `invalid_credentials`),耗时也相同,不会透露哪些邮箱已注册。
- **登录状态**保存在 httpOnly cookie `nestboard_session` 中(页面脚本读不到,其他网站发来的请求不带它)。数据库只保存令牌的 SHA-256。登录状态 30 天不使用即失效,使用时自动延长。
- **连续输错密码**:同一个邮箱连续错 5 次后,每次再试都要等待,30 秒起,每次翻倍,最多 15 分钟;返回 429 `too_many_attempts`,`details.retry_after` 和 `Retry-After` 头给出秒数。登录成功后重新计数。修改密码时输错当前密码也计入。

**重置密码**

- 只有**实例管理员**能生成重置链接。组织的 Admin 不能:一个人可能同时属于其他组织,能重置他的密码就等于能进入那些组织。
- 还没有邮件,实例管理员把链接(`/reset-password/<token>`)自己交给对方。`token` 只在生成时返回一次,数据库只保存它的 SHA-256。
- 每个链接只能用一次,有效期 1 到 72 小时(默认 24 小时)。为同一个账号生成新链接后,旧的未使用链接失效。不能再用的链接返回 410:`password_reset_used`、`password_reset_replaced`、`password_reset_expired`。
- 重置后,该账号的所有登录退出,连续输错密码的等待也清除;使用链接的浏览器直接登录。

## 组织的规则

- 一个用户可以加入多个组织。不属于某个组织的人,访问它的任何接口都得到 404,与不存在一样;是成员但角色不够,返回 403 `not_allowed`(`details.role` 是你的角色)。
- **角色**:Member < Admin < Owner。只有实例管理员能创建组织,并成为第一位 Owner;要把组织交给别人,邀请对方为 Owner,然后自己退出。
- **至少一个 Owner**:最后一位 Owner 不能降级、退出或被移除(409 `last_owner`)。修改成员前会锁住组织,两位 Owner 同时互相降级时只有一个会成功。
- **职位**(`title`)只用于显示,不影响权限,由 Admin 设置,可以为空。
- **可以创建项目**(`can_create_projects`):Admin 为每个 Member 打开或关闭,新成员默认关闭;Owner 和 Admin 始终可以,接口对他们总是返回 true。
- 组织和项目的名称不必唯一;页面地址用它们的 id(`/organizations/<id>/projects/<id>/…`),不透露名称。

**邀请链接**

- 前端把 `token` 放进链接(`/invite/<token>`)由邀请人自己发送,不需要邮件服务器。`token` 只在创建时返回一次,数据库只保存它的 SHA-256;丢了就撤销并重新创建。
- 每个链接只能用一次;有效期 1 到 30 天(默认 7 天);可以随时撤销。用过、撤销、过期的链接返回 410,代码分别为 `invitation_used`、`invitation_revoked`、`invitation_expired`。两个人同时使用同一个链接,只有一个会成功。
- 邀请可以指定 `email`:只有这个地址能使用(403 `invitation_for_another_email`)。
- 已有账号的邮箱不能通过链接注册(409 `email_taken`),应登录后接受邀请。已经是成员的人接受邀请返回 409 `already_member`,链接保持未使用。
- 除第一个账号外,注册只能通过邀请链接。

## 项目与权限的规则

- **授权** = 一个用户或一个组 + 角色(Viewer < Editor < Owner)。一个人在项目中的角色,是所有适用于他的授权中最高的那个:直接给他的,和给他所在的任何组的(组的成员包括下层组里的人)。只有项目所在组织的成员才能有角色。
- 没有角色时,项目和其中的图表、ADR 都不存在(404)。唯一的例外:Org Admin 能在列表中看到所有项目的名称,并可以**接管**(成为 Owner);接管会记入项目的活动记录,项目里的人都能看到。
- 项目至少保留一个 Owner 授权(用户或组);最后一个不能降级或取消(409 `last_owner`)。修改授权前会锁住项目,两位 Owner 同时互相取消时只有一个会成功。
- 离开组织时,同时取消你在它所有项目中的个人授权。项目的最后一位 Owner 离开后,由 Org Admin 接管。

**框上的授权**

- 授权可以只给一张图表中的一个框:覆盖这个框和它里面所有层级。一个人在某个框上的角色,是整个项目的角色与这个框及其所有上层框上的授权中最高的那个。根画布不是框,只看整个项目的角色。
- 只有框上授权的人也能看到这个项目,在其他地方算 Viewer。
- 框上的 Owner 授权就是这个框的**负责人**:这个框、它上层框或项目的 Owner 都能在框里面授权和取消授权,所以负责人可以把框里面的部分再分给别人。框上的 Owner 不算项目的 Owner(不计入"至少一个 Owner")。
- 框被删除后,它上面的授权保留,标为 `orphaned`,显示授权时框的名称;由项目 Owner 清理。

**保存图表时的检查**(项目 Owner 不受限制)

每次保存列出它改动的框和连线,后端把每一个和已保存的那一行比较,每处改动都要有权限,否则整次保存被拒绝(403 `outside_your_part`):

| 改动 | 需要 |
|---|---|
| 新建或删除一个框 | 它所在的框(上一层)的 Editor |
| 在画布上拖动框的位置 | 它所在的框的 Editor |
| 改框的名称、类型、技术、描述 | 这个框本身的 Editor(负责一个框的人可以给它改名) |
| 拖动框的画布上的外部框 | 这个框本身的 Editor;因为外部框被删除而消失的位置不算改动 |
| 删除有自己授权的框 | 上一层的 Owner,所以没人能删掉分给自己的框 |
| 新建、修改、删除同一层的两个框之间的连线 | 两端至少一端的 Editor |
| 新建、修改、删除不同层的两个框之间的连线 | 至少一端所在的框(上一层)的 Editor:只能编辑 Shop 里的 Cart 的人,不能把它连到 Shop 外面 |

## 组的规则

- 组可以嵌套:每个组最多一个上层组,最多 10 层(422 `group_too_deep`,移动时把跟着走的下层组也算上),不能放进自己或自己的下层组(422 `group_loop`)。
- **成员身份向上算**:在 Payments 里的人,也算 Platform 和 Engineering 的成员。
- 组长管理这个组和它下面所有的组;新建、移动、删除一个组需要管理它的上一层(顶层需要 Org Admin)。
- 同一个上层组下组名不能重复,不区分大小写(409 `group_name_taken`)。有下层组的组不能删除(409 `group_has_subgroups`)。
- 只能把本组织的成员加入组(404 `member_not_found`)。离开组织时,同时退出它的所有组。
- 改变组的结构(新建、移动、删除)前会锁住组织,两个同时进行的移动不会形成环。

## 并发与错误

- 每次修改都要带上它所基于的 `version`。如果期间有人改过,请求失败,返回 409 `version_conflict`,`details.current_version` 是当前版本;客户端应重新读取后再提交。同一时刻的多个修改,只有一个会成功。例外是保存图表的改动:`version` 可以不给,改动做在当前的图表上(见"图表")。
- 所有错误的格式相同:

  ```json
  {"error": {"code": "adr_locked", "message": "ADR-0003 is accepted, so it can no longer be edited. ...", "details": {"status": "accepted"}}}
  ```

  `code` 是稳定的,供程序判断;`message` 是给人看的英文句子。

## 代码结构

```
app/
  main.py            应用入口:中间件、错误处理、接口描述
  auth.py            登录 cookie,以及需要登录的接口用的 CurrentUser
  passwords.py       密码散列(argon2id)
  access.py          找出图表或 ADR 所在的项目、当前用户在其中的角色,以及在 ADR 范围上的角色
  box_rights.py      框上的角色,以及保存图表时检查每处改动是否在权限范围内
  api/               路由(只处理 HTTP)
  services/          业务规则(不依赖 HTTP,将来的 AI / MCP 集成可以直接调用)
  models/            数据表
  schemas/           请求和响应的格式
  diagram_tree.py    图表的结构(哪个框在哪个框里)和连线的规则,读取文件、检查保存、权限和 ADR 共用
  diagram_format.py  图表文件格式的检查(移植自前端的 frontend/src/model/serialize.ts),以及文件与表中各行的互相转换
  diagram_changes.py 检查一次保存的改动是否符合规则,并算出要写哪些行和跳过哪些
  live.py            实时连接:谁打开着哪张图表,按顺序转告每次保存和每个人在做的事(连接本身在 api/live.py)
  adr_markdown.py    ADR 的 Markdown 导出
  pdf_export/        PDF 导出:outline.py 决定页面顺序和标题,canvas.py 计算一层画布的布局,
                     draw.py 和 canvas.typ 画图,document.py 和 report.typ 组成整份报告(Typst 生成 PDF)
  body_limit.py      请求体大小限制
migrations/          Alembic 迁移
tests/               测试(pytest,运行在 nestboard_test 数据库上)
```

**修改图表文件格式时**,必须同时修改前端的 `frontend/src/model/serialize.ts`(及 `types.ts`)和后端的 `app/diagram_format.py`、`app/schemas/document.py`,否则后端会拒绝新格式的文件,或丢掉新字段。框或连线多了字段时,还要在 `app/models/diagram.py` 加列(并写迁移)、改 `app/schemas/diagrams.py`(`Box` 和 `BoxPatch`,或 `Edge` 和 `EdgePatch`)和 `app/diagram_changes.py`,以及前端的 `frontend/src/model/records.ts`、`src/model/changes.ts`(编辑器按同样的规则做别人的改动)和 `src/api/diagrams.ts`。

**写入图表的新代码**(保存、改名、删除之外的)要在 `live.hub.writing(diagram_id)` 里面做,提交后用 `live.hub.publish` 告诉打开着它的人;改变谁能看到或编辑什么的代码,提交后调用 `live.hub.access_changed`。
