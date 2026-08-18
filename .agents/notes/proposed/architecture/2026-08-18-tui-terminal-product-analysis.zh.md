# Agent Note: deepseek-harness 的终端产品形态（TUI）

Status: proposed

[English](2026-08-18-tui-terminal-product-analysis.md) | 中文

## 问题

deepseek-harness 当前交付三个 surface——headless 一次性、Web 浏览器 app、ACP/JSON-RPC 自动化——**没有一个 TUI**。全仓 `package.json` 搜 `ink`/`blessed`/`inquirer`/`prompts`/`terminal-kit` 零命中；搜 `createInterface`/`setRawMode`/`isTTY`/`readline`/`process.stdin.on('data'|'keypress')` 在生产路径零命中（唯一 `process.stdin` 用法是 `packages/examples/acp-demo/src/bin.ts:31` 与 `packages/examples/jsonrpc-demo/src/runner.ts:51`，均为 EOF 驱动协议服务器，非按键读取）。

但架构已为 TUI 留好接入点：

- **launcher 已预留 `tui` profile**：`apps/cli/reference/README.md:46-48` 把 `dsh --profile tui --resume <id>` 列为未来 surface，而 `packages/boot/app-boot/src/profile.ts:121`（`PROFILE_TEMPLATES`）当前只定义 `web`/`headless`。接入点已就绪，只差一个 bundle。
- **spine 是事件溯源的**：agent-loop 把每个事实（token delta、tool call、approval）写入 `SessionEventMap`（`packages/core/session/src/types.ts:236`），UI 是观察者。"model-visible ⟺ logged" 不变量（`docs/architecture.md:96`）保证 TUI 可从 live 流或 JSONL 日志完整重建 transcript。
- **render intent 已是纯数据**：`packages/core/tools/src/presentation.ts` 的 `card` 标签联合体 provider 中立、replay-safe、discriminated，TUI 直接消费。
- **MCP client 已存在**：`packages/mcp/mcp-client`（`@modelcontextprotocol/sdk` ^1.12.0）连外部 MCP server 并把 tools 注册到 `ctx.tools`——松耦合接外部记忆平台的现成基础。
- **Phase 0 已验证**：`packages/examples/tui-demo/`（`@deepseek-ai/dsh-tui-demo`）standalone bin，keyless via llm-replay，实测 `verified: true`——in-process `session/event` → 终端渲染管道跑通（流式 token + tool call/result 行）。

因此改造性质 = **补一个 bundle + 终端渲染层 + 可选远程 client transport，不动 `agent-loop`**（遵守 `CLAUDE.md` "Plugins, not loop changes"）。

## 提案

### 三模式并存（类比 Claude Code）

约束：dsh TUI 与 warp/SF **松耦合**（类比 CC ↔ warp/SF，靠 CLAUDE.md/MCP/CLI/Agent/Skills/Rules/hook 关联），且**保留独立远程开发能力**（脱离 warp/SF 仍可本地或 webUI 式与服务端交互）。

| 模式 | agent 跑在哪 | TUI 角色 | 脱离 warp/SF | 远程 | 协作来源 |
|---|---|---|---|---|---|
| **本地 in-process** `dsh-tui-demo`（Phase 0 已验证）/ `dsh --profile tui` | 本地 | 本地 agent + 本地 TUI | ✅ | 本地 | — |
| **远程瘦 client** `dsh --profile tui --remote <url>` | 服务端 | HTTP/SSE client 连 dsh Web BFF | ✅ | ✅ | — |
| **warp 内** TUI 跑在 warp | 本地 | 本地 agent，终端字节流共享 | 依赖 warp | 本地+共享 | warp session share |

约束 2 要的"保留服务端"= **保留 dsh 自己的 Web BFF**（`packages/bundle/web-app` 的 `dsh-host-apiproxy`）并让 TUI 当它的 client，**不新建服务端**。BFF 已逐字转发 `session/event` + `approval/requested` + `question/requested`（浏览器是它的现成 client）。

