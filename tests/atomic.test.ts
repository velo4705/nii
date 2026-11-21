import assert from "node:assert/strict"
import { test } from "node:test"
import { withLock } from "../.opencode/plugins/nii/lock.ts"
import {
  claimPivot,
  emptyStuckState,
  failureCount,
  finalizePivot,
  markPivoted,
  recordFailure,
  shouldPivot,
} from "../.opencode/plugins/nii/stuck.ts"

function stuckAfter(n: number) {
  let state = emptyStuckState()
  for (let i = 0; i < n; i++) state = recordFailure(state, `shell: failure-${i}`)
  return state
}

test("claiming a pivot consumes no budget and blocks a second pivot", () => {
  const state = stuckAfter(3)
  assert.equal(shouldPivot(state), true)
  const claimed = claimPivot(state, "use the streaming parser", state.ruledOut)
  assert.equal(claimed.pivots, 0)
  assert.deepEqual(claimed.inflight, {
    proposal: "use the streaming parser",
    signatures: state.ruledOut,
  })
  assert.equal(shouldPivot(claimed), false)
})

test("finalizing after delivery consumes exactly one pivot", () => {
  const claimed = claimPivot(stuckAfter(3), "use the streaming parser", ["shell: failure-2"])
  const done = finalizePivot(claimed)
  assert.equal(done.pivots, 1)
  assert.equal(done.lastPivot, "use the streaming parser")
  assert.deepEqual(done.pivotsTried, ["use the streaming parser"])
  assert.equal(done.inflight, undefined)
  assert.equal(failureCount(done), 3)
  assert.equal(finalizePivot(done).pivots, 1)
})

test("a crash before delivery leaves a replayable claim", () => {
  const claimed = claimPivot(stuckAfter(3), "replay this exact pivot", ["shell: failure-0"])
  // Simulate a resume: state is read fresh from storage, still claimed.
  const resumed = { ...claimed }
  assert.equal(resumed.pivots, 0)
  assert.equal(resumed.inflight?.proposal, "replay this exact pivot")
  assert.equal(shouldPivot(resumed), false)
  const done = finalizePivot(resumed)
  assert.equal(done.pivots, 1)
  assert.equal(done.lastPivot, "replay this exact pivot")
})

test("the lock serializes concurrent work for the same key", async () => {
  const events: string[] = []
  const first = withLock("session-1", async () => {
    events.push("first:start")
    await new Promise((resolve) => setTimeout(resolve, 10))
    events.push("first:end")
  })
  const second = withLock("session-1", async () => {
    events.push("second:start")
    events.push("second:end")
  })
  const unrelated = withLock("session-2", async () => {
    events.push("unrelated")
  })
  await Promise.all([first, second, unrelated])
  assert.deepEqual(events, ["first:start", "unrelated", "first:end", "second:start", "second:end"])
})

test("the lock releases after a failure so later work can proceed", async () => {
  await assert.rejects(
    withLock("session-3", async () => {
      throw new Error("delivery failed")
    }),
    /delivery failed/,
  )
  let ran = false
  await withLock("session-3", async () => {
    ran = true
  })
  assert.equal(ran, true)
})

test("markPivoted remains a simple helper for non-atomic callers", () => {
  const marked = markPivoted(stuckAfter(3))
  assert.equal(marked.pivots, 1)
  assert.equal(marked.inflight, undefined)
})
