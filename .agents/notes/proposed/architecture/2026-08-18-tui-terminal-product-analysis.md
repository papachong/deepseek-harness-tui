# Agent Note: Terminal product form for deepseek-harness (TUI)

Status: proposed

English | [中文](2026-08-18-tui-terminal-product-analysis.zh.md)

## Problem

deepseek-harness ships three surfaces today — headless one-shot, the Web browser app, and ACP/JSON-RPC automation — and **none of them is a TUI**. A full-repo search for `ink`/`blessed`/`inquirer`/`prompts`/`terminal-kit` in `package.json` files returns zero hits, and a search for `createInterface`/`setRawMode`/`isTTY`/`readline`/`process.stdin.on('data'|'keypress')` hits nothing on any production path (the only `process.stdin` uses are `packages/examples/acp-demo/src/bin.ts:31` and `packages/examples/jsonrpc-demo/src/runner.ts:51`, both EOF-driven protocol servers, not keypress readers).

Yet the architecture has left TUI entry points in place:

- **The launcher reserves a `tui` profile.** `apps/cli/reference/README.md:46-48` lists `dsh --profile tui --resume <id>` as a future surface, and `packages/boot/app-boot/src/profile.ts:121` (`PROFILE_TEMPLATES`) currently defines only `web`/`headless`. The seam exists; only the bundle is missing.
- **The spine is event-sourced.** `agent-loop` writes every fact (token delta, tool call, approval) to `SessionEventMap` (`packages/core/session/src/types.ts:236`); the UI is an observer. The "model-visible ⟺ logged" invariant (`docs/architecture.md:96`) guarantees a TUI can rebuild a full transcript from either the live stream or the JSONL log.
- **Render intent is already pure data.** The `card` discriminated-union provider in `packages/core/tools/src/presentation.ts` is provider-neutral, replay-safe, and discriminated; a TUI consumes it directly.
- **An MCP client already exists.** `packages/mcp/mcp-client` (`@modelcontextprotocol/sdk` ^1.12.0) connects external MCP servers and registers their tools on `ctx.tools` — the ready base for loose coupling to an external memory platform.
- **Phase 0 is verified.** `packages/examples/tui-demo/` (`@deepseek-ai/dsh-tui-demo`) is a standalone bin, keyless via llm-replay, with `verified: true` — the in-process `session/event` → terminal render pipeline runs (streaming tokens + tool call/result lines).

The change is therefore **add a bundle + a terminal render layer + an optional remote client transport, without touching `agent-loop`** (honoring the `CLAUDE.md` rule "Plugins, not loop changes").

## Proposal

### Three modes coexist (analogous to Claude Code)

Constraint: the dsh TUI stays **loosely coupled** to warp/SF (like CC ↔ warp/SF, related through CLAUDE.md/MCP/CLI/Agent/Skills/Rules/hooks) and **retains independent remote-development capability** (it still works locally or webUI-style against a server without warp/SF).

| Mode | agent runs on | TUI role | without warp/SF | remote | collaboration source |
|---|---|---|---|---|---|
| **Local in-process** `dsh-tui-demo` (Phase 0 verified) / `dsh --profile tui` | local | local agent + local TUI | ✅ | local | — |
| **Remote thin client** `dsh --profile tui --remote <url>` | server | HTTP/SSE client to the dsh Web BFF | ✅ | ✅ | — |
| **Inside warp** TUI runs in warp | local | local agent, terminal byte stream shared | depends on warp | local+shared | warp session share |

The "retain a server" constraint means **keep dsh's own Web BFF** (`packages/bundle/web-app`'s `dsh-host-apiproxy`) and make the TUI a client of it, **not build a new server**. The BFF already forwards `session/event` + `approval/requested` + `question/requested` verbatim (the browser is its existing client).

### Current state: three walls, no TTY

| Surface | transport | form | file:line |
|---|---|---|---|
| Headless one-shot | in-process | writes the last non-empty assistant text to stdout, exit 0/1, no streaming | `packages/bundle/headless/src/index.ts:129-133` |
| Web browser | HTTP/SSE | React 18 app, full event replay | `packages/bundle/web-app/src/index.ts`; `packages/client/web-react/package.json:31` |
| ACP stdio | JSON-RPC stdio | automation-only, strips live progress/reasoning/tool/plan/title | `packages/acp/acp/README.md:7,78,80` |
| JSON-RPC SDK | stdio JSON-RPC | forwards `session.event` verbatim, 3 requests + 4 notifications | `packages/sdk/server/src/server.ts:53-240` |

