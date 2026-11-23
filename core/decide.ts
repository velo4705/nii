/** Harness-neutral evaluator: given observable state, DONE or PUSH. */

import {
  continuationDirective,
  detectCheats,
  detectQuitSignals,
  emptyActivity,
  exitDecision,
  isGenuineBlocker,
  recordCompletionTag,
  recordTool,
} from "./index.ts"

export type EvaluateInput = {
  text?: string
  exitCode?: number
  verified?: boolean
  edits?: number
  tools?: string[]
  cheats?: string[]
  blocker?: boolean
  userGate?: boolean
  completionTag?: boolean
}

export type EvaluateResult = {
  decision: "DONE" | "PUSH"
  reason: string
  prompt?: string
}

export const UNIVERSAL_MEMORY_PATH = ".nii/memory.json"

export function evaluate(input: EvaluateInput): EvaluateResult {
  const text = input.text ?? ""
  const tools = input.tools ?? []
  let activity = emptyActivity()
  for (const tool of tools) activity = recordTool(activity, tool)
  for (let i = 1; i < (input.edits ?? 0); i++) activity = recordTool(activity, "edit")
  activity = recordCompletionTag(activity, input.completionTag ? "<nii:done />" : text)
  activity = {
    ...activity,
    lastExitCode: input.exitCode,
    blocker: input.blocker === true || isGenuineBlocker(text),
    userGate: input.userGate === true,
  }

  const cheats = input.cheats ?? detectCheats(text)
  const verifiedPass = input.verified === true || (input.verified !== false && input.exitCode === 0)
  const decision = exitDecision({ activity, verifiedPass, cheats, budgetReached: false })

  if (decision === "stand-down") {
    if (activity.blocker || activity.userGate) return { decision: "DONE", reason: "blocker or user gate" }
    return { decision: "DONE", reason: verifiedPass && cheats.length === 0 ? "verified pass" : "no active task" }
  }
  if (decision === "report") return { decision: "DONE", reason: "budget ceiling" }

  const signals = detectQuitSignals(text)
  return {
    decision: "PUSH",
    reason: signals.length > 0 ? `quit signal: ${signals.join(", ")}` : "unverified task",
    prompt: continuationDirective(cheats),
  }
}