### 现状：三面墙，无一 TTY

| Surface | 传输 | 形态 | file:line |
|---|---|---|---|
| Headless 一次性 | in-process | 取最后非空 assistant 文本写 stdout，exit 0/1，无流式 | `packages/bundle/headless/src/index.ts:129-133` |
| Web 浏览器 | HTTP/SSE | React 18 app，完整事件回放 | `packages/bundle/web-app/src/index.ts`；`packages/client/web-react/package.json:31` |
| ACP stdio | JSON-RPC stdio | automation-only，剥离 live progress/reasoning/tool/plan/title | `packages/acp/acp/README.md:7,78,80` |
| JSON-RPC SDK | stdio JSON-RPC | 逐字转发 `session.event`，3 请求 + 4 通知 | `packages/sdk/server/src/server.ts:53-240` |

### TUI 要包裹的最小程序面

**类型 spine：**

- `Agent` 接口 — `packages/core/agent/src/runtime-types.ts:64-144`：`id`、`options`、`session`、`inbox`、`status`、`followup`、`steer`、`inject`、`cancel`、`whenIdle`。
- `AgentLoop` — `packages/core/agent-loop/src/index.ts:296`，`static inject = ['agents','sessions','llm','tools','systemPrompt']`。
- `AgentRegistry.create(options)` — `packages/core/agent/src/index.ts:405`。
- `Session.append(type, data, ...opts)` — `packages/core/session/src/index.ts:604`，唯一合法事件写入点。
- `SessionEventMap` — `packages/core/session/src/types.ts:236-335`（merge-extensible）。

**一轮 turn 的执行轨迹**：`ReactLoopAgent`（`packages/core/agent-loop/src/agent.ts:64`）：`ctx.agents.create` → `agent.followup(msg)` → `wakeDriver` → `kick()`（`:210`，`while(await this.turn())`）→ `turn()`（`:246`，`turn/start`）→ 每 step：`preStep`（`:225`，claim inbox、assemble system prompt、`agent/pre-step` waterfall）→ `buildRequest`（`:407`，frozen config）→ `step()`（`:332`，`llm.stream` → 逐 chunk append `assistant/chunk`，`BlockAssembler` 折叠，`finish` append `assistant/message`）→ `executeToolCalls`（`packages/core/agent-loop/src/tool-calls.ts:59`，append `tool/call`+`tool/result`）→ `step/end` → `agent/turn-stopping` 可 `steer` → `turn/end`。`kick` 退出 → `agent/status{idle}` → `whenIdle()` resolve。参考 caller `packages/bundle/headless/src/index.ts:111-134`；Phase 0 `packages/examples/tui-demo/src/runner.ts` 已复用此流程。

**事件火带（TUI 渲染源）**：`session/event`（`packages/core/session/src/index.ts:641-647`）逐字携带每个 `SessionEvent`：

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

### 渲染层：差距与复用

现有渲染原语全是 React/DOM：`packages/client/ui-primitives/package.json:29-50` 拉 `anser`（ANSI SGR 解析）、`shiki`（语法高亮）、`mdast-util-*`（GFM+math）、`katex`、`react`/`react-dom`。

高价值复用候选（纯逻辑可移植）：

| 模块 | 价值 | file:line |
|---|---|---|
| `ansi.ts` | 完整 ANSI SGR 解析 + 光标移动回放 + 宽字符 + 主题 token 映射 | `packages/client/ui-primitives/src/ansi.ts:1-447` |
| `markdown/incremental.ts` | 流式 append-only markdown 解析，O(1)/chunk | `packages/client/ui-primitives/src/markdown/incremental.ts` |
| `markdown/parse.ts` | GFM+math 两条文法 | 同目录 |
| `markdown/plain-text.ts` | 纯文本抽取 | 同目录 |

Gap vs Claude Code TUI：

