# @deepseek-ai/dsh-tui

English | [中文](README.zh.md)

The dsh terminal UI bundle: a multi-turn in-process TUI REPL over the agent spine with approval and ask-user answerers, no Host, HTTP server, or browser layer. The published `dsh-tui` bin boots an external `cordis.yml`, reads stdin lines, drives one agent turn per line, renders streaming assistant text + tool lines to stdout, and answers approval/ask-user prompts from stdin. It is a standalone bin — not registered in `PROFILE_TEMPLATES` — so it adds no in-tree core edit (per the [upstream-follow strategy](../../../.agents/notes/proposed/architecture/2026-08-18-tui-solution-and-dev-plan.md)).

## Config discovery

The first non-empty channel wins: `$DSH_CORDIS_CONFIG`, then positional `argv[2]`. If neither names an existing file, the bin prints one-line usage to stderr and exits 1. Set `DSH_SNAPSHOT=replay` to swap `cordis.yml` → `cordis.snapshot.yml` in the same directory for keyless llm-replay (no `DEEPSEEK_API_KEY`). `DSH_SESSION_ROOT` overrides the JSONL backend root; `DSH_CWD` overrides the bash/filesystem cwd.

## stdin is the REPL

stdin carries one task line per turn (piped or typed). The bin pauses stdin before boot so a piped writer's data survives the async boot, then creates a readline interface after boot and drains it in a `for await` loop — each line drives one `agent.followup` turn. stdout is the terminal surface; diagnostics go to stderr. The approval answerer and ask-user provider reuse the same readline interface.

## Model Experience

Indirectly, through the plugins loaded from the external `cordis.yml`, which own every model-bound prompt, schema, message, and result; this bin adds none of its own.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Raw stdout, not a terminal renderer** — streaming text and `[tool/call]`/`[tool/result]` lines are written directly via `process.stdout.write`; there is no ANSI SGR, no markdown folding, no card components, no diff/todo/plan rendering. The render layer (pi-tui port + `presentation.ts` card dispatch) is Phase 2.
- **Line-mode stdin, not raw-mode** — `terminal: !isTTY ? false : true` readline; no single-keystroke approval (y/n needs `<enter>`), no keypress handling, no autocomplete, no slash-commands. Raw-mode keyboard input is Phase 2.
- **No `--resume`** — the bin creates a fresh session per run; there is no JSONL reconstruction of a prior session. `--resume` is Phase 3.
- **Answerers are line-mode and block the turn** — the approval/ask-user answerers read a full line from the shared stdin; under warp session-share, `SharedSessionWriteToLongRunningCommands` may gate this and require a non-blocking answerer (see the [analysis note](../../../.agents/notes/proposed/architecture/2026-08-18-tui-terminal-product-analysis.md) §8).
