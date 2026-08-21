# Agent Note: dsh-tui is a bundle, not a capability seam

Status: proposed

English | [中文](2026-08-21-tui-bundle-not-capability-seam.zh.md)

## Problem

"Can the TUI be made into a plugin?" The question presumes the TUI is not yet a plugin, or that it is in the wrong form. This note records the structural answer, the official-documents backing, and the consequence for how the TUI is published — so the next session does not re-derive it.

## Proposal

`@deepseek-ai/dsh-tui` is **already a plugin in the correct form: a bundle** (an installable `dsh --profile` patch-layer package per `packages/bundle/`), not a capability seam (Service Definition / Service Provider / Consumer triad). Its render layer should **not** be upgraded to a Service Definition at this stage. The Bun-FFI process boundary this package owns is what decides its publish form: an independent `dsh-tui` bin, not a `dsh --profile tui` surface bundle (yet).

### Evidence the TUI is a bundle, not a capability

- **No Service Definition.** A full `src/` grep for `extends Service | ctx.plugin( | .provides( | ServiceDefinition` returns zero hits. `src/index.ts` is `export {}`. The only Cordis companion, `src/invariant.ts` (`name='tui-invariant'`, `inject=['invariants']`), registers a no-op installer whose JSDoc states "registers nothing model-facing."
- **No Service Provider.** The package calls neither `ctx.provides(...)` nor `ctx.effect()` to expose a `ctx.tui` service. No `declare module '@deepseek-ai/cordis' { interface Context { tui: ... } }` augments the context. The OpenTUI store (`src/view/store.ts`) and renderer (`src/view/renderer.ts`) are private machinery, not a service.
- **Consumer + provider-only, on seams owned elsewhere.** The TUI registers answerers against two Service Definitions that live in `packages/interaction/`: `ctx.userQuestions.registerProvider(...)` (`src/answerers.ts:70`; seam at `packages/interaction/user-questions/src/index.ts:51`) and `ctx.on('approval/request', ...)` (`src/answerers.ts:46`; seam at `packages/interaction/user-questions/src/index.ts:17`). It also subscribes to `session/event` and `agent/status` (`src/runner.ts:174,178`).
- **Bundle composition.** `cordis.yml` flat-mounts ~10 capability plugins (agent-spine-demo, llm-deepseek, bash, fs, sessions, approval, user-questions) — the substance of a composition layer, not a capability.

### Official-documents backing

- `docs/user/develop/basic/index.md` ("What is a plugin?") defines a plugin as a module exporting `apply`, and states the **class form** (`extends Service`) is for "when the plugin needs to provide a service to other plugins." The TUI renders for the **terminal user**, not for other plugins; nothing injects `ctx.tui`. By this single criterion the TUI should not take the class form or define a Service Definition.
- `docs/user/develop/basic/publish.md` ("Two concepts, two manifests") distinguishes **bundle** (`dsh.bundle` patch layer; "what does this package contribute?") from **profile** (`dsh.profile`; "which bundles compose this setup?"). The TUI is a bundle an author distributes; a profile is what a user boots. "Nothing is both."
- `docs/user/develop/cordis-tutorial/` ch.3 (Services) and the `declare module` pattern: declaration merging adds the `ctx.<key>` type but "generates no runtime wiring; the plugin must separately provide the service or emit the event." The TUI does neither for a render key.
- `docs/glossary.md` "seam": the seam is the **complete capability across all three roles**; one role alone is not a seam. `docs/architecture.md:99-102` restates this, and `:123` gives the official UI-integration path: "drive `ctx.agents` and render from `session/event`" — which the TUI already does.

### No host-side render Service Definition exists to attach to

A search of every `interface Context { ... }` augmentation across `packages/` finds **no** `ctx.render` / `ctx.view` / `ctx.display` / `ctx.ui` host-side Service Definition. The only "render" extension points are browser-only: `ConversationNodeDefinition` + keyed renderer on `ctx.conversationEvents` (`packages/client/`), and the `ui-renderer`/`ui-conversation` client-half services. So "TUI as Provider for an existing render seam" has no target today.

## Why not make the render layer a seam now

1. **YAGNI + the split criterion.** Pre-release, single frontend. The seam's three roles (Service Definition / Provider / Consumer) would not evolve independently. `packages/CLAUDE.md` and `docs/glossary.md` both say: split roles into separate packages only when they evolve independently. One role alone is not a seam; a speculative seam is dead weight.
2. **Render is a process-level boundary, not an in-process service.** The TUI is a standalone Bun bin that boots the whole Loader in-process (`src/runner.ts` `boot()`). OpenTUI's `bun:ffi` terminal rendering runs in its own process. The in-process `ctx.<key>` service model does not fit a boundary the renderer crosses by FFI. (Node cannot load the `.so` at all; `bin.ts:5`, `tests/pty-harness.ts:112`.)
3. **Historical lesson.** The deleted `dsh-tui` v0.0.1 (commit `10bb9cbf4a`, 84 files, 40 snapshot tests) pushed `installAgentLlmTarget` into `packages/core/agent`. Its removal deleted the seam and 40 snapshots together — over-reaching into core is a verified failure mode. The current bundle form is the deliberate recoil from that.

## Consequence: publish as an independent bin, not (yet) a profile surface

The Bun-FFI runtime mismatch decides this. `dsh --profile <name>` boots through the `dsh` CLI under `node --import tsx/esm` (`CLAUDE.md` source-launch contract). OpenTUI's `createCliRenderer()` calls FFI that only Bun provides. A `dsh --profile tui` surface bundle would therefore FFI-fail under the Node launcher. The sibling surface bundles (`dsh-headless`, `dsh-web-app`) avoid this: their surfaces are Node-native (one-shot Agent run; HTTP server). The TUI surface is terminal FFI — inherently its own process.

So the publish path is **independent bin** (path A): `@deepseek-ai/dsh-tui` as a standalone `dsh-tui` bin run under `bun lib/bin.js`, distributed via npm so users `npm i -g @deepseek-ai/dsh-tui` or `npx @deepseek-ai/dsh-tui`. This honestly reflects the process boundary. It is **not** the `dsh --profile tui` profile-surface form until either the `dsh` launcher gains a Bun-runtime mode or the render layer drops its `bun:ffi` hard dependency.

## When to revisit

Introduce a `ctx.surface` / `ctx.render` Service Definition only when **both** hold:

1. A second real frontend exists (an IDE extension, a second TUI framework, or warp-mode), and
2. The render protocol needs in-process unification rather than per-frontend `session/event` subscription.

The Provider contract would then aggregate what `src/runner.ts` and `src/answerers.ts` already do: subscribe `session/event`, register the `user-questions` provider, and register the `approval/request` answerer. Until then those three are correctly in the bundle.

## Out of scope

- The publish mechanics for path A (release-family wiring vs. standalone `prepare` script) are an operations task, not an architecture decision; this note only fixes the form.
- Render-layer feature gaps (raw stdout, line-mode stdin) are tracked in the package README "Known Limitations"; they do not change the bundle-vs-seam verdict.
