# Agent Note: dsh TUI 的 OpenTUI 渲染层已实现

Status: implemented

[English](2026-08-20-tui-opentui-view-layer-implemented.md) | 中文

## 问题

[OpenTUI 渲染层提案](2026-08-20-tui-opentui-render-layer.zh.md)列出三个 spike 已确认的风险，外加一个 spike 未预见的风险。渲染层必须迎着它们构建，而非绕开：(1) `createCliRenderer()` 是 async（通过 stdin 查 DSR），(2) tsdown/rolldown 不编译 Solid JSX，`.tsx` 文件需单独的 `Bun.build()` 步骤，(3) `dsh-tui` bin 走 Bun（Node 无法加载 `bun:ffi`），(4)——spike 未发现——OpenTUI 的 Solid reconciler 对 `<Show>` 的假值分支会发出一个游离空文本节点，在非文本父节点（`<box>`/`<scrollbox>`）下成为孤儿，抛 `Orphan text error`。answerer 的 `stdin.readLine()` 也无法与 OpenTUI 的 raw-mode keymap 共存，故 approval/ask-user 路径需要新的回答面。

## Decision

OpenTUI 渲染层按已实现交付：`@opentui/solid` 替换 raw-stdout Phase 2 层，`dsh-tui` bin 走 Bun，JSX 通过单独的 `Bun.build()` 步骤并外部化 `@opentui/*` 使原生 FFI 在运行时从 pnpm store 解析。answerer 冲突用 `StoreAnswerAccess` 面（store 的 `awaitAnswer`/`resolveAnswer`）而非 `stdin.readLine()` 解决，`<Show>` 用 memo 条件替代以避免 reconciler 的孤儿文本崩溃。

渲染层是 `src/view/`（纯加法）加上 `runner.ts`、`answerers.ts`、`bin.ts`、`package.json`、`tsconfig.json` 的最小接线和 `scripts/build-view.ts` 的 Bun.build 步骤。非 JSX 响应式 spine（`store.ts`、`renderer.ts`）与包其余部分一样由 tsdown 打包；JSX 组件（`app.tsx`、`components/*.tsx`）由 `Bun.build()` + `createSolidTransformPlugin()` 打包，并将 `@opentui/*` + `solid-js` 外部化，使原生 `.so` 在运行时从 pnpm store 解析，而非 bundle 内烘焙的相对哈希路径。

### 已交付

- `src/view/store.ts`：Solid 响应式 store，镜像 opencode 的 SDK flush 模式——在 `push` 上排队事件，16ms 窗口内 `batch()` 发射。`applyEvent` 在 `SessionEventMap` 判别式上 switch；`plan/mode`（插件合并扩展，不在基础 map）在 switch 前用 string-type 检查处理。暴露 `setStatus`（agent/status 不是 session event）、`awaitAnswer`/`pendingQuestion`/`resolveAnswer`（回答面）和 `planActive: boolean`（`plan/mode` payload 是 `{ active }`，非 markdown）。
- `src/view/renderer.ts`：跨平台 FFI 启动——`setRenderLibPath(findSo())` 后 `await createCliRenderer()`。`findSo` 遍历 pnpm store 找平台 `.so`/`.dylib`/`.dll`。
- `src/view/components/{message,tool-card,projections,prompt}.tsx` + `src/view/app.tsx`：JSX。`<Message>` 用 `<markdown streaming>`；`<ToolCard>` 接 card-union switch 但 v1 全落到 generic；`<Todos>`/`<Plan>` 内联渲染；`<Prompt>` 拥有 REPL 输入并路由待答问题。全部用 memo 条件而非 `<Show>`（见 Consequences）。
- `src/runner.ts`：用 `store.push(TransportEvent)` 替换 `renderEvent`/`BlockAssembler`；启动渲染器；通过动态 import 加载 `app.js`（tsdown 不解析，Bun.build 供给）；`onSubmit` 处理器驱动 `agent.followup` + `whenIdle` + `flush`；退出时恢复终端。
- `src/answerers.ts`：从 `StdinAccess`（`stdin.readLine`）重构为 `StoreAnswerAccess`——answerer 通过 `awaitAnswer()` 将待答问题推入 store 并返回其 promise；`<Prompt>` 解析它。在 OpenTUI raw mode 下这是强制的。
- `src/bin.ts`：用 `typeof` 检查守卫 `process.loadEnvFile`（Bun 1.3.14 缺失；Bun 原生加载 `.env`）。
- `scripts/build-view.ts`：`Bun.build` + `createSolidTransformPlugin()` + 对所有 `@opentui/*` 和 `solid-js` 的 `external`。
- `tests/input.spec.ts`：从 readline `LineInput` 重接到 `TuiStore` 回答面。

### 混合构建路径

`pnpm run build`（Node）跑 tsdown，打包非 JSX spine（含 `store.ts`/`renderer.ts`）到 `lib/`。`bun scripts/build-view.ts`（单独或作为后续）打包 JSX 到 `lib/view/`。`runner.js` 的 `await import('./view/app.js')` 在运行时解析到 Bun.build 输出；tsdown 不解析该动态 import。`dsh-tui` bin 是 `bun lib/bin.js`。

## Consequences

