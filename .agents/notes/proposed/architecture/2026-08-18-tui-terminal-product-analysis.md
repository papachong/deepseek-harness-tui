# TUI 终端形态产品改造技术分析

> 状态：提案（proposed）。目标：将 deepseek-harness 改造为类似 Claude Code CLI 的 TUI 终端产品。本报告基于对 `packages/` 源码、`/data/AI_Dev/warp`、`/data/AI_Dev/sf/ai-hub`、SF 记忆方案的源码级调查，结论附 `file:line` 引用。合并前需按 [dsh-doc-standards](.agents/skills/dsh-doc-standards/SKILL.md) 做双语与预算处理。
>
> 修订记录（2026-08-18）：纳入 warp session-share 调查、SF 松耦合约束、保留独立远程开发能力约束、记忆方案分阶段接入、upstream 跟随策略、Phase 0 原型验证结果。

## 1. 核心结论

deepseek-harness 当前是**纯 headless / automation / web 驱动**的产品，**仓库内不存在任何 TUI 代码**（全仓 `package.json` 搜 `ink`/`blessed`/`inquirer`/`prompts`/`terminal-kit` 零命中）。但架构已为 TUI 留好接入点：

- **launcher 已预留 `tui` profile**：`apps/cli/reference/README.md:46-48` 把 `dsh --profile tui --resume <id>` 列为未来 surface，`apps/cli/src/args.ts:10` 注释明确"第一个不识别的 token 之后属于被启动 app"，但 `packages/boot/app-boot/src/profile.ts:121` 的 `PROFILE_TEMPLATES` 只有 `web`/`headless`。接入点已就绪，只差一个 bundle。
- **spine 是事件溯源的**：agent-loop 把每个事实（token delta、tool call、approval）写入 `SessionEventMap`（`packages/core/session/src/types.ts:236`），UI 是观察者。"model-visible ⟺ logged" 不变量（`docs/architecture.md:96`）保证 TUI 可从 live 流或 JSONL 日志完整重建 transcript。
- **render intent 已是纯数据**：`packages/core/tools/src/presentation.ts` 的 `card` 标签联合体 provider 中立、replay-safe、discriminated，TUI 直接消费。
- **MCP client 已存在**：`packages/mcp/mcp-client`（`@modelcontextprotocol/sdk` ^1.12.0）连外部 MCP server 并把 tools 注册到 `ctx.tools`——松耦合接 SF 的现成基础。
- **Phase 0 已验证**：`packages/examples/tui-demo/`（`@deepseek-ai/dsh-tui-demo`）standalone bin，keyless via llm-replay，实测 `verified: true`——in-process `session/event` → 终端渲染管道跑通（流式 token + tool call/result 行）。

**改造性质 = 补一个 bundle + 终端渲染层 + 可选远程 client transport，不动 `agent-loop`**（遵守 `CLAUDE.md` "Plugins, not loop changes"）。

## 2. 形态目标：三模式并存（类比 Claude Code）

约束：dsh TUI 与 warp/SF **松耦合**（类比 CC ↔ warp/SF，靠 CLAUDE.md/MCP/CLI/Agent/Skills/Rules/hook 关联），且**保留独立远程开发能力**（脱离 warp/SF 仍可本地或 webUI 式与服务端交互）。

| 模式 | agent 跑在哪 | TUI 角色 | 脱离 warp/SF | 远程 | 协作来源 |
|---|---|---|---|---|---|
| **本地 in-process** `dsh-tui-demo`（Phase 0 已验证）/ `dsh --profile tui` | 本地 | 本地 agent + 本地 TUI | ✅ | 本地 | — |
| **远程瘦 client** `dsh --profile tui --remote <url>` | 服务端 | HTTP/SSE client 连 dsh Web BFF | ✅ | ✅ | — |
| **warp 内** TUI 跑在 warp | 本地 | 本地 agent，终端字节流共享 | 依赖 warp | 本地+共享 | warp session share |

**关键**：约束 2 要的"保留服务端"= 保留 dsh 自己的 Web BFF（`packages/bundle/web-app` 的 `dsh-host-apiproxy`）并让 TUI 当它的 client，**不新建服务端**。BFF 已逐字转发 `session/event` + `approval/requested` + `question/requested`（浏览器是它的现成 client）。

## 3. 现状：三面墙，无一 TTY

