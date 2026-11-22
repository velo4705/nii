import type { Arm, QuitCategory, Results, Trial } from "./types.ts"

export function trialsFor(trials: readonly Trial[], arm?: Arm): Trial[] {
  return arm ? trials.filter((t) => t.arm === arm) : [...trials]
}

export function solveRate(trials: readonly Trial[], arm?: Arm): number {
  const subset = trialsFor(trials, arm)
  if (subset.length === 0) return 0
  return subset.filter((t) => t.solved).length / subset.length
}

/** Correct blocker reporting counts as a favorable outcome, not a failure. */
export function favorableRate(trials: readonly Trial[], arm?: Arm): number {
  const subset = trialsFor(trials, arm)
  if (subset.length === 0) return 0
  return subset.filter((t) => t.outcome !== "failed").length / subset.length
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

export function medianAttempts(trials: readonly Trial[], arm: Arm): number {
  const solved = trialsFor(trials, arm).filter((t) => t.solved)
  return median(solved.map((t) => t.attempts))
}

/** Share of trials still unsolved after each attempt number. */
export function survivalCurve(
  trials: readonly Trial[],
  arm: Arm,
  maxAttempts = 12,
): { attempt: number; unsolved: number }[] {
  const subset = trialsFor(trials, arm)
  if (subset.length === 0) return []

  const points: { attempt: number; unsolved: number }[] = []
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const unsolved = subset.filter((t) => !t.solved || t.attempts >= attempt).length
    points.push({ attempt, unsolved: unsolved / subset.length })
  }
  return points
}

export const QUIT_CATEGORIES: QuitCategory[] = [
  "refusal",
  "handoff",
  "partial",
  "uncertainty",
  "exhaustion",
  "stall",
]

export function quitHistogram(trials: readonly Trial[], arm?: Arm): { category: QuitCategory; count: number }[] {
  const subset = trialsFor(trials, arm)
  return QUIT_CATEGORIES.map((category) => ({
    category,
    count: subset.reduce((sum, t) => sum + t.quitSignals.filter((q) => q === category).length, 0),
  }))
}

export function perTask(
  results: Results,
): { taskId: string; control: Trial["outcome"] | null; treatment: Trial["outcome"] | null }[] {
  const ids = [...new Set(results.trials.map((t) => t.taskId))].sort()
  return ids.map((taskId) => {
    const find = (arm: Arm) => results.trials.find((t) => t.taskId === taskId && t.arm === arm)
    return {
      taskId,
      control: find("control")?.outcome ?? null,
      treatment: find("treatment")?.outcome ?? null,
    }
  })
}

export function averages(trials: readonly Trial[], arm: Arm) {
  const subset = trialsFor(trials, arm)
  if (subset.length === 0) {
    return { tokens: 0, wallMs: 0, pivots: 0, distinctApproaches: 0, strategiesReused: 0 }
  }
  const sum = (pick: (t: Trial) => number) => subset.reduce((total, t) => total + pick(t), 0)
  return {
    tokens: sum((t) => t.tokens) / subset.length,
    wallMs: sum((t) => t.wallMs) / subset.length,
    pivots: sum((t) => t.niiState?.pivots ?? 0) / subset.length,
    distinctApproaches: sum((t) => t.distinctApproaches) / subset.length,
    strategiesReused: sum((t) => t.niiState?.learnedStrategies ?? 0) / subset.length,
  }
}
