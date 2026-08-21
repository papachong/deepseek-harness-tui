# Agent Note：dsh-tui 是 bundle，不是 capability seam

Status: proposed

English | [中文](2026-08-21-tui-bundle-not-capability-seam.zh.md)

## 问题

"TUI 能否做成插件？"——这个问题预设 TUI 还不是插件，或形态不对。本 note 记录结构性结论、官方文档背书、以及对发布形态的决定，供下一会话直接取用，无需重新推导。

## 结论

`@deepseek-ai/dsh-tui` **已经是正确形态的 plugin——bundle**（`packages/bundle/` 下的可安装 `dsh --profile` patch-layer 包），不是 capability seam（Service Definition / Service Provider / Consumer 三角色）。其渲染层当前**不应**升级为 Service Definition。该包持有的 Bun-FFI 进程边界决定了发布形态：独立 `dsh-tui` bin，而非（暂时的）`dsh --profile tui` surface bundle。

### TUI 是 bundle 不是 capability 的证据

- **无 Service Definition。** `src/` 全量 grep `extends Service | ctx.plugin( | .provides( | ServiceDefinition` 零命中。`src/index.ts` 仅 `export {}`。唯一 Cordis companion `src/invariant.ts` 是 no-op，JSDoc 写明 "registers nothing model-facing"。
- **无 Service Provider。** 不调用 `ctx.provides(...)` / `ctx.effect()` 暴露 `ctx.tui`。无 `declare module` 扩展 Context。OpenTUI store/renderer是私有机器。
- **仅为 Consumer + Provider，挂在别处拥有的 seam 上。** 对 `packages/interaction/` 两条 seam 注册 answerer：`ctx.userQuestions.registerProvider`（`src/answerers.ts:70`）、`ctx.on('approval/request')`（`src/answerers.ts:46`）。另订阅 `session/event`/`agent/status`（`src/runner.ts:174,178`）。
- **Bundle 组合。** `cordis.yml` 扁平挂载 ~10 个 capability 插件——组合层的实质。

### 官方文档背书

- `docs/user/develop/basic/index.md`：plugin 是导出 `apply` 的模块；**类形式**（`extends Service`）仅用于"插件需要向其他插件提供服务时"。TUI 服务**终端用户**，无 `ctx.tui` 被任何插件 inject——按此判据不该取类形式。
- `docs/user/develop/basic/publish.md`：bundle（`dsh.bundle` patch 层）vs profile（`dsh.profile` 组合）。TUI 是分发的 bundle；profile 是启动的组合。"Nothing is both."
- `docs/user/develop/cordis-tutorial/`：`declare module` 只加类型，"不生成运行时接线"。
- `docs/architecture.md:123`：UI 集成官方路径 = "drive `ctx.agents` and render from `session/event`"——TUI 已这么做。

### 无主机侧 render Service Definition 可挂

全 `packages/` 无 `ctx.render` / `ctx.view` / `ctx.display` / `ctx.ui`。仅浏览器侧 `ConversationNodeDefinition` + keyed renderer（`packages/client/`，client-half）。

## 为何现在不做 seam

1. **YAGNI + 拆分判据**：pre-release 单前端，三角色不会独立演进。
2. **渲染是进程级边界**：TUI 是独立 Bun bin，进程内 `boot()` 整个 Loader；OpenTUI 的 `bun:ffi` 在自己进程。in-process `ctx.<key>` service 模型不适配 FFI 跨越的边界（Node 无法加载 `.so`）。
3. **历史教训**：删除的旧 `dsh-tui` v0.0.1 把 `installAgentLlmTarget` 塞进 core，删除时连带移除 seam + 40 快照——过度伸进 core 是已验证失败模式。

## 发布形态：独立 bin（路径 A）

Bun-FFI 运行时不匹配决定此形态。`dsh --profile <name>` 经 `dsh` CLI 跑在 `node --import tsx/esm` 下；OpenTUI `createCliRenderer()` 的 FFI 只有 Bun 提供。兄弟 surface bundle（headless、web-app）的 surface 是 Node 原生（一次性 Agent / HTTP server）；TUI surface 是终端 FFI——天生独立进程。

故发布为独立 `dsh-tui` bin（`bun lib/bin.js`），经 npm 分发：`npm i -g @deepseek-ai/dsh-tui` 或 `npx @deepseek-ai/dsh-tui`。在 `dsh` 启动器获得 Bun 运行时模式、或渲染层去掉 `bun:ffi` 硬依赖之前，不做 `dsh --profile tui`。

## 何时重审

仅当**同时**满足时引入 `ctx.surface`/`ctx.render`：(1) 出现第二个真实前端；(2) 渲染协议需进程内统一。Provider 契约聚合 runner.ts + answerers.ts 已做的三件事。

## 范围外

- 路径 A 的发布机械（release-family 接线 vs 独立 `prepare` 脚本）是运维任务，非架构决策。
- 渲染层功能缺口（raw stdout、行模式 stdin）在 package README "Known Limitations" 跟踪，不改 bundle-vs-seam 结论。
