# Agent Note: dsh TUI 的 OpenTUI 渲染层

Status: proposed

[English](2026-08-20-tui-opentui-render-layer.md) | 中文

## 问题

dsh TUI bundle（`packages/bundle/tui/`）的 Phase 1–3 用的是**原始 `process.stdout.write` 渲染层**：流式文本和 `[tool/call]`/`[tool/result]` 行直接写出，无 ANSI SGR、无 markdown 折叠、无 card 组件、无 diff/todo/plan 渲染。Phase 2 渲染层（`src/render/{ansi,markdown,cards,projections}.ts`）是手搓最小实现——仅 GFM→ANSI，无语法高亮、无表格、无 KaTeX、无流式 markdown 折叠。

[方案 note](2026-08-18-tui-solution-and-dev-plan.md) Phase 2 把 `@earendil-works/pi-tui`（前任 TUI 的渲染器）作为首选，40 个归档 `terminal.expected.txt` 快照为验收标准。但对 `/data/AI_Dev/opencode` 的调查揭示了一个**已发布、能力更强的替代**：`@opentui/solid`（npm `0.5.4`），opencode TUI 使用的 SolidJS 终端 reconciler，内置流式 `<markdown>` 组件，带 shiki 语法高亮、表格、KaTeX、conceal——正是 dsh 手搓层的缺口。

## Spike 结果（2026-08-20 验证）

hello-world spike 在 **Bun** 下把 `<text fg="green">Hello OpenTUI</text>` 渲染到终端（绿色 RGB `[38;2;0;128;0m`，干净退出 0）。三个发现修正了原提案：

1. **`createCliRenderer()` 是 async**——它通过 stdin 向终端查询（DSR），必须 `await`。同步调用抛 `Cannot create CliRenderer: stdin is already used by another CliRenderer`。
2. **tsdown/rolldown 不编译 Solid JSX。** `jsx: { runtime: 'solid' }` 被忽略；rolldown 回退 React jsx-runtime → `Cannot resolve 'react/jsx-runtime'`。Solid JSX 编译必须经 `Bun.build()` + `@opentui/solid/bun-plugin` 的 `createSolidTransformPlugin()`（spike 的 `spike-build.ts` 证明了这条路径）。Bun 1.3.14 运行时也不处理 Solid JSX（默认 React）；transform 插件必需。
3. **Node 构建的 `lib/bin.js` 在 Bun 下原样运行。** tsdown 打包的非 JSX spine（runner/answerers/capture/bin）在 Bun 下加载 cordis 插件树、跑 agent spine、replay fixture、触发 SessionEnd capture hook。仅 `process.loadEnvFile` 在 Bun 1.3.14 缺失（用 `typeof process.loadEnvFile === 'function'` 守卫；Bun 原生加载 `.env`，该调用在 Bun 下冗余）。

**运行时决策：`dsh-tui` bin 走 Bun，不走 Node/tsx。** 这与 TUI 渲染器生态对齐：opencode 是 100% Bun（`packageManager: bun@1.3.14`、`#!/usr/bin/env bun` shebang、无构建步骤——exports 指向 `./src/index.tsx`）；Claude Code 是 Bun `--compile` 的原生 ELF 二进制。Bun 对 dsh 不是偏离——它是这一层的标准运行时。dsh 工具链（tsdown、vitest、lefthook、pre-push）仍是 Node；只有 `dsh-tui` bin 入口从 `node lib/bin.js` 改成 `bun lib/bin.js`。隔离面是一个 bin 入口。

**混合构建路径：** tsdown（Node）把非 JSX spine 模块打包到 `lib/`；单独的 `Bun.build()` 步骤用 `createSolidTransformPlugin()` 把 JSX `src/view/*.tsx` 模块打包到 `lib/view/`。两者都是纯 ESM JS；Bun bin 运行时无 JSX 残留。

## 提案

### 采用 `@opentui/solid` 作为 dsh TUI 渲染层，替换 raw-stdout Phase 2 层

