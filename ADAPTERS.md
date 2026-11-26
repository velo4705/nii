# Cross-agent adapters

`nii-skill` ships on OpenCode first. The portable engine lives in `core/` with zero OpenCode imports, so other harnesses only need a thin adapter. These adapters are specified here, not yet live-tested.

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

The shared adapter is `nii-hook`. It reads one JSON object on stdin and applies `nii-core`.

Both Stop payloads carry `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `stop_hook_active` and `last_assistant_message`. Codex also sends `turn_id`. The hook uses `last_assistant_message` first because the transcript is written asynchronously and can lag the current turn. It falls back to the transcript and then to `.nii/memory.json`.

The output contract is strict:

| Decision | stdout | stderr | Exit |
| --- | --- | --- | --- |
| Keep working | empty | the NII push prompt | `2` |
| Allow the stop | `{"continue":true}` | empty | `0` |

Codex requires JSON on stdout when a Stop hook exits `0`; Claude Code accepts the same object. The hook prints nothing else to stdout and never exits `1`.

The hook stands down when `stop_hook_active` is true, or after six blocks of its own. Six is below Claude Code's default harness cap of eight, so NII yields before the harness overrides it.

```sh
echo '{"transcript_path":"/path/to/transcript.jsonl","last_assistant_message":"I cannot finish"}' | npx nii-hook
# exit 2 + push prompt on stderr when the task is unverified
# exit 0 + {"continue":true} on stdout when the stop is legitimate
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

Codex CLI, `.codex/hooks.json`:

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "npx nii-hook", "timeout": 30 }] }
    ]
  }
}
```

Codex does not run a new project hook until it has been reviewed and trusted. Open `/hooks` in Codex, review the hook, and trust it. A changed hook gets a new hash and needs review again.

The hook CLI is unit-tested locally with piped mock payloads, with no subscription or API key needed. Live behaviour on those harnesses is **community-tested**: the contract is implemented, but only OpenCode has been exercised end to end here.

## Universal skill (shipped)

`universal/SKILL.md` is a passive companion for Cursor, Cline, Windsurf, Pi and other agents that support `SKILL.md`. It teaches the agent to read and update `.nii/memory.json`, avoid repeated paths, and obey the stop rules. Without a lifecycle hook it cannot force a turn to continue; it only shapes behavior.

## Rollout order

1. OpenCode native plugin, already shipped.
2. Claude Code `Stop` hook.
3. Codex CLI hooks and the universal skill for the remaining editors.
