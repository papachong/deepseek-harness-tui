# Agent Note: TUI technical solution and development plan

Status: proposed

English | [中文](2026-08-18-tui-solution-and-dev-plan.zh.md)

## Problem

The [TUI analysis note](2026-08-18-tui-terminal-product-analysis.md) established *what* and *why*: deepseek-harness has no TUI, the architecture leaves the entry points ready, Phase 0 proved the in-process `session/event` → terminal pipeline, and the remote transport is decided as BFF SSE. What is missing is an actionable *solution and plan*: the precise seams to call, the files to add, the phase order, and the verification gate for each step. This note closes that gap. It is the `sf-solution` + `sf-plan` output for the TUI work item and supersedes nothing in the analysis note — it depends on that note's conclusions (rebuild-from-spec, no core change, BFF SSE, additive-new-package).

### Resolved (local-template stage)

- **workItemRef:** TUI terminal product (no live SF work item; this repo is a local static template per `CLAUDE.md`, so `run_list`/`run_create` are not called). The `runContext`-equivalent is the `phase0/tui-prototype` branch + its six commits, already pushed to `origin`.
- **branch:** `phase0/tui-prototype` (HEAD `ba62f6cc43`), upstream `origin/phase0/tui-prototype`.
- **allowedScope:** new package `packages/examples/tui-demo/` (Phase 0, present) → `packages/bundle/tui/` (Phase 1+); no edits to `packages/core/*`, `agent-loop`, or `PROFILE_TEMPLATES`. Per the analysis note §14 (additive-first, overlay-first, patch-fallback).
- **contextSummary:** the analysis note's §1 (no TUI today), §5 (minimal spine), §6 (render gap/reuse), §7 (interaction loop), §10 (BFF SSE decided), §11 (rebuild-from-spec).

## Proposal

### Architecture in one paragraph

A new `packages/bundle/tui/` mirrors `dsh-headless`: a Cordis function plugin (`name`/`inject`/`Config`/`apply`) that creates one Agent via `AgentRegistry.create`, couples mutable model selection through `installModelSelection` (the *current* core seam, **not** the deleted `installAgentLlmTarget`), subscribes to `session/event`, registers an `approval/request` answerer and a `UserQuestionService` provider, and renders to stdout via a terminal render layer that consumes the `presentation.ts` `card` union and the `todos`/`plan` session projections. The bundle is a standalone bin (its own `boot()` + `cordis.yml`), **not** registered in `PROFILE_TEMPLATES`. Remote mode is a swappable `EventSourceTransport` adapter against the existing Web BFF; no new server.

### Seams the TUI calls (verified against the current tree)

| concern | seam | file:line | notes |
|---|---|---|---|
| create agent | `AgentRegistry.create` | `packages/core/agent/src/index.ts:405` | `sessionId` + `agentOptions` + `setup(agentCtx)` |
| model selection | `installModelSelection(agentCtx, ref)` | `packages/core/agent/src/model-selection.ts:39` | **current** seam; replaces deleted `installAgentLlmTarget`. `ModelSelectionRef = { current, assembled }`. Headless + Web BFF both use it (`headless/src/index.ts:117`, `api-proxy.ts:10,1127`) |
| drive a turn | `agent.followup(msg)` + `agent.whenIdle()` | `packages/core/agent/src/runtime-types.ts:122,91` | headless `index.ts:122-126`; Phase 0 `tui-demo/src/runner.ts` |
| event firehose | `ctx.on('session/event', (session, event))` | `packages/core/session/src/index.ts:641` | carry `assistant/chunk`/`assistant/message`/`tool/call`/`tool/result`/`todo/write`/`turn/*` |
| approval answerer | `ctx.on('approval/request', (req, next) => {...})` | `packages/interaction/user-approval/src/index.ts:30`; BFF mirror `api-proxy.ts:1391` | **must call `next()`**; fail-closed if none registered returns `'unavailable'` |
| ask-user provider | `ctx.userQuestions.registerProvider({ ask })` | `packages/interaction/user-questions/src/index.ts:64`; BFF mirror `api-proxy.ts:1338` | `plan-review` intent gets special rendering |
| commands | `CommandRuntime` `list`/`register`/`execute` | `packages/interaction/commands/src/index.ts:260,80,225` | per-agent `ScopedLayers`; TUI builds autocomplete |
| render intent | `ToolCallView`/`ToolResultView` `card` union | `packages/core/tools/src/presentation.ts:46,140` | cards: `generic`/`terminal`/`diff`/`read`/`search`/`web` |
| chunk folding | `BlockAssembler` | `packages/llm/llm/src/assembler.ts` | folds `assistant/chunk` deltas to visible text |
| todos/plan projections | `Session.surface` / `todo/write` | `packages/core/session/src/surface.ts:427`; `types.ts:299` | `plan` via `planSurfaceEvent` (`surface.ts:321`) |
| BFF SSE mux (remote) | `session/event` + `approval/requested` + `question/requested` + `POST /api/respond` | `packages/host/apiproxy/src/api/events.ts:70,72,74`; `api-proxy.ts:3633-3678` | host-computed `ToolEventView` on the `view` slot |
| stdin | `setRawMode(true)` + keypress | (new) | Phase 0 used `readline` `terminal:false`; raw-mode is new |