| Surface | 传输 | 形态 | file:line |
|---|---|---|---|
| Headless 一次性 | in-process | 取最后非空 assistant 文本写 stdout，exit 0/1，无流式 | `packages/bundle/headless/src/index.ts:129-133` |
| Web 浏览器 | HTTP/SSE | React 18 app，完整事件回放 | `packages/bundle/web-app/src/index.ts`；`packages/client/web-react/package.json:31` |
| ACP stdio | JSON-RPC stdio | automation-only，剥离 live progress/reasoning/tool/plan/title | `packages/acp/acp/README.md:7,78,80` |
| JSON-RPC SDK | stdio JSON-RPC | 逐字转发 `session.event`，3 请求 + 4 通知 | `packages/sdk/server/src/server.ts:53-240` |

证据：全仓搜 `createInterface`/`setRawMode`/`isTTY`/`readline`/`process.stdin.on('data'|'keypress')` 在生产路径零命中——唯一 `process.stdin` 用法是 `packages/examples/acp-demo/src/bin.ts:31` 与 `packages/examples/jsonrpc-demo/src/runner.ts:51` 的 `on('end')`（EOF 驱动协议服务器，非按键）。TUI 的 stdin raw-mode 读取是**全新代码**（Phase 0 已验证可行性）。

## 4. 传输层选型

| 候选 | 评价 | 结论 |
|---|---|---|
| **in-process `ctx.agents`**（本地模式） | 直接拿 `approval/request`/`user-questions` seam，零协议开销 | 本地模式用（Phase 0 已验证） |
| **dsh Web BFF HTTP/SSE**（远程模式） | 逐字转发 `session/event`，`approval/requested`/`question/requested` 已在 wire，TUI 回 `POST /api/respond` | **远程模式已定**（见 §10） |
| JSON-RPC SDK server（远程模式） | 逐字转发 `session.event`，但 approval 的 server→client request **未实现**（"dead capability"） | 延后（见 §10） |
| ACP | automation-only，剥离 live progress，fresh-session-only | 不选（`README.md:7,78,80`） |
| Remote BFF / Typert | 远程多租户，Typert 是类型图注册非 client transport | 不选 |

## 5. 核心 spine：TUI 要包裹的最小程序面

### 5.1 类型 spine

- `Agent` 接口 — `packages/core/agent/src/runtime-types.ts:64-144`：`id`、`options`、`session`、`inbox`、`status`、`followup`、`steer`、`inject`、`cancel`、`whenIdle`。
- `AgentLoop` — `packages/core/agent-loop/src/index.ts:296`，`static inject = ['agents','sessions','llm','tools','systemPrompt']`。
- `AgentRegistry.create(options)` — `packages/core/agent/src/index.ts:405`。
- `Session.append(type, data, ...opts)` — `packages/core/session/src/index.ts:604`，唯一合法事件写入点。
- `SessionEventMap` — `packages/core/session/src/types.ts:236-335`（merge-extensible）。

### 5.2 一轮 turn 的执行轨迹

`ReactLoopAgent`（`packages/core/agent-loop/src/agent.ts:64`）：`ctx.agents.create` → `agent.followup(msg)` → `wakeDriver` → `kick()`（`:210`，`while(await this.turn())`）→ `turn()`（`:246`，`turn/start`）→ 每 step：`preStep`（`:225`，claim inbox、assemble system prompt、`agent/pre-step` waterfall）→ `buildRequest`（`:407`，frozen config）→ `step()`（`:332`，`llm.stream` → 逐 chunk append `assistant/chunk`，`BlockAssembler` 折叠，`finish` append `assistant/message`）→ `executeToolCalls`（`packages/core/agent-loop/src/tool-calls.ts:59`，append `tool/call`+`tool/result`）→ `step/end` → `agent/turn-stopping` 可 `steer` → `turn/end`。`kick` 退出 → `agent/status{idle}` → `whenIdle()` resolve。参考 caller `packages/bundle/headless/src/index.ts:111-134`；Phase 0 `packages/examples/tui-demo/src/runner.ts` 已复用此流程。

### 5.3 事件火带（TUI 渲染源）

`session/event`（`packages/core/session/src/index.ts:641-647`）逐字携带每个 `SessionEvent`：