| Claude Code TUI 能力 | dsh 现状 | 改造 |
|---|---|---|
| 流式 markdown | `IncrementalMarkdownParser` 存在但绑 React | 绑终端 markdown 渲染器 |
| 工具审批卡片 | `ApprovalService` seam-only，fail-closed | TUI 注册 answerer |
| todo 面板 | `todo/write` projection 存在 | 读 `sessionProjections` 的 `todos` key，终端侧栏 |
| plan 模式 | `plan` projection + `exit_plan_mode` + `plan-review` intent | 消费 `plan` projection + 特殊渲染 intent |
| diff 视图 | `DiffBlock.tsx` React，`DiffHunk` 纯数据 | 终端 diff 渲染器（greenfield） |
| slash-commands | `CommandRuntime` 可扩展，已注册 `/permission` `/compact` `/plan` `/goal` `/feedback` `/export-log` | 自建 autocomplete over `list(agent)` |
| 键盘输入 | 零 TTY 代码 | `setRawMode` + readline/keypress（Phase 0 已验证 stdin 路径） |

render intent 已是纯数据契约：`packages/core/tools/src/presentation.ts` 定义 `ToolCallView`（`:46`）/ `ToolResultView`（`:140`）。`ToolDefinition` 钩子 `presentCall?`/`presentResult?`（`packages/core/tools/src/index.ts:271-287`）是**纯函数**（`docs/cookbook/adding-a-tool.md:84-88`）。TUI 按 `card` discriminant 分派。

各工具 render intent：bash→`terminal`、write/edit→`diff`、read→`read`、grep/glob→`search`、web→`web`、exit_plan_mode→`generic`(plan)、todo_write→projection（非 card）。todo/plan-mode 是 session projection（`todos`/`plan`），通过 `sessionProjections` 消费。

TUI owns 的会话上下文职责：`TerminalCallView.cwd` 相对路径解析（`presentation.ts:96-99`）、`ReadResultView.path` 相对化（`:285`）、bash 退出码解析（`packages/shell/tool-bash/src/render.ts:103`）、spill file（`tool-bash/src/index.ts:166-181`）。

### 交互闭环：审批 / ask-user / commands

**审批**（fail-closed，TUI 必须注册 answerer）：`ApprovalService`（`packages/interaction/user-approval/src/index.ts:192`），`ApprovalPolicy='ask'|'never'`（`:94`），无 answerer 返回 `'unavailable'`（`:309-329`）。`ApprovalOutcome='allowed-once'|'rejected'|'cancelled'|'unavailable'`（`types.ts:29`）。answerer 是 `approval/request` waterfall listener，**必须调 `next()`**。唯一 production answerer = Web BFF（`api-proxy.ts:1391-1450`）。TUI 必须注册 answerer。参考 `api-proxy.ts:1391-1450` 与 `acp/src/index.ts:271-289`。

**ask-user**（provider-only）：`UserQuestionService`（`packages/interaction/user-questions/src/index.ts:38`），`registerProvider`（`:64`），无 provider 抛 `NO_PROVIDER`。`intent:'plan-review'`（`types.ts:23-32`）。TUI 必须 `registerProvider`，`plan-review` 特殊渲染。

**slash-commands**（可扩展）：`CommandRuntime`（`packages/interaction/commands/src/index.ts:225`），per-agent `ScopedLayers`。`register`（`:245`）、`execute`（`:297`）、`list`（`:260`）。TUI 自建 autocomplete。

**terminal 包**（不是 TUI host）：`packages/terminal/` 是 agent 驱动持久 PTY 的 capability（`terminal/src/index.ts:105`），per-agent、带审计、sandbox-fence。给的是 pty 不是画布。TUI 复用：消费 pty 输出流（如 Web client `bash-sample.tsx` 那样但用终端渲染器），或注册新 `TerminalBackend`。

### warp session-share：实时协作层（外部能力，不耦合）

调查 `/data/AI_Dev/warp` + `/data/AI_Dev/sf/ai-hub` 结论：