### Minimal program surface the TUI must wrap

**Type spine:**

- `Agent` interface — `packages/core/agent/src/runtime-types.ts:64-144`: `id`, `options`, `session`, `inbox`, `status`, `followup`, `steer`, `inject`, `cancel`, `whenIdle`.
- `AgentLoop` — `packages/core/agent-loop/src/index.ts:296`, `static inject = ['agents','sessions','llm','tools','systemPrompt']`.
- `AgentRegistry.create(options)` — `packages/core/agent/src/index.ts:405`.
- `Session.append(type, data, ...opts)` — `packages/core/session/src/index.ts:604`, the only legal event write point.
- `SessionEventMap` — `packages/core/session/src/types.ts:236-335` (merge-extensible).

**One turn's execution trace:** `ReactLoopAgent` (`packages/core/agent-loop/src/agent.ts:64`): `ctx.agents.create` → `agent.followup(msg)` → `wakeDriver` → `kick()` (`:210`, `while(await this.turn())`) → `turn()` (`:246`, `turn/start`) → each step: `preStep` (`:225`, claim inbox, assemble system prompt, `agent/pre-step` waterfall) → `buildRequest` (`:407`, frozen config) → `step()` (`:332`, `llm.stream` → append `assistant/chunk` per chunk, `BlockAssembler` folds, `finish` appends `assistant/message`) → `executeToolCalls` (`packages/core/agent-loop/src/tool-calls.ts:59`, append `tool/call`+`tool/result`) → `step/end` → `agent/turn-stopping` may `steer` → `turn/end`. `kick` exits → `agent/status{idle}` → `whenIdle()` resolves. Caller reference `packages/bundle/headless/src/index.ts:111-134`; Phase 0 `packages/examples/tui-demo/src/runner.ts` reuses this flow.

**Event firehose (TUI render source):** `session/event` (`packages/core/session/src/index.ts:641-647`) carries each `SessionEvent` verbatim:

| event.type | use | file:line |
|---|---|---|
| `assistant/chunk` | token-level stream (`text-delta`/`reasoning-delta`/`tool-call-delta`/`usage`/`finish`) | `types.ts:266`; `packages/llm/llm/src/types.ts:312-330` |
| `assistant/message` | folded full assistant message + usage | `types.ts:273` |
| `tool/call` / `tool/result` | tool call/result (`meta` carries replayable projection) | `types.ts:279,291-297` |
| `todo/write` | todo full snapshot (last-write-wins) | `types.ts:299` |
| `turn/start\|end` / `step/start\|end` | structural boundary | `types.ts:243-256` |
| `approval/asked\|decided\|policy` | audit (log-only, not in model transcript) | `packages/interaction/user-approval/src/index.ts:34-73` |
| `agent/inbox/spliced` | inbox change (steering source) | `packages/core/agent/src/types.ts:19` |

`assistant/chunk` is the raw token delta, persisted verbatim — TUI streaming render and log replay share one path. Phase 0 measured: `BlockAssembler` (`packages/llm/llm/src/assembler.ts`) folds chunks into visible text, `tool/call`+`tool/result` render as `[tool/call]`/`[tool/result]` lines.

### Render layer: gaps and reuse

Existing render primitives are all React/DOM: `packages/client/ui-primitives/package.json:29-50` pulls `anser` (ANSI SGR parse), `shiki` (syntax highlight), `mdast-util-*` (GFM+math), `katex`, `react`/`react-dom`.

High-value reuse candidates (pure logic, portable):

| module | value | file:line |
|---|---|---|
| `ansi.ts` | full ANSI SGR parse + cursor-movement replay + wide chars + theme token map | `packages/client/ui-primitives/src/ansi.ts:1-447` |
| `markdown/incremental.ts` | streaming append-only markdown parse, O(1)/chunk | `packages/client/ui-primitives/src/markdown/incremental.ts` |
| `markdown/parse.ts` | GFM+math grammars | same directory |
| `markdown/plain-text.ts` | plain-text extraction | same directory |

Gap vs Claude Code TUI:

| Claude Code TUI capability | dsh current state | change |
|---|---|---|
| streaming markdown | `IncrementalMarkdownParser` exists but is bound to React | bind a terminal markdown renderer |
| tool approval card | `ApprovalService` seam-only, fail-closed | TUI registers an answerer |
| todo panel | `todo/write` projection exists | read the `sessionProjections` `todos` key, terminal sidebar |
| plan mode | `plan` projection + `exit_plan_mode` + `plan-review` intent | consume `plan` projection + special render intent |
| diff view | `DiffBlock.tsx` React, `DiffHunk` pure data | terminal diff renderer (greenfield) |
| slash-commands | `CommandRuntime` extensible, `/permission` `/compact` `/plan` `/goal` `/feedback` `/export-log` registered | build autocomplete over `list(agent)` |
| keyboard input | zero TTY code | `setRawMode` + readline/keypress (Phase 0 verified the stdin path) |

Render intent is already a pure data contract: `packages/core/tools/src/presentation.ts` defines `ToolCallView` (`:46`) / `ToolResultView` (`:140`). The `ToolDefinition` hooks `presentCall?`/`presentResult?` (`packages/core/tools/src/index.ts:271-287`) are **pure functions** (`docs/cookbook/adding-a-tool.md:84-88`). The TUI dispatches on the `card` discriminant.

Per-tool render intent: bash→`terminal`, write/edit→`diff`, read→`read`, grep/glob→`search`, web→`web`, exit_plan_mode→`generic`(plan), todo_write→projection (not a card). todo/plan-mode are session projections (`todos`/`plan`), consumed via `sessionProjections`.

TUI-owned session-context duties: `TerminalCallView.cwd` relative-path resolution (`presentation.ts:96-99`), `ReadResultView.path` relativization (`:285`), bash exit-code parse (`packages/shell/tool-bash/src/render.ts:103`), spill file (`tool-bash/src/index.ts:166-181`).

### Interaction loop: approval / ask-user / commands

**Approval** (fail-closed, the TUI must register an answerer): `ApprovalService` (`packages/interaction/user-approval/src/index.ts:192`), `ApprovalPolicy='ask'|'never'` (`:94`), no answerer returns `'unavailable'` (`:309-329`). `ApprovalOutcome='allowed-once'|'rejected'|'cancelled'|'unavailable'` (`types.ts:29`). The answerer is an `approval/request` waterfall listener that **must call `next()`**. The only production answerer is the Web BFF (`api-proxy.ts:1391-1450`). The TUI must register an answerer. Reference `api-proxy.ts:1391-1450` and `acp/src/index.ts:271-289`.

**ask-user** (provider-only): `UserQuestionService` (`packages/interaction/user-questions/src/index.ts:38`), `registerProvider` (`:64`), no provider throws `NO_PROVIDER`. `intent:'plan-review'` (`types.ts:23-32`). The TUI must `registerProvider`; `plan-review` gets special rendering.

**slash-commands** (extensible): `CommandRuntime` (`packages/interaction/commands/src/index.ts:225`), per-agent `ScopedLayers`. `register` (`:245`), `execute` (`:297`), `list` (`:260`). The TUI builds its own autocomplete.