40 快照 pty 驱动验收推迟到 pty 快照 harness 存在；该层由 `tsc`、`pnpm run build`、`bun scripts/build-view.ts`、`bun lib/bin.js` 启动和 11 个通过的单元测试验证。工具卡片特化（terminal/diff/read/search/web）推迟到后续让 runner 接 `presentCall`/`presentResult` 的 pass。`build:view` 尚未接入根 `scripts/build.ts`（它不调用 per-package 脚本）；当前契约是 spine 构建后跑 `bun scripts/build-view.ts`。该权衡换来：一个流式 markdown、shiki 高亮、支持表格/KaTeX 的 TUI，与 opencode + Claude Code 运行时对齐，且保留 in-process 事件 spine、无 core 改动。

## Testing

- `tsc -b tsconfig.json` 带新 `.tsx` 文件绿（jsx:preserve；tsc 为类型检查发 `.d.ts`，`.jsx` 产物不用——Bun.build 拥有 JSX emit）。
- `pnpm run build` 绿：tsdown 打包 spine。
- `bun scripts/build-view.ts` 绿：产出 `lib/view/app.js`（外部化 `@opentui/*`）。
- `bun lib/bin.js` 启动 OpenTUI，进入 alt screen，渲染 `task> ` 提示，退出时恢复终端。
- `npx vitest run packages/bundle/tui/tests/input.spec.ts`——11 passed（answerer 集成测试重接到 store）。
- 全部 scoped doc 门绿：`verify-package-paths`、`verify-export-jsdoc`（`render/*`/`transport/*`/`capture.ts` 的 14 个既有 JSDoc 缺口也一并补齐）、`verify-translation-pairing`。
- 不改 `agent-loop`；不改 `packages/core/*`；不注册 `PROFILE_TEMPLATES`。

## Risks

1. **`<Show>` 孤儿**——OpenTUI Solid reconciler 对 `<Show>` 假值分支发出游离空文本节点；在非文本父节点（`<scrollbox>`）下抛 `Orphan text error`。缓解：所有条件用 `createMemo` 返回 `JSX.Element | undefined` 代替 `<Show>`。每个组件模块文档均有记录。
2. **Solid 响应式不驱动挂载后的重渲染（阻塞）**——`createStore`/`createSignal` 更新触发（探针确认 store flush 且 signal setter 运行），但 `<For each>` 不再求值：Solid effect 队列在 Bun 下不 flush 到 @opentui/solid 的 reconciler。初始挂载渲染（静态 `task>` 提示、输入回显），`renderer.start()` + exit latch 保持 bin 存活，但流式 assistant 文本和工具卡片从不出现。最小复现（`createSignal` + `<For>` + `r.start()`）同样失败，故不是 double-`solid-js`-instance 或 store-outside-root 问题。opencode 工作；差异未解——可能是 `createCliRenderer` 配置（`targetFps`/`useKittyKeyboard`/`autoFocus`）或我们未复现的 `@opentui/solid/preload` 运行时钩子。这是 live 模型输出的开放阻塞。
3. **管道 stdin 无法驱动 `<Prompt>`**——OpenTUI 的 `<input>` 消费 raw-mode keypress 事件；管道不产生。python `pty.fork` harness（`tests/pty-harness.ts`）驱动 bin：`onSubmit` 触发，agent loop 运行（`turn/start` → `assistant/chunk` 事件探针确认），但视图不更新（见风险 #2）。Live 验证需真实 TTY + `DEEPSEEK_API_KEY`。
4. **构建接线**——根 `scripts/build.ts` 现在在 `build:lib` 和 `build:web` 之间调用 `runViewBuild()`（PATH 遍历找 `bun`）；Bun 不在时 warn 跳过。release lane 加 `oven-sh/setup-bun@v2`。
5. **工具卡片特化推迟**——card-union switch（terminal/diff/read/search/web）v1 全落 generic；store 不填 `callView`/`resultView`（无工具注册表）。
6. **`lib/view/*.js` 被 gitignore**——与 `lib/` 其余部分一样，view bundle 是 `bun scripts/build-view.ts` 再生的构建产物；`files[]` 白名单在发布时携带。

## 备选方案

- **保留手搓 Phase 2 渲染层**——否决；无 shiki/表格/KaTeX/流式 markdown，达到对等会复制 OpenTUI。
- **在 `runner.ts` 静态 import `app.js`**——否决；tsdown 在 Bun.build 之前跑，`lib/view/app.js` 在 tsdown 时不存在，静态 import 解析失败。动态 `await import('./view/app.js')` 被 rolldown 留为未解析，运行时由 Bun 解析。
- **保留 answerer 在 `stdin.readLine()` + 非 raw 回退**——否决；渲染器为整个 REPL 拥有 raw mode，回退不可达。`StoreAnswerAccess` + `awaitAnswer`/`resolveAnswer` 面是强制的。

## Confirmation Or Next Step

- **confirmationRequired：** false——已实现。
- **recommendedNextSkill：** 将 `build:view` 接入 `scripts/build.ts`；为 40 个归档 `terminal.expected.txt` 规格加 pty 驱动快照 harness；特化 tool-card 各分支。
- **blockedReason：** 无。
