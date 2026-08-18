# Agent Note: TUI 技术方案与开发计划

Status: proposed

[English](2026-08-18-tui-solution-and-dev-plan.md) | 中文

## 问题

[TUI 分析 note](2026-08-18-tui-terminal-product-analysis.md) 已确立 *做什么* 与 *为什么*：deepseek-harness 当前无 TUI，架构已留好接入点，Phase 0 已验证 in-process `session/event` → 终端管道，远程 transport 已定 BFF SSE。缺的是可执行的 *方案与计划*：要调哪些精确 seam、加哪些文件、阶段顺序、每步验证门。本 note 补上这一缺口。它是 TUI 工作项的 `sf-solution` + `sf-plan` 输出，不取代分析 note 的任何结论——它依赖该 note 的判断（以删除产物为规格重建、不碰 core、BFF SSE、纯加法新包）。

### Resolved（本地模板阶段）

- **workItemRef：** TUI 终端产品（无 live SF 工作项；本仓库是本地静态模板，见 `CLAUDE.md`，故不调 `run_list`/`run_create`）。`runContext` 的本地等价物是 `phase0/tui-prototype` 分支及其 6 个 commit，已推到 `origin`。
- **branch：** `phase0/tui-prototype`（HEAD `ba62f6cc43`），upstream `origin/phase0/tui-prototype`。
- **allowedScope：** 新包 `packages/examples/tui-demo/`（Phase 0，已存在）→ `packages/bundle/tui/`（Phase 1+）；不改 `packages/core/*`、`agent-loop`、`PROFILE_TEMPLATES`。依据分析 note §14（加法优先 + overlay 优先 + patch 兜底）。
- **contextSummary：** 分析 note §1（当前无 TUI）、§5（最小 spine）、§6（渲染差距/复用）、§7（交互闭环）、§10（BFF SSE 已定）、§11（以规格重建）。

## 提案

### 一段话架构

新增 `packages/bundle/tui/` 镜像 `dsh-headless`：一个 Cordis 函数插件（`name`/`inject`/`Config`/`apply`），通过 `AgentRegistry.create` 创建一个 Agent，经 `installModelSelection` 耦合可变模型选择（**当前** core seam，**不**复活被删的 `installAgentLlmTarget`），订阅 `session/event`，注册 `approval/request` answerer 与 `UserQuestionService` provider，经终端渲染层渲染到 stdout——该层消费 `presentation.ts` 的 `card` 联合体与 `todos`/`plan` session projection。bundle 是 standalone bin（自带 `boot()` + `cordis.yml`），**不**注册进 `PROFILE_TEMPLATES`。远程模式是可换的 `EventSourceTransport` adapter，连现有 Web BFF；不新建服务端。

### TUI 要调的 seam（已对照当前树验证）

