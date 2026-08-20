# Agent Note: TUI 交互与渲染优化方案

Status: proposed

[English](2026-08-19-tui-optimization-plan.md) | 中文

## Problem

`packages/bundle/tui` 处于"Phase 1 交互可用、Phase 2 渲染层已移植未接线"的中间态。代码盘点（2026-08-19）发现八个具体问题：

1. **渲染能力是死代码。** `src/render/{markdown,cards,projections,ansi}.ts` 均已实现（即开发计划中的"纯 Node 回退"移植路径），但 `runner.ts` 的 `renderEvent()`（src/runner.ts:219-269）仍用原始 `process.stdout.write` 输出无样式纯文本；全仓库没有任何模块 import 这 4 个渲染文件。
2. **流式渲染是全量重渲染。** `TerminalMarkdown.append()`（src/render/markdown.ts:45-49）每次 chunk 都把整个累积文档重渲染成完整字符串；`incremental.ts` 只优化了解析（O(1)/chunk），渲染仍是 O(文档长度)/chunk——长回答下平方级，无法支撑真实 TUI 的增量重绘。
3. **共享 readline 双消费 bug。** `answerers.ts` 的 `readLine()` 用 `rl.once('line')`（src/answerers.ts:72-79），与 REPL 的 `for await (const line of rl)`（src/runner.ts:164）监听同一个 readline 接口。readline 的 'line' 事件广播给全部监听者：审批/提问期间用户输入的回答行会被 answerer 消费 **并且** 排入 for-await 迭代器队列——轮结束后被当作伪造任务行发给 agent。
4. **行模式交互。** 无 raw-mode keypress：无历史、无 Ctrl-R、无多行粘贴、无补全；审批必须回车；Ctrl-C 直接进程退出（src/runner.ts:87），不能先取消进行中的轮——而 `Agent.cancel(cause)` seam 已存在。
5. **输入/输出交错。** `[agent:status]` / `[tool/call]` / 审批提示在用户输入 `task>` 时直接 write，无保存/恢复协议；输出后 prompt 不重绘。
6. **无终端能力检测。** 无 NO_COLOR / FORCE_COLOR / dumb TERM 处理；stdout 是管道时渲染模块仍输出 ANSI；无宽度处理、换行、截断。
7. **零测试。** tests/ 只有 3 个 fixtures，无任何 `*.test.ts`；渲染模块是纯函数却无单测，fixtures 也没有 golden 断言。
8. **状态呈现粗糙。** `[agent:busy]` / `[tokens]` / `[turn/end]` 原始行；无 spinner、status bar、todos/plan 边栏。README 与实现漂移（README 称渲染层与 `--resume` 未落地，实际两者都已存在）。

## Proposal

### 核心决策：不引入 pi-tui，在现有纯 Node 渲染层上自建轻量 diff 渲染屏

