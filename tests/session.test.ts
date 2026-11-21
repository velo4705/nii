import assert from "node:assert/strict"
import { test } from "node:test"
import type { NiiContext } from "../.opencode/plugins/nii/state.ts"
import {
  clearPending,
  clearStuck,
  isEnabled,
  readLearning,
  readPending,
  readStuck,
  setSessionEnabled,
  writeLearning,
  writePending,
  writeStuck,
} from "../.opencode/plugins/nii/state.ts"
import {
  BASE_MANDATE,
  BLOCKER_MANDATE,
  ESCALATED_MANDATE,
  EXHAUSTED_MANDATE,
  fallbackProposal,
  motivationFor,
  pivotMessage,
  REFUSAL_MANDATE,
  STUCK_NUDGE,
} from "../.opencode/plugins/nii/playbook.ts"
import {
  buildCoachPrompt,
  emptyStuckState,
  failureCount,
  isExhausted,
  isGenuineBlocker,
  markPivoted,
  MAX_PIVOTS,
  recordBlocker,
  recordFailure,
  recordRefusal,
  recordSuccess,
  shouldEscalateRefusal,
  shouldPivot,
} from "../.opencode/plugins/nii/stuck.ts"
import {
  ineffectiveStrategies,
  isDistinctEnough,
  matchingStrategies,
  recordIneffective,
  recordLearning,
} from "../.opencode/plugins/nii/learning.ts"

type Harness = {
  ctx: NiiContext
  data: Map<string, unknown>
  sessionID: string
}

function harness(projectID = "project-a", sessionID = "ses-1", sharedData?: Map<string, unknown>): Harness {
  const data = sharedData ?? new Map<string, unknown>()
  const ctx: NiiContext = {
    storage: {
      async get(key: string) {
        return data.get(key)
      },
      async set(key: string, value: unknown) {
        data.set(key, value)
      },
      async remove(key: string) {
        data.delete(key)
      },
    },
    location: { directory: `/work/${projectID}`, project: { id: projectID } },
  }
  return { ctx, data, sessionID }
}

async function fail(h: Harness, signature: string, blockerText?: string) {
  const current = await readStuck(h.ctx, h.sessionID)
  if (blockerText && isGenuineBlocker(blockerText)) {
    await writeStuck(h.ctx, h.sessionID, recordBlocker(current))
    return
  }
  const pending = await readPending(h.ctx, h.sessionID)
  if (pending) {
    await writeLearning(
      h.ctx,
      recordIneffective(await readLearning(h.ctx), pending.signatures, pending.strategy),
    )
    await clearPending(h.ctx, h.sessionID)
  }
  await writeStuck(h.ctx, h.sessionID, recordFailure(current, signature))
}

async function succeed(h: Harness) {
  const current = await readStuck(h.ctx, h.sessionID)
  const pending = await readPending(h.ctx, h.sessionID)
  if (pending) {
    await writeLearning(
      h.ctx,
      recordLearning(await readLearning(h.ctx), pending.signatures, pending.strategy),
    )
    await clearPending(h.ctx, h.sessionID)
  }
  await writeStuck(h.ctx, h.sessionID, recordSuccess(current))
}

async function refuse(h: Harness) {
  const current = await readStuck(h.ctx, h.sessionID)
  await writeStuck(h.ctx, h.sessionID, recordRefusal(current))
}

async function pivot(h: Harness, proposal: string) {
  const current = await readStuck(h.ctx, h.sessionID)
  if (!shouldPivot(current)) return false
  await writeStuck(h.ctx, h.sessionID, markPivoted(current))
  await writePending(h.ctx, h.sessionID, { signatures: current.ruledOut, strategy: proposal })
  return true
}

async function mandate(h: Harness) {
  return motivationFor(await readStuck(h.ctx, h.sessionID), MAX_PIVOTS)
}

test("a short failing burst nudges but does not pivot", async () => {
  const h = harness()
  await fail(h, "shell: build failed")
  await fail(h, "shell: test failed")
  const stuck = await readStuck(h.ctx, h.sessionID)
  assert.equal(failureCount(stuck), 2)
  assert.equal(shouldPivot(stuck), false)
  assert.equal(await mandate(h), `${BASE_MANDATE}\n\n${STUCK_NUDGE}`)
})

test("three failures produce exactly one pivot, then the state settles", async () => {
  const h = harness()
  await fail(h, "shell: one")
  await fail(h, "shell: two")
  await fail(h, "shell: three")
  assert.equal(await pivot(h, "try a different build system"), true)
  assert.equal(await mandate(h), `${BASE_MANDATE}\n\n${ESCALATED_MANDATE}`)
  assert.equal(await pivot(h, "duplicate pivot"), false)
  assert.equal((await readStuck(h.ctx, h.sessionID)).pivots, 1)
})