| event.type | 用途 | file:line |
|---|---|---|
| `assistant/chunk` | token 级流式（`text-delta`/`reasoning-delta`/`tool-call-delta`/`usage`/`finish`） | `types.ts:266`；`packages/llm/llm/src/types.ts:312-330` |
| `assistant/message` | 折叠后完整 assistant 消息 + usage | `types.ts:273` |
| `tool/call` / `tool/result` | 工具调用/结果（`meta` 携带可重放投影） | `types.ts:279,291-297` |
| `todo/write` | todo 全量快照（last-write-wins） | `types.ts:299` |
| `turn/start\|end` / `step/start\|end` | 结构边界 | `types.ts:243-256` |
| `approval/asked\|decided\|policy` | 审计（log-only，不进 model transcript） | `packages/interaction/user-approval/src/index.ts:34-73` |
| `agent/inbox/spliced` | inbox 变更（steering 来源） | `packages/core/agent/src/types.ts:19` |

`assistant/chunk` 是原始 token delta，逐字持久化——TUI 流式渲染与日志重放走同一路径。Phase 0 已实测：`BlockAssembler`（`packages/llm/llm/src/assembler.ts`）折叠 chunk 为可见文本，`tool/call`+`tool/result` 渲染为 `[tool/call]`/`[tool/result]` 行。

## 6. 渲染层：差距与复用

### 6.1 现有渲染原语全是 React/DOM

`packages/client/ui-primitives/package.json:29-50`：`anser`（ANSI SGR 解析）、`shiki`（同步语法高亮）、`mdast-util-*`（GFM+math）、`katex`、`react`/`react-dom`。

### 6.2 高价值复用候选（纯逻辑可移植）

| 模块 | 价值 | file:line |
|---|---|---|
| `ansi.ts` | 完整 ANSI SGR 解析 + 光标移动回放 + 宽字符 + 主题 token 映射 | `packages/client/ui-primitives/src/ansi.ts:1-447` |
| `markdown/incremental.ts` | 流式 append-only markdown 解析，O(1)/chunk | `packages/client/ui-primitives/src/markdown/incremental.ts` |
| `markdown/parse.ts` | GFM+math 两条文法 | 同目录 |
| `markdown/plain-text.ts` | 纯文本抽取 | 同目录 |

### 6.3 Gap vs Claude Code TUI

| Claude Code TUI 能力 | dsh 现状 | 改造 |
|---|---|---|
| 流式 markdown | `IncrementalMarkdownParser` 存在但绑 React | 绑终端 markdown 渲染器 |
| 工具审批卡片 | `ApprovalService` seam-only，fail-closed | TUI 注册 answerer |
| todo 面板 | `todo/write` projection 存在 | 读 `sessionProjections` 的 `todos` key，终端侧栏 |
| plan 模式 | `plan` projection + `exit_plan_mode` + `plan-review` intent | 消费 `plan` projection + 特殊渲染 intent |
| diff 视图 | `DiffBlock.tsx` React，`DiffHunk` 纯数据 | 终端 diff 渲染器（greenfield） |
| slash-commands | `CommandRuntime` 可扩展，已注册 `/permission` `/compact` `/plan` `/goal` `/feedback` `/export-log` | 自建 autocomplete over `list(agent)` |
| 键盘输入 | 零 TTY 代码 | `setRawMode` + readline/keypress（Phase 0 已验证 stdin 路径） |

### 6.4 render intent 已是纯数据契约

`packages/core/tools/src/presentation.ts`：`ToolCallView`（`:46`）/ `ToolResultView`（`:140`）。`ToolDefinition` 钩子 `presentCall?`/`presentResult?`（`packages/core/tools/src/index.ts:271-287`）是**纯函数**（`docs/cookbook/adding-a-tool.md:84-88`）。TUI 按 `card` discriminant 分派。

各工具 render intent：bash→`terminal`、write/edit→`diff`、read→`read`、grep/glob→`search`、web→`web`、exit_plan_mode→`generic`(plan)、todo_write→projection（非 card）。todo/plan-mode 是 session projection（`todos`/`plan`），通过 `sessionProjections` 消费。

### 6.5 TUI owns 的会话上下文职责

`TerminalCallView.cwd` 相对路径解析（`presentation.ts:96-99`）、`ReadResultView.path` 相对化（`:285`）、bash 退出码解析（`packages/shell/tool-bash/src/render.ts:103`）、spill file（`tool-bash/src/index.ts:166-181`）。

## 7. 交互闭环：审批 / ask-user / commands

### 7.1 审批（fail-closed，必须 TUI 注册 answerer）

