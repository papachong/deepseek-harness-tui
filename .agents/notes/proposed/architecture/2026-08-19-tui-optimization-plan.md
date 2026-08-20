# Agent Note: TUI Interaction and Rendering Optimization Plan

Status: proposed

[中文](2026-08-19-tui-optimization-plan.zh.md) | English

## Problem

`packages/bundle/tui` sits in an in-between state: Phase 1 interaction works, but the Phase 2 render layer is ported and unplugged. A code inventory (2026-08-19) found eight concrete issues:

1. **The render layer is dead code.** `src/render/{markdown,cards,projections,ansi}.ts` are implemented (the pure-Node fallback port from the dev plan), yet `runner.ts`'s `renderEvent()` (src/runner.ts:219-269) still writes plain unstyled text via raw `process.stdout.write`, and no module in the repository imports any of the four render files.
2. **Streaming rendering is full re-render.** `TerminalMarkdown.append()` (src/render/markdown.ts:45-49) re-renders the entire accumulated document to a full string on every chunk; `incremental.ts` optimizes only parsing (O(1)/chunk), so rendering stays O(document)/chunk — quadratic on long answers and unfit for a real TUI's incremental repaint.
3. **Shared-readline double-consumption bug.** `readLine()` in answerers.ts attaches `rl.once('line')` (src/answerers.ts:72-79) while the REPL drains the same interface via `for await (const line of rl)` (src/runner.ts:164). readline broadcasts 'line' to every listener: a line typed during an approval/question is consumed by the answerer **and** queued into the for-await iterator — after the turn it is fed to the agent as a forged task line.
4. **Line-mode interaction.** No raw-mode keypress: no history, no Ctrl-R, no multi-line paste, no completion; approvals require Enter; Ctrl-C exits the process outright (src/runner.ts:87) instead of cancelling the running turn — even though `Agent.cancel(cause)` already exists as a seam.
5. **Input/output interleaving.** `[agent:status]` / `[tool/call]` / approval prompts are written directly while the user is typing at `task>`, with no save/restore protocol; the prompt is not redrawn after output.
6. **No terminal capability detection.** No NO_COLOR / FORCE_COLOR / dumb-TERM handling; the render modules emit ANSI even when stdout is a pipe; no width handling, wrapping, or truncation.
7. **Zero tests.** tests/ holds only three fixtures and no `*.test.ts`; the render modules are pure functions with no unit tests and the fixtures have no golden assertions.
8. **Coarse status presentation.** `[agent:busy]` / `[tokens]` / `[turn/end]` raw lines; no spinner, status bar, or todos/plan sidebar. The README also drifted from the implementation (it says the render layer and `--resume` are not landed, but both exist).

## Proposal

### Core decision: no pi-tui; build a thin diff-rendering screen on the existing pure-Node layer