- **终端流级共享（tmux 式）**：PTY 字节是渲染输出真相源，经服务端中继（ai-hub Socket.IO，生产 `wss://sessions.app.warp.dev`，OSS 补丁 0001/0006 改指向 ai-hub）。
- **viewer 可输入**：`WriteToPty` 字节逐字落到 sharer 的 PTY master fd，调用链追到 `local_tty/event_loop.rs:289 self.pty.writer().write(bytes)`——与本地按键同一路径。门控：`SharedSessionWriteToLongRunningCommands` + long-running block + Executor 角色。
- **在 warp 里跑 CC/dsh**：共享的是 TUI 的**终端渲染字节 + 按键流**，不是 app 级结构化共享。
- **混合模型**：PTY 字节 = 渲染真相；上层叠 app 级边带事件（`CommandExecutionStarted/Finished` 带 `participant_id`+AI metadata、`AgentResponseEvent`、CRDT `InputUpdate`、初始化 `Scrollback`）。

对 dsh TUI 的影响：

- **不写协作代码**：dsh TUI 跑在 warp 里白拿终端流共享 + 审批协作（审批 answerer 读 stdin 按键，warp 把 viewer 按键逐字写同一 PTY stdin → viewer 可直接回答审批卡）。
- **绕开 SDK approval 缺口**：warp 模式下审批走 PTY stdin，不经 SDK wire。
- **门控风险**：warp viewer 写入 gated on `SharedSessionWriteToLongRunningCommands` + long-running block。dsh 阻塞式审批 readline 是否被判为 long-running 需实测——若不行，answerer 要改非阻塞或显式长时运行标记。
- **历史线索**：`DiffBlock.tsx:1-9` 注释"Unlike the TUI's exact changed-row comparison"暗示仓库曾存在 TUI 参照点，查 git 历史可复用其设计决策。

warp 与需求 #1（多 session 语义透明）是两个问题：warp = 实时同看一个 session；需求 #1 = N 个 session 各跑各 AI 的跨 session/跨时间语义透明。前者 warp 解决，后者 SF 平台 + 记忆解决。

### SF 松耦合与记忆分阶段接入

松耦合四件套（类比 CC ↔ warp/SF）：

| 关联面 | CC 做法 | dsh TUI 等价 | dsh 现状 |
|---|---|---|---|
| MCP | CC 连 MCP server 拿外部工具 | `dsh-mcp-client` 连 SF `ai-mcp-adapter`（`memory.recall/get/feedback`） | **已有** `packages/mcp/mcp-client` |
| CLI | CC 调外部 CLI | SessionEnd 生命周期事件 → 调 `sf memory capture`（dsh 当 ai-cli 角色） | 需在 tui-runner 加采集钩子 |
| CLAUDE.md/AGENTS.md | 项目级强规则 | `workspaceContext`（AGENTS.md loader，agent-spine-demo 已挂） | **已有** |
| Skills/Rules/hooks | CC 原生 | `dsh-skill` + `packages/hooks/`（hooks-claude-code 桥读 CC hooks.json） | **已有** |

松耦合成立：dsh 对 SF 的全部依赖收敛到「一个 MCP server 配置 + 一条 CLI 调用 + 项目级 AGENTS.md」，拔掉仍独立可跑。

记忆方案分阶段接入（不建双权威）：记忆方案（`/data/AI_Dev/sf/ai-docs/productionDesign/多人AI协作开发大模型记忆管理技术方案.md`）**直接命中**需求 #1"AI 有充分上下文、更少冲突"。但完整治理闭环（Evidence→Candidate→Version→Review→Revoke→Policy + Gateway L3/L4 + 黄金语料评测）是 SF 四仓 `ai-core`/`ai-mcp-adapter`/`ai-tool-gateway`/`ai-cli` 大工程，方案 §13 自己分 M0-M5。dsh TUI 是 harness，不是 SF 控制平面；记忆权威在 ai-core，dsh 不该自建第二权威（ADR-MEM-001 + 不变量 6 fail-closed）。

dsh 扮演 = 记忆方案里的 `ai-cli`（薄采集适配器）+ 一个 recall consumer，不是 `ai-core`。分阶段：