`ApprovalService`（`packages/interaction/user-approval/src/index.ts:192`），`ApprovalPolicy='ask'|'never'`（`:94`），无 answerer 返回 `'unavailable'`（`:309-329`）。`ApprovalOutcome='allowed-once'|'rejected'|'cancelled'|'unavailable'`（`types.ts:29`）。answerer 是 `approval/request` waterfall listener，**必须调 `next()`**。唯一 production answerer = Web BFF（`api-proxy.ts:1391-1450`）。TUI 必须注册 answerer。参考 `api-proxy.ts:1391-1450` 与 `acp/src/index.ts:271-289`。

### 7.2 ask-user（provider-only）

`UserQuestionService`（`packages/interaction/user-questions/src/index.ts:38`），`registerProvider`（`:64`），无 provider 抛 `NO_PROVIDER`。`intent:'plan-review'`（`types.ts:23-32`）。TUI 必须 `registerProvider`，`plan-review` 特殊渲染。

### 7.3 slash-commands（可扩展）

`CommandRuntime`（`packages/interaction/commands/src/index.ts:225`），per-agent `ScopedLayers`。`register`（`:245`）、`execute`（`:297`）、`list`（`:260`）。TUI 自建 autocomplete。

### 7.4 terminal 包（不是 TUI host）

`packages/terminal/` 是 agent 驱动持久 PTY 的 capability（`terminal/src/index.ts:105`），per-agent、带审计、sandbox-fence。给的是 pty 不是画布。TUI 复用：消费 pty 输出流（如 Web client `bash-sample.tsx` 那样但用终端渲染器），或注册新 `TerminalBackend`。

## 8. warp session-share：实时协作层（外部能力，不耦合）

调查 `/data/AI_Dev/warp` + `/data/AI_Dev/sf/ai-hub` 结论：

- **终端流级共享（tmux 式）**：PTY 字节是渲染输出真相源，经服务端中继（ai-hub Socket.IO，生产 `wss://sessions.app.warp.dev`，OSS 补丁 0001/0006 改指向 ai-hub）。
- **viewer 可输入**：`WriteToPty` 字节逐字落到 sharer 的 PTY master fd，调用链追到 `local_tty/event_loop.rs:289 self.pty.writer().write(bytes)`——与本地按键同一路径。门控：`SharedSessionWriteToLongRunningCommands` + long-running block + Executor 角色。
- **在 warp 里跑 CC/dsh**：共享的是 TUI 的**终端渲染字节 + 按键流**，不是 app 级结构化共享。
- **混合模型**：PTY 字节 = 渲染真相；上层叠 app 级边带事件（`CommandExecutionStarted/Finished` 带 `participant_id`+AI metadata、`AgentResponseEvent`、CRDT `InputUpdate`、初始化 `Scrollback`）。

**对 dsh TUI 的影响**：
- **不写协作代码**：dsh TUI 跑在 warp 里白拿终端流共享 + 审批协作（审批 answerer 读 stdin 按键，warp 把 viewer 按键逐字写同一 PTY stdin → viewer 可直接回答审批卡）。
- **绕开 SDK approval 缺口**：warp 模式下审批走 PTY stdin，不经 SDK wire。
- **门控风险**：warp viewer 写入 gated on `SharedSessionWriteToLongRunningCommands` + long-running block。dsh 阻塞式审批 readline 是否被判为 long-running 需实测——若不行，answerer 要改非阻塞或显式长时运行标记。
- **历史线索**：`DiffBlock.tsx:1-9` 注释"Unlike the TUI's exact changed-row comparison"暗示仓库曾存在 TUI 参照点，查 git 历史可复用其设计决策。

**warp 与需求 #1（多 session 语义透明）是两个问题**：warp = 实时同看一个 session；需求 #1 = N 个 session 各跑各 AI 的跨 session/跨时间语义透明。前者 warp 解决，后者 SF 平台 + 记忆解决。

## 9. SF 松耦合与记忆分阶段接入

### 9.1 松耦合四件套（类比 CC ↔ warp/SF）

| 关联面 | CC 做法 | dsh TUI 等价 | dsh 现状 |
|---|---|---|---|
| MCP | CC 连 MCP server 拿外部工具 | `dsh-mcp-client` 连 SF `ai-mcp-adapter`（`memory.recall/get/feedback`） | **已有** `packages/mcp/mcp-client` |
| CLI | CC 调外部 CLI | SessionEnd 生命周期事件 → 调 `sf memory capture`（dsh 当 ai-cli 角色） | 需在 tui-runner 加采集钩子 |
| CLAUDE.md/AGENTS.md | 项目级强规则 | `workspaceContext`（AGENTS.md loader，agent-spine-demo 已挂） | **已有** |
| Skills/Rules/hooks | CC 原生 | `dsh-skill` + `packages/hooks/`（hooks-claude-code 桥读 CC hooks.json） | **已有** |

