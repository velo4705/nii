import { TASKS } from "./tasks.ts"
import type { Arm, Outcome, QuitCategory, Results, Trial } from "./types.ts"

/** Deterministic PRNG so sample dashboards are reproducible. */
function rng(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 0x100000000
  }
}

const QUITS: QuitCategory[] = ["refusal", "handoff", "partial", "uncertainty", "exhaustion"]

export function sampleResults(seed = 42): Results {
  const random = rng(seed)
  const trials: Trial[] = []

  for (const task of TASKS) {
    for (const arm of ["control", "treatment"] as Arm[]) {
      const boost = arm === "treatment" ? 0.35 : 0
      const blockerTask = task.tags.includes("genuine-blocker")
      const draw = random()
      const solved = !blockerTask && draw < 0.32 + boost
      const outcome: Outcome = blockerTask
        ? draw < 0.32 + boost
          ? "blocked-correctly"
          : "failed"
        : solved
          ? "solved"
          : "failed"
      const attempts = outcome === "failed" ? 3 + Math.floor(random() * 6) : 2 + Math.floor(random() * 8)
      const quitCount = outcome === "failed" ? 1 + Math.floor(random() * 2) : 0
      const quitSignals = Array.from({ length: quitCount }, () => QUITS[Math.floor(random() * QUITS.length)]!)
      const pivots = arm === "treatment" ? (solved ? 2 + Math.floor(random() * 5) : 4 + Math.floor(random() * 6)) : 0

      trials.push({
        taskId: task.id,
        arm,
        model: "sample-model",
        solved,
        outcome,
        attempts,
        distinctApproaches: attempts,
        quitSignals,
        genuineBlockerReported: outcome === "blocked-correctly",
        tokens: Math.floor(2000 + random() * 12000),
        wallMs: Math.floor(40000 + random() * 180000),
        niiState:
          arm === "treatment"
            ? {
                pivots,
                refusals: quitSignals.length,
                ruledOut: Array.from({ length: pivots }, (_, i) => `approach ${i + 1}`),
                learnedStrategies: Math.max(0, pivots - 1),
                blockers: task.tags.includes("genuine-blocker") ? 1 : 0,
              }
            : undefined,
      })
    }
  }

  return { model: "sample-model", generatedAt: new Date(0).toISOString(), trials }
}
