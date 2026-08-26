# DSH TUI

English | [中文](README.zh.md)

A terminal UI for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), the plugin-based agent harness where everything is a plugin. DSH TUI runs the agent loop in-process and renders it with an OpenTUI (SolidJS) interface: streaming markdown, per-tool cards, themes, and work modes.

![DSH TUI home](patches/tui-screenshot-home.png)

Features:

- Home and chat pages with streaming markdown replies
- Tool-call cards: terminal, diff, read, search, web
- Slash commands with an autocomplete menu: `/model`, `/mode`, `/theme`, `/lang`, `/sessions`, `/clear`, `/compact`, `/goal`, `/plan`
- `@path` file mentions and `@[session]` cross-session mentions
- Sidebar session list with resume, approval prompts, 33 themes
- Tab-cyclable work modes (standard / code / minimal / cordis) backed by agent presets
- Runtime UI locale switching (`en` / `zh`), detected from the system env and overridable via `/lang`
- JSONL session persistence under `./.sessions` (override with `DSH_SESSION_ROOT`)

## Install

DSH TUI is a dsh bundle distributed through the npm ecosystem (no standalone binary). The package is published as `@ruhooai/dsh-tui` with a prebuilt `lib/`.

### Via dsh (recommended)

Install the bundle into a profile, then launch through the profile:

```sh
dsh plugin --profile default add @ruhooai/dsh-tui
```

Add `dsh-tui` to the profile's `dsh.profile.bundles` (the `add` command appends it), then run the profile's bin. Set `DEEPSEEK_API_KEY` for live model turns; see [the dsh publish guide](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish) for the bundle/`package.json` `"dsh"` metadata.

### Via npm directly

```sh
bunx --bun @ruhooai/dsh-tui cordis.yml
```

Requires `@deepseek-ai/dsh-*` peer packages to be resolvable (the dsh profile install path satisfies this; a bare `bunx` needs the peers present in the surrounding `node_modules`).

### From source (for development)

Requires Node.js ^22.19 or >=24 (build tooling) and [Bun](https://bun.sh) 1.3+ (compiles the Solid view and runs the result — the OpenTUI renderer draws through `bun:ffi`, which Node.js does not provide).

```sh
git clone https://github.com/papachong/deepseek-harness-tui.git
cd deepseek-harness-tui
pnpm install          # needs Node.js ^22.19 or >=24, and Bun for the view build
pnpm run build        # tsc + tsdown bundles; Bun.build compiles the Solid view
cd packages/bundle/tui
echo 'DEEPSEEK_API_KEY=sk-...' > .env
bun lib/bin.js cordis.yml
```

To hack on the interface, the view layer lives in `packages/bundle/tui/src/view/` (SolidJS components, store, themes) and the REPL runner in `src/runner.ts`. Rebuild the view with `pnpm --filter @ruhooai/dsh-tui run build:view` and relaunch `bun lib/bin.js`.

To compose your own agent instead of editing the UI, write your own `cordis.yml` — mount different plugins, presets, or models — and point the bin at it. The TUI renders whatever the composition produces.

The bin takes the composition config from the first non-empty channel: `$DSH_CORDIS_CONFIG`, then the positional argument. Useful flags and variables:

- `--resume <sessionId>` — rebuild the agent on a persisted session
- `DSH_SESSION_ROOT` — session storage root (default `./.sessions`)
- `DSH_CWD` — working directory for bash and filesystem tools

### Planned

- **Single-file binary**: a download-and-run executable per platform (Windows/macOS/Linux) is explored as a future channel via `bun build --compile`, but the npm bundle path above is the official distribution.

## Contributing

Issues and pull requests are welcome at [github.com/papachong/deepseek-harness-tui](https://github.com/papachong/deepseek-harness-tui). Before pushing, run the relevant checks (`pnpm run typecheck`, `pnpm run lint`, focused `pnpm run test`); see [AGENTS.md](AGENTS.md) for repository conventions.

## License

[MIT](LICENSE)
