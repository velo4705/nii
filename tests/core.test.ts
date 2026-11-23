import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { test } from "node:test"
import { evaluate, UNIVERSAL_MEMORY_PATH } from "../core/decide.ts"

test("core exports are harness-neutral", async () => {
  const core = await import("../core/index.ts")
  assert.equal(typeof core.emptyActivity, "function")
  assert.equal(typeof core.evaluate, "undefined") // evaluate lives in core/decide.ts
  assert.equal(typeof core.buildMemoryFile, "function")
})

test("evaluate pushes on an unverified task with a quit signal", () => {
  const result = evaluate({
    tools: ["shell", "edit"],
    edits: 1,
    exitCode: 1,
    text: "I can't make it work",
  })
  assert.equal(result.decision, "PUSH")
  assert.match(result.reason!, /quit signal/)
  assert.match(result.prompt!, /not done/)
})

test("evaluate stands down on a verified pass with a completion tag", () => {
  const result = evaluate({
    tools: ["shell", "edit"],
    edits: 1,
    verified: true,
    completionTag: true,
  })
  assert.equal(result.decision, "DONE")
  assert.equal(result.reason, "verified pass")
})

test("evaluate rejects cheats even with a green exit code", () => {
  const result = evaluate({
    tools: ["shell", "edit"],
    edits: 1,
    exitCode: 0,
    completionTag: true,
    cheats: ["TODO"],
  })
  assert.equal(result.decision, "PUSH")
})

test("evaluate stands down on blockers and user gates", () => {
  for (const input of [{ blocker: true }, { userGate: true }]) {
    assert.equal(evaluate({ tools: ["shell"], ...input }).decision, "DONE")
  }
})

test("conversation-only input is dormant", () => {
  assert.equal(evaluate({ text: "what does this do?" }).decision, "DONE")
})

test("cli prints DONE or PUSH", () => {
  const push = execFileSync(process.execPath, ["core/cli.ts", "--tools", "shell,edit", "--exit-code", "1"], {
    encoding: "utf8",
  })
  assert.match(push, /^PUSH/)
  const done = execFileSync(process.execPath, ["core/cli.ts", "--verified", "--completion-tag", "--tools", "shell,edit"], {
    encoding: "utf8",
  })
  assert.match(done, /^DONE/)
})

test("universal memory path is documented", () => {
  assert.equal(UNIVERSAL_MEMORY_PATH, ".nii/memory.json")
})
