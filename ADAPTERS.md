# Cross-agent adapters

`opencode-nii` ships on OpenCode first. The portable engine lives in `core/` with zero OpenCode imports, so other harnesses only need a thin adapter. These adapters are specified here, not yet live-tested.

## The core contract

`nii-evaluate` reads observable state and prints `DONE` or `PUSH`. A `PUSH` decision is followed by the next directive.

```sh
npx nii-evaluate --tools shell,edit --edits 2 --exit-code 1 --text 'I cannot fix this'
# PUSH
# [NII proof gate] The task is not done...
```

`npx nii-evaluate --verified --completion-tag --tools shell,edit` returns `DONE`.

The engine also exports `evaluate()`, `buildMemoryFile()` and `ledgerText()` for adapters that want to call it in-process.

## OpenCode (shipped)

The plugin subscribes to `session.idle`, tool events, `session.text.ended`, and `session.compaction.ended`. It calls the same pure functions in `core/` directly and injects continuations with `ctx.session.prompt()`.

## Claude Code and Codex CLI (community-tested)

Both harnesses use the same hook contract: JSON on stdin, exit code `2` with a non-empty stderr message to block the stop, exit code `0` to allow it. The shared adapter is `nii-hook`, which reads the transcript path from the hook payload and applies `nii-core`.

```sh
echo '{"transcript_path":"/path/to/transcript.jsonl"}' | npx nii-hook
# exit 2 + push prompt on stderr when the task is unverified
# exit 0 when the stop is legitimate
```

Claude Code, `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "npx nii-hook" }] }
    ]
  }
}
```

Codex CLI, `.codex/hooks.json` with the same `Stop` command shape.

The hook CLI is unit-tested locally with piped mock payloads, with no subscription or API key needed. Live behaviour on those harnesses is **community-tested**: the contract is implemented, but only OpenCode has been exercised end to end here. Field names in real payloads may need small PRs from adopters.

## Universal skill (shipped)

`universal/SKILL.md` is a passive companion for Cursor, Cline, Windsurf, Pi and other agents that support `SKILL.md`. It teaches the agent to read and update `.nii/memory.json`, avoid repeated paths, and obey the stop rules. Without a lifecycle hook it cannot force a turn to continue; it only shapes behavior.

## Rollout order

1. OpenCode native plugin, already shipped.
2. Claude Code `Stop` hook.
3. Codex CLI hooks and the universal skill for the remaining editors.
