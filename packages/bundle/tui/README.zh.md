# @deepseek-ai/dsh-tui

[English](README.md) | 中文

dsh 终端 UI bundle：一个多轮 in-process TUI REPL，跑在 agent spine 之上，带审批与 ask-user answerer，无 Host、HTTP server 或浏览器层。发布的 `dsh-tui` bin 启动外部 `cordis.yml`，读 stdin 行，每行驱动一轮 agent turn，把流式 assistant 文本 + 工具行渲染到 stdout，并从 stdin 回答审批/ask-user 提示。它是 standalone bin——不注册进 `PROFILE_TEMPLATES`——故不增加 in-tree core 编辑（见[上游跟随策略](../../../.agents/notes/proposed/architecture/2026-08-18-tui-solution-and-dev-plan.md)）。

## 配置发现

第一个非空通道胜出：`$DSH_CORDIS_CONFIG`，其次位置参数 `argv[2]`。若两者均未指向已存在文件，bin 向 stderr 打印一行用法并以 exit 1 退出。设 `DSH_SNAPSHOT=replay` 可将同目录的 `cordis.yml` 换成 `cordis.snapshot.yml`，实现 keyless llm-replay（无需 `DEEPSEEK_API_KEY`）。`DSH_SESSION_ROOT` 覆盖 JSONL backend 根；`DSH_CWD` 覆盖 bash/filesystem 的 cwd。

## stdin 即 REPL

stdin 每行承载一个任务（管道或键入）。bin 在 boot 前暂停 stdin，使管道写端的数据在异步 boot 中存活，然后在 boot 后创建行分发器（`src/input.ts`）并经 REPL 循环排空——每行驱动一次 `agent.followup` turn。stdout 是终端 surface；诊断走 stderr。

分发器是 readline 接口的**单拥有者**：每行恰好路由给一个消费者——有 pending 的审批/ask-user prompt 读取者则答复之，否则进入任务行队列。这修复了共享 readline 双消费 bug（审批答案行同时进入 REPL 迭代器、轮结束后被当作伪造任务行发给 agent）。readline 必须接 `output: process.stdout`：Node 不传 output 时 `rl.output` 为 undefined，`_writeToOutput` 静默丢弃全部回显/刷新写入（而 `terminal: true` 已关掉驱动层 ECHO），按键将永不显示。

内置 REPL 命令：`exit` / `quit` / `/exit` / `/quit` 干净结束 REPL（exit 0），不再作为任务发给 agent；Ctrl-D（EOF）与 Ctrl-C（SIGINT）同样可退出。

## Model Experience

间接，通过从外部 `cordis.yml` 加载的插件，由它们拥有所有绑定模型的 prompt、schema、message、result；本 bin 自身不增加任何此类内容。

#### KV Cache effect

无直接失效；具名 consumer 拥有任何 request-prefix 变更。

## Known Limitations and Deferred Work

- **原始 stdout，非终端渲染器**——流式文本与 `[tool/call]`/`[tool/result]` 行直接经 `process.stdout.write` 写出；无 ANSI SGR、无 markdown 折叠、无 card 组件、无 diff/todo/plan 渲染。渲染层（pi-tui 移植 + `presentation.ts` card 分派）是 Phase 2。
- **行模式 stdin，非 raw-mode**——`terminal: !isTTY ? false : true` readline；无单键审批（y/n 需 `<enter>`）、无按键处理、无 autocomplete、无 slash-commands。raw-mode 键盘输入是 Phase 2。
- **`--resume` 已支持**——`dsh-tui <config> --resume <sessionId>` 从 JSONL 重建冷会话并恢复 agent（镜像 api-proxy.ts:1626 的 `ctx.agents.resume`）；残留：replay fixture 与恢复会话的 turn-cursor 交互是测试数据限制，非 --resume 机制缺陷。
- **answerer 是行模式且阻塞 turn**——审批/ask-user answerer 经单拥有者行分发器读整行；在 warp session-share 下，`SharedSessionWriteToLongRunningCommands` 可能 gate 此行为，需改非阻塞 answerer（见[分析 note](../../../.agents/notes/proposed/architecture/2026-08-18-tui-terminal-product-analysis.md) §8）。
- **采集仅为 dry-run**——SessionEnd 钩子向 stderr 记录采集意图；真实 `sf memory capture` 延后到用户确认（Phase 3 风险 #4：必须复用 ai-cli 的脱敏/幂等）。
