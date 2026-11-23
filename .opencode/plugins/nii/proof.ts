/**
 * Positive-proof gate for NII.
 *
 * An active task is unfinished until objective evidence says otherwise.
 * Natural-language completion claims are never sufficient.
 */

export const EXECUTION_TOOLS = ["shell", "bash", "edit", "write", "patch", "apply_patch"]

export type Activity = {
  tools: string[]
  edits: number
  lastExitCode: number | undefined
  completionTag: boolean
  userAbort: boolean
  blocker: boolean
  userGate: boolean
  continuations: number
  startedAt: number
}

export function recordContinuation(activity: Activity): Activity {
  return { ...activity, continuations: activity.continuations + 1 }
}

export function emptyActivity(): Activity {
  return {
    tools: [],
    edits: 0,
    lastExitCode: undefined,
    completionTag: false,
    userAbort: false,
    blocker: false,
    userGate: false,
    continuations: 0,
    startedAt: Date.now(),
  }
}

export function recordTool(activity: Activity, name: string): Activity {
  const normalized = name.toLowerCase()
  const executes = EXECUTION_TOOLS.some((tool) => normalized.includes(tool))
  return {
    ...activity,
    tools: [...new Set([...activity.tools, normalized])],
    edits: activity.edits + (["edit", "write", "patch", "apply_patch"].some((t) => normalized.includes(t)) ? 1 : 0),
    ...(executes ? {} : {}),
  }
}

export function recordExit(activity: Activity, code: number | undefined): Activity {
  return { ...activity, lastExitCode: code }
}

export function recordCompletionTag(activity: Activity, text: string): Activity {
  return /<nii:\s*done\s*\/?\s*>/i.test(text)
    ? { ...activity, completionTag: true }
    : activity
}

/** Conversation-only turns stay dormant. */
export function isTaskExecution(activity: Activity): boolean {
  return activity.edits > 0 || activity.tools.some((tool) => tool.includes("shell") || tool.includes("bash"))
}

const CHEAT_PATTERNS: RegExp[] = [
  /^\s*[-+].*(test|spec)[^:]*\.(ts|js|py|rs)\b.*$/im,
  /^\s*-\s*(describe|it|test|assert)\s*\(/im,
  /\b(TODO|FIXME|unimplemented!\(\)|not implemented|placeholder)\b/i,
  /^\s*\+\s*\/\/\s*(assert|test)/im,
]

/** Diff-level checks for a cheap green exit code. */
export function detectCheats(diff: string): string[] {
  return CHEAT_PATTERNS.filter((pattern) => pattern.test(diff)).map((pattern) => pattern.source)
}

const TASK_INTENT = /\b(fix|build|implement|debug|refactor|create|write|run|test|migrate|solve|optimize|design|implement|add|change|repair|investigate)\b/i

/** Ordinary Q&A gets no mandate at all. */
export function shouldInjectMandate(
  activity: Activity,
  stuck: { pivots: number; refusals: number; blockers: number; recentLength: number },
  prompt: string,
): boolean {
  if (stuck.pivots > 0 || stuck.refusals > 0 || stuck.blockers > 0 || stuck.recentLength > 0) return true
  if (isTaskExecution(activity)) return true
  return TASK_INTENT.test(prompt)
}

export function wallExceeded(activity: Activity, maxWallMs: number): boolean {
  return maxWallMs > 0 && Date.now() - activity.startedAt >= maxWallMs
}

/** Fallback for tasks with no objective verifier and no tool exit code. */
export function lightweightPass(activity: Activity, cheats: string[]): boolean {
  return activity.completionTag && activity.edits > 0 && cheats.length === 0 && !activity.blocker && !activity.userAbort
}

export type ExitInput = {
  activity: Activity
  verifiedPass: boolean
  cheats: string[]
  budgetReached: boolean
  wallExceeded?: boolean
}

export type ExitDecision = "stand-down" | "continue" | "report"

export function exitDecision(input: ExitInput): ExitDecision {
  const { activity, verifiedPass, cheats, budgetReached } = input
  if (activity.userAbort || activity.blocker || activity.userGate) return "stand-down"
  if (budgetReached || input.wallExceeded) return "report"
  if (!isTaskExecution(activity)) return "stand-down"
  if (verifiedPass && cheats.length === 0 && activity.completionTag) return "stand-down"
  return "continue"
}

export function continuationDirective(cheats: string[]): string {
  const cheatNote = cheats.length > 0
    ? `\nCheating signals were detected in the diff: ${cheats.join(", ")}. Restore the tests or logic you weakened.`
    : ""

  return `[NII proof gate] The task is not done. No passing verification was observed, or the completion claim was not backed by evidence.${cheatNote} Keep working: find an untried approach, run a real verification, and only then signal completion with <nii:done />. Do not hand back a placeholder or a conceptual outline.`
}
