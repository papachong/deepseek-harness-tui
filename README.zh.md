# DSH TUI

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的终端界面——一个“一切皆插件”的 agent harness。DSH TUI 在进程内运行 agent 循环，并通过 OpenTUI（SolidJS）界面渲染：流式 markdown、按工具类型的卡片、主题与工作模式。

![DSH TUI 主页](patches/tui-screenshot-home.png)

特性：

- 主页与对话页，支持流式 markdown 回复
- 工具调用卡片：terminal、diff、read、search、web
- 带自动补全菜单的斜杠命令：`/model`、`/mode`、`/theme`、`/lang`、`/sessions`、`/clear`、`/compact`、`/goal`、`/plan`
- `@path` 文件提及与 `@[session]` 跨会话提及
- 侧边栏会话列表，支持恢复、审批提示、33 套主题
- Tab 循环切换的工作模式（standard / code / minimal / cordis），由 agent preset 驱动
- 运行时 UI 语言切换（`en` / `zh`），从系统环境变量检测，可用 `/lang` 覆盖
- `./.sessions` 下的 JSONL 会话持久化（用 `DSH_SESSION_ROOT` 覆盖）

## 安装

DSH TUI 是一个 dsh bundle，通过 npm 生态分发（无单文件二进制）。包以 `@ruhooai/dsh-tui` 发布，内含预构建的 `lib/`。

### 通过 dsh 安装（推荐）

把 bundle 装进一个 profile，再通过 profile 启动：

```sh
dsh plugin --profile default add @ruhooai/dsh-tui
```

将 `dsh-tui` 加入 profile 的 `dsh.profile.bundles`（`add` 命令会自动追加），然后运行 profile 的 bin。设置 `DEEPSEEK_API_KEY` 以进行实时模型调用；bundle 与 `package.json` 的 `"dsh"` 元数据见 [dsh 发布指南](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)。

### 直接通过 npm

```sh
bunx --bun @ruhooai/dsh-tui cordis.yml
```

需要 `@deepseek-ai/dsh-*` peer 包可解析（dsh profile 安装路径已满足；纯 `bunx` 需周边 `node_modules` 存在 peer 包）。

### 从源码构建（开发用）

需要 Node.js ^22.19 或 >=24（构建工具）与 [Bun](https://bun.sh) 1.3+（编译 Solid 视图并运行结果——OpenTUI 渲染器通过 `bun:ffi` 绘制，Node.js 不支持）。

```sh
git clone https://github.com/papachong/deepseek-harness-tui.git
cd deepseek-harness-tui
pnpm install          # needs Node.js ^22.19 or >=24, and Bun for the view build
pnpm run build        # tsc + tsdown bundles; Bun.build compiles the Solid view
cd packages/bundle/tui
echo 'DEEPSEEK_API_KEY=sk-...' > .env
bun lib/bin.js cordis.yml
```

要改界面，视图层位于 `packages/bundle/tui/src/view/`（SolidJS 组件、store、主题），REPL runner 在 `src/runner.ts`。用 `pnpm --filter @ruhooai/dsh-tui run build:view` 重建视图，再重新运行 `bun lib/bin.js`。

若想组合自己的 agent 而非改界面，写一份自己的 `cordis.yml`——挂载不同的插件、preset 或模型——并让二进制指向它。TUI 渲染组合所产出的一切。

二进制按以下非空优先级取组合配置：`$DSH_CORDIS_CONFIG`，其次位置参数。常用标志与环境变量：

- `--resume <sessionId>` — rebuild the agent on a persisted session
- `DSH_SESSION_ROOT` — session storage root (default `./.sessions`)
- `DSH_CWD` — working directory for bash and filesystem tools

### 计划中

- **单文件二进制**：每平台（Windows/macOS/Linux）下载即用的可执行文件作为未来探索的通道（经 `bun build --compile`），但上述 npm bundle 路径是官方分发方式。

## 参与贡献

欢迎在 [github.com/papachong/deepseek-harness-tui](https://github.com/papachong/deepseek-harness-tui) 提交 Issue 与 PR。推送前运行相关检查（`pnpm run typecheck`、`pnpm run lint`、聚焦的 `pnpm run test`）；仓库约定见 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)
