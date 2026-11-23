import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { decideHook, HOOK_BLOCK_CAP, readTranscript } from "../core/hook.ts"

const HOOK_CLI = join(process.cwd(), "core", "hook-cli.ts")

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "nii-hook-test-"))
  mkdirSync(join(dir, ".nii"), { recursive: true })
  return dir
}

function transcript(dir: string, lines: Record<string, unknown>[]): string {
  const path = join(dir, "transcript.jsonl")
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8")
  return path
}

const FAILING_TASK = [
  { message: { content: [{ type: "tool_use", name: "shell" }, { type: "tool_result", exit_code: 1 }] } },
]

const VERIFIED_TASK = [
  { message: { content: [{ type: "tool_use", name: "shell" }, { type: "tool_result", exit_code: 0 }] } },
  { message: { content: [{ type: "text", text: "all tests pass <nii:done />" }] } },
]

test("hook reads tool facts from a transcript", () => {
  const dir = sandbox()
  try {
    const path = transcript(dir, [
      { message: { content: [{ type: "text", text: "working on it" }] } },
      ...FAILING_TASK,
    ])
    const facts = readTranscript(path)
    assert.match(facts.text, /working on it/)
    assert.deepEqual(facts.tools, ["shell"])
    assert.equal(facts.edits, 0)
    assert.equal(facts.exitCode, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("Test 1: valid Stop JSON blocks an unfinished task with exit 2", () => {
  const dir = sandbox()
  try {
    const result = decideHook(
      { transcript_path: transcript(dir, FAILING_TASK), last_assistant_text: "I can't make it work" },
      dir,
    )
    assert.equal(result.exitCode, 2)
    assert.match(result.stderr, /NII proof gate/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("Test 2: verified completion exits 0 with clean output", () => {
  const dir = sandbox()
  try {
    const result = decideHook({ transcript_path: transcript(dir, VERIFIED_TASK) }, dir)
    assert.equal(result.exitCode, 0)
    assert.equal(result.stderr, "")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("Test 3: malformed non-ASCII stdin recovers without exit 1", () => {
  const dir = sandbox()
  try {
    let status = 0
    let stderr = ""
    let stdout = ""
    try {
      stdout = execFileSync(process.execPath, [HOOK_CLI], {
        input: Buffer.from('{"last_assistant_message":"caf\u00e9 broken'),
        cwd: dir,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      })
    } catch (error) {
      const failure = error as { status?: number; stderr?: string; stdout?: string }
      status = failure.status ?? 0
      stderr = failure.stderr ?? ""
      stdout = failure.stdout ?? ""
    }
    assert.ok(status === 0 || status === 2, `status=${status} stderr=${stderr}`)
    assert.equal(stdout, "")
    assert.ok(stderr === "" || stderr.includes("NII"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("Test 4: stop_hook_active past the cap never deadlocks the terminal", () => {
  const dir = sandbox()
  try {
    writeFileSync(
      join(dir, ".nii", "memory.json"),
      JSON.stringify({ version: 1, hookBlocks: HOOK_BLOCK_CAP }),
      "utf8",
    )
    const result = decideHook(
      { stop_hook_active: true, transcript_path: transcript(dir, FAILING_TASK) },
      dir,
    )
    assert.equal(result.exitCode, 0)
    assert.equal(result.stderr, "")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("CLI keeps stdout empty on a block", () => {
  const dir = sandbox()
  try {
    let stdout = ""
    let status = 0
    try {
      execFileSync(process.execPath, [HOOK_CLI], {
        input: JSON.stringify({
          cwd: dir,
          transcript_path: transcript(dir, FAILING_TASK),
          last_assistant_text: "I give up",
        }),
        cwd: dir,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      })
    } catch (error) {
      const failure = error as { status?: number; stdout?: string }
      status = failure.status ?? 0
      stdout = failure.stdout ?? ""
    }
    assert.equal(status, 2)
    assert.equal(stdout, "")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
