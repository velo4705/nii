import assert from "node:assert/strict"
import { test } from "node:test"
import {
  continuationDirective,
  detectCheats,
  emptyActivity,
  exitDecision,
  isTaskExecution,
  lightweightPass,
  recordCompletionTag,
  recordContinuation,
  recordExit,
  recordTool,
  shouldInjectMandate,
  wallExceeded,
} from "../.opencode/plugins/nii/proof.ts"

test("conversation-only turns stay dormant", () => {
  assert.equal(isTaskExecution(emptyActivity()), false)
  let activity = emptyActivity()
  activity = recordTool(activity, "read")
  assert.equal(isTaskExecution(activity), false)
})

test("edits and shell commands count as task execution", () => {
  assert.equal(isTaskExecution(recordTool(emptyActivity(), "edit")), true)
  assert.equal(isTaskExecution(recordTool(emptyActivity(), "shell")), true)
})

test("completion tag is only a claim, not proof", () => {
  const activity = recordCompletionTag(recordTool(emptyActivity(), "shell"), "done <nii:done />")
  assert.equal(activity.completionTag, true)
  assert.equal(
    exitDecision({ activity, verifiedPass: false, cheats: [], budgetReached: false }),
    "continue",
  )
})

test("verified pass with no cheats and a completion tag stands down", () => {
  const activity = recordCompletionTag(recordTool(emptyActivity(), "shell"), "<nii:done />")
  assert.equal(
    exitDecision({ activity, verifiedPass: true, cheats: [], budgetReached: false }),
    "stand-down",
  )
})

test("cheats reject an otherwise green verification", () => {
  const activity = recordCompletionTag(recordTool(emptyActivity(), "shell"), "<nii:done />")
  assert.equal(
    exitDecision({ activity, verifiedPass: true, cheats: ["TODO"], budgetReached: false }),
    "continue",
  )
})

test("blocker, user abort and user gate are the only early exits", () => {
  for (const flag of ["userAbort", "blocker", "userGate"] as const) {
    const activity = { ...emptyActivity(), [flag]: true }
    assert.equal(
      exitDecision({ activity, verifiedPass: false, cheats: [], budgetReached: false }),
      "stand-down",
    )
  }
})

test("budget ceiling reports instead of continuing forever", () => {
  assert.equal(
    exitDecision({
      activity: recordTool(emptyActivity(), "shell"),
      verifiedPass: false,
      cheats: [],
      budgetReached: true,
    }),
    "report",
  )
})

test("diff cheats are detected", () => {
  const diff = "-describe('test', () => {\n+  // TODO: implement later\n"
  assert.ok(detectCheats(diff).length >= 2)
  assert.deepEqual(detectCheats("+ const x = 1"), [])
})

test("continuation directive names the cheats and demands real verification", () => {
  const text = continuationDirective(["TODO"])
  assert.match(text, /not done/)
  assert.match(text, /TODO/)
  assert.match(text, /<nii:done \/>/)
})

test("continuations are counted", () => {
  let activity = emptyActivity()
  activity = recordContinuation(activity)
  activity = recordContinuation(activity)
  assert.equal(activity.continuations, 2)
})

test("ordinary Q&A gets no mandate", () => {
  const clean = { pivots: 0, refusals: 0, blockers: 0, recentLength: 0 }
  assert.equal(shouldInjectMandate(emptyActivity(), clean, "what does this function do?"), false)
  assert.equal(shouldInjectMandate(emptyActivity(), clean, "fix the failing test"), true)
  assert.equal(shouldInjectMandate(recordTool(emptyActivity(), "shell"), clean, "hello"), true)
  assert.equal(shouldInjectMandate(emptyActivity(), { ...clean, pivots: 1 }, "hello"), true)
})

test("wall clock budget reports instead of looping", () => {
  const activity = recordTool(emptyActivity(), "shell")
  assert.equal(wallExceeded(activity, 0), false)
  assert.equal(wallExceeded({ ...activity, startedAt: Date.now() - 5000 }, 1000), true)
  assert.equal(
    exitDecision({
      activity,
      verifiedPass: false,
      cheats: [],
      budgetReached: false,
      wallExceeded: true,
    }),
    "report",
  )
})

test("subjective fallback needs a completion tag and real edits", () => {
  const edited = recordTool(emptyActivity(), "edit")
  assert.equal(lightweightPass(edited, []), false)
  assert.equal(lightweightPass(recordCompletionTag(edited, "<nii:done />"), []), true)
  assert.equal(lightweightPass(recordCompletionTag(edited, "<nii:done />"), ["TODO"]), false)
})

test("exit codes are recorded for verification", () => {
  assert.equal(recordExit(emptyActivity(), 0).lastExitCode, 0)
  assert.equal(recordExit(emptyActivity(), undefined).lastExitCode, undefined)
})
