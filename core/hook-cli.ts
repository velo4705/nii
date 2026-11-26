#!/usr/bin/env node
/** nii-hook — Claude Code / Codex CLI Stop hook. Reads JSON on stdin. */

import { decideHook, type HookInput } from "./hook.ts"

async function main() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString("utf8")

  let input: HookInput = {}
  if (raw.trim()) {
    try {
      input = JSON.parse(raw) as HookInput
    } catch {
      // Windows/truncated payloads must never crash the hook. Fall back to
      // the on-disk ledger and the cwd inferred by the harness.
      input = {}
    }
  }

  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd()
  const result = decideHook(input, cwd)
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(`${result.stderr}\n`)
  process.exitCode = result.exitCode
}

main().catch((error) => {
  process.stdout.write('{"continue":true}\n')
  process.stderr.write(`nii-hook failed: ${(error as Error).message}\n`)
  process.exitCode = 0
})