OpenTUI 是**纯渲染器**：一个 SolidJS reconciler 跑在终端 buffer 上（`@opentui/core` 的 `createCliRenderer`，`@opentui/solid` 的 `render`）。它不关心事件来源——消费 Solid 响应式 store。这与 dsh 的 in-process 事件 spine（`ctx.on('session/event')`）+ BFF SSE transport（`transport/session-event.ts`）架构正交：把 `TransportEvent` 流喂进 Solid store，OpenTUI 渲染它。

**不要复制 opencode 的客户端-服务器拆分。** opencode 的 TUI 是 agent server 的 client（`createOpencodeClient({ baseUrl })` + SSE）。dsh 的本地 in-process 模式是优点（无需 spawn server）；OpenTUI 在进程内同样工作。

### OpenTUI 给 dsh 带来什么

| 能力 | dsh 当前（raw stdout） | OpenTUI |
|---|---|---|
| 流式 markdown | 无（原始 text delta） | `<markdown streaming>`——增量，O(1)/chunk |
| 语法高亮 | 无 | `@shikijs/stream`（shiki） |
| 表格 | 无 | 内置 grid 表格 |
| KaTeX 数学 | 无 | 内置 |
| 工具卡片 | `[tool/call]`/`[tool/result]` 行 | `<box>` 组件，按 `presentation.ts` card 联合体分派 |
| diff 视图 | 无 | `<box>` 配 `@pierre/diffs` 或原始 |
| todos/plan 侧栏 | 无 | `<scrollbox>` |
| 输入回显（TTY） | readline `terminal:true`（已修） | OpenTUI keymap + raw-mode（更丰富） |
| slash-commands | 无 | `<dialog>` + autocomplete over `CommandRuntime.list(agent)` |

### 架构

```
ctx.on('session/event') ─┐
                         ├─→ TransportEvent ─→ Solid store ─→ OpenTUI <App/>
BffSseTransport.connect ─┘   (transport/         (view/store.ts)   (view/app.tsx)
                              session-event.ts)
```

- `transport/session-event.ts`（已有）把 in-process + SSE 归一成 `TransportEvent`。
- `view/store.ts`（新）：Solid 响应式 store；`subscribeInProcess`/`BffSseTransport` push 事件；信号持 `messages[]`、`tools[]`、`todos`、`plan`。
- `view/app.tsx`（新）：`render(() => <App />, { renderer: createCliRenderer() })`。
- `view/components/`：`<Message>`（`<markdown streaming>`）、`<ToolCard>`（按 `presentation.ts` card 联合体分派）、`<Todos>`、`<Plan>`、`<Prompt>`。
- `runner.ts`：把 `renderEvent`（raw stdout）替换为 `store.push(transportEvent)`。OpenTUI 的 reconciler 拥有所有 stdout 写入；dsh 不再为渲染内容调 `process.stdout.write`。
- `src/render/ansi.ts`（已有）：保留——OpenTUI 的 terminal 卡片在工具结果带 ANSI 时消费它。

### 关键决策

1. **流式文本跳过 `BlockAssembler`**：OpenTUI 的 `<markdown streaming>` 自己做增量折叠。把 `assistant/chunk` 的 `text-delta` 直接喂给 markdown 组件；不要用 `BlockAssembler` 预折叠（避免双重折叠）。
2. **render intent**：in-process 模式直接读 `presentCall`/`presentResult`；远程模式消费 BFF `view` slot 上的 host-computed `ToolEventView`（已是 `transport/event-source.ts` 的设计）。两者都喂 `<ToolCard>`。
3. **JSX 构建**：dsh 是纯 TS ESM，无 JSX。加 `solid-js`（peer）+ `@opentui/core` + `@opentui/solid` + `@opentui/keymap`。tsdown（rolldown）经 `jsx: { runtime: 'solid' }` 编译 Solid JSX（先用 hello-world spike 验证）。
4. **40 快照验收**：归档 `terminal.expected.txt` 逐像素 SGR 规格仍是验收标准（分析 §11.2）。OpenTUI 默认主题可能不匹配；把 `syntaxStyle`/`fg`/`bg` 对齐到快照的 SGR 规格。
5. **不改 core，不注册 `PROFILE_TEMPLATES`**：所有新代码在 `packages/bundle/tui/` 下新增的 `src/view/` 目录（纯加法）。遵守分析 §14。

