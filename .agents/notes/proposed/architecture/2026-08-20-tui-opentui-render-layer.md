# Agent Note: OpenTUI render layer for the dsh TUI

Status: proposed

English | [中文](2026-08-20-tui-opentui-render-layer.zh.md)

## Problem

The dsh TUI bundle (`packages/bundle/tui/`) ships Phase 1–3 with a **raw `process.stdout.write` render layer**: streaming text and `[tool/call]`/`[tool/result]` lines written directly, no ANSI SGR, no markdown folding, no card components, no diff/todo/plan rendering. The Phase 2 render layer (`src/render/{ansi,markdown,cards,projections}.ts`) is a minimal hand-roll — GFM→ANSI only, no syntax highlighting, no tables, no KaTeX, no streaming markdown folding.

The [solution note](2026-08-18-tui-solution-and-dev-plan.md) Phase 2 named `@earendil-works/pi-tui` (the former TUI's renderer) as the primary, with 40 archived `terminal.expected.txt` snapshots as the acceptance standard. But an investigation of `/data/AI_Dev/opencode` reveals a **better-published, more-capable alternative**: `@opentui/solid` (npm `0.5.4`), the SolidJS terminal reconciler opencode's TUI uses, which ships a built-in streaming `<markdown>` component with shiki syntax highlighting, tables, KaTeX, and conceal — exactly the gaps dsh's hand-roll has.

## Spike results (verified 2026-08-20)

A hello-world spike renders `<text fg="green">Hello OpenTUI</text>` to the terminal under **Bun** (green RGB `[38;2;0;128;0m`, clean exit 0). Three findings corrected the original proposal:

1. **`createCliRenderer()` is async** — it queries the terminal (DSR) over stdin and must be `await`ed. A synchronous call throws `Cannot create CliRenderer: stdin is already used by another CliRenderer`.
2. **tsdown/rolldown does NOT compile Solid JSX.** `jsx: { runtime: 'solid' }` is ignored; rolldown falls back to the React jsx-runtime → `Cannot resolve 'react/jsx-runtime'`. Solid JSX compilation must go through `Bun.build()` with `@opentui/solid/bun-plugin`'s `createSolidTransformPlugin()` (the spike's `spike-build.ts` proves this path). Bun 1.3.14 does not handle Solid JSX at runtime either (defaults to React); the transform plugin is required.
3. **Node-built `lib/bin.js` runs under Bun unchanged.** The tsdown-bundled non-JSX spine (runner/answerers/capture/bin) loads the cordis plugin tree, runs the agent spine, replays a fixture, and fires the SessionEnd capture hook under Bun. Only `process.loadEnvFile` is absent in Bun 1.3.14 (guard with `typeof process.loadEnvFile === 'function'`; Bun loads `.env` natively, so the call is redundant there).

**Runtime decision: the `dsh-tui` bin runs under Bun, not Node/tsx.** This aligns with the TUI-renderer ecosystem: opencode is 100% Bun (`packageManager: bun@1.3.14`, `#!/usr/bin/env bun` shebang, no build step — exports point at `./src/index.tsx`); Claude Code is a Bun `--compile` native ELF binary. Bun is not a deviation for dsh — it is the standard runtime for this layer. The dsh toolchain (tsdown, vitest, lefthook, pre-push) stays Node; only the `dsh-tui` bin entrypoint changes from `node lib/bin.js` to `bun lib/bin.js`. The isolation surface is one bin entrypoint.

**Hybrid build path:** tsdown (Node) bundles the non-JSX spine modules to `lib/`; a separate `Bun.build()` step with `createSolidTransformPlugin()` bundles the JSX `src/view/*.tsx` modules to `lib/view/`. Both outputs are plain ESM JS; the Bun bin runs them with no JSX left at runtime.

## Proposal

### Adopt `@opentui/solid` as the dsh TUI render layer, replacing the raw-stdout Phase 2 layer

OpenTUI is a **pure renderer**: a SolidJS reconciler over a terminal buffer (`createCliRenderer` from `@opentui/core`, `render` from `@opentui/solid`). It does not care where events come from — it consumes a Solid reactive store. This is architecturally orthogonal to dsh's in-process event spine (`ctx.on('session/event')`) + BFF SSE transport (`transport/session-event.ts`): feed the `TransportEvent` stream into a Solid store, and OpenTUI renders it.

**Do NOT copy opencode's client-server split.** opencode's TUI is a client of an agent server (`createOpencodeClient({ baseUrl })` + SSE). dsh's local in-process mode is an advantage (no server spawn); OpenTUI works in-process equally well.

### What OpenTUI gives dsh

| capability | dsh current (raw stdout) | OpenTUI |
|---|---|---|
| streaming markdown | none (raw text deltas) | `<markdown streaming>` — incremental, O(1)/chunk |
| syntax highlighting | none | `@shikijs/stream` (shiki) |
| tables | none | built-in grid tables |
| KaTeX math | none | built-in |
| tool cards | `[tool/call]`/`[tool/result]` lines | `<box>` components, dispatch on `presentation.ts` card union |
| diff view | none | `<box>` with `@pierre/diffs` or raw |
| todos/plan sidebar | none | `<scrollbox>` |
| input echo (TTY) | readline `terminal:true` (fixed) | OpenTUI keymap + raw-mode (richer) |
| slash-commands | none | `<dialog>` + autocomplete over `CommandRuntime.list(agent)` |

### Architecture

```
ctx.on('session/event') ─┐
                         ├─→ TransportEvent ─→ Solid store ─→ OpenTUI <App/>
BffSseTransport.connect ─┘   (transport/         (view/store.ts)   (view/app.tsx)
                              session-event.ts)
```

