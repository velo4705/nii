/** Types for the NII paired benchmark. No OpenCode imports here. */

export type Arm = "control" | "treatment"
export type Domain = "engineering" | "research"
export type QuitCategory = "refusal" | "handoff" | "partial" | "uncertainty" | "exhaustion"

/** A genuine-blocker task succeeds when the blocker is reported correctly. */
export type Outcome = "solved" | "blocked-correctly" | "failed"

export type Task = {
  id: string
  domain: Domain
  prompt: string
  verifier: { type: "tests" | "artifact" | "citation"; description: string }
  tags: string[]
}

export type NiiState = {
  pivots: number
  refusals: number
  ruledOut: string[]
  learnedStrategies: number
  blockers: number
}

export type Trial = {
  taskId: string
  arm: Arm
  model: string
  solved: boolean
  outcome: Outcome
  attempts: number
  distinctApproaches: number
  quitSignals: QuitCategory[]
  genuineBlockerReported: boolean
  tokens: number
  wallMs: number
  niiState?: NiiState
}

export type TrialRunner = {
  name: string
  run(task: Task, arm: Arm, model: string): Promise<Trial>
}

export type Results = {
  model: string
  generatedAt: string
  trials: Trial[]
}
