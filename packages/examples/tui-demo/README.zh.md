# @deepseek-ai/dsh-tui-demo

[English](README.md) | 中文

Phase 0 TUI 原型：一个 bin-only app，启动外部 `cordis.yml`，读一行 stdin，驱动一轮 agent turn，把流式 assistant 文本 + 工具行渲染到 stdout。它以 keyless 方式证明 in-process `session/event` → 终端渲染管道可行，不碰 `agent-loop`、不注册 profile。发布的 `dsh-tui-demo` bin 从配置工程解析 bare 插件；stdout 是终端 surface——无 JSON-RPC、无 TTY raw mode。

## 配置发现

第一个非空通道胜出：`$DSH_CORDIS_CONFIG`，其次位置参数 `argv[2]`。若两者均未指向已存在文件，bin 向 stderr 打印一行用法并以 exit 1 退出。设 `DSH_SNAPSHOT=replay` 可将同目录的 `cordis.yml` 换成 `cordis.snapshot.yml`，实现 keyless llm-replay（无需 `DEEPSEEK_API_KEY`）。`DSH_SESSION_ROOT` 覆盖 JSONL backend 根；`DSH_CWD` 覆盖 bash/filesystem 的 cwd。

## stdin 即任务

stdin 承载一行任务（管道或键入）。bin 在 `boot()` **之前**读它，以免管道写端立即关闭与 readline 挂载相竞态。stdout 是终端 surface；诊断走 stderr。

## Model Experience

间接，通过从外部 `cordis.yml` 加载的插件，由它们拥有所有绑定模型的 prompt、schema、message、result；本 bin 自身不增加任何此类内容。

#### KV Cache effect

无直接失效；具名 consumer 拥有任何 request-prefix 变更。

## Known Limitations and Deferred Work

- **仅一轮**——bin 驱动单次 `agent.followup` turn，渲染后退出；无 REPL 循环、无 `--resume`、无 session 列表。多轮交互是 Phase 1 产品 TUI 的工作，见 [TUI 分析 Agent Note](../../../.agents/notes/proposed/architecture/2026-08-18-tui-terminal-product-analysis.md)。
- **无审批或 ask-user answerer**——原型渲染事件但既未注册 `approval/request` answerer 也未注册 `UserQuestionService` provider，故任何请求审批的 turn 返回 `'unavailable'`（fail-closed）。产品 TUI 必须两者都注册。
- **原始 `process.stdout.write`，非终端渲染器**——流式文本与 `[tool/call]`/`[tool/result]` 行直接写出；无 ANSI SGR、无 markdown 折叠、无 card 组件、无 diff/todo/plan 渲染。渲染层是 Phase 2。
- **stdin 是行缓冲，非 raw-mode**——`terminal: false` readline；无按键处理、无 autocomplete、无 slash-commands。raw-mode 键盘输入是 Phase 2。
