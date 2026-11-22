import assert from "node:assert/strict"
import { test } from "node:test"
import { averages, favorableRate, quitHistogram, solveRate, survivalCurve } from "../benchmark/aggregate.ts"
import { buildPrompt } from "../benchmark/runner.ts"
import { sampleResults } from "../benchmark/sample.ts"
import { TASKS } from "../benchmark/tasks.ts"
import { renderDashboard } from "../benchmark/visualize.ts"

test("sample results are deterministic", () => {
  assert.deepEqual(sampleResults(7), sampleResults(7))
  assert.notDeepEqual(sampleResults(7), sampleResults(8))
})

test("every task gets one control and one treatment trial", () => {
  const results = sampleResults()
  assert.equal(results.trials.length, TASKS.length * 2)
  for (const task of TASKS) {
    assert.equal(results.trials.filter((t) => t.taskId === task.id && t.arm === "control").length, 1)
    assert.equal(results.trials.filter((t) => t.taskId === task.id && t.arm === "treatment").length, 1)
  }
})

test("solve rate and survival curve use the right arm", () => {
  const results = sampleResults()
  const control = solveRate(results.trials, "control")
  const treatment = solveRate(results.trials, "treatment")
  assert.ok(control >= 0 && control <= 1)
  assert.ok(treatment >= 0 && treatment <= 1)

  const curve = survivalCurve(results.trials, "control", 5)
  assert.equal(curve.length, 5)
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i]!.unsolved <= curve[i - 1]!.unsolved)
  }
})

test("a correctly reported blocker is favorable but not a solve", () => {
  const results = sampleResults()
  const blockerTrials = results.trials.filter((t) => t.taskId === "res-blocked-source")
  assert.ok(blockerTrials.length > 0)
  for (const trial of blockerTrials) {
    if (trial.outcome === "blocked-correctly") {
      assert.equal(trial.solved, false)
      assert.equal(trial.genuineBlockerReported, true)
    }
  }
  assert.ok(favorableRate(results.trials, "treatment") >= solveRate(results.trials, "treatment"))
})

test("aggregates do not divide by zero", () => {
  assert.equal(solveRate([]), 0)
  assert.deepEqual(survivalCurve([], "control"), [])
  assert.equal(averages([], "control").pivots, 0)
})

test("quit histogram covers all categories", () => {
  const results = sampleResults()
  const histogram = quitHistogram(results.trials)
  assert.equal(histogram.length, 6)
  assert.ok(histogram.every((row) => row.count >= 0))
})

test("paired prompts differ only in the NII instruction", () => {
  const task = TASKS[0]!
  const control = buildPrompt(task, "control")
  const treatment = buildPrompt(task, "treatment")
  assert.match(control, /You may stop when you believe it cannot be done/)
  assert.match(treatment, /NII is active/)
  assert.ok(control.includes(task.prompt))
  assert.ok(treatment.includes(task.prompt))
})

test("dashboard renders charts without NaN", () => {
  const html = renderDashboard(sampleResults())
  assert.match(html, /<svg/)
  assert.match(html, /Solve rate/)
  assert.match(html, /Still unsolved/)
  assert.match(html, /Per-task outcome/)
  assert.doesNotMatch(html, /NaN/)
  assert.doesNotMatch(html, /undefined/)
})
