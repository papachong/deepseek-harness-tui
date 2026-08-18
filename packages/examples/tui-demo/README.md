# @deepseek-ai/dsh-tui-demo

English | [中文](README.zh.md)

Phase 0 TUI prototype: a bin-only app that boots an external `cordis.yml`, reads one stdin line, drives one agent turn, and renders streaming assistant text + tool lines to stdout. It proves the in-process `session/event` → terminal-render pipeline works keyless, without touching `agent-loop` or registering a profile. The published `dsh-tui-demo` bin resolves bare plugins from the configuration project; stdout is the terminal surface — no JSON-RPC, no TTY raw mode.

## Config discovery

The first non-empty channel wins: `$DSH_CORDIS_CONFIG`, then positional `argv[2]`. If neither names an existing file, the bin prints one-line usage to stderr and exits 1. Set `DSH_SNAPSHOT=replay` to swap `cordis.yml` → `cordis.snapshot.yml` in the same directory for keyless llm-replay (no `DEEPSEEK_API_KEY`). `DSH_SESSION_ROOT` overrides the JSONL backend root; `DSH_CWD` overrides the bash/filesystem cwd.

## stdin is the task

stdin carries one task line (piped or typed). The bin reads it **before** `boot()` so a piped writer that closes immediately does not race the readline attach. stdout is the terminal surface; diagnostics go to stderr.

## Model Experience

Indirectly, through the plugins loaded from the external `cordis.yml`, which own every model-bound prompt, schema, message, and result; this bin adds none of its own.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **One turn only** — the bin drives a single `agent.followup` turn, renders it, and exits; there is no REPL loop, no `--resume`, no session listing. Multi-turn interaction is Phase 1 product-TUI work tracked in the [TUI analysis Agent Note](../../../.agents/notes/proposed/architecture/2026-08-18-tui-terminal-product-analysis.md).
- **No approval or ask-user answerer** — the prototype renders events but does not register an `approval/request` answerer or a `UserQuestionService` provider, so any turn that requests approval returns `'unavailable'` (fail-closed). The product TUI must register both.
- **Raw `process.stdout.write`, not a terminal renderer** — streaming text and `[tool/call]`/`[tool/result]` lines are written directly; there is no ANSI SGR, no markdown folding, no card components, no diff/todo/plan rendering. The render layer is Phase 2.
- **stdin is line-buffered, not raw-mode** — `terminal: false` readline; no keypress handling, no autocomplete, no slash-commands. Raw-mode keyboard input is Phase 2.
