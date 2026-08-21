# Agent Note: OpenTUI view layer implemented for the dsh TUI

Status: implemented

English | [中文](2026-08-20-tui-opentui-view-layer-implemented.zh.md)

## Problem

The [OpenTUI render-layer proposal](2026-08-20-tui-opentui-render-layer.zh.md) named three risks the spike confirmed and one it did not predict. The view layer had to be built against them, not around them: (1) `createCliRenderer()` is async (DSR over stdin), (2) tsdown/rolldown does not compile Solid JSX so the `.tsx` files need a separate `Bun.build()` step, (3) the `dsh-tui` bin runs under Bun (Node cannot load `bun:ffi`), and (4) — uncovered by the spike — the OpenTUI Solid reconciler emits a stray empty text node for `<Show>`'s falsy branch that orphans under a non-text parent (`<box>`/`<scrollbox>`), raising `Orphan text error`. The answerers' `stdin.readLine()` also cannot coexist with OpenTUI's raw-mode keymap, so the approval/ask-user path needed a new answer surface.

## Decision

The OpenTUI render layer ships as implemented: `@opentui/solid` replaces the raw-stdout Phase 2 layer, the `dsh-tui` bin runs under Bun, and the JSX goes through a separate `Bun.build()` step externalizing `@opentui/*` so the native FFI resolves from the pnpm store at runtime. The answerer conflict is resolved with a `StoreAnswerAccess` surface (the store's `awaitAnswer`/`resolveAnswer`) instead of `stdin.readLine()`, and `<Show>` is replaced by memo-conditionals to avoid the reconciler's orphan-text crash.

The view layer is `src/view/` (pure additive) plus minimal wiring in `runner.ts`, `answerers.ts`, `bin.ts`, `package.json`, `tsconfig.json`, and a `scripts/build-view.ts` Bun.build step. The non-JSX reactive spine (`store.ts`, `renderer.ts`) is tsdown-bundled like the rest of the package; the JSX components (`app.tsx`, `components/*.tsx`) are bundled by `Bun.build()` with `createSolidTransformPlugin()` and externalized `@opentui/*` + `solid-js` so the native `.so` resolves from the pnpm store at runtime, not a relative hash-named path baked into the bundle.

### What shipped

- `src/view/store.ts`: a Solid reactive store mirroring opencode's SDK flush pattern — queue events on `push`, `batch()`-emit within 16ms windows. `applyEvent` switches on the `SessionEventMap` discriminant; `plan/mode` (a plugin-augmented extension, not in the base map) is handled with a string-type check before the switch. Exposes `setStatus` (agent/status is not a session event), `awaitAnswer`/`pendingQuestion`/`resolveAnswer` (the answerer surface), and `planActive: boolean` (the `plan/mode` payload is `{ active }`, not markdown).
- `src/view/renderer.ts`: cross-platform FFI bootstrap — `setRenderLibPath(findSo())` then `await createCliRenderer()`. `findSo` walks the pnpm store for the platform `.so`/`.dylib`/`.dll`.
- `src/view/components/{message,tool-card,projections,prompt}.tsx` + `src/view/app.tsx`: the JSX. `<Message>` uses `<markdown streaming>`; `<ToolCard>` wires the card-union switch but falls through to generic for v1; `<Todos>`/`<Plan>` render inline; `<Prompt>` owns the REPL input and routes pending answers. All use memo-conditionals instead of `<Show>` (see Consequences).
- `src/runner.ts`: replaced `renderEvent`/`BlockAssembler` with `store.push(TransportEvent)`; boots the renderer; loads `app.js` via dynamic import (tsdown leaves it unresolved, Bun.build supplies it); the `onSubmit` handler drives `agent.followup` + `whenIdle` + `flush`; restores the terminal on exit.
- `src/answerers.ts`: refactored from `StdinAccess` (`stdin.readLine`) to `StoreAnswerAccess` — the answerers push a pending question into the store via `awaitAnswer()` and return its promise; `<Prompt>` resolves it. This is mandatory under OpenTUI raw mode.
- `src/bin.ts`: guards `process.loadEnvFile` with a `typeof` check (Bun 1.3.14 lacks it; Bun loads `.env` natively).
- `scripts/build-view.ts`: `Bun.build` with `createSolidTransformPlugin()` + `external` for all `@opentui/*` and `solid-js`.
- `tests/input.spec.ts`: rewired from the readline `LineInput` to the `TuiStore` answer surface.

### Hybrid build path

`pnpm run build` (Node) runs tsdown, which bundles the non-JSX spine (including `store.ts`/`renderer.ts`) into `lib/`. `bun scripts/build-view.ts` (run separately or as a follow-up) bundles the JSX to `lib/view/`. `runner.js`'s `await import('./view/app.js')` resolves to the Bun.build output at runtime; tsdown leaves the dynamic import unresolved. The `dsh-tui` bin is `bun lib/bin.js`.

## Consequences

The 40-snapshot pty-driven acceptance is deferred until a pty snapshot harness exists; the layer is verified by `tsc`, `pnpm run build`, `bun scripts/build-view.ts`, `bun lib/bin.js` boot, and 11 passing unit tests. Tool-card specialization (terminal/diff/read/search/web) is deferred to a later pass that wires the runner to `presentCall`/`presentResult`. The `build:view` step is not yet wired into the root `scripts/build.ts` (it never calls per-package scripts); the current contract is running `bun scripts/build-view.ts` after the spine build. The trade-off bought: a streaming-markdown, shiki-highlighted, table/KaTeX-capable TUI aligned with the opencode + Claude Code runtime, with the in-process event spine preserved and no core change.

## Testing

- `tsc -b tsconfig.json` green with the new `.tsx` files (jsx:preserve; tsc emits `.d.ts` for type-checking, `.jsx` artifacts are unused — Bun.build owns JSX emit).
- `pnpm run build` green: tsdown bundles the spine.
- `bun scripts/build-view.ts` green: produces `lib/view/app.js` (externalized `@opentui/*`).
- `bun lib/bin.js` boots OpenTUI, enters alt screen, renders the `task> ` prompt, and restores the terminal on exit.
- `npx vitest run packages/bundle/tui/tests/input.spec.ts` — 11 passed (the answerer integration tests rewired to the store).
- All scoped doc gates green: `verify-package-paths`, `verify-export-jsdoc` (the 14 pre-existing JSDoc gaps in `render/*`/`transport/*`/`capture.ts` were also closed), `verify-translation-pairing`.
- No `agent-loop` change; no `packages/core/*` edit; no `PROFILE_TEMPLATES` row.

## Risks

1. **`<Show>` orphans** — the OpenTUI Solid reconciler emits a stray empty text node for `<Show>`'s falsy branch; under a non-text parent (`<scrollbox>`) it raises `Orphan text error`. Mitigation: all conditionals use `createMemo` returning `JSX.Element | undefined` instead of `<Show>`. Documented in each component's module doc.
2. **Solid reactivity does not drive re-renders after mount (BLOCKER)** — `createStore`/`createSignal` updates fire (probes confirm the store flushes and the signal setter runs) but `<For each>` never re-evaluates: the Solid effect queue does not flush into @opentui/solid's reconciler under Bun. The initial mount renders (static `task>` prompt, input echo), and `renderer.start()` + the exit latch keep the bin alive, but streamed assistant text and tool cards never appear. A minimal repro (`createSignal` + `<For>` + `r.start()`) also fails, so it is not a double-`solid-js`-instance or store-outside-root issue. opencode works; the difference is unresolved — likely a `createCliRenderer` config (`targetFps`/`useKittyKeyboard`/`autoFocus`) or an `@opentui/solid/preload` runtime hook we do not replicate. This is the open blocker for live model output.
3. **Piped stdin cannot drive the `<Prompt>`** — OpenTUI's `<input>` consumes raw-mode keypress events; a pipe generates none. A python `pty.fork` harness (`tests/pty-harness.ts`) drives the bin: `onSubmit` fires, the agent loop runs (`turn/start` → `assistant/chunk` events probe-confirmed), but the view does not update (see risk #2). Live validation needs a real TTY + `DEEPSEEK_API_KEY`.
4. **Build wiring is manual** — the root `scripts/build.ts` now calls `runViewBuild()` (PATH-walks for `bun`) between `build:lib` and `build:web`; it skips with a warning when Bun is absent. The release lane adds `oven-sh/setup-bun@v2`.
5. **Tool card specialization deferred** — the card-union switch (terminal/diff/read/search/web) falls through to generic for v1; the store does not populate `callView`/`resultView` (no tool registry).
6. **`lib/view/*.js` is gitignored** — like the rest of `lib/`, the view bundle is a build artifact regenerated by `bun scripts/build-view.ts`; the `files[]` whitelist ships it on publish.

## Alternatives considered

- **Keep the hand-rolled Phase 2 render layer** — rejected; it has no shiki/tables/KaTeX/streaming markdown, and reaching parity would replicate OpenTUI.
- **Static import of `app.js` in `runner.ts`** — rejected; tsdown runs before Bun.build, so `lib/view/app.js` does not exist at tsdown time and the static import fails to resolve. The dynamic `await import('./view/app.js')` is left unresolved by rolldown and resolved by Bun at runtime.
- **Keep the answerers on `stdin.readLine()` with a non-raw fallback** — rejected; the renderer owns raw mode for the whole REPL, so the fallback is unreachable. The `StoreAnswerAccess` + `awaitAnswer`/`resolveAnswer` surface is mandatory.

## Confirmation Or Next Step

- **confirmationRequired:** false — implemented.
- **recommendedNextSkill:** wire `build:view` into `scripts/build.ts`; add a pty-driven snapshot harness for the 40 archived `terminal.expected.txt` specs; specialize the tool-card arms.
- **blockedReason:** none.
