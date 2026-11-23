import assert from "node:assert/strict"
import { test } from "node:test"
import { buildMemoryFile, ledgerText } from "../.opencode/plugins/nii/memory.ts"
import { emptyStuckState, recordFailure, markPivoted } from "../.opencode/plugins/nii/stuck.ts"

test("memory file records ruled-out paths and strategies", () => {
  let stuck = recordFailure(emptyStuckState(), "shell: build failed")
  stuck = markPivoted(stuck)
  const file = buildMemoryFile("demo", stuck, [
    { signature: "shell: build failed", strategy: "upgrade linker", uses: 1, updated: 1 },
  ])
  assert.equal(file.version, 1)
  assert.equal(file.project, "demo")
  assert.deepEqual(file.ruledOut, ["shell: build failed"])
  assert.equal(file.strategies[0]!.strategy, "upgrade linker")
  assert.equal(file.strategies[0]!.ineffective, false)
})

test("ledger shows the ruled-out paths and delivered pivots", () => {
  let stuck = recordFailure(emptyStuckState(), "shell: build failed")
  stuck = { ...stuck, pivotsTried: ["upgrade linker"] }
  const text = ledgerText(stuck, [])
  assert.match(text, /Ruled-out paths/)
  assert.match(text, /shell: build failed/)
  assert.match(text, /upgrade linker/)
  assert.match(text, /none learned/)
})