| TUI Phase | 记忆接入 | 对应方案 milestone |
|---|---|---|
| Phase 0-1（TUI 本体） | 无记忆接入，先跑通单机 TUI | — |
| Phase 2（渲染层） | 接入 `memory.recall` 作为 in-process tool（经 `dsh-mcp-client` 连 `ai-mcp-adapter`），让 TUI 内 AI 召回跨人跨 session 历史 | M3 partial |
| Phase 3（交互深化） | SessionEnd 触发 Evidence 采集：dsh session-lifecycle 事件 → 复用 `sf memory capture`（不重写采集/脱敏/队列/重放，复用 ai-cli 已修好的 §8.3.1） | M2 partial |
| 后续（单独决策） | 完整记忆治理归 SF 四仓推进，dsh 只消费 | M4-M5 |

## 验收标准

- **Phase 0（原型，已验证）**：`packages/examples/tui-demo/` standalone bin，keyless，证明事件流→渲染可行。bash-tool 与 text-turn fixture 实测：`task> [agent:running]` → `[tool/call] bash(...)` → `[tool/result] [ok] ...` → `[turn/end] completed` → `[agent:idle]`；text-turn 纯流式也渲染成功。复现：`node --import tsx/esm packages/examples/tui-demo/src/bin.ts`（需 Node v22+）。修了两个真实 bug：(1) stdin 须在 `boot()` 前读以缓冲；(2) `rl.close()` 不能在 line handler 内调（同步 close 事件下 tick 覆盖 `resolve(l)`）。
- **Phase 1（产品 TUI bundle，in-process）**：`packages/bundle/tui/`（镜像 `headless`/`web-app`）+ `tui-startup` + `tui-runner`。`ctx.agents.create` + `ctx.on('session/event')` + 注册 approval/ask-user answerer + `setRawMode` + `BlockAssembler` + `ctx.appExit`。**standalone bin + overlay，不注册 `PROFILE_TEMPLATES`**（见下方上游跟随策略）。
- **Phase 2（渲染层 + BFF SSE transport）**：选型终端渲染栈（复用 pi-tui——有先例）；移植 `ansi.ts`/`markdown/incremental.ts`；实现 8 个 card 组件 + todo/plan projection；写 `EventSourceTransport` adapter 连 BFF；slash-command autocomplete。经 `dsh-mcp-client` 接 `memory.recall`（M3 partial）。
- **Phase 3（交互深化 + 采集）**：Code Mode sub-call 渲染（`tool/code-dispatch-*`）；spill file/退出码/cwd；`--resume` 从 JSONL 重建；SessionEnd 调 `sf memory capture`（M2 partial）。双 transport 可换 adapter。
- **任何 phase 不改 `agent-loop`**（遵守 `CLAUDE.md` "Plugins, not loop changes"）。任何 core 文件改动先评估能否用 overlay/新包绕开；不能绕开才进 patch series。

## 风险

1. **远程 transport 选型——已定 BFF SSE，Phase 2 只做 BFF，SDK 延后。** 源码级验证：BFF mux 流已闭环 approval/ask-user（`approval/requested`/`question/requested` + `POST /api/respond`）；SDK 是 "dead capability"（server 从不 `transport.request`，`FakeTransport` 断言锁死，client 无 `onRequest`）。保留双 transport adapter 架构，后续自动化场景待 SDK 补 approval wire 再接入。
2. **渲染栈选型——有先例。** 前任 TUI 用 `@earendil-works/pi-tui`（npm 0.84.2 在线，前任用 0.80.7）。Phase 2 评估 pi-tui 作为首选（其 `TUI`→`TuiMainScreen` API 已漂移，需对账）；40 个 `terminal.expected.txt` 逐像素快照是重建的确定验收标准。不再从 ink/纯 Node 二选一——有先例可循。
3. **warp 审批门控。** `SharedSessionWriteToLongRunningCommands` 是否覆盖 dsh 阻塞式审批 readline，需实测；不行则 answerer 改非阻塞。
4. **记忆双权威边界。** dsh 只做 `ai-cli` 角色 + recall consumer，治理闭环归 SF 四仓；任何采集必须复用 `sf memory capture`，不绕过 ai-cli 的脱敏/幂等/SDK child guard。
5. **Agent Note 合规。** 合并需双语配对 + `verify-doc-budgets` + 配套 keyless snapshot（`CLAUDE.md` testing policy）。
6. **pre-release stance**（`CLAUDE.md`）：无外部消费者，优先正确 foundation 而非兼容 shim。