松耦合成立：dsh 对 SF 的全部依赖收敛到「一个 MCP server 配置 + 一条 CLI 调用 + 项目级 AGENTS.md」，拔掉仍独立可跑。

### 9.2 记忆方案分阶段接入（不建双权威）

记忆方案（`/data/AI_Dev/sf/ai-docs/productionDesign/多人AI协作开发大模型记忆管理技术方案.md`）**直接命中**需求 #1"AI 有充分上下文、更少冲突"。但：
- 完整治理闭环（Evidence→Candidate→Version→Review→Revoke→Policy + Gateway L3/L4 + 黄金语料评测）是 SF 四仓 `ai-core`/`ai-mcp-adapter`/`ai-tool-gateway`/`ai-cli` 大工程，方案 §13 自己分 M0-M5。
- dsh TUI 是 harness，不是 SF 控制平面；记忆权威在 ai-core，dsh 不该自建第二权威（ADR-MEM-001 + 不变量 6 fail-closed）。

**dsh 扮演 = 记忆方案里的 `ai-cli`（薄采集适配器）+ 一个 recall consumer**，不是 `ai-core`。分阶段：

| TUI Phase | 记忆接入 | 对应方案 milestone |
|---|---|---|
| Phase 0-1（TUI 本体） | 无记忆接入，先跑通单机 TUI | — |
| Phase 2（渲染层） | 接入 `memory.recall` 作为 in-process tool（经 `dsh-mcp-client` 连 `ai-mcp-adapter`），让 TUI 内 AI 召回跨人跨 session 历史 | M3 partial |
| Phase 3（交互深化） | SessionEnd 触发 Evidence 采集：dsh session-lifecycle 事件 → 复用 `sf memory capture`（不重写采集/脱敏/队列/重放，复用 ai-cli 已修好的 §8.3.1） | M2 partial |
| 后续（单独决策） | 完整治理闭环由 SF 四仓推进，dsh 只消费 | M4-M5 |

## 10. 远程模式 transport 调查结论（BFF SSE，已定）

针对约束 2"保留独立远程开发能力"，TUI 远程瘦 client 的 transport **已定为 BFF SSE**。源码级逐项验证（`packages/host/apiproxy/src/api/events.ts`、`api-proxy.ts`、`fetch/handler.ts`、`api-request-trust.ts`、`packages/sdk/protocol/`、`packages/sdk/server/`、`packages/sdk/client/`）。

### 10.1 判定矩阵（每格 file:line）

| 维度 | BFF (A) 已选 | SDK (B) 延后 |
|---|---|---|
| drive turn | `POST /api/session.prompt`（`fetch/handler.ts:99`，`api-proxy.ts:2401-2457`） | `session/prompt`（`types.ts:34-45`，`server.ts:190-201`） |
| 流式 token | `session/event` 逐字 `SessionEvent`（`events.ts:70`） | `session.event`（`types.ts:51-56`，`server.ts:71-74`） |
| tool call/result | `session/event` + host 算好的 `view`（`api-proxy.ts:713-749`） | 仅 `session.event`，无 `view` |
| todo | `session/projection`（`events.ts:107`）+ `session/queue`（`:84`） | 无专用 frame（`types.ts:92-98`） |
| approval 请求 | ✅ `approval/requested`（`events.ts:72`，`api-proxy.ts:3384`） | ❌ dead capability |
| approval 回答 | ✅ `POST /api/respond`（`api-proxy.ts:3633-3647`），`ApprovalResponsePayload`（`approvals.ts:17-21`） | ❌ 无 `onRequest`（`client.ts:257-260`） |
| ask-user | ✅ `question/requested`+`POST /api/respond`（`api-proxy.ts:3648-3678`），`QuestionResponsePayload`（`questions.ts:16-19`） | ❌ 同 approval 缺口 |
| host 算 render intent | ✅ `viewFor`（`api-proxy.ts:713-749`），`ToolEventView`（`events.ts:24-35`）挂 `session/event` 的 `view` slot | ❌ 协议无 `ToolEventView`（`types.ts:92-105`） |
| resume/list | ✅ `session.list`（`sessions.ts:233`）+ `session.history`（`:282`，带 `view` 的 `HistoryEntry`） | ❌ switch 无 list/history/resume case |
| 非 browser auth | Host-header fence，loopback 免凭据（`api-request-trust.ts:96-123`） | stdio spawn，无 auth |
| 现成 consumer | 浏览器 WS client（`client/connection/src/index.ts:174-194`） | `HarnessClient`（`client.ts:184`） |

