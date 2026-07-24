# Troubleshooting

## `pnpm test` fails because of browser APIs

Make sure the workspace dependencies are installed from the repo root:

```bash
pnpm install
```

## Package resolution is broken

Run install from the repository root, not from a subpackage.

## Node version is too old

Use Node.js `22+`.

## Terminal startup fails

Check that your shell environment is available and executable, and that at least one supported provider binary is on `PATH`.

Provider checks:

- Codex: `codex --version`, `codex login`, and project trust when Codex prompts for it.
- Claude Code: `claude --version`, Claude authentication, and hook callback dependencies.

If startup fails with `Terminal session limit reached`, Octogent already has the configured number of live agent sessions. Stop unused terminals with `octogent terminal stop <terminal-id>` or prune inactive records with `octogent terminal prune`. The default cap is 32; set `OCTOGENT_MAX_TERMINAL_SESSIONS` to a positive integer before starting Octogent to adjust it.

## Codex app-server mode fails

Codex uses the existing PTY launch path by default. The native `codex app-server`
driver is experimental and only used when `OCTOGENT_CODEX_RUNTIME=app-server`
is set before starting Octogent.

If app-server mode fails, verify:

- `codex app-server --help` works from the same shell
- Codex is authenticated
- the project is trusted by Codex
- `OCTOGENT_CODEX_RUNTIME` is set to exactly `app-server`

Unset `OCTOGENT_CODEX_RUNTIME` to return Codex terminals to the default PTY
runtime.

## Worktree terminal creation fails

Verify:

- `git --version` works
- the workspace is a git repository
- the current user can create worktrees in `.octogent/worktrees/`

## GitHub summary is unavailable

Verify:

```bash
gh auth status
```

## Monitor refresh fails

Verify your X bearer token and API access.

## Messages disappear after restart

That is expected. Channel messages are in-memory only and do not persist across API restarts.

## A terminal survived reload but not server restart

That is also expected. Live agent sessions can survive a reconnect window, but they do not survive an API restart.

After restart, terminals that were persisted as running are marked `stale` when Octogent cannot reattach them to an in-memory session. Use `octogent terminal list` to inspect lifecycle state, `octogent terminal stop <terminal-id>` or `octogent terminal kill <terminal-id>` for a recorded process, and `octogent terminal prune` to remove stale, stopped, or exited records from the UI.