## 备选方案

### 远程 transport：BFF SSE（已选）vs JSON-RPC SDK（延后）vs ACP vs Remote BFF/Typert

针对约束 2"保留独立远程开发能力"，TUI 远程瘦 client 的 transport **已定为 BFF SSE**。源码级逐项验证（`packages/host/apiproxy/src/api/events.ts`、`api-proxy.ts`、`fetch/handler.ts`、`api-request-trust.ts`、`packages/sdk/protocol/`、`packages/sdk/server/`、`packages/sdk/client/`）。

判定矩阵（每格 file:line）：

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

决定性理由：**approval + ask-user 在 BFF 今天就闭环，SDK 是 "dead capability"。** 这是产品级硬需求，不能等。

- BFF mux 流（`events.ts:69-108`）已携带 `approval/requested`/`resolved`（`:72-73`）、`question/requested`/`resolved`（`:74-75`），同走 `POST /api/respond`（`fetch/handler.ts:296-300`）。
- SDK 缺口不是"待启用"而是"不存在"：server 只 `transport.notify` 从不 `request`（`server.ts:73-102`）；`FakeTransport` **断言**服务端永不 `request`（`server.spec.ts:19-29`）；client 只装 `onNotification`（`client.ts:257-260`）；`protocol/README.md:39` 明文 "dead capability"。补 SDK 需动 3 包（protocol types + server emit site + client onRequest）+ 翻 `FakeTransport` 断言 + 重写 `viewFor`，违反最小新代码。

BFF 额外红利——host 算好的 `ToolEventView`：`viewFor(...)`（`api-proxy.ts:713-749`）服务端算好 `ToolEventView`（`events.ts:24-35`）挂 `session/event` 的 `view` 字段（`api-proxy.ts:3425-3430`）。**TUI 直接消费 host 算好的 render intent，跳过自调 `presentCall/presentResult`**——匹配"webUI 式与服务端交互"：TUI 是浏览器那层的瘦 view。SDK 无此类型。

已决定的待定项：Phase 2 只做 BFF，SDK 延后（2026-08-18 确认）。SDK 作为后续自动化/headless 场景的可选 transport，待其补 approval wire 再接入。保留双 transport adapter 架构（`EventSourceTransport` vs `JsonRpcTransport` 归一成统一 `SessionEvent` 流喂同一渲染层），后续接 SDK 时平滑切。

三模式的 transport 落地：

| 模式 | transport | 事件源 |
|---|---|---|
| 本地 in-process | 直连 `ctx.on('session/event')` | in-process 事件火带（Phase 0 已验证） |
| 远程瘦 client | BFF SSE（`EventSource` + `POST /api/respond`） | HTTP/SSE + host 算好的 `view` |
| warp 内 | 终端字节流（无 transport） | PTY 字节 + `BlockAssembler` |

被否的备选：ACP——automation-only，剥离 live progress，fresh-session-only（`README.md:7,78,80`）。Remote BFF / Typert——远程多租户，Typert 是类型图注册非 client transport。

### 前任 TUI 恢复：以删除产物为规格重建，不机械恢复

仓库**曾有完整 `@deepseek-ai/dsh-tui` v0.0.1**，住 `packages/ui/tui/`（84 文件，src 7676 行 + tests 10321 行 + 40 个 `terminal.expected.txt` 渲染快照）+ `apps/cli/`（`src/tui.ts`、`config/tui.cordis.yml`、`src/tui-onboarding/`、`tests/pty-harness.ts`）。commit `10bb9cbf4a`（2026-08-04）"cleanup: remove TUI package and legacy dsh entrypoints" 一次性删除，同日归档 114 份设计 note。