## 验收标准

- 在任何 view 工作前，一个 hello-world spike 经 tsdown + `@opentui/solid` 把 Solid 组件渲染到终端（降低 JSX 构建风险）。
- `tsc -b tsconfig.host.json` 带新 `.tsx` 文件绿。
- keyless 多轮：`<markdown streaming>` 渲染 two-turn fixture 的 assistant 文本带 ANSI 样式（bold/italic/code），非 raw stdout。
- live DeepSeek：流式 markdown 渲染真实模型输出，代码块带语法高亮。
- 40 个归档 `terminal.expected.txt` 快照对新渲染层通过（逐像素 SGR）。
- 全部 scoped doc 门绿（`verify-package-paths`、`verify-agent-note-format`、`gen-config-catalog`、`verify-package-readme-*`、`verify-translation-pairing`）。
- 不改 `agent-loop`；不改 `packages/core/*`；不注册 `PROFILE_TEMPLATES`。

## 风险

1. **JSX 构建接入**——dsh 全仓无 JSX。tsdown/rolldown 的 Solid JSX 编译必须在 view 工作前验证。缓解：先 hello-world spike。
2. **40 快照主题对齐**——OpenTUI 默认主题可能不匹配归档的逐像素规格。缓解：`syntaxStyle` + `fg`/`bg` 映射；若某快照无法匹配，把偏差记为已知限制（pre-release stance 允许）。
3. **双重流式折叠**——`BlockAssembler` + `<markdown streaming>` 都折叠。缓解：把 `text-delta` 直接喂 `<markdown>`，markdown 路径跳过 `BlockAssembler`（非 markdown card 路径保留）。
4. **Solid 响应式在 dsh 事件火带下**——dsh 从 agent loop 同步发事件；Solid 的批量更新（16ms）可能增延迟。缓解：`batch()` 事件 push（镜像 opencode 的 `sdk.tsx` flush）。
5. **bundle 体积**——`solid-js` + `@opentui/*` + `shiki` 给 `dsh-tui` bin 增重。缓解：tsdown `codeSplitting: false` 已内联；shiki 按需加载文法。

## 备选方案

- **pi-tui（前任 TUI 渲染器，npm `0.84.2`）**：方案 note 的原选择。在此否决：其 `TUI`→`TuiMainScreen` API 0.80.7→0.84.2 漂移，40 快照从未真正测过其渲染层（全挂 setup，分析 §11.3），且缺 OpenTUI 内置的 shiki/表格/KaTeX。OpenTUI 已发布、在维护、能力更强。
- **保留手搓 Phase 2 渲染层**：否决——无语法高亮、无表格、无 KaTeX、无流式 markdown 折叠。手搓到功能对等会复制 OpenTUI 已有的东西。
- **复制 opencode 的客户端-服务器架构**：否决——dsh 的 in-process 模式是优点（无 server spawn，直接 `ctx.on('session/event')`）。OpenTUI 在进程内工作；transport 抽象（`transport/session-event.ts`）已归一 in-process + SSE，只改 store 消费端。

## Confirmation Or Next Step

- **confirmationRequired：** true——这是替换 Phase 2 渲染层的提案。确认：(a) 采用 OpenTUI 而非 pi-tui，(b) Solid JSX 构建可接受，(c) 40-快照对齐是验收标准。
- **recommendedNextSkill：** `sf-plan`（任务拆解：spike → store → message → tool-card → projections → prompt → snapshot-align）→ `sf-implement`。
- **blockedReason：** 提案阶段无阻塞。