| 关注点 | seam | file:line | 说明 |
|---|---|---|---|
| 创建 agent | `AgentRegistry.create` | `packages/core/agent/src/index.ts:405` | `sessionId` + `agentOptions` + `setup(agentCtx)` |
| 模型选择 | `installModelSelection(agentCtx, ref)` | `packages/core/agent/src/model-selection.ts:39` | **当前** seam；替代被删的 `installAgentLlmTarget`。`ModelSelectionRef = { current, assembled }`。headless 与 Web BFF 都用它（`headless/src/index.ts:117`、`api-proxy.ts:10,1127`） |
| 驱动一轮 | `agent.followup(msg)` + `agent.whenIdle()` | `packages/core/agent/src/runtime-types.ts:122,91` | headless `index.ts:122-126`；Phase 0 `tui-demo/src/runner.ts` |
| 事件火带 | `ctx.on('session/event', (session, event))` | `packages/core/session/src/index.ts:641` | 携 `assistant/chunk`/`assistant/message`/`tool/call`/`tool/result`/`todo/write`/`turn/*` |
| 审批 answerer | `ctx.on('approval/request', (req, next) => {...})` | `packages/interaction/user-approval/src/index.ts:30`；BFF 镜像 `api-proxy.ts:1391` | **必须调 `next()`**；无 answerer 返回 `'unavailable'`（fail-closed） |
| ask-user provider | `ctx.userQuestions.registerProvider({ ask })` | `packages/interaction/user-questions/src/index.ts:64`；BFF 镜像 `api-proxy.ts:1338` | `plan-review` intent 特殊渲染 |
| commands | `CommandRuntime` `list`/`register`/`execute` | `packages/interaction/commands/src/index.ts:260,80,225` | per-agent `ScopedLayers`；TUI 自建 autocomplete |
| render intent | `ToolCallView`/`ToolResultView` `card` 联合体 | `packages/core/tools/src/presentation.ts:46,140` | cards：`generic`/`terminal`/`diff`/`read`/`search`/`web` |
| chunk 折叠 | `BlockAssembler` | `packages/llm/llm/src/assembler.ts` | 把 `assistant/chunk` delta 折成可见文本 |
| todos/plan 投影 | `Session.surface` / `todo/write` | `packages/core/session/src/surface.ts:427`；`types.ts:299` | `plan` 经 `planSurfaceEvent`（`surface.ts:321`） |
| BFF SSE mux（远程） | `session/event` + `approval/requested` + `question/requested` + `POST /api/respond` | `packages/host/apiproxy/src/api/events.ts:70,72,74`；`api-proxy.ts:3633-3678` | host 算好的 `ToolEventView` 挂在 `view` slot |
| stdin | `setRawMode(true)` + keypress |（新增）| Phase 0 用 `readline` `terminal:false`；raw-mode 是新代码 |

### 移植源文件（纯逻辑、绑 React → 剥离绑定）

| 模块 | 行数 | 移植任务 |
|---|---|---|
| `packages/client/ui-primitives/src/ansi.ts` | 447 | 剥 `CSSProperties`；emit 终端渲染器可消费的 ANSI 样式 span |
| `.../markdown/incremental.ts` | 130 | O(1)/chunk 块解析器——原样移植（无 React 绑定） |
| `.../markdown/parse.ts` | 44 | GFM+math 文法 |
| `.../markdown/plain-text.ts` | 121 | 纯文本抽取 |

### 渲染栈决策

选 `@earendil-works/pi-tui`（前任 TUI 的渲染器，npm `0.84.2`）作为终端渲染栈首选——有先例，40 个归档 `terminal.expected.txt` 快照是重建的逐像素验收标准。这是 Phase 2 评估项，非 Phase 1 承诺：Phase 1 用原始 `process.stdout.write`（同 Phase 0）落地交互 seam，渲染栈在 Phase 2 落地。

### 包布局（Phase 1+）

```
packages/bundle/tui/
  package.json          # @deepseek-ai/dsh-tui, bin: dsh-tui
  tsconfig.json         # extends tsconfig.base.json, rootDir src, outDir lib/types
  src/
    index.ts            # name/inject/Config/apply — the Cordis function plugin
    invariant.ts        # package-owned invariant companion
    startup.ts          # boot/resolve-config/stdin-attach/dispose lifecycle
    runner.ts           # create agent + installModelSelection + subscribe + drive turn loop
    answerers.ts        # approval/request answerer + userQuestions.registerProvider
    render/             # terminal render layer (Phase 2)
      ansi.ts           # ported from ui-primitives
      markdown.ts       # ported incremental parser
      cards.ts          # dispatch on presentation.ts card union
      projections.ts    # todos/plan sidebar
    transport/          # Phase 2 remote adapter
      event-source.ts   # EventSourceTransport → BFF SSE
      session-event.ts  # unify EventSource/in-process into one SessionEvent stream
  cordis.yml            # the bin's own composition (mirrors tui-demo)
  cordis.snapshot.yml   # keyless llm-replay
  README.md / README.zh.md
```

### 开发计划（分阶段）

**Phase 0 —— 原型（已完成，已验证）。** `packages/examples/tui-demo/` standalone bin，keyless，`session/event` → `process.stdout.write`。修了两个 bug（boot 前读 stdin、`rl.close` 竞态）。在 `phase0/tui-prototype` 分支。