**terminal package** (not a TUI host): `packages/terminal/` is an agent-driven persistent-PTY capability (`terminal/src/index.ts:105`), per-agent, audited, sandbox-fenced. It provides a pty, not a canvas. TUI reuse: consume the pty output stream (like the Web client's `bash-sample.tsx` but with a terminal renderer), or register a new `TerminalBackend`.

### warp session-share: the realtime collaboration layer (external, uncoupled)

Investigation of `/data/AI_Dev/warp` + `/data/AI_Dev/sf/ai-hub` concludes:

- **Terminal-stream-level sharing (tmux-style):** PTY bytes are the render-output source of truth, relayed through a server (ai-hub Socket.IO, production `wss://sessions.app.warp.dev`, OSS patches 0001/0006 repoint to ai-hub).
- **Viewer can input:** `WriteToPty` bytes land verbatim on the sharer's PTY master fd, traced to `local_tty/event_loop.rs:289 self.pty.writer().write(bytes)` — the same path as a local keypress. Gating: `SharedSessionWriteToLongRunningCommands` + long-running block + Executor role.
- **Running CC/dsh inside warp:** what is shared is the TUI's **terminal render bytes + keypress stream**, not app-level structured sharing.
- **Hybrid model:** PTY bytes = render truth; app-level sideband events layered above (`CommandExecutionStarted/Finished` with `participant_id`+AI metadata, `AgentResponseEvent`, CRDT `InputUpdate`, initial `Scrollback`).

Impact on the dsh TUI:

- **No collaboration code to write:** the dsh TUI running in warp gets terminal-stream sharing + approval collaboration for free (the approval answerer reads stdin keypresses; warp writes the viewer's keypresses verbatim to the same PTY stdin → the viewer can answer the approval card directly).
- **Sidesteps the SDK approval gap:** in warp mode, approval goes through PTY stdin, not the SDK wire.
- **Gating risk:** warp viewer writes are gated on `SharedSessionWriteToLongRunningCommands` + the long-running block. Whether dsh's blocking approval readline is judged long-running needs measurement — if not, the answerer must become non-blocking or carry an explicit long-running marker.
- **Historical clue:** `DiffBlock.tsx:1-9` comments "Unlike the TUI's exact changed-row comparison", hinting the repo once had a TUI reference point; git history may surface reusable design decisions.

warp and requirement #1 (multi-session semantic transparency) are two problems: warp = real-time co-viewing of one session; requirement #1 = cross-session/cross-time semantic transparency across N sessions each running its own AI. warp solves the former; the SF platform + memory scheme solves the latter.

### SF loose coupling and staged memory adoption

Loose-coupling four-pack (analogous to CC ↔ warp/SF):

| surface | CC's approach | dsh TUI equivalent | dsh current state |
|---|---|---|---|
| MCP | CC connects MCP servers for external tools | `dsh-mcp-client` connects SF `ai-mcp-adapter` (`memory.recall/get/feedback`) | **exists** `packages/mcp/mcp-client` |
| CLI | CC calls external CLIs | SessionEnd lifecycle event → call `sf memory capture` (dsh as the ai-cli role) | needs a capture hook in tui-runner |
| CLAUDE.md/AGENTS.md | project-level hard rules | `workspaceContext` (AGENTS.md loader, agent-spine-demo already attaches) | **exists** |
| Skills/Rules/hooks | CC native | `dsh-skill` + `packages/hooks/` (hooks-claude-code bridge reads CC hooks.json) | **exists** |

Loose coupling holds: every dsh dependency on SF collapses to "one MCP server config + one CLI call + project-level AGENTS.md", and pulling it leaves dsh independently runnable.

Staged memory adoption (no second authority): the memory scheme (`/data/AI_Dev/sf/ai-docs/productionDesign/多人AI协作开发大模型记忆管理技术方案.md`) directly serves requirement #1 ("the AI has sufficient context, fewer conflicts"). But the full governance loop (Evidence→Candidate→Version→Review→Revoke→Policy + Gateway L3/L4 + golden-corpus eval) is a large SF four-repo effort (`ai-core`/`ai-mcp-adapter`/`ai-tool-gateway`/`ai-cli`); the scheme's own §13 stages it M0-M5. dsh TUI is a harness, not the SF control plane; the memory authority lives in ai-core, and dsh must not build a second authority (ADR-MEM-001 + invariant 6 fail-closed).

dsh plays = the memory scheme's `ai-cli` (thin collection adapter) + a recall consumer, not `ai-core`. Staged:

| TUI Phase | memory adoption | scheme milestone |
|---|---|---|
| Phase 0-1 (TUI body) | no memory adoption, get the single-machine TUI running first | — |
| Phase 2 (render layer) | adopt `memory.recall` as an in-process tool (via `dsh-mcp-client` → `ai-mcp-adapter`), letting the TUI's AI recall cross-person cross-session history | M3 partial |
| Phase 3 (interaction deepening) | SessionEnd triggers Evidence capture: dsh session-lifecycle event → reuse `sf memory capture` (do not rewrite collection/redaction/queue/replay, reuse ai-cli's already-fixed §8.3.1) | M2 partial |
| later (separate decision) | full governance loop driven by the SF four repos; dsh only consumes | M4-M5 |

## Acceptance criteria

- **Phase 0 (prototype, verified):** `packages/examples/tui-demo/` standalone bin, keyless, proves the event-stream → render path. Demonstrated on bash-tool and text-turn fixtures: `task> [agent:running]` → `[tool/call] bash(...)` → `[tool/result] [ok] ...` → `[turn/end] completed` → `[agent:idle]`; text-turn pure streaming also renders. Reproduce with `node --import tsx/esm packages/examples/tui-demo/src/bin.ts` (Node v22+). Two real bugs fixed: (1) stdin must be read before `boot()` to buffer; (2) `rl.close()` cannot be called inside the line handler (a synchronous close event lets a tick overwrite `resolve(l)`).
- **Phase 1 (product TUI bundle, in-process):** `packages/bundle/tui/` (mirrors `headless`/`web-app`) + `tui-startup` + `tui-runner`. `ctx.agents.create` + `ctx.on('session/event')` + register approval/ask-user answerer + `setRawMode` + `BlockAssembler` + `ctx.appExit`. **Standalone bin + overlay, does not register in `PROFILE_TEMPLATES`** (per the upstream-follow strategy below).
- **Phase 2 (render layer + BFF SSE transport):** pick a terminal render stack (reuse pi-tui — precedent exists); port `ansi.ts`/`markdown/incremental.ts`; implement the 8 card components + todo/plan projection; write an `EventSourceTransport` adapter to the BFF; slash-command autocomplete. Connect `memory.recall` via `dsh-mcp-client` (M3 partial).
- **Phase 3 (interaction deepening + capture):** Code Mode sub-call render (`tool/code-dispatch-*`); spill file/exit code/cwd; `--resume` rebuild from JSONL; SessionEnd calls `sf memory capture` (M2 partial). Dual-transport swappable adapter.
- **No `agent-loop` change** in any phase (honors `CLAUDE.md` "Plugins, not loop changes"). Any core-file change is first evaluated for an overlay/new-package bypass; only if no bypass exists does it enter a patch series.

## Risks

1. **Remote transport choice — decided BFF SSE, Phase 2 does BFF only, SDK deferred.** Source-level verification: the BFF mux stream already closes the loop on approval/ask-user (`approval/requested`/`question/requested` + `POST /api/respond`); the SDK is a "dead capability" (the server never `transport.request`, `FakeTransport` asserts it never will, the client has no `onRequest`). A dual-transport adapter architecture is retained so the SDK can be attached later for automation scenarios once it gains the approval wire.
2. **Render-stack choice — precedent exists.** The former TUI used `@earendil-works/pi-tui` (npm 0.84.2 online; the former used 0.80.7). Phase 2 evaluates pi-tui as the primary (its `TUI`→`TuiMainScreen` API has drifted and needs reconciliation); the 40 `terminal.expected.txt` pixel-exact snapshots are the deterministic acceptance standard for the rebuild. The choice is no longer "ink vs a pure-Node library" — there is a precedent to follow.
3. **warp approval gating.** Whether `SharedSessionWriteToLongRunningCommands` covers dsh's blocking approval readline needs measurement; if not, the answerer becomes non-blocking.
4. **Memory double-authority boundary.** dsh only plays `ai-cli` + recall consumer; the governance loop belongs to the SF four repos. Any capture must reuse `sf memory capture`, not bypass ai-cli's redaction/idempotence/SDK child guard.
5. **Agent Note compliance.** Merge requires bilingual pairing + `verify-doc-budgets` + a companion keyless snapshot (`CLAUDE.md` testing policy).
6. **Pre-release stance** (`CLAUDE.md`): no external consumers, so prefer the correct foundation over compatibility shims.

## Alternatives considered

### Remote transport: BFF SSE (chosen) vs JSON-RPC SDK (deferred) vs ACP vs Remote BFF/Typert

For constraint 2 ("retain independent remote-development capability"), the TUI remote thin-client transport **is decided as BFF SSE**. Source-level per-cell verification against `packages/host/apiproxy/src/api/events.ts`, `api-proxy.ts`, `fetch/handler.ts`, `api-request-trust.ts`, `packages/sdk/protocol/`, `packages/sdk/server/`, `packages/sdk/client/`.

Decision matrix (every cell file:line):

| dimension | BFF (A) chosen | SDK (B) deferred |
|---|---|---|
| drive turn | `POST /api/session.prompt` (`fetch/handler.ts:99`, `api-proxy.ts:2401-2457`) | `session/prompt` (`types.ts:34-45`, `server.ts:190-201`) |
| streaming token | `session/event` verbatim `SessionEvent` (`events.ts:70`) | `session.event` (`types.ts:51-56`, `server.ts:71-74`) |
| tool call/result | `session/event` + host-computed `view` (`api-proxy.ts:713-749`) | `session.event` only, no `view` |
| todo | `session/projection` (`events.ts:107`) + `session/queue` (`:84`) | no dedicated frame (`types.ts:92-98`) |
| approval request | ✅ `approval/requested` (`events.ts:72`, `api-proxy.ts:3384`) | ❌ dead capability |
| approval answer | ✅ `POST /api/respond` (`api-proxy.ts:3633-3647`), `ApprovalResponsePayload` (`approvals.ts:17-21`) | ❌ no `onRequest` (`client.ts:257-260`) |
| ask-user | ✅ `question/requested`+`POST /api/respond` (`api-proxy.ts:3648-3678`), `QuestionResponsePayload` (`questions.ts:16-19`) | ❌ same gap as approval |
| host-computed render intent | ✅ `viewFor` (`api-proxy.ts:713-749`), `ToolEventView` (`events.ts:24-35`) on the `session/event` `view` slot | ❌ protocol has no `ToolEventView` (`types.ts:92-105`) |
| resume/list | ✅ `session.list` (`sessions.ts:233`) + `session.history` (`:282`, `HistoryEntry` with `view`) | ❌ switch has no list/history/resume case |
| non-browser auth | Host-header fence, loopback credential-free (`api-request-trust.ts:96-123`) | stdio spawn, no auth |
| existing consumer | browser WS client (`client/connection/src/index.ts:174-194`) | `HarnessClient` (`client.ts:184`) |

Decisive reason: **approval + ask-user close the loop on the BFF today; the SDK is a "dead capability".** This is a product-level hard requirement and cannot wait.

- The BFF mux stream (`events.ts:69-108`) already carries `approval/requested`/`resolved` (`:72-73`), `question/requested`/`resolved` (`:74-75`), all answered via `POST /api/respond` (`fetch/handler.ts:296-300`).
- The SDK gap is not "to be enabled" but "does not exist": the server only `transport.notify`s, never `request`s (`server.ts:73-102`); `FakeTransport` **asserts** the server never `request`s (`server.spec.ts:19-29`); the client only installs `onNotification` (`client.ts:257-260`); `protocol/README.md:39` states "dead capability" verbatim. Filling the SDK requires touching 3 packages (protocol types + server emit site + client onRequest) + overturning the `FakeTransport` assertion + rewriting `viewFor`, violating the minimal-new-code rule.

BFF bonus — host-computed `ToolEventView`: `viewFor(...)` (`api-proxy.ts:713-749`) computes `ToolEventView` (`events.ts:24-35`) server-side and hangs it on the `session/event` `view` field (`api-proxy.ts:3425-3430`). **The TUI consumes the host-computed render intent directly, skipping its own `presentCall/presentResult` calls** — matching "webUI-style interaction with the server": the TUI is the thin view at the browser's layer. The SDK has no such type.

Decided open items: Phase 2 does BFF only, SDK deferred (confirmed 2026-08-18). The SDK remains an optional transport for later automation/headless scenarios, to be attached once it gains the approval wire. The dual-transport adapter architecture (`EventSourceTransport` vs `JsonRpcTransport` unified into one `SessionEvent` stream feeding one render layer) is retained so a later SDK swap is smooth.

Three-mode transport landing:

| mode | transport | event source |
|---|---|---|
| local in-process | direct `ctx.on('session/event')` | in-process event firehose (Phase 0 verified) |
| remote thin client | BFF SSE (`EventSource` + `POST /api/respond`) | HTTP/SSE + host-computed `view` |
| inside warp | terminal byte stream (no transport) | PTY bytes + `BlockAssembler` |

Rejected alternatives: ACP — automation-only, strips live progress, fresh-session-only (`README.md:7,78,80`). Remote BFF / Typert — remote multi-tenant; Typert is a type-graph registry, not a client transport.

### Former-TUI recovery: rebuild from spec, do not mechanically restore

The repo once had a complete `@deepseek-ai/dsh-tui` v0.0.1, in the deleted `ui/tui` package directory (84 files, src 7676 lines + tests 10321 lines + 40 `terminal.expected.txt` render snapshots) + `apps/cli/` (`src/tui.ts`, `config/tui.cordis.yml`, `src/tui-onboarding/`, `tests/pty-harness.ts`). Commit `10bb9cbf4a` (2026-08-04) "cleanup: remove TUI package and legacy dsh entrypoints" deleted it in one pass and archived 114 design notes the same day.

Removal reason (established): not technical debt, but the pre-release stance (`CLAUDE.md` "Pre-release stance: foundation over blast radius") moving a not-yet-external surface out of the first RC (`dsh-v0.1.0-rc.7` was tagged 13 days after the deletion). The same day still merged PR #1359 `perf/tui-long-session-render` at 10:06, then deleted everything at 13:20 — the surface was judged "not RC-ready" and moved out of blast radius, not a failure.

Former-TUI artifact: renderer `@earendil-works/pi-tui` (npm still online, 0.84.2; the former used 0.80.7). Module structure: `src/{runtime,prompt,config,index,invariant}.ts` + `chat/` (autocomplete/channel/file-autocomplete/model-command/questions/resume/skill-invocation/timing/tokens) + `components/` (content/dialogs/text/theme/transcript/xml-tool-output) + `extension/` (overlay-manager/types, the `ctx.tui.openOverlay()` FIFO arbiter). The 40 snapshots carry pixel-exact SGR specs like `terminal 96x36 buffer=normal` + per-line `style N-M fg=bright-magenta bold underline` — the **deterministic acceptance standard for the rebuild**.

Recovery drift audit (RED, but a single root cause, not the render layer): restoring the deleted `ui/tui` package and `apps/cli/...` to the working tree via `git checkout 10bb9cbf4a^` and running Map→Fix→Verify:

- Fix-stage mechanical renames done (12 files, tui-side): `dsh-compact→dsh-compaction`, `dsh-user-interaction→dsh-user-questions`, `UserInteractionError→UserQuestionError`, `UserInteractionService→UserQuestionService`, `ctx.userInteraction→ctx.userQuestions`, `COMPACT_CHECKPOINT_SOURCE→compactCheckpointSource(CompactionId())`, pi-tui 0.80.7→0.84.2, `TUI→TuiMainScreen`, `@cordisjs/plugin-loader→@deepseek-ai/cordis-plugin-loader`, tsconfig path fixes. **`pnpm install` passed.**
- typecheck: 111 tsc errors, classified: 33× TS2339 (`ctx.llm/sessions/commands/tools/tokenMeter/agents/userQuestions/systemPrompt` not on `Context` — declaration-merge broke), 48× TS7006 (implicit any, downstream cascade), 13× TS2345 (EventMap name drift like `llm/adapters-updated`/`commands/change`), the rest pi-tui API.
- 40 snapshots 0/40 fail, but **same root cause**: `TypeError: installAgentLlmTarget is not a function at createTuiChat (index.ts:592)` — harness setup throws before mount, **never reaching render/snapshot comparison**. Render-layer drift remains unknown.

Decisive blocker: `installAgentLlmTarget` is a deleted core seam. The former `llm-target.ts` in `dsh-agent` **does not exist in the current tree**. The former TUI's `index.ts:592` calls `installAgentLlmTarget(agent.ctx, target)`, that file's export — an interactive model-selection coupling mechanism: it attaches mutable provider/model/reasoning-strength routing to the agent's `system-prompt/assemble` + `agent/request` waterfall, letting the front door (TUI) switch models between steps. **Deleting the TUI also deleted this interaction seam from core**; the Web BFF replaced it with a different model-selection path.

This is **not package-rename mechanical drift; it is an interaction seam removed from core**. Restoring the TUI means either (a) restoring `llm-target.ts` into core (**violates the no-core-change constraint below**), or (b) rewriting the TUI's model-controller onto the model-selection path the Web BFF now uses (equal to rewriting a key interaction layer).

Final judgment: **rebuild from the deleted artifact as spec, do not mechanically restore.** Rationale:

1. The `installAgentLlmTarget` seam was deleted from core; restoring requires touching core or rewriting the model-controller (the former violates the no-core-change constraint, the latter equals rewriting the interaction layer).
2. 33 Context declaration-merges + 13 EventMap renames are systematic mechanical work, doable, but the model-controller seam is still missing.
3. The 40 snapshots never actually tested the render layer (all failed at setup); restoration cost is unpredictable.

Correct path: treat the deleted TUI (84 files + 40 snapshots + 114 archived notes) as **spec and reference implementation**, not as a base. Start from the verified Phase 0 `tui-demo` (in-process `session/event` pipeline works), rebuild the render layer against the 40 snapshots' pixel-exact spec, and route the model-controller through the current core's path (do not revive `installAgentLlmTarget`). This matches the "pure-additive new package, do not touch core" constraint.

Architectural fact this establishes: `llm-target.ts` was deleted with the TUI, confirming that dsh's "core seam the interactive front door uses" and the TUI are **symbiotic** — when the TUI was deleted, core also deleted its dedicated entry point. This is the aggressive face of the pre-release stance: "foundation over blast radius" deletes not only the not-yet-external surface but also the core interface that served only it. The rebuild must therefore go through the current core's existing seam (the Web BFF's model-selection path), not revive the deleted one.

### Upstream-follow strategy: fork maintenance (key constraint)

deepseek-harness is an open-source project; the terminal conversion must **minimize impact on following upstream updates**. Three tiers by where the change lands:

| landing | upstream-merge impact | in-process capability | applies to |
|---|---|---|---|
| pure-additive new package (new directory, no existing file changed) | ✅ near-zero conflict (new files do not conflict with upstream) | ✅ retained | TUI code body |
| `cordis.patch.yml` overlay (per-user `$DSH_HOME`, not in tree) | ✅ zero conflict (not in the repo) | ✅ retained | profile config layer |
| core-file change (e.g. add a line to `PROFILE_TEMPLATES`) | ⚠️ merge-conflict point | ✅ | avoid if possible |
| out-of-tree independent repo (consumes `@deepseek-ai/dsh-*` as npm dep) | ✅ zero fork divergence | ❌ loses in-process seam | external-only components |

Core tension: the in-process local mode requires being in-tree; in-tree changes must minimize upstream conflict.

Recommended strategy: additive-first + overlay-first + patch-fallback.

1. **Additive over in-tree edit:** all TUI code lives in a new package (`packages/examples/tui-demo/` Phase 0 → `packages/bundle/tui/` product-grade), all-new files, no upstream-merge conflict.
2. **Overlay over registration:** the TUI is a standalone bin (mirroring `jsonrpc-demo`, its own `boot()` its own `cordis.yml`), **not** registered in `PROFILE_TEMPLATES` (`packages/boot/app-boot/src/profile.ts:121`) — avoiding that in-tree edit, zero core change. `dsh --profile tui` launcher integration demotes to a later optional low-priority item, or is realized via a per-user `$DSH_HOME/cordis.patch.yml` (not in tree).
3. **Patch-fallback for unavoidable core changes:** when a product-grade change truly must touch core, maintain a patch series + `sync-upstream.sh` after the `warp-patches` pattern (`/data/AI_Dev/sf/ai-hub/warp-patches/` is a live sample: fork OSS, patch-customize, sync upstream). dsh's native `cordis.patch.yml` patch stack + `--patch` overlay is the native equivalent.

Constraints on each phase: Phase 0 (prototype) standalone bin, pure-additive new package — ✅ aligned. Phase 1 (product bundle) `packages/bundle/tui/` new package + standalone bin, not registered in `PROFILE_TEMPLATES`; the `tui` profile activates via overlay. Phase 2-3 render layer, transport adapter, capture hook all inside the new package; MCP via `dsh-mcp-client` config (not in tree); CLI capture calls `sf memory capture` (external, not in tree). Any core-changing requirement is first evaluated for an overlay/new-package bypass; only if no bypass exists does it enter a patch series.

### Key attachment seams (file:line)

- create agent: `AgentRegistry.create` — `packages/core/agent/src/index.ts:405`
- drive one turn: `agent.followup` — `packages/core/agent/src/runtime-types.ts:122`; steer `:126`; inject `:130`; cancel `:85`; whenIdle `:91`
- turn/step machine: `ReactLoopAgent` — `packages/core/agent-loop/src/agent.ts:64`; kick `:210`; turn `:246`; step `:332`; buildRequest `:407`
- tool dispatch: `executeToolCalls` — `packages/core/agent-loop/src/tool-calls.ts:59`
- event firehose: `Session.append` — `packages/core/session/src/index.ts:604`; `session/event` `:641-647`
- approval seam: `ApprovalService` — `packages/interaction/user-approval/src/index.ts:192`; `approval/request` waterfall `:30,318`
- ask-user seam: `UserQuestionService` — `packages/interaction/user-questions/src/index.ts:38`; `registerProvider` `:64`
- LLM stream: `LlmRuntime.stream` — `packages/llm/llm/src/index.ts:171`; `llm/stream` waterfall `:64,923`; `BlockAssembler` `packages/llm/llm/src/assembler.ts`
- MCP client: `packages/mcp/mcp-client/src/connection.ts` + `tools.ts` (registers MCP tools on `ctx.tools`)
- BFF event subscription (remote transport reference): `packages/host/apiproxy/src/api-proxy.ts:3412-3500`; approval `:1391-1450`; mux frame `packages/host/apiproxy/src/api/events.ts:69-108`
- SDK server (alternate transport reference): `packages/sdk/server/src/server.ts:71-103`
- launcher wiring: `provideCmdline` — `packages/boot/cmdline/src/index.ts:68`; `PROFILE_TEMPLATES` — `packages/boot/app-boot/src/profile.ts:121`; `runProfile` — `apps/cli/src/profile-boot.ts:207`
- Phase 0 reference: `packages/examples/tui-demo/src/runner.ts` (verified); `packages/examples/jsonrpc-demo/src/{bin,runner}.ts`; `packages/examples/agent-spine-demo/src/index.ts`