The existing render/* modules already are the dev plan's "pure-Node fallback" path, and this round's pain points (interaction correctness, incremental rendering) are orthogonal to pi-tui; its API drift (0.80.7 → 0.84.2, `TUI` → `TuiMainScreen`) is un-reconciled. A self-built Screen is a ~300-line budget; if complexity overruns, pi-tui remains a drop-in replacement behind the same interface (risk 5).

### Target architecture (five layers)

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

### Phases (each with its own gate)

**Phase A — correctness + test foundation (prerequisite).**
1. Single-owner line dispatch: new `src/input.ts` owns the stdin line stream and routes internally — pending prompt → answer; otherwise → task-line queue. The REPL loop switches to `await input.nextTaskLine()`; the answerers' side-channel `readLine()` is deleted. Fixes the double-consumption bug.
2. Test foundation: `tests/*.spec.ts`; pure-function unit tests for the render modules (incremental / ansi / markdown / cards / projections); golden tests driven by tests/fixtures/*.session.jsonl (event sequence → rendered lines); a regression test for double consumption.
3. Gate: `npm test -- --run packages/bundle/tui` green; double-consumption regression test present.

**Phase B — view model + incremental render wiring (core).**
1. `src/view.ts`: SessionView (turns[] / status / todos / plan / tokens) replacing the inline subscriptions at runner.ts:137-144.
2. `src/render/diff.ts` + Screen incremental protocol: markdown emits per block — frozen blocks are appended once, tail-block changes rewrite only the tail lines (each block records its line count); a line-level diff emits minimal repaint.
3. `src/screen.ts`: terminal detection (TTY / color / width / dumb), TTY mode (hidden cursor, input-line protection, incremental repaint, resize reflow), pipe mode (plain text stream — today's semantics).
4. Wire runner.ts: delete the inline renderEvent/status writes; upgrade status presentation (in-turn status line, end-of-turn tool summary).
5. Gate: 3-turn golden matches; assertion that chunks written per step equal new lines only; pipe mode output has no ANSI.

**Phase C — raw-mode interaction.**
1. Input raw-mode: `setRawMode(true)` + keypress; history (memory + `~/.dsh/tui_history`); Ctrl-R reverse search; Ctrl-L clear; multi-line paste; up/down history.
2. Ctrl-C semantics: running turn → `agent.cancel(cause)` (seam exists); idle → exit.
3. Approval/ask-user single-key interaction: y / n / Enter / Esc; non-blocking pending prompts rendered in the status area without interrupting input.
4. Autocomplete (M1): dsh commands + cwd paths.
5. Gate: pseudo-terminal (node-pty) keypress integration tests; live warp session-share approval loop verified ungated.

**Phase D — terminal adaptation and scale.**
1. Width/long lines: ANSI-aware wrapping, truncation with `…`, collapsible large output (expand).
2. Resize full reflow; incremental rendering stays O(diff) on a ten-thousand-event session; status refresh debounced.
3. Non-TTY pipe-mode golden added to CI.
4. Gate: 40/120-column reflow; ten-thousand-event benchmark; pipe golden stays ANSI-free.

**Phase E — productization (future, not committed).**

Configuration via `$DSH_HOME/tui.json`; BFF SSE remote wiring (transport skeleton already exists); session list + `--resume` polish; todos/plan right sidebar; bilingual README sync.

### Key design details

- **Input/output cooperation protocol**: `Screen.beginInputEdit()` / `endInputEdit()` — save the cursor and clear the input line before writing output, redraw the input line after; content area scrolls, status area stays on the last row.
- **Incremental markdown emit**: `renderBlocks()` returns `{ frozenDelta, tailLines, tailLineCount }`; the Screen appends frozen blocks and diff-rewrites only the tail.
- **Terminal detection**: `detectTerminal(stdout) → { color: truecolor|256|basic|none, width, raw }`, with NO_COLOR / FORCE_COLOR / CI precedence.
- **Turn cancellation**: `agent.cancel(cause, { keepInbox })` keeps queued work and aborts the active turn (the Agent API already provides it); if convergence misbehaves, fall back to ignoring events until `turn/end`.

## Acceptance criteria

- Phase A: double-consumption regression test exists and passes; render/* pure-function tests cover the modules; package tests green.
- Phase B: 3-turn golden passes; incremental written-line assertion passes; pipe-mode output is ANSI-free; no core / PROFILE_TEMPLATES edits.
- Phase C: keypress integration tests pass; live warp approval loop verified.
- Phase D: resize / long-line / ten-thousand-event benchmarks pass; pipe golden in CI.
- Every phase: new code stays under packages/bundle/tui/; bilingual README stays in sync; upstream-follow (addition-first) preserved.

## Risks

1. **`agent.cancel` convergence is unverified** — the post-cancel event sequence (turn/end? agent/disposed?) must be measured; if convergence misbehaves, Ctrl-C cancellation degrades to "ignore output until turn/end".
2. **Raw-mode races** — resize, bracketed paste, signal delivery; mitigated by keeping the non-TTY fallback and pseudo-terminal integration tests.
3. **Warp session-share gating** — known (dev plan risk 3); non-blocking answerer plus live verification.
4. **Large-output memory** — collapse + truncate; never cache the full ANSI document.
5. **Self-built Screen complexity overrun** — 300-line budget; on overrun, fall back to pi-tui behind the same interface.

## Alternatives considered

- **pi-tui render stack**: has precedent and the 40 archived snapshots, but its API drift is un-reconciled and it does not address the interaction/correctness pain points; kept as the Phase B failure fallback.
- **Full repaint instead of diff**: simpler but O(n²) with flicker; rejected.
- **Bug fixes + tests only (no UX work)**: de-risks but delivers no product value; rejected.
- **React terminal frameworks (ink et al.)**: new dependency and off-style for a repo that prefers pure Node; rejected.
- **Locking the shared readline**: double consumption is EventEmitter broadcast semantics; locking cannot remove the second consumer — single ownership is required; rejected.