**Phase 1 —— 产品 TUI bundle，in-process（下一个交付物）。**
1. 创建 `packages/bundle/tui/`，镜像 `dsh-headless` 布局（`index.ts`/`invariant.ts`/`startup.ts`）。
2. `runner.ts`：`ctx.agents.create` + `installModelSelection(agentCtx, { current: defaultModel.currentSelection(), assembled: undefined })`（抄 `headless/src/index.ts:106-119` 与 `tui-demo/src/runner.ts:104-112`）。
3. `answerers.ts`：注册 `ctx.on('approval/request', ...)` 读 stdin 按键（y/n）并 `next()`；注册 `ctx.userQuestions.registerProvider({ ask })` 渲染问题并 resolve。镜像 `api-proxy.ts:1338-1391`。
4. REPL 循环：`agent.followup` → `whenIdle` → 读下一行 stdin → 重复（Phase 0 是单轮；这里加循环）。
5. raw-mode stdin：`process.stdin.setRawMode(true)` + keypress；非 TTY 时回退行模式。
6. **不**注册 `PROFILE_TEMPLATES`；作 standalone bin + overlay 发版（分析 §14）。
7. README 双语对 + `Known Limitations and Deferred Work` + `SENTENCE_MODEL_EXPERIENCE` allowlist 条目 + `config-catalog` 重生成。
- **退出标准：** bin keyless 跑（`DSH_SNAPSHOT=replay`），驱动多轮对话，从 stdin 答审批与 ask-user 提示，`SIGTERM`/`SIGINT`/EOF 干净退出。一个 boot `cordis.yml` 经 Loader 的 REAL-composition 测试（依 `packages/CLAUDE.md` 测试规则）。

**Phase 2 —— 渲染层 + BFF SSE transport。**
1. 加 `@earendil-works/pi-tui`；对账 `TUI`→`TuiMainScreen` API 漂移 vs `0.84.2`。
2. 移植 `ansi.ts` + `markdown/incremental.ts`（剥 React 绑定）。
3. `cards.ts`：按 `card` discriminant 分派（`generic`/`terminal`/`diff`/`read`/`search`/`web`）。
4. `projections.ts`：从 `Session.surface` 渲染 `todos` + `plan`。
5. `transport/event-source.ts`：`EventSource` → BFF `session/event`/`approval/requested`/`question/requested`；`POST /api/respond` 回答。经 `transport/session-event.ts` 与 in-process 归一。
6. 经 `dsh-mcp-client` 接 `memory.recall` → `ai-mcp-adapter`（M3 partial）——唯一 SF 接触点，out-of-tree 配置。
- **退出标准：** 40 个归档 `terminal.expected.txt` 逐像素快照对新渲染层通过（分析 §11.2 的确定验收标准）。远程瘦 client 连一个跑着的 BFF 并经 SSE 答一次审批。

**Phase 3 —— 交互深化 + 采集。**
1. Code Mode sub-call 渲染（`tool/code-dispatch-*`）。
2. spill file / 退出码 / cwd 解析（TUI owns 的会话上下文职责，分析 §6.5）。
3. `--resume` 从 JSONL 重建。
4. SessionEnd → `sf memory capture`（M2 partial）；复用 ai-cli 的脱敏/队列/重放，不重写。
5. 双 transport 可换 adapter（`EventSourceTransport` vs `JsonRpcTransport` 归一）。
- **退出标准：** `--resume <id>` 重建 transcript；SessionEnd 触发 dry-run 采集；任何 phase 不改 `agent-loop`。

## 验收标准