现有 render/* 正是开发计划的"纯 Node 回退"路径，且本轮痛点（交互正确性、增量渲染）与 pi-tui 无关；pi-tui API 漂移（0.80.7 → 0.84.2，`TUI` → `TuiMainScreen`）未对账。自建 Screen 预算约 300 行；若复杂度超支，pi-tui 仍是同一接口后的替换回退（风险 5）。

### 目标架构（五层）

```
stdin ─> Input (raw-mode keypress dispatch; line-mode fallback when non-TTY)
           | task lines / keys / approval answers (single-owner line dispatch)
           v
       Runner (turn loop: followup → whenIdle → flush; keeps the Phase 1 seams)
           | session/event · agent/status
           v
       ViewModel (turns/steps/assistant md/tool cards/tokens/status/todos/plan)
           | versioned state snapshots
           v
       Renderer (md/cards/projections/ansi → line array; diff against last frame)
           | minimal repaint directives
           v
       Screen (TTY: cursor-addressed incremental repaint + input-line protection; pipe: plain text stream)
           v
       stdout
```

### 阶段划分（每阶段有独立门）

**Phase A —— 正确性 + 测试基座（先决）。**
1. 单拥有者行分发：新增 `src/input.ts` 统一持有 stdin 行流并内部路由——有 pending prompt → 答复；否则 → 任务行队列。REPL 循环改为 `await input.nextTaskLine()`；删除 answerers 的旁路 `readLine()`。修复双消费 bug。
2. 测试基座：`tests/*.spec.ts`；渲染模块纯函数单测（incremental / ansi / markdown / cards / projections）；用 tests/fixtures/*.session.jsonl 驱动 golden 测试（事件序列 → 渲染行输出）；双消费回归测试。
3. 门：`npm test -- --run packages/bundle/tui` 全绿；双消费回归测试存在。

**Phase B —— 视图模型 + 增量渲染接线（核心）。**
1. `src/view.ts`：SessionView（turns[] / status / todos / plan / tokens），替代 runner.ts:137-144 的内联订阅。
2. `src/render/diff.ts` + Screen 增量协议：markdown 按块 emit——冻结块只追加写一次，尾部块变化仅重写尾部行（每块记录行数）；行级 diff 输出最小重绘。
3. `src/screen.ts`：终端检测（TTY / 颜色 / 宽度 / dumb），TTY 模式（隐藏光标、输入行保护、增量重绘、resize 重排），管道模式（纯文本流——即现状语义）。
4. runner.ts 接线：删除内联 renderEvent/status 写；状态呈现升级（轮内 status 行、轮末 tool 摘要）。
5. 门：3-turn golden 一致；断言每 chunk 只写新增行；管道模式输出无 ANSI。

**Phase C —— raw-mode 交互。**
1. Input raw-mode：`setRawMode(true)` + keypress；历史（内存 + `~/.dsh/tui_history`）；Ctrl-R 反向搜索；Ctrl-L 清屏；多行粘贴；上下键历史。
2. Ctrl-C 语义：有进行中轮 → `agent.cancel(cause)`（seam 已存在）；空闲 → 退出。
3. 审批/ask-user 单键交互：y / n / Enter / Esc；非阻塞 pending prompt 渲染在状态区，不打断输入。
4. 补全（M1）：dsh commands + cwd 路径。
5. 门：伪终端（node-pty）键位集成测试；warp session-share 实测审批不被 gate。

**Phase D —— 终端适配与规模化。**
1. 宽度/长行：ANSI 感知自动换行、超长截断 `…`、大输出可折叠（expand）。
2. resize 全量重排；万事件会话增量渲染保持 O(diff)；status 防抖刷新。
3. 非 TTY 管道 golden 纳入 CI。
4. 门：40/120 列重排；万事件基准；pipe golden 无 ANSI。

**Phase E —— 产品化（远期，不承诺）。**

`$DSH_HOME/tui.json` 配置；BFF SSE 远程接线（transport 骨架已存在）；会话列表 + `--resume` 完善；todos/plan 右栏；README 双语同步。

### 关键设计细节

- **输入/输出协作协议**：`Screen.beginInputEdit()` / `endInputEdit()`——写输出前保存光标并清输入行，输出后重绘输入行；内容区滚动，状态区固定末行。
- **markdown 增量 emit**：`renderBlocks()` 返回 `{ frozenDelta, tailLines, tailLineCount }`；Screen 对冻结块追加写，对尾部块 diff 重写。
- **终端检测**：`detectTerminal(stdout) → { color: truecolor|256|basic|none, width, raw }`，NO_COLOR / FORCE_COLOR / CI 优先。
- **取消轮**：`agent.cancel(cause, { keepInbox })` 保留队列、中止活动轮（Agent API 已提供）；若收敛异常，兜底忽略事件至 `turn/end`。

## Acceptance criteria

- Phase A：双消费回归测试存在且通过；render/* 纯函数测试覆盖各模块；包测试全绿。
- Phase B：3-turn golden 通过；增量写行断言通过；管道模式输出无 ANSI；不改 core / PROFILE_TEMPLATES。
- Phase C：键位集成测试通过；warp 实测审批闭环。
- Phase D：resize / 长行 / 万事件基准通过；pipe golden 进 CI。
- 每阶段：新代码全在 packages/bundle/tui/ 内；README 双语同步；保持上游跟随（加法优先）。

## Risks

1. **`agent.cancel` 收敛行为未验证** —— cancel 后的事件序列（turn/end？agent/disposed？）需实测；若收敛异常，Ctrl-C 取消退化为"忽略输出至 turn/end"。
2. **raw-mode 竞态** —— resize、bracketed paste、信号投递；缓解：保留非 TTY 回退路径 + 伪终端集成测试。
3. **warp session-share 门控** —— 已知（开发计划风险 3）；非阻塞 answerer + live 实测。
4. **大输出内存** —— 折叠 + 截断，不缓存全量 ANSI 文档。
5. **自建 Screen 复杂度失控** —— 300 行预算；超预算回退 pi-tui（同一接口后的替换实现）。

## Alternatives considered

- **pi-tui 渲染栈**：有先例与 40 个归档快照，但 API 漂移未对账、不解决交互/正确性痛点；保留为 Phase B 失败回退。
- **全量重绘（非 diff）**：简单但 O(n²) 且闪烁；否。
- **仅修 bug + 补测试（不做体验）**：降低风险但无产品价值提升；否。
- **ink 等 React 终端框架**：新依赖、风格不符（仓库偏好纯 Node）；否。
- **共享 readline 加锁**：双消费是 EventEmitter 广播语义，加锁无法消除第二个消费者——必须单拥有者；否。
