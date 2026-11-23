/** Shared stdin/exit-code wrapper for Claude Code Stop and Codex CLI Stop hooks. */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { evaluate } from "./decide.ts"
import { UNIVERSAL_MEMORY_PATH } from "./decide.ts"

export const HOOK_BLOCK_CAP = 8

export type HookInput = {
  session_id?: string
  transcript_path?: string
  cwd?: string
  hook_event_name?: string
  stop_hook_active?: boolean
  last_assistant_text?: string
}

export type HookResult = {
  exitCode: 0 | 2
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
      textLines.push(content)
      continue
    }
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== "object") continue
      const block = part as Record<string, unknown>
      if (block.type === "text" && typeof block.text === "string") textLines.push(block.text)
      if (block.type === "tool_use" && typeof block.name === "string") {
        tools.push(block.name)
        if (/edit|write|patch/i.test(block.name)) edits++
      }
      if (block.type === "tool_result" && typeof block.exit_code === "number") {
        exitCode = block.exit_code
      }
    }
  }

  return { text: textLines.join("\n"), tools: [...new Set(tools)], edits, exitCode }
}

export function decideHook(input: HookInput, cwd = process.cwd()): HookResult {
  const memory = readMemory(cwd)
  const blocks = typeof memory.hookBlocks === "number" ? memory.hookBlocks : 0

  // Own ceiling, independent of the harness cap.
  if (input.stop_hook_active === true && blocks >= HOOK_BLOCK_CAP) {
    return { exitCode: 0, stderr: "" }
  }

  const facts = readTranscript(input.transcript_path)
  const result = evaluate({
    text: [input.last_assistant_text, facts.text].filter(Boolean).join("\n"),
    tools: facts.tools,
    edits: facts.edits,
    exitCode: facts.exitCode,
  })

  if (result.decision === "DONE") {
    if (blocks > 0) writeMemory(cwd, { ...memory, hookBlocks: 0 })
    return { exitCode: 0, stderr: "" }
  }

  writeMemory(cwd, { ...memory, hookBlocks: blocks + 1 })
  return { exitCode: 2, stderr: result.prompt ?? "NII: keep working until verification passes." }
}