- **不改 core。** 任何 phase 不改 `packages/core/*` 下任何文件；`PROFILE_TEMPLATES`（`packages/boot/app-boot/src/profile.ts:121`）不加 `tui` 行。未来不可避免的 core 改动进 `cordis.patch.yml` patch 栈，非 in-tree 编辑（分析 §14）。
- **Phase 1 门：** `pnpm run verify-package-paths`、`verify-package-readme-limitations`、`verify-package-readme-model-experience`、`gen-config-catalog --check`、`verify-agent-note-format`、`verify-translation-pairing` 全绿；一个 keyless REAL-composition 测试通过（`DSH_SNAPSHOT=replay`）。
- **Phase 2 门：** 40 个归档快照通过；`doc-typecheck` 绿；远程瘦 client 经 BFF SSE 答一次审批。
- **Phase 3 门：** `--resume` 重建冷会话；SessionEnd 采集是 dry-run，用户确认前只记日志不写。
- **上游跟随：** 新代码全在 `packages/bundle/tui/`（新文件，零冲突）；`tui` profile 经 per-user `$DSH_HOME/cordis.patch.yml` overlay 激活，非 in-tree。

## 风险

1. **pi-tui API 漂移。** 前任 TUI 用 `0.80.7`；当前 `0.84.2` 把 `TUI` 改名 `TuiMainScreen`。Phase 2 承诺前必须对账；若漂移过大，回退纯 Node 渲染器（分析 note 把此作为被否备选留口）。
2. **stdin raw-mode 竞态。** Phase 0 修了两个 stdin bug；raw-mode keypress 增新竞态（终端 resize、bracketed paste、信号投递）。缓解：非 TTY 时保留 `terminal:false` readline 回退路径；仅 `process.stdin.isTTY` 时 raw-mode。
3. **warp 审批门控。** `SharedSessionWriteToLongRunningCommands` 可能把阻塞式审批 readline 判为 long-running，gate viewer 输入。需在 live warp 会话实测；若被 gate，answerer 改非阻塞（分析 §8）。
4. **记忆双权威。** dsh 只作 `ai-cli` + recall consumer；治理闭环归 SF 四仓。任何采集必须复用 `sf memory capture`，不绕过 ai-cli 脱敏/幂等（ADR-MEM-001，分析 §9.2）。
5. **BFF 审批 wire 是单一实现 seam。** TUI 远程 answerer 镜像 `api-proxy.ts:1391`；若 BFF 改了该 wire，TUI adapter 漂移。缓解：把 adapter 钉在 mux frame 契约（`events.ts:70-75`），不钉实现。
6. **pre-release stance。** 无外部消费者；优先正确 foundation 而非兼容 shim（`CLAUDE.md`）。Phase 1 可发原始 stdout 并延后渲染栈，不阻塞。

## 备选方案

所有主要备选已在 [分析 note](2026-08-18-tui-terminal-product-analysis.md) 决定，**不**在此重议；本计划继承：

- **远程 transport：** BFF SSE 已选，SDK JSON-RPC 延后（分析 §10——SDK 审批系 "dead capability"）。不再重开。
- **前任 TUI 恢复：** 以规格重建，不机械恢复（分析 §11.5——`installAgentLlmTarget` 已从 core 删）。不再重开。
- **上游跟随：** 加法优先 + overlay 优先 + patch 兜底（分析 §14）。不再重开。
- **渲染栈：** pi-tui 首选（有先例），纯 Node 回退——这是唯一开放决策，Phase 2 评估。

本计划唯一引入的决策是 **分阶段**：Phase 1 先在原始 stdout 上落地交互 seam，渲染栈在 Phase 2 落地。备选——先渲染栈再 seam——会把验证审批/ask-user 闭环（产品级硬需求）推到有已知验收标准（40 快照）且可独立度量的渲染工作之后。

## Confirmation Or Next Step

- **confirmationRequired：** true——这是方案草稿。在 `sf-plan` 产出带精确文件清单与测试用例的任务拆解前，请确认：(a) 分阶段（seam 先于渲染），(b) Phase 1 作为 `phase0/tui-prototype` 上的下一个交付物，(c) pi-tui 延后到 Phase 2 评估。
- **recommendedNextSkill：** `sf-plan`（任务拆解、每任务验收标准、测试计划）→ 计划确认后 `sf-prompt`。
- **blockedReason：** 方案阶段无阻塞；分析 note 已解决全部阻断决策。