### 10.2 决定性理由

**approval + ask-user 在 BFF 今天就闭环，SDK 是 "dead capability"。** 这是产品级硬需求，不能等。

- BFF mux 流（`events.ts:69-108`）已携带 `approval/requested`/`resolved`（`:72-73`）、`question/requested`/`resolved`（`:74-75`），同走 `POST /api/respond`（`fetch/handler.ts:296-300`）。
- SDK 缺口不是"待启用"而是"不存在"：server 只 `transport.notify` 从不 `request`（`server.ts:73-102`）；`FakeTransport` **断言**服务端永不 `request`（`server.spec.ts:19-29`）；client 只装 `onNotification`（`client.ts:257-260`）；`protocol/README.md:39` 明文 "dead capability"。补 SDK 需动 3 包（protocol types + server emit site + client onRequest）+ 翻 `FakeTransport` 断言 + 重写 `viewFor`，违反最小新代码。

### 10.3 BFF 的额外红利：host-computed ToolEventView

`viewFor(...)`（`api-proxy.ts:713-749`）服务端算好 `ToolEventView`（`events.ts:24-35`）挂 `session/event` 的 `view` 字段（`api-proxy.ts:3425-3430`）。**TUI 直接消费 host 算好的 render intent，跳过自调 `presentCall/presentResult`**——匹配"webUI 式与服务端交互"：TUI 是浏览器那层的瘦 view。SDK 无此类型。

### 10.4 待定项已决

- **Phase 2 只做 BFF，SDK 延后**（用户 2026-08-18 确认）。SDK 作为后续自动化/headless 场景的可选 transport，待其补 approval wire 再接入。
- 保留双 transport adapter 架构（`EventSourceTransport` vs `JsonRpcTransport` 归一成统一 `SessionEvent` 流喂同一渲染层），后续接 SDK 时平滑切。

### 10.5 三模式的 transport 落地

| 模式 | transport | 事件源 |
|---|---|---|
| 本地 in-process | 直连 `ctx.on('session/event')` | in-process 事件火带（Phase 0 已验证） |
| 远程瘦 client | BFF SSE（`EventSource` + `POST /api/respond`） | HTTP/SSE + host-computed `view` |
| warp 内 | 终端字节流（无 transport） | PTY 字节 + `BlockAssembler` |

## 11. Phase 0 原型验证结果（已验证）

`packages/examples/tui-demo/`（`@deepseek-ai/dsh-tui-demo`，分支 `phase0/tui-prototype`）已实现并 keyless 跑通：

- **8 文件**：`package.json`、`tsconfig.json`、`src/{index,invariant,bin,runner}.ts`、`cordis.yml`、`cordis.snapshot.yml`。
- **verified: true**：in-process `ctx.on('session/event')` + `ctx.on('agent/status')` 订阅 → 终端渲染管道跑通。
- **实测输出**（bash-tool fixture）：
  ```
  task> [agent:running]
  [tokens: in=123 out=89]
  [tool/call] bash({"command":"echo dsh-sdk-proof-7391",...})
  [tool/result] [ok] dsh-sdk-sdk-proof-7391
  dsh-sdk-proof-7391
  [turn/end] completed
  [agent:idle]
  ```
  text-turn fixture 纯流式也渲染成功。
- **keyless**：`DSH_SNAPSHOT=replay` + `cordis.snapshot.yml`（llm-replay + committed fixture），不需 `DEEPSEEK_API_KEY`。
- **修复了两个真实 bug**（原型验证价值）：(1) stdin 须在 `boot()` 前读以缓冲（piped stdin 立即关闭 write end，readline 后附会丢行）；(2) `rl.close()` 不能在 line handler 内调（同步 close 事件下 tick 覆盖 line 的 `resolve(l)`，须 close 在 promise resolve 后）。
- **复现**：`node --import tsx/esm packages/examples/tui-demo/src/bin.ts`（需 Node v22+，`fnm use 22`）。

**结论**：方案落地性已验证。事件流→终端渲染、keyless 运行、stdin 驱动 turn 三条路径均通。