### Port-source files (pure logic, React-bound → strip the binding)

| module | lines | port task |
|---|---|---|
| `packages/client/ui-primitives/src/ansi.ts` | 447 | strip `CSSProperties`; emit ANSI-styled spans a terminal renderer consumes |
| `.../markdown/incremental.ts` | 130 | O(1)/chunk block parser — port as-is (no React binding) |
| `.../markdown/parse.ts` | 44 | GFM+math grammars |
| `.../markdown/plain-text.ts` | 121 | plain-text extraction |

### Render stack decision

Use `@earendil-works/pi-tui` (the former TUI's renderer, npm `0.84.2`) as the primary terminal render stack — precedent exists, and the 40 archived `terminal.expected.txt` snapshots are the pixel-exact acceptance standard for the rebuild. This is a Phase 2 evaluation, not a Phase 1 commitment: Phase 1 ships raw `process.stdout.write` (as Phase 0 does) and lands the interaction seams; the render stack lands in Phase 2.

### Package layout (Phase 1+)

```
packages/bundle/tui/
  package.json          # @deepseek-ai/dsh-tui, bin: dsh-tui
  tsconfig.json         # extends tsconfig.base.json, rootDir src, outDir lib/types
  src/
    index.ts            # name/inject/Config/apply — the Cordis function plugin
    invariant.ts        # package-owned invariant companion
    startup.ts          # boot/resolve-config/stdin-attach/dispose lifecycle
    runner.ts           # create agent + installModelSelection + subscribe + drive turn loop
    answerers.ts        # approval/request answerer + userQuestions.registerProvider
    render/             # terminal render layer (Phase 2)
      ansi.ts           # ported from ui-primitives
      markdown.ts       # ported incremental parser
      cards.ts          # dispatch on presentation.ts card union
      projections.ts    # todos/plan sidebar
    transport/          # Phase 2 remote adapter
      event-source.ts   # EventSourceTransport → BFF SSE
      session-event.ts  # unify EventSource/in-process into one SessionEvent stream
  cordis.yml            # the bin's own composition (mirrors tui-demo)
  cordis.snapshot.yml   # keyless llm-replay
  README.md / README.zh.md
```

### Development plan (phased)

**Phase 0 — prototype (DONE, verified).** `packages/examples/tui-demo/` standalone bin, keyless, `session/event` → `process.stdout.write`. Two bugs fixed (stdin-before-boot, `rl.close` race). Lives on `phase0/tui-prototype`.

**Phase 1 — product TUI bundle, in-process (the next deliverable).**
1. Create `packages/bundle/tui/` mirroring `dsh-headless` layout (`index.ts`/`invariant.ts`/`startup.ts`).
2. `runner.ts`: `ctx.agents.create` + `installModelSelection(agentCtx, { current: defaultModel.currentSelection(), assembled: undefined })` (copy `headless/src/index.ts:106-119` and `tui-demo/src/runner.ts:104-112`).
3. `answerers.ts`: register `ctx.on('approval/request', ...)` that reads a stdin keypress (y/n) and `next()`s; register `ctx.userQuestions.registerProvider({ ask })` that renders the question and resolves. Mirror `api-proxy.ts:1338-1391`.
4. REPL loop: `agent.followup` → `whenIdle` → read next stdin line → repeat (Phase 0 was single-turn; this adds the loop).
5. Raw-mode stdin: `process.stdin.setRawMode(true)` + keypress; fall back to line mode if `!process.stdin.isTTY`.
6. **Do not** register in `PROFILE_TEMPLATES`; ship as standalone bin + overlay (analysis §14).
7. README bilingual pair + `Known Limitations and Deferred Work` + `SENTENCE_MODEL_EXPERIENCE` allowlist entry + `config-catalog` regen.
- **Exit criteria:** bin runs keyless (`DSH_SNAPSHOT=replay`), drives a multi-turn conversation, answers an approval prompt and an ask-user prompt from stdin, exits cleanly on `SIGTERM`/`SIGINT`/EOF. One REAL-composition test booting `cordis.yml` through the Loader (per `packages/CLAUDE.md` testing rule).

**Phase 2 — render layer + BFF SSE transport.**
1. Add `@earendil-works/pi-tui`; reconcile `TUI`→`TuiMainScreen` API drift vs `0.84.2`.
2. Port `ansi.ts` + `markdown/incremental.ts` (strip React binding).
3. `cards.ts`: dispatch on `card` discriminant (`generic`/`terminal`/`diff`/`read`/`search`/`web`).
4. `projections.ts`: render `todos` + `plan` from `Session.surface`.
5. `transport/event-source.ts`: `EventSource` → BFF `session/event`/`approval/requested`/`question/requested`; `POST /api/respond` to answer. Unify with in-process via `transport/session-event.ts`.
6. Connect `memory.recall` via `dsh-mcp-client` → `ai-mcp-adapter` (M3 partial) — the only SF touch, configured out-of-tree.
- **Exit criteria:** the 40 archived `terminal.expected.txt` pixel-exact snapshots pass against the new render layer (the deterministic acceptance standard from the analysis §11.2). Remote thin-client connects to a running BFF and answers an approval over SSE.

**Phase 3 — interaction deepening + capture.**
1. Code Mode sub-call render (`tool/code-dispatch-*`).
2. spill file / exit code / cwd resolution (TUI-owned context duties, analysis §6.5).
3. `--resume` rebuild from JSONL.
4. SessionEnd → `sf memory capture` (M2 partial); reuse ai-cli's redaction/queue/replay, do not rewrite.
5. Dual-transport swappable adapter (`EventSourceTransport` vs `JsonRpcTransport` unified).
- **Exit criteria:** `--resume <id>` rebuilds a transcript; SessionEnd triggers a dry-run capture; no `agent-loop` change in any phase.

## Acceptance criteria

- **No core change.** No file under `packages/core/*` is edited in any phase; `PROFILE_TEMPLATES` (`packages/boot/app-boot/src/profile.ts:121`) gains no `tui` row. Any future unavoidable core change enters a `cordis.patch.yml` patch series, not an in-tree edit (analysis §14).
- **Phase 1 gates:** `pnpm run verify-package-paths`, `verify-package-readme-limitations`, `verify-package-readme-model-experience`, `gen-config-catalog --check`, `verify-agent-note-format`, `verify-translation-pairing` all green; one keyless REAL-composition test passes (`DSH_SNAPSHOT=replay`).
- **Phase 2 gates:** the 40 archived snapshots pass; `doc-typecheck` green; remote thin-client answers an approval over BFF SSE.
- **Phase 3 gates:** `--resume` reconstructs a cold session; SessionEnd capture is a dry-run that logs without writing until user-confirmed.
- **Upstream-follow:** all new code in `packages/bundle/tui/` (new files, zero conflict); `tui` profile activation via per-user `$DSH_HOME/cordis.patch.yml` overlay, not in-tree.

## Risks

1. **pi-tui API drift.** Former TUI used `0.80.7`; current `0.84.2` renamed `TUI`→`TuiMainScreen`. Phase 2 must reconcile before committing to pi-tui; if the drift is too large, fall back to a pure-Node renderer (the analysis note leaves this open as the rejected alternative).
2. **stdin raw-mode race.** Phase 0 fixed two stdin bugs; raw-mode keypress adds new races (terminal resize, bracketed paste, signal delivery). Mitigation: keep `terminal:false` readline as the non-TTY fallback path; raw-mode only when `process.stdin.isTTY`.
3. **warp approval gating.** `SharedSessionWriteToLongRunningCommands` may judge the blocking approval readline as long-running and gate the viewer's input. Needs measurement in a live warp session; if gated, the answerer becomes non-blocking (analysis §8).
4. **Memory double-authority.** dsh is `ai-cli` + recall consumer only; the governance loop belongs to the SF four repos. Any capture must reuse `sf memory capture`, not bypass ai-cli redaction/idempotence (ADR-MEM-001, analysis §9.2).
5. **BFF approval wire is a single-implementation seam.** The TUI remote answerer mirrors `api-proxy.ts:1391`; if the BFF changes that wire, the TUI adapter drifts. Mitigation: pin the adapter to the mux frame contract (`events.ts:70-75`), not to the implementation.
6. **Pre-release stance.** No external consumers; prefer correct foundation over compatibility shims (`CLAUDE.md`). Phase 1 may ship raw stdout and defer the render stack without blocking.

## Alternatives considered

All major alternatives are decided in the [analysis note](2026-08-18-tui-terminal-product-analysis.md) and are **not** re-litigated here; this plan inherits them:

- **Remote transport:** BFF SSE chosen, SDK JSON-RPC deferred (analysis §10 — SDK approval is a "dead capability"). Not re-opened.
- **Former-TUI recovery:** rebuild-from-spec, not mechanical restore (analysis §11.5 — `installAgentLlmTarget` was deleted from core). Not re-opened.
- **Upstream-follow:** additive-first + overlay-first + patch-fallback (analysis §14). Not re-opened.
- **Render stack:** pi-tui primary (precedent), pure-Node fallback — this is the one open decision, evaluated in Phase 2.

The only decision this plan introduces is **phasing**: Phase 1 ships the interaction seams over raw stdout before the render stack lands in Phase 2. The alternative — land the render stack first, then the seams — would delay verifying the approval/ask-user loop (the product-level hard requirement) behind render work that has a known acceptance standard (40 snapshots) and can be measured independently.

## Confirmation Or Next Step

- **confirmationRequired:** true — this is a solution draft. Before `sf-plan` produces a task breakdown with precise file lists and test cases, confirm: (a) the phasing (seams-before-render), (b) Phase 1 as the next deliverable on `phase0/tui-prototype`, (c) pi-tui deferred to Phase 2 evaluation.
- **recommendedNextSkill:** `sf-plan` (task breakdown, acceptance criteria per task, test plan) → `sf-prompt` after plan confirmation.
- **blockedReason:** none at the solution stage; the analysis note resolved all blocking decisions.