- `transport/session-event.ts` (existing) normalizes both in-process + SSE into `TransportEvent`.
- `view/store.ts` (new): a Solid reactive store; `subscribeInProcess`/`BffSseTransport` push events; signals hold `messages[]`, `tools[]`, `todos`, `plan`.
- `view/app.tsx` (new): `render(() => <App />, { renderer: createCliRenderer() })`.
- `view/components/`: `<Message>` (`<markdown streaming>`), `<ToolCard>` (dispatch on `presentation.ts` card union), `<Todos>`, `<Plan>`, `<Prompt>`.
- `runner.ts`: replace `renderEvent` (raw stdout) with `store.push(transportEvent)`. OpenTUI's reconciler owns all stdout writes; dsh no longer calls `process.stdout.write` for render content.
- `src/render/ansi.ts` (existing): retained — OpenTUI's terminal card consumes ANSI when a tool result carries it.

### Key decisions

1. **Skip `BlockAssembler` for streaming text**: OpenTUI's `<markdown streaming>` does its own incremental folding. Feed `assistant/chunk` `text-delta` directly to the markdown component; do not pre-fold with `BlockAssembler` (avoid double folding).
2. **Render intent**: in-process mode reads `presentCall`/`presentResult` directly; remote mode consumes the host-computed `ToolEventView` on the BFF `view` slot (already the design in `transport/event-source.ts`). Both feed `<ToolCard>`.
3. **JSX build**: dsh is pure-TS ESM, no JSX. Add `solid-js` (peer) + `@opentui/core` + `@opentui/solid` + `@opentui/keymap`. tsdown (rolldown) compiles Solid JSX via `jsx: { runtime: 'solid' }` (verify with a hello-world spike first).
4. **40 snapshot acceptance**: the archived `terminal.expected.txt` pixel-exact SGR specs are still the acceptance standard (analysis §11.2). OpenTUI's default theme may not match; align `syntaxStyle`/`fg`/`bg` to the snapshots' SGR specs.
5. **No core change, no `PROFILE_TEMPLATES`**: all new code in the new `src/view/` directory under `packages/bundle/tui/` (pure additive). Honors analysis §14.

## Acceptance criteria

- A hello-world spike renders a Solid component to the terminal via tsdown + `@opentui/solid` before any view work (de-risk the JSX build).
- `tsc -b tsconfig.host.json` green with the new `.tsx` files.
- Keyless multi-turn: `<markdown streaming>` renders the two-turn fixture's assistant text with ANSI styling (bold/italic/code), not raw stdout.
- Live DeepSeek: streaming markdown renders real model output with code-block syntax highlighting.
- The 40 archived `terminal.expected.txt` snapshots pass against the new render layer (pixel-exact SGR).
- All scoped doc gates green (`verify-package-paths`, `verify-agent-note-format`, `gen-config-catalog`, `verify-package-readme-*`, `verify-translation-pairing`).
- No `agent-loop` change; no `packages/core/*` edit; no `PROFILE_TEMPLATES` row.

## Risks

1. **JSX build integration** — dsh has no JSX anywhere. tsdown/rolldown's Solid JSX compilation must be verified before view work. Mitigation: hello-world spike first.
2. **40-snapshot theme alignment** — OpenTUI's default theme may not match the archived pixel specs. Mitigation: `syntaxStyle` + `fg`/`bg` mapping; if a snapshot can't match, document the deviation as a known limitation (pre-release stance allows it).
3. **Double streaming fold** — `BlockAssembler` + `<markdown streaming>` both fold. Mitigation: feed raw `text-delta` to `<markdown>`, skip `BlockAssembler` for the markdown path (keep it for non-markdown card paths).
4. **Solid reactivity under the dsh event firehose** — dsh emits events synchronously from the agent loop; Solid's batched updates (16ms) may add latency. Mitigation: `batch()` event pushes (mirror opencode's `sdk.tsx` flush).
5. **Bundle size** — `solid-js` + `@opentui/*` + `shiki` adds weight to the `dsh-tui` bin. Mitigation: tsdown `codeSplitting: false` already inlines; shiki loads grammars on demand.

## Alternatives considered

- **pi-tui (former TUI renderer, npm `0.84.2`)**: the solution note's original choice. Rejected here: its `TUI`→`TuiMainScreen` API drifted 0.80.7→0.84.2, the 40 snapshots never actually tested its render layer (all failed at setup, analysis §11.3), and it lacks shiki/tables/KaTeX that OpenTUI ships built-in. OpenTUI is published, maintained, and more capable.
- **Keep the hand-rolled Phase 2 render layer**: rejected — it has no syntax highlighting, no tables, no KaTeX, no streaming markdown folding. Reaching feature parity by hand would replicate what OpenTUI already ships.
- **Copy opencode's client-server architecture**: rejected — dsh's in-process mode is an advantage (no server spawn, direct `ctx.on('session/event')`). OpenTUI works in-process; the transport abstraction (`transport/session-event.ts`) already unifies in-process + SSE, so only the store consumer changes.

## Confirmation Or Next Step

- **confirmationRequired:** true — this is a proposal to replace the Phase 2 render layer. Confirm: (a) adopt OpenTUI over pi-tui, (b) the Solid JSX build is acceptable, (c) the 40-snapshot alignment is the acceptance standard.
- **recommendedNextSkill:** `sf-plan` (task breakdown: spike → store → message → tool-card → projections → prompt → snapshot-align) → `sf-implement`.
- **blockedReason:** none at proposal stage.