移除理由（已查清）：非技术债，是 pre-release stance（`CLAUDE.md` "Pre-release stance: foundation over blast radius"）下把未对外的 surface 移出首 RC（`dsh-v0.1.0-rc.7` 在删除后 13 天打）。删除当天 10:06 还在 merge PR #1359 `perf/tui-long-session-render`，13:20 整体删——是被判定"未达 RC-ready"而移出 blast radius，不是失败。

前任 TUI 实物：渲染器 `@earendil-works/pi-tui`（npm 仍在线，0.84.2，前任用 0.80.7）。模块结构：`src/{runtime,prompt,config,index,invariant}.ts` + `chat/`（autocomplete/channel/file-autocomplete/model-command/questions/resume/skill-invocation/timing/tokens）+ `components/`（content/dialogs/text/theme/transcript/xml-tool-output）+ `extension/`（overlay-manager/types，即 `ctx.tui.openOverlay()` FIFO 仲裁器）。40 个快照含逐像素 SGR 规格如 `terminal 96x36 buffer=normal` + 每行 `style N-M fg=bright-magenta bold underline`——**重建的确定验收标准**。

恢复性 drift 审计（RED，但根因单一且非渲染层）：把 `git checkout 10bb9cbf4a^ -- packages/ui/tui/ apps/cli/...` 拉回工作树，跑 Map→Fix→Verify：

- Fix 已做的机械 rename（12 文件，tui 侧）：`dsh-compact→dsh-compaction`、`dsh-user-interaction→dsh-user-questions`、`UserInteractionError→UserQuestionError`、`UserInteractionService→UserQuestionService`、`ctx.userInteraction→ctx.userQuestions`、`COMPACT_CHECKPOINT_SOURCE→compactCheckpointSource(CompactionId())`、pi-tui 0.80.7→0.84.2、`TUI→TuiMainScreen`、`@cordisjs/plugin-loader→@deepseek-ai/cordis-plugin-loader`、tsconfig 路径修正。**pnpm install 通过**。
- typecheck：111 tsc 错，分类：33× TS2339（`ctx.llm/sessions/commands/tools/tokenMeter/agents/userQuestions/systemPrompt` 不在 `Context` 上——declaration-merge 断）、48× TS7006（implicit any，下游连锁）、13× TS2345（EventMap 名字漂移如 `llm/adapters-updated`/`commands/change`）、其余 pi-tui API。
- 40 快照 0/40 全挂，但**同一根因**：`TypeError: installAgentLlmTarget is not a function at createTuiChat (index.ts:592)`——harness setup 在挂载前抛，**根本没到渲染/快照比对**。渲染层 drift 仍未知。

决定性阻断点：`installAgentLlmTarget` 是被删的 core seam。`packages/core/agent/src/llm-target.ts` **在当前树已不存在**。前任 TUI `index.ts:592` 调的 `installAgentLlmTarget(agent.ctx, target)` 是该文件导出——一个交互式模型选择耦合机制：把可变 provider/model/reasoning 强度路由挂到 agent 的 `system-prompt/assemble` + `agent/request` waterfall，让 front door（TUI）能在 step 间切模型。**删除 TUI 时 core 侧配套删除了这个交互 seam**，Web BFF 用了另一套模型选择路径替代。

这**不是包改名级机械 drift，是一个交互 seam 从 core 被移除**。恢复 TUI 要么 (a) 把 `llm-target.ts` 恢复进 core（**违反下方不碰 core 约束**），要么 (b) 把 TUI 的 model-controller 重写到 Web BFF 现在用的模型选择路径（等于重写关键交互层）。

最终判定：**以删除产物为规格重建，不机械恢复。** 理由：