## 12. 改造路线图

- **Phase 0 原型**（已验证）：`packages/examples/tui-demo/` standalone bin，keyless，证明事件流→渲染可行。
- **Phase 1 产品 TUI bundle**（in-process）：`packages/bundle/tui/`（镜像 `headless`/`web-app`）+ `tui-startup` + `tui-runner`。`ctx.agents.create` + `ctx.on('session/event')` + 注册 approval/ask-user answerer + `setRawMode` + `BlockAssembler` + `ctx.appExit`。**standalone bin + overlay，不注册 `PROFILE_TEMPLATES`**（见 §14）。
- **Phase 2 渲染层 + BFF SSE transport**：选型终端渲染栈（ink 复用 React 组件 vs 纯 Node 库）；移植 `ansi.ts`/`markdown/incremental.ts`；实现 8 个 card 组件 + todo/plan projection；写 `EventSourceTransport` adapter 连 BFF；slash-command autocomplete。经 `dsh-mcp-client` 接 `memory.recall`（M3 partial）。
- **Phase 3 交互深化 + 采集**：Code Mode sub-call 渲染（`tool/code-dispatch-*`）；spill file/退出码/cwd；`--resume` 从 JSONL 重建；SessionEnd 调 `sf memory capture`（M2 partial）。双 transport 可换 adapter。
- **后续**：完整记忆治理归 SF 四仓 M4-M5，dsh 只消费。

## 13. 关键接入 seam 汇总（file:line）

- 创建 agent：`AgentRegistry.create` — `packages/core/agent/src/index.ts:405`
- 驱动一轮：`agent.followup` — `packages/core/agent/src/runtime-types.ts:122`；steer `:126`；inject `:130`；cancel `:85`；whenIdle `:91`
- turn/step 机器：`ReactLoopAgent` — `packages/core/agent-loop/src/agent.ts:64`；kick `:210`；turn `:246`；step `:332`；buildRequest `:407`
- 工具派发：`executeToolCalls` — `packages/core/agent-loop/src/tool-calls.ts:59`
- 事件火带：`Session.append` — `packages/core/session/src/index.ts:604`；`session/event` `:641-647`
- 审批 seam：`ApprovalService` — `packages/interaction/user-approval/src/index.ts:192`；`approval/request` waterfall `:30,318`
- ask-user seam：`UserQuestionService` — `packages/interaction/user-questions/src/index.ts:38`；`registerProvider` `:64`
- LLM 流式：`LlmRuntime.stream` — `packages/llm/llm/src/index.ts:171`；`llm/stream` waterfall `:64,923`；`BlockAssembler` `packages/llm/llm/src/assembler.ts`
- MCP client：`packages/mcp/mcp-client/src/connection.ts` + `tools.ts`（注册 MCP tools 到 `ctx.tools`）
- BFF 事件订阅（远程 transport 参考）：`packages/host/apiproxy/src/api-proxy.ts:3412-3500`；approval `:1391-1450`；mux frame `packages/host/apiproxy/src/api/events.ts:69-108`
- SDK server（备选 transport 参考）：`packages/sdk/server/src/server.ts:71-103`
- launcher 接线：`provideCmdline` — `packages/boot/cmdline/src/index.ts:68`；`PROFILE_TEMPLATES` — `packages/boot/app-boot/src/profile.ts:121`；`runProfile` — `apps/cli/src/profile-boot.ts:207`
- Phase 0 参考：`packages/examples/tui-demo/src/runner.ts`（已验证）；`packages/examples/jsonrpc-demo/src/{bin,runner}.ts`；`packages/examples/agent-spine-demo/src/index.ts`

## 14. 上游跟随策略（fork 维护，关键约束）

deepseek-harness 是开源项目，终端化改造须**最小化对跟随 upstream 更新的影响**。按改造落点分三档：

| 落点 | upstream merge 影响 | in-process 能力 | 适用 |
|---|---|---|---|
| 纯加法新包（新目录，不改现有文件） | ✅ 几乎零冲突（新文件不与 upstream 冲突） | ✅ 保留 | TUI 代码主体 |
| `cordis.patch.yml` overlay（per-user `$DSH_HOME`，不入树） | ✅ 零冲突（不在仓库） | ✅ 保留 | profile 配置层 |
| 改 core 文件（如 `PROFILE_TEMPLATES` 加一行） | ⚠️ merge 冲突点 | ✅ | 能免则免 |
| out-of-tree 独立仓（消费 `@deepseek-ai/dsh-*` 为 npm dep） | ✅ 零 fork 分叉 | ❌ 丢 in-process seam | 仅纯外部组件 |

