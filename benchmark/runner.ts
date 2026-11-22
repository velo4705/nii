import type { Arm, Task, TrialRunner } from "./types.ts"

/**
 * Prompt construction for paired runs. Control and treatment receive the same
 * task text; only the NII instruction differs.
 */
export function buildPrompt(task: Task, arm: Arm): string {
  const prefix =
    arm === "control"
      ? "Solve the task below. You may stop when you believe it cannot be done.\n\n"
      : "Solve the task below. NII is active: keep going until you have a verified solution or a genuine blocker.\n\n"

  return `${prefix}${task.prompt}\n\nVerifier: ${task.verifier.description}`
}

/**
 * Placeholder until the provider is stable. A real runner should create one
 * session per trial, capture the transcript and NII state, and apply the
 * task's verifier before writing the Trial record.
 */
export const unavailableRunner: TrialRunner = {
  name: "unavailable",
  async run() {
    throw new Error(
      "No live runner configured. Use the sample command for visualizations, or implement a TrialRunner against a stable provider.",
    )
  },
}
