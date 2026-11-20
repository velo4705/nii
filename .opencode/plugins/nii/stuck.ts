/**
 * Pure stuckness logic for NII Phase 2.
 *
 * No I/O here on purpose: every decision can be tested directly. The plugin
 * only counts failures, counts pivots, and produces a coach prompt.
 */

export const FAILURE_THRESHOLD = 3
export const MAX_PIVOTS = 3
const MAX_RULED_OUT = 8

export type StuckState = {
  /** Consecutive tool failures on the current approach. */
  streak: number
  /** Strategy pivots already issued in this session. */
  pivots: number
  /** Streak at which the last pivot was issued. */
  lastPivotStreak: number
  /** Short signatures of approaches/errors already observed. */
  ruledOut: string[]
}

export function emptyStuckState(): StuckState {
  return { streak: 0, pivots: 0, lastPivotStreak: 0, ruledOut: [] }
}

/** Reduce an error to a compact, comparable signature. */
export function errorSignature(type: string, message: string): string {
  const firstLine = message.split("\n")[0]?.trim() ?? ""
  const cleaned = firstLine.replace(/\/[\w.\-/]+/g, "<path>").slice(0, 140)
  return `${type}: ${cleaned}`.trim()
}

/** The subset of a tool event the failure detector needs. */
export type ToolOutcome = {
  error?: { type?: string; message?: string }
  metadata?: { exit?: number; status?: string }
  content?: readonly { type?: string; text?: string }[]
}

/**
 * A non-zero shell exit is delivered as `session.tool.success` with
 * `metadata.exit`, so the event name alone cannot identify a failure.
 */
export function isToolFailure(eventType: string, data: ToolOutcome): boolean {
  if (eventType === "session.tool.failed") return true
  if (eventType !== "session.tool.success") return false
  if (data.metadata?.status === "error") return true

  const exit = data.metadata?.exit
  if (typeof exit === "number" && exit !== 0) return true

  const text = data.content?.map((part) => part.text ?? "").join("\n") ?? ""
  return /Exited with code [1-9]\d*/.test(text)
}

export function toolFailureSignature(data: ToolOutcome): string {
  const type = data.error?.type ?? (data.metadata?.exit !== undefined ? "shell" : "tool")
  const message =
    data.error?.message ??
    data.content?.map((part) => part.text ?? "").join("\n").trim() ??
    "unknown failure"
  return errorSignature(type, message)
}

export function recordFailure(state: StuckState, signature: string): StuckState {
  const ruledOut = state.ruledOut.includes(signature)
    ? state.ruledOut
    : [...state.ruledOut, signature].slice(-MAX_RULED_OUT)

  return { ...state, streak: state.streak + 1, ruledOut }
}

/** Any success breaks the failure streak; the pivot budget is not restored. */
export function recordSuccess(state: StuckState): StuckState {
  return { ...state, streak: 0 }
}

export function shouldPivot(state: StuckState): boolean {
  return (
    state.streak >= FAILURE_THRESHOLD &&
    state.streak > state.lastPivotStreak &&
    state.pivots < MAX_PIVOTS
  )
}

export function markPivoted(state: StuckState): StuckState {
  return { ...state, pivots: state.pivots + 1, lastPivotStreak: state.streak }
}

export function isExhausted(state: StuckState): boolean {
  return state.pivots >= MAX_PIVOTS
}

export function buildCoachPrompt(ruledOut: string[], knownStrategies: string[] = []): string {
  const list = ruledOut.length > 0 ? ruledOut.map((item) => `- ${item}`).join("\n") : "- (no failure details recorded)"
  const known =
    knownStrategies.length > 0
      ? `\n\nStrategies that worked for similar failures before:\n${knownStrategies.map((item) => `- ${item}`).join("\n")}\n\nAdapt one of these if it fits this situation, or propose something better.`
      : ""

  return `You are the NII strategy coach. An agent is stuck on a task and has already tried the approaches below without success.

Already tried or failed:
${list}
${known}

Propose ONE genuinely different approach — a different mechanism, not a parameter change or a re-run. Include:
1. the approach in two or three sentences;
2. the smallest first step that could be taken now;
3. the observable evidence that would prove it worked.

Do not conclude with a refusal or a claim that the goal cannot be reached, and do not suggest simply trying harder. Respond in under 150 words.`
}