**核心张力**：in-process 本地模式（§5）要求在树内；树内改动要最小化上游冲突。

**推荐策略：加法优先 + overlay 优先 + patch 兜底**

1. **能加法就不改**：TUI 代码全放新包（`packages/examples/tui-demo/` Phase 0 → `packages/bundle/tui/` 产品级），全新文件，upstream merge 不冲突。
2. **能 overlay 就不注册**：TUI 做成 standalone bin（镜像 `jsonrpc-demo`，自己 `boot()` 自己 `cordis.yml`），**不**注册进 `PROFILE_TEMPLATES`（`packages/boot/app-boot/src/profile.ts:121`）——避免那行 in-tree 编辑，零核心改动。`dsh --profile tui` 的 launcher 集成降级为后续可选低优项，或经 per-user `$DSH_HOME/cordis.patch.yml`（不入树）实现。
3. **不可避免的 core 改动用 patch 兜底**：真到产品级必须改 core 时，照 `warp-patches` 模式维护 patch series + `sync-upstream.sh`（`/data/AI_Dev/sf/ai-hub/warp-patches/` 是活样本：fork OSS、补丁定制、sync 上游）。dsh 自带 `cordis.patch.yml` patch 栈 + `--patch` overlay 是原生等价物。

**对方案各 Phase 的约束**：
- Phase 0（原型）：standalone bin，纯加法新包——✅ 已对齐。
- Phase 1（产品 bundle）：`packages/bundle/tui/` 新包 + standalone bin，不注册 `PROFILE_TEMPLATES`；`tui` profile 经 overlay 激活。
- Phase 2-3：渲染层、transport adapter、采集钩子全在新包内；MCP 经 `dsh-mcp-client` 配置（不入树）；CLI 采集调 `sf memory capture`（外部，不入树）。
- 任何需改 core 的需求，先评估能否用 overlay/新包绕开；不能绕开才进 patch series。

## 15. 风险与决策点

1. **远程 transport 选型**：**已定 BFF SSE，Phase 2 只做 BFF，SDK 延后**。源码级验证：BFF mux 流已闭环 approval/ask-user（`approval/requested`/`question/requested` + `POST /api/respond`），SDK 是 "dead capability"（server 从不 `transport.request`，`FakeTransport` 断言锁死，client 无 `onRequest`）。保留双 transport adapter 架构，后续自动化场景再接 SDK。
2. **渲染栈选型**：ink（复用 React 组件，引入 React 运行时于终端）vs 纯 Node TUI 库（移植纯逻辑更轻但重写组件）。建议先 ink 原型最大化复用，稳定后评估去 React。
3. **warp 审批门控**：`SharedSessionWriteToLongRunningCommands` 是否覆盖 dsh 阻塞式审批 readline，需实测；不行则 answerer 改非阻塞。
4. **记忆双权威边界**：dsh 只做 `ai-cli` 角色 + recall consumer，治理闭环归 SF 四仓；任何采集必须复用 `sf memory capture`，不绕过 ai-cli 的脱敏/幂等/SDK child guard。
5. **Agent Note 合规**：合并需双语 + `verify-doc-budgets` + 配套 keyless snapshot（`CLAUDE.md` testing policy）。
6. **pre-release stance**（`CLAUDE.md`）：无外部消费者，优先正确 foundation 而非兼容 shim。

## 16. 一句话结论

**改造 = 新增 `packages/bundle/tui/` + 终端渲染层（复用 `ansi.ts`/`incremental markdown` 纯逻辑 + 直接消费 `presentation.ts` 纯数据 render intent）+ 注册 approval/ask-user/commands 的 in-process answerer + 可换的远程 transport adapter（BFF SSE，复用现有 Web BFF，不新建服务端）。** 不动 `agent-loop`。实时协作借 warp session-share（零代码），多 session 语义透明借 SF 平台 + 记忆方案（dsh 作 `ai-cli` 薄采集 + recall consumer，不双权威）。三模式并存（本地/远程/warp）共享同一渲染层，全程纯加法新包 + overlay 以最小化上游跟随冲突。最高风险项是 stdin raw-mode 读取与终端 markdown 渲染（全新代码），而非架构对接——Phase 0 已验证前者可行。