1. `installAgentLlmTarget` seam 已从 core 删除，恢复必须碰 core 或重写 model-controller（前者违反不碰 core 约束，后者等于重写交互层）。
2. 33 个 Context declaration-merge + 13 EventMap 名字是系统性机械工作，可做但 model-controller seam 仍缺。
3. 40 快照从未真正测过渲染层（全挂 setup），恢复成本不可预测。

正确路径：把删除的 TUI（84 文件 + 40 快照 + 114 归档 note）当**规格与参考实现**，而非 base。以已验证的 Phase 0 `tui-demo`（in-process `session/event` 管道通）为起点，按 40 快照的逐像素规格重建渲染层，model-controller 走当前 core 的路径（不复活 `installAgentLlmTarget`）。这正契合"纯加法新包，不碰 core"约束。

由此确立的架构事实：`llm-target.ts` 随 TUI 一起删，印证 dsh 的"交互 front door 用的 core seam"与 TUI **共生**——TUI 删时 core 也删了它的专有入口。这是 pre-release stance 的激进面："foundation over blast radius"不仅删未对外 surface，还删了只服务它的 core 接口。重建因此必须走当前 core 现有 seam（Web BFF 的模型选择路径），不能复活被删 seam。

### 上游跟随策略：fork 维护（关键约束）

deepseek-harness 是开源项目，终端化改造须**最小化对跟随 upstream 更新的影响**。按改造落点分三档：

| 落点 | upstream merge 影响 | in-process 能力 | 适用 |
|---|---|---|---|
| 纯加法新包（新目录，不改现有文件） | ✅ 几乎零冲突（新文件不与 upstream 冲突） | ✅ 保留 | TUI 代码主体 |
| `cordis.patch.yml` overlay（per-user `$DSH_HOME`，不入树） | ✅ 零冲突（不在仓库） | ✅ 保留 | profile 配置层 |
| 改 core 文件（如 `PROFILE_TEMPLATES` 加一行） | ⚠️ merge 冲突点 | ✅ | 能免则免 |
| out-of-tree 独立仓（消费 `@deepseek-ai/dsh-*` 为 npm dep） | ✅ 零 fork 分叉 | ❌ 丢 in-process seam | 仅纯外部组件 |

核心张力：in-process 本地模式要求在树内；树内改动要最小化上游冲突。

推荐策略：加法优先 + overlay 优先 + patch 兜底。

1. **能加法就不改**：TUI 代码全放新包（`packages/examples/tui-demo/` Phase 0 → `packages/bundle/tui/` 产品级），全新文件，upstream merge 不冲突。
2. **能 overlay 就不注册**：TUI 做成 standalone bin（镜像 `jsonrpc-demo`，自己 `boot()` 自己 `cordis.yml`），**不**注册进 `PROFILE_TEMPLATES`（`packages/boot/app-boot/src/profile.ts:121`）——避免那行 in-tree 编辑，零核心改动。`dsh --profile tui` 的 launcher 集成降级为后续可选低优项，或经 per-user `$DSH_HOME/cordis.patch.yml`（不入树）实现。
3. **不可避免的 core 改动用 patch 兜底**：真到产品级必须改 core 时，照 `warp-patches` 模式维护 patch series + `sync-upstream.sh`（`/data/AI_Dev/sf/ai-hub/warp-patches/` 是活样本：fork OSS、补丁定制、sync 上游）。dsh 自带 `cordis.patch.yml` patch 栈 + `--patch` overlay 是原生等价物。

对方案各 Phase 的约束：Phase 0（原型）standalone bin，纯加法新包——✅ 已对齐。Phase 1（产品 bundle）`packages/bundle/tui/` 新包 + standalone bin，不注册 `PROFILE_TEMPLATES`；`tui` profile 经 overlay 激活。Phase 2-3 渲染层、transport adapter、采集钩子全在新包内；MCP 经 `dsh-mcp-client` 配置（不入树）；CLI 采集调 `sf memory capture`（外部，不入树）。任何需改 core 的需求，先评估能否用 overlay/新包绕开；不能绕开才进 patch series。

### 关键接入 seam 汇总（file:line）

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
