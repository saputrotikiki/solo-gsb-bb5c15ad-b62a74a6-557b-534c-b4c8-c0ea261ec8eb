# 社团章程修订 Web 应用

一款面向社团章程（条款制规章）的版本化修订平台：

- 录入**首版条款及条款间引用**，原子生成不可变版本；
- 从任意已发布版本创建**草案**，对带**稳定标识**的条款进行编辑、移动、删除，并登记/删除条款引用；
- 随时查看草案相对其**基线版本**的结构差异与正文逐字差异；
- 并行草案发布时，系统把草案相对基线的改动**重放（replay）**到最新发布版：
  - **不相交**的条款改动自动合并；
  - **同一条款被双方改动**（或一方删除、另一方修改，或双方新增同标识但内容不同）→ **拒绝发布**，逐条说明冲突；
  - 重放后产生**悬空引用**（引用来源或目标条款不存在）→ **拒绝发布**并列出悬空引用；
  - 冲突/悬空时**草案原样保留**，可继续修改后再次发布；
- 草案允许**暂存悬空引用**并在界面明确标红，但**不能发布**；
- 发布成功在**单个 SQLite 原子事务**中写入不可变新版本；历史版本可完整**还原该版的条款顺序、正文与引用**，并支持任意两版差异对比。
- 发布可指定**晚于当前时间的 UTC 生效时刻**：发布后仍**立即生成不可变版本快照**，但到点才自动成为当前生效版（惰性生效，无后台任务）。
- 发布前可**预览将要落库的最终版本**：沿用三方重放与排程规则，返回相对最新发布版的正文/顺序/引用差异及一次性**确认凭据**；预览不写版本、不关闭草案。持凭据确认时只能在同一事务内发布与预览**完全一致**的内容及生效安排；草案被编辑、他人先发布、排程改期/取消或预定时刻已过均使凭据失效并保留草案。
- 页面「生效排程」展示**当前生效版**与**待生效队列**，支持生效前**改期 / 取消**（携带读取时的**排程修订号**乐观并发控制）。
- 可按任意 UTC 时点查询**当时生效版本**的完整条款、顺序与引用；**已发生时点的结果不随后续改期或取消变化**。

## 技术栈

