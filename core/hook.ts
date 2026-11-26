/** Shared Stop-hook adapter for Claude Code and Codex CLI. */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { evaluate, UNIVERSAL_MEMORY_PATH } from "./decide.ts"

/** Below Claude Code's default harness cap of 8, so we stand down first. */
export const HOOK_BLOCK_CAP = 6

/** Both harnesses accept this on a successful Stop hook. Codex requires it. */
const DONE_STDOUT = '{"continue":true}\n'

export type HookInput = {
  session_id?: string
  turn_id?: string
  transcript_path?: string
  cwd?: string
  hook_event_name?: string
  permission_mode?: string
  stop_hook_active?: boolean
  last_assistant_message?: string | null
  last_assistant_text?: string
}

export type HookResult = {
  exitCode: 0 | 2
  stdout: string
  stderr: string
}

type UniversalMemory = {
  version?: number
  ruledOut?: string[]
  pivots?: string[]
  strategies?: unknown[]
  hookBlocks?: number
}

function memoryPath(cwd: string): string {
  return join(cwd, UNIVERSAL_MEMORY_PATH)
}

function readMemory(cwd: string): UniversalMemory {
  try {
    return JSON.parse(readFileSync(memoryPath(cwd), "utf8")) as UniversalMemory
  } catch {
    return {}
  }
}

function writeMemory(cwd: string, memory: UniversalMemory): void {
  try {
    writeFileSync(memoryPath(cwd), `${JSON.stringify({ version: 1, ...memory }, null, 2)}\n`, "utf8")
  } catch {
    // A failed ledger write must never turn into a failed hook.
  }
}

type TranscriptFacts = {
  text: string
  tools: string[]
  edits: number
  exitCode: number | undefined
}

function isAssistant(entry: Record<string, unknown>, message: Record<string, unknown>): boolean {
  return entry.type === "assistant" || message.role === "assistant"
}

function exitCodeFrom(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value
  if (typeof value !== "string") return undefined
  const match = value.match(/exit code:\s*(\d+)/i)
  return match ? Number(match[1]) : undefined
}

/** Best-effort JSONL transcript scan. Unknown shapes yield no facts. */
export function readTranscript(path: string | undefined): TranscriptFacts {
  const empty: TranscriptFacts = { text: "", tools: [], edits: 0, exitCode: undefined }
  if (!path) return empty
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch {
    return empty
  }

  const textLines: string[] = []
  const tools: string[] = []
  let edits = 0
  let exitCode: number | undefined

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const message = (entry.message ?? entry) as Record<string, unknown>
    const content = message.content

    if (typeof content === "string") {
      if (isAssistant(entry, message)) textLines.push(content)
      continue
    }
    if (!Array.isArray(content)) continue

    for (const part of content) {
      if (!part || typeof part !== "object") continue
      const block = part as Record<string, unknown>
      if (block.type === "text" && typeof block.text === "string" && isAssistant(entry, message)) {
        textLines.push(block.text)
      }
      if (block.type === "tool_use" && typeof block.name === "string") {
        tools.push(block.name)
        if (/edit|write|patch/i.test(block.name)) edits++
      }
      if (block.type === "tool_result") {
        if (block.is_error === true && exitCode === undefined) exitCode = 1
        const metadata = block.metadata as Record<string, unknown> | undefined
        const found = exitCodeFrom(block.exit_code) ?? exitCodeFrom(metadata?.exit_code) ?? exitCodeFrom(block.content)
        if (found !== undefined) exitCode = found
      }
    }
  }

  return { text: textLines.join("\n"), tools: [...new Set(tools)], edits, exitCode }
}

export function decideHook(input: HookInput, cwd = process.cwd()): HookResult {
  const memory = readMemory(cwd)
  const blocks = typeof memory.hookBlocks === "number" ? memory.hookBlocks : 0

  // Stand down when the harness already continued this turn, or when our own
  // cap is reached. The own cap is lower than Claude Code's default of 8.
  if (input.stop_hook_active === true || blocks >= HOOK_BLOCK_CAP) {
    if (blocks > 0) writeMemory(cwd, { ...memory, hookBlocks: 0 })
    return { exitCode: 0, stdout: DONE_STDOUT, stderr: "" }
  }

  const facts = readTranscript(input.transcript_path)
  const latest = input.last_assistant_message ?? input.last_assistant_text ?? ""
  const result = evaluate({
    text: [latest, facts.text].filter(Boolean).join("\n"),
    tools: facts.tools,
    edits: facts.edits,
    exitCode: facts.exitCode,
  })

  if (result.decision === "DONE") {
    if (blocks > 0) writeMemory(cwd, { ...memory, hookBlocks: 0 })
    return { exitCode: 0, stdout: DONE_STDOUT, stderr: "" }
  }

  writeMemory(cwd, { ...memory, hookBlocks: blocks + 1 })
  return { exitCode: 2, stdout: "", stderr: result.prompt ?? "NII: keep working until verification passes." }
}
