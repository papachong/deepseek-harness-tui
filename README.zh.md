# DSH TUI

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的终端界面——一个“一切皆插件”的 agent harness。DSH TUI 在进程内运行 agent 循环，并通过 OpenTUI（SolidJS）界面渲染：流式 markdown、按工具类型的卡片、主题与工作模式。

![DSH TUI 主页](patches/tui-screenshot-home.png)

特性：

- 主页与对话页，支持流式 markdown 回复
- 工具调用卡片：terminal、diff、read、search、web
- 带自动补全菜单的斜杠命令：`/model`、`/mode`、`/theme`、`/sessions`、`/clear`、`/compact`、`/goal`、`/plan`
- `@path` 文件提及与 `@[session]` 跨会话提及
- 侧边栏会话列表，支持恢复、审批提示、33 套主题
- Tab 循环切换的工作模式（standard / code / minimal / cordis），由 agent preset 驱动
- `./.sessions` 下的 JSONL 会话持久化（用 `DSH_SESSION_ROOT` 覆盖）

## 下载发布包

预构建的单文件二进制发布在 [GitHub Releases](https://github.com/papachong/deepseek-harness-tui/releases)——无需安装运行时，可执行文件已内嵌一切：

| 平台 | 产物 |
| --- | --- |
| Windows x86-64 | `dsh-tui-windows-x64.exe` |
| macOS Intel | `dsh-tui-macos-x64` |
| macOS Apple Silicon (arm64) | `dsh-tui-macos-arm64` |
| Linux x86-64 (Debian/Ubuntu, `.deb`) | `dsh-tui-linux-x64.deb` |

未来版本将提供一行在线安装命令。

设置 [DeepSeek API key](https://platform.deepseek.com)，然后用一份组合配置运行二进制（从本仓库复制默认的 [`packages/bundle/tui/cordis.yml`](packages/bundle/tui/cordis.yml)）：

```sh
# macOS / Linux
export DEEPSEEK_API_KEY=sk-...        # or put it in a .env next to your config
chmod +x ./dsh-tui-macos-arm64
./dsh-tui-macos-arm64 path/to/cordis.yml

# Linux (.deb) installs dsh-tui onto PATH
sudo dpkg -i dsh-tui-linux-x64.deb
dsh-tui path/to/cordis.yml
```

```powershell
# Windows (PowerShell)
$env:DEEPSEEK_API_KEY = "sk-..."
.\dsh-tui-windows-x64.exe path\to\cordis.yml
```

二进制按以下非空优先级取组合配置：`$DSH_CORDIS_CONFIG`，其次位置参数。常用标志与环境变量：

- `--resume <sessionId>` — rebuild the agent on a persisted session
- `DSH_SESSION_ROOT` — session storage root (default `./.sessions`)
- `DSH_CWD` — working directory for bash and filesystem tools

## 从源码构建

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

要改界面，视图层位于 `packages/bundle/tui/src/view/`（SolidJS 组件、store、主题），REPL runner 在 `src/runner.ts`。用 `pnpm --filter @deepseek-ai/dsh-tui run build:view` 重建视图，再重新运行 `bun lib/bin.js`。

若想组合自己的 agent 而非改界面，写一份自己的 `cordis.yml`——挂载不同的插件、preset 或模型——并让二进制指向它。TUI 渲染组合所产出的一切。

## 参与贡献

欢迎在 [github.com/papachong/deepseek-harness-tui](https://github.com/papachong/deepseek-harness-tui) 提交 Issue 与 PR。推送前运行相关检查（`pnpm run typecheck`、`pnpm run lint`、聚焦的 `pnpm run test`）；仓库约定见 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)