- Node.js 20（内置 `http`，无额外 Web 框架）
- SQLite（[`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)，同步事务）
- 浏览器端原生 HTML/CSS/JavaScript 单页应用（无需构建）

## 一键启动（Docker Compose）

需要已安装 Docker 与 Compose 插件（`docker compose version` 可用）。

```bash
docker compose up -d --build
```

启动后访问：

- **地址：** http://localhost:3000
- **端口：** 容器内固定 `3000`；宿主机端口可用环境变量 `HOST_PORT` 修改：

```bash
HOST_PORT=8080 docker compose up -d --build
# 访问 http://localhost:8080
```

停止与清理：

```bash
docker compose down            # 停止并删除容器（数据库卷保留）
docker compose down -v         # 同时删除数据库卷（清空全部数据，谨慎）
docker compose logs -f         # 查看日志
```

SQLite 数据库文件位于命名卷 `charter-data` 内（容器路径 `/data/charter.db`），首次启动若库表不存在会自动建表初始化，无需手工迁移。

## 本地直接运行（不使用 Docker）

要求 Node.js ≥ 20。

```bash
npm install
npm start
```

运行单元测试（纯业务逻辑：差异 / 三方重放 / 悬空引用）：

```bash
npm test
```

## 配置

通过环境变量配置，均有默认值：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 监听端口 |
| `DB_PATH` | `./data/charter.db`（本地）/ `/data/charter.db`（Docker） | SQLite 数据库文件路径，目录不存在会自动创建；首次启动自动建表 |

Docker Compose 额外支持：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST_PORT` | `3000` | 宿主机映射端口 |

## 使用流程

1. **录入首版**：打开首页即见首版录入表单（已附 4 条示例条款与引用，可直接“发布首版”体验）。逐条填写稳定标识（字母、数字、汉字、`_`、`-`，≤40 字符）、标题、正文，并登记条款间引用；提交后原子生成不可变 `v1`。
2. **创建草案**：在“草案”页选择基线版本创建草案。可同时创建多个草案（并行修订）。
3. **编辑草案**：
   - 新增条款（获得新的稳定标识，追加后可用 ↑/↓ 移动）；
   - 编辑标题/正文（标识不可修改，保证跨版本稳定）；
   - 移动条款顺序、删除条款；
   - 新增/删除引用，允许引用暂不存在的条款——会被标记为**悬空引用**并阻止发布。
4. **查看差异**：草案页实时显示相对基线的新增/删除/修改/移动与引用增删，可打开“正文差异”查看逐字增删（`<ins>` / `<del>`）。
5. **发布**（推荐先预览再确认，也可直接发布）：
   - 草案存在错误级问题（空正文、悬空引用、标识重复等）时禁止预览与发布；
   - 点「预览将要落库的版本」可查看经三方重放后的最终条款正文、顺序、引用差异与生效安排：**预览不写版本、不关闭草案**，仅在预览成功时返回确认凭据；
   - 点「按预览内容确认发布」持凭据在**同一原子事务**内复核落库；预览后草案被编辑、其他草案先发布、排程改期/取消或预定时刻已过，都会收到 `PREVIEW_STALE` 及原因并保留草案，重新预览即可；
   - 「立即发布（不预览）」沿用原有直接发布路径：若基线不是最新版，在 `BEGIN IMMEDIATE` 事务内把改动重放到最新版；不相交改动合并成功则生成新版本；同条款双方改动或重放后悬空则返回冲突说明、回滚事务并保留草案；
   - 发布时可选择「立即生效」或「定时生效」（UTC 时刻，必须晚于当前）。
6. **发布历史**：在“发布历史”中查看每个不可变版本（顺序/正文/引用完整还原），可下拉选择任意其他版本做两版对比；版本列表标注「即时生效 / 待生效 / 已取消」与生效时刻。
7. **生效排程**：在“生效排程”页查看当前生效版、待生效队列与排程修订号，对待生效版本改期或取消，并按任意 UTC 时点查询当时生效版本。

## 定时生效与排程规则

- **发布即固化、到点才生效**：指定 `effective_at`（带 `Z` 或时区偏移的 ISO-8601，晚于当前 UTC）后，版本内容快照立即不可变写入，`schedule_status = scheduled`；到点后查询自动命中（惰性，无需定时任务/重启迁移）。
- **严格递增**：同一待生效队列中，各版本的生效时刻必须按**发布版顺序**严格递增——新入队时刻须严格晚于队列末尾版本，否则以 `SCHEDULE_ORDER_VIOLATION` 拒绝。
- **队列保护**：队列非空时，**未指定**生效时刻的发布会被拒绝（`QUEUE_NOT_EMPTY`）并返回当前排程；队列为空时未指定时刻仍沿用**即时生效**。
- **改期**：只能改仍未到点的待生效版本；新时刻必须晚于当前，且**不得越过相邻版本**（严格位于前后相邻待生效版本的时刻之间）。
- **取消**：生效前可取消（`schedule_status = cancelled`），快照保留、永不生效；已生效或已取消版本不可再改期/取消。
- **排程修订号（乐观锁）**：任一入队/改期/取消都会使 `meta.schedule_revision` 递增。改期/取消必须携带读取排程时获得的 `schedule_revision`；修订号过期或版本已生效时**整次拒绝**并在响应中返回**当前排程**。
- **时点查询不可变**：`GET /api/effective?at=<ISO>` 返回该时点生效版本及其完整条款/顺序/引用。由于改期只能指向未来、取消只作用于待生效版本，**已发生时点的查询结果不会因之后的改期或取消而改变**。
- **草案基线**：始终以**最新发布版**（最大版本号，含待生效/已取消快照）为默认基线；现有版本快照、两版差异与草案编辑操作均不受排程影响。

## 合并（重放）语义

设基线为 `B`，草案为 `D`，最新发布版为 `L`，逐条款判定：

| 情况 | 结果 |
| --- | --- |
| 仅 `D` 改动（新增/编辑/移动/删除） | 采用草案内容与位置 |
| 仅 `L` 改动 | 保留最新版内容 |
| `D` 与 `L` 改动完全相同（收敛） | 自动采纳，不算冲突 |
| 双方对同一标识都做了不同改动 | **冲突，拒绝发布**（`modify-modify` / `delete-modify` / `modify-delete` / `add-add`） |
| 双方都删除同一条款 | 收敛为删除 |
| 重放后任一引用的来源或目标条款缺失 | **悬空，拒绝发布** |

条款的出边（引用）跟随条款归属：条款采纳自哪一侧，其引用集就来自哪一侧。新增条款的位置按其在草案中的锚点（前一条款）插入到最新版顺序中；移动条款同理重定位。

“移动”按方向性锚点判定：旧序锚点的后继在新序中发生变化且该后继仍位于锚点之后，才算该条款被主动移动（被插队而被动让位的条款不计）。因此“草案后移 B、最新版仅修改 C 正文”这类不相交改动可以干净重放。

## HTTP API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/overview` | 章程标题、版本列表（含排程状态/生效时刻）、草案列表、当前生效版与排程修订号 |
| `POST` | `/api/initialize` | 录入并发布首版（仅一次）；可选 `effective_at` 定时生效 |
| `GET` | `/api/effective?at=:iso` | 查询指定 UTC 时点（缺省为当前）当时生效版本及完整条款、顺序、引用 |
| `GET` | `/api/schedule` | 当前生效版、待生效队列（顺序）、排程修订号 |
| `POST` | `/api/versions/:id/schedule` | 改期 `{effective_at, schedule_revision}` |
| `POST` | `/api/versions/:id/cancel` | 取消待生效排程 `{schedule_revision}` |
| `GET` | `/api/versions/:id?compare=:otherId` | 查看版本快照（可选两版差异） |
| `POST` | `/api/drafts` | 从基线版本创建草案 `{baseline_id?, name?}` |
| `GET` | `/api/drafts/:id?diff=1` | 草案详情、问题清单、基线差异 |
| `PATCH` | `/api/drafts/:id` | 重命名草案 |
| `POST` | `/api/drafts/:id/clauses` | 新增条款 |
| `PUT` | `/api/drafts/:id/clauses/:key` | 编辑条款标题/正文 |
| `DELETE` | `/api/drafts/:id/clauses/:key` | 删除条款（相关引用保留为悬空） |
| `POST` | `/api/drafts/:id/clauses/:key/move` | 移动条款 `{ordinal}` 或 `{after}` |
| `POST` | `/api/drafts/:id/refs` | 新增引用（允许悬空暂存） |
| `DELETE` | `/api/drafts/:id/refs/:ordinal` | 删除引用 |
| `POST` | `/api/drafts/:id/preview` | 预览将要落库的最终版本（不写版本、不关闭草案）；成功返回确认凭据 |
| `GET` | `/api/drafts/:id/previews/:token` | 查看预览内容及凭据当前是否仍可确认 |
| `POST` | `/api/drafts/:id/publish` | 原子发布；可选 `effective_at`（未来 UTC 时刻）定时生效；携带 `preview_token` 时为凭据确认发布 |

### 发布前预览与凭据确认（推荐）

正式落库前可先预览**将要写入的最终版本**：系统沿用既有的三方重放与排程规则，计算出相对**最新发布版**的条款正文、顺序、引用差异，并返回一个一次性**确认凭据**。

- 预览**不写版本、不关闭草案**；只有预览本身成功（无冲突、无悬空、排程规则通过）才返回凭据；
- 凭据把**草案内容、发布说明、生效安排、当时的最新发布版与排程修订号**一起锁定；
- 持凭据确认时，在**同一个 `BEGIN IMMEDIATE` 原子事务**内复核并落库；下列任一情况都会使凭据失效，返回 `409 PREVIEW_STALE` 及失效原因（`reason`）并**保留草案**，需重新预览：
  - `draft-edited`：预览后草案被编辑；
  - `newer-version-published`：其他草案先发布（最新发布版已变化）；
  - `schedule-changed`：待生效队列发生改期或取消（排程修订号变化）；
  - `effective-time-passed`：预览锁定的预定生效时刻已过；
  - `draft-closed` / `preview-consumed`：草案已发布或凭据已使用。
- 确认请求可只发 `{ "preview_token": "..." }`（采用预览锁定的说明与生效安排）；若显式携带不同的 `note` 或 `effective_at`，以 `400 CONFIRM_MISMATCH` 拒绝，需重新预览。
- 原有的**直接发布**调用（`POST /api/drafts/:id/publish` 不带凭据）及其全部错误语义保持不变；页面弹窗同时提供「预览将要落库的版本」「按预览内容确认发布」与「立即发布（不预览）」。

```bash
# 1) 预览（可选 effective_at，规则与直接发布完全一致；预览不入队）
curl -s -X POST http://localhost:3000/api/drafts/7/preview \
  -H 'Content-Type: application/json' \
  -d '{"note":"秋季修订","effective_at":"2026-10-01T08:30:00Z"}'
# -> 200
# { "token": "Ab3...确认凭据",
#   "draft_id": 7, "draft_status": "open",
#   "latest_version_id": 4, "replayed": true,            // 是否需要三方重放
#   "schedule_status": "scheduled",                      // immediate | scheduled
#   "effective_at": "2026-10-01T08:30:00.000Z",
#   "would_enqueue": { "position_after": 0, "tail_version_id": null },
#   "version": { order, clauses, refs },                 // 将要落库的最终版本
#   "diff": { added, deleted, changed, moved,
#             refs_added, refs_removed, changed_detail } // 相对最新发布版的差异
# }
# 预览失败时沿用直接发布的错误语义与状态码，且不返回 token：
#   409 CONFLICT（冲突/悬空）、409 DRAFT_INVALID、409 QUEUE_NOT_EMPTY、
#   409 SCHEDULE_ORDER_VIOLATION、400 PAST_EFFECTIVE_AT、400 VALIDATION、400 NO_CHANGES

# 2) 查看预览（页面打开凭据时使用；失效时 usable=false 并给出 stale_reason）
curl -s http://localhost:3000/api/drafts/7/previews/Ab3...

# 3) 持凭据确认：同事务复核，只发布与预览完全一致的内容及生效安排
curl -s -X POST http://localhost:3000/api/drafts/7/publish \
  -H 'Content-Type: application/json' \
  -d '{"preview_token":"Ab3..."}'
# -> 201 { "version_id": 5, "confirmed_preview": true, "replayed": true,
#          "schedule_status": "scheduled", "effective_at": "...", "schedule": {...} }

# 4) 凭据失效 -> 409，草案保留，重新预览后再确认
# { "error": "PREVIEW_STALE", "reason": "draft-edited",
#   "message": "预览后草案已被编辑，凭据失效；请重新预览",
#   "repreview": true, "draft_id": 7 }
```

### 定时生效调用示例（curl）

```bash
# 1) 定时发布：指定未来 UTC 时刻，立即得到不可变版本号与当前排程
curl -s -X POST http://localhost:3000/api/drafts/1/publish \
  -H 'Content-Type: application/json' \
  -d '{"note":"秋季修订","effective_at":"2026-10-01T08:30:00Z"}'
# -> { "version_id": 5, "schedule_status": "scheduled",
#      "effective_at": "2026-10-01T08:30:00.000Z",
#      "schedule": { "schedule_revision": 3, "current_version_id": 4,
#                    "pending": [ {"id":5,"effective_at":"..."} ] } }

# 2) 队列非空时不指定时刻 -> 409 QUEUE_NOT_EMPTY（响应携带当前排程）
#    入队时刻必须严格晚于队列末尾，否则 409 SCHEDULE_ORDER_VIOLATION

# 3) 改期：携带读取时的排程修订号；不得越过相邻版本或落到过去
curl -s -X POST http://localhost:3000/api/versions/5/schedule \
  -H 'Content-Type: application/json' \
  -d '{"effective_at":"2026-10-02T09:00:00Z","schedule_revision":3}'
# -> { "ok": true, "schedule_revision": 4, "schedule": {...} }
# 修订号过期 -> 409 STALE_SCHEDULE_REVISION（响应返回当前排程）
# 版本已生效 -> 409 ALREADY_EFFECTIVE；已取消 -> 409 VERSION_CANCELLED

# 4) 生效前取消（快照仍保留、永不生效）
curl -s -X POST http://localhost:3000/api/versions/5/cancel \
  -H 'Content-Type: application/json' -d '{"schedule_revision":4}'

# 5) 时点查询：当时生效版本及完整条款/顺序/引用（已发生时点结果恒定）
curl -s 'http://localhost:3000/api/effective?at=2026-10-01T08:30:00Z'
curl -s 'http://localhost:3000/api/effective'   # 当前生效版
```

时间参数只接受**带明确时区设计符**的 ISO-8601（`...Z` 或 `...+08:00`），服务端统一转为 UTC 存储与比较；不带时区的“天真”时间串会以 `400 VALIDATION` 拒绝。

## 目录结构

```
.
├── Dockerfile
├── docker-compose.yml
├── package.json
├── README.md
├── src
│   ├── server.js      # HTTP 服务、API、发布预览凭据、原子发布事务、生效排程/改期/取消、时点查询
│   ├── db.js          # SQLite 连接、建表、版本/草案/预览凭据快照读写、排程修订号
│   └── model.js       # 纯逻辑：差异、移动判定、三方重放、悬空引用校验、生效判定/队列
├── public
│   ├── index.html     # 单页应用入口
│   ├── styles.css
│   └── app.js         # 首版录入 / 草案编辑 / 差异 / 发布预览与确认 / 历史还原 / 生效排程
└── test
    ├── model.test.js  # 核心合并逻辑与排程判定单元测试（npm test）
    └── e2e.js         # 端到端 API 冒烟测试（含预览凭据、定时生效/改期/取消/时点查询）
```

## 数据持久化与备份

- 本地运行：数据库即 `DB_PATH` 指向的文件（默认 `./data/charter.db`，WAL 模式另有 `-wal`/`-shm` 伴生文件）。
- Docker：使用命名卷 `charter-data`，可用 `docker cp` 或直接挂载卷备份；已发布版本的**条款内容快照**只追加、不更新不删除，具备不可变性。排程仅改 `effective_at` 或置 `schedule_status = cancelled`，不触碰条款快照；升级后首次启动会自动为旧库补齐排程列（旧版本按发布时刻即时生效）。发布预览凭据存于 `publish_previews` 表（预览只追加凭据行，不写版本、不改草案；确认成功后凭据置为 `consumed`），随数据库一起持久化，删除该表不影响已发布版本的还原。