test("an intervening success does not erase earlier failures from the window", async () => {
  const h = harness()
  await fail(h, "shell: one")
  await fail(h, "shell: two")
  await succeed(h)
  await fail(h, "shell: three")
  assert.equal(failureCount(await readStuck(h.ctx, h.sessionID)), 3)
  assert.equal(shouldPivot(await readStuck(h.ctx, h.sessionID)), true)
})

test("a genuine blocker stops the whole loop and survives further failures", async () => {
  const h = harness()
  await fail(h, "shell: one")
  await fail(h, "shell: two")
  await fail(h, "tool: permission denied", "permission denied")
  const stuck = await readStuck(h.ctx, h.sessionID)
  assert.equal(stuck.blockers, 1)
  assert.equal(shouldPivot(stuck), false)
  assert.equal((await mandate(h)).includes(BLOCKER_MANDATE), true)
  await fail(h, "shell: four")
  assert.equal((await readStuck(h.ctx, h.sessionID)).blockers, 1)
  assert.equal(await isEnabled(h.ctx, h.sessionID), true)
})

test("a successful pivot becomes a hint for later sessions in the same project", async () => {
  const h = harness()
  await fail(h, "shell: one")
  await fail(h, "shell: two")
  await fail(h, "shell: three")
  await pivot(h, "switch to the incremental compiler")
  await succeed(h)
  assert.deepEqual(matchingStrategies(await readLearning(h.ctx), ["shell: three"]), [
    "switch to the incremental compiler",
  ])

  const later = harness("project-a", "ses-2", h.data)
  await fail(later, "shell: one")
  await fail(later, "shell: three")
  const learned = await readLearning(later.ctx)
  assert.deepEqual(matchingStrategies(learned, ["shell: three"]), [
    "switch to the incremental compiler",
  ])

  const elsewhere = harness("project-b", "ses-3")
  await fail(elsewhere, "shell: three")
  assert.equal((await readLearning(elsewhere.ctx)).length, 0)
})

test("a failed pivot is marked ineffective in that project", async () => {
  const h = harness()
  await fail(h, "shell: one")
  await fail(h, "shell: two")
  await fail(h, "shell: three")
  await pivot(h, "retry with more verbose logging")
  await fail(h, "shell: three")
  const learned = await readLearning(h.ctx)
  assert.deepEqual(matchingStrategies(learned, ["shell: three"]), [])
  assert.deepEqual(ineffectiveStrategies(learned, ["shell: three"]), [
    "retry with more verbose logging",
  ])
  assert.match(
    buildCoachPrompt(["shell: three"], [], ineffectiveStrategies(learned, ["shell: three"])),
    /Do NOT repeat these/,
  )
})

test("the pivot budget caps at three and /nii reset clears it", async () => {
  const h = harness()
  for (let i = 1; i <= MAX_PIVOTS; i++) {
    for (let j = 1; j <= 3; j++) await fail(h, `shell: round-${i}-${j}`)
    assert.equal(await pivot(h, `strategy ${i}`), true)
  }
  const exhausted = await readStuck(h.ctx, h.sessionID)
  assert.equal(isExhausted(exhausted), true)
  assert.equal((await mandate(h)).includes(EXHAUSTED_MANDATE), true)

  await setSessionEnabled(h.ctx, h.sessionID, false)
  await clearStuck(h.ctx, h.sessionID)
  assert.deepEqual(await readStuck(h.ctx, h.sessionID), emptyStuckState())
  assert.equal(await isEnabled(h.ctx, h.sessionID), false)
  assert.equal((await mandate(h)).includes(EXHAUSTED_MANDATE), false)
})

test("a refusal alongside a failure escalates with the refusal mandate", async () => {
  const h = harness()
  await refuse(h)
  assert.equal((await mandate(h)).includes(REFUSAL_MANDATE), false)
  await fail(h, "shell: one")
  assert.equal(shouldEscalateRefusal(await readStuck(h.ctx, h.sessionID)), true)
  assert.equal((await mandate(h)).includes(REFUSAL_MANDATE), true)
})

test("a duplicate coach proposal falls back to the deterministic playbook pivot", async () => {
  const h = harness()
  await fail(h, "shell: one")
  await fail(h, "shell: two")
  await fail(h, "shell: three")
  const ruledOut = (await readStuck(h.ctx, h.sessionID)).ruledOut
  const duplicate = "try a different build system again"
  const accepted = isDistinctEnough(duplicate, ["try a different build system"])
  assert.equal(accepted, false)

  const proposal = accepted ? duplicate : fallbackProposal(ruledOut)
  assert.equal(await pivot(h, proposal), true)
  const msg = pivotMessage(proposal, 1, MAX_PIVOTS)
  assert.match(msg, /\[NII — strategy pivot 1\/3\]/)
  assert.match(msg, /Goal restatement/)
  assert.match(proposal, /playbook directly/)
  assert.match(proposal, /Already failed: shell: one/)
})
