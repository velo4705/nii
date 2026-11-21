/**
 * Pure stuckness logic for NII.
 *
 * No I/O here on purpose: every decision can be tested directly. The plugin
 * only counts outcomes, counts pivots, and produces a coach prompt.
 */

export const FAILURE_THRESHOLD = 3
export const MAX_PIVOTS = 3
export const FAILURE_WINDOW = 10
const MAX_RULED_OUT = 8

export type StuckState = {
  /** Recent tool outcomes: "" means success, otherwise a failure signature. */
  recent: string[]
  /** Strategy pivots already issued in this session. */
  pivots: number
  /** Failure count at which the last pivot was issued. */
  lastPivotFailureCount: number
  /** Short signatures of approaches/errors already observed. */
  ruledOut: string[]
  /** Most recent pivot proposal, for /nii status. */
  lastPivot?: string
  /** Strategies already delivered, used as a diversity guard. */
  pivotsTried: string[]
  /**
   * Claims of inability in assistant text ("I can't do this"). Increments on
   * a refusal, resets on a successful outcome.
   */
  refusals: number
}

export const MAX_REFUSALS = 10

export const REFUSAL_PATTERNS: RegExp[] = [
  /\b(?:i|we) cannot (?:do|fix|complete|finish|solve|run|make|verify|figure out)\b/i,
  /\b(?:i|we) can(?:not|'t) (?:do|fix|complete|finish|solve|run|make|verify|figure out)\b/i,
  /\b(?:i|we) give up\b/i,
  /\b(?:unable|impossible|not possible) to (?:do|fix|complete|finish|solve|run|make|verify)\b/i,
  /\bno way to (?:do|complete|solve)\b/i,
]

export function isRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(text))
}

export function emptyStuckState(): StuckState {
  return {
    recent: [],
    pivots: 0,
    lastPivotFailureCount: 0,
    ruledOut: [],
    pivotsTried: [],
    refusals: 0,
  }
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

/** Failures in the recent window. Successes no longer erase earlier evidence. */
export function failureCount(state: StuckState): number {
  return state.recent.filter((item) => item !== "").length
}

/** The same failure twice in a row is a cosmetic-retry signal. */
export function hasRepeatedFailure(state: StuckState): boolean {
  const n = state.recent.length
  if (n < 2) return false
  const a = state.recent[n - 1]!
  const b = state.recent[n - 2]!
  return a !== "" && a === b
}

export function recordFailure(state: StuckState, signature: string): StuckState {
  const ruledOut = state.ruledOut.includes(signature)
    ? state.ruledOut
    : [...state.ruledOut, signature].slice(-MAX_RULED_OUT)

  return {
    ...state,
    recent: [...state.recent, signature].slice(-FAILURE_WINDOW),
    ruledOut,
  }
}

export function recordSuccess(state: StuckState): StuckState {
  return { ...state, recent: [...state.recent, ""].slice(-FAILURE_WINDOW), refusals: 0 }
}

export function recordRefusal(state: StuckState): StuckState {
  return { ...state, refusals: Math.min(state.refusals + 1, MAX_REFUSALS) }
}

export function shouldPivot(state: StuckState): boolean {
  const count = failureCount(state)
  const triggered = count >= FAILURE_THRESHOLD || hasRepeatedFailure(state)
  return (
    triggered &&
    count > state.lastPivotFailureCount &&
    state.pivots < MAX_PIVOTS
  )
}

export function markPivoted(state: StuckState): StuckState {
  return { ...state, pivots: state.pivots + 1, lastPivotFailureCount: failureCount(state) }
}

export function isExhausted(state: StuckState): boolean {
  return state.pivots >= MAX_PIVOTS
}

export function buildCoachPrompt(
  ruledOut: string[],
  knownStrategies: string[] = [],
  avoidedStrategies: string[] = [],
): string {
  const list = ruledOut.length > 0 ? ruledOut.map((item) => `- ${item}`).join("\n") : "- (no failure details recorded)"
  const known =
    knownStrategies.length > 0
      ? `\n\nStrategies that worked for similar failures before:\n${knownStrategies.map((item) => `- ${item}`).join("\n")}\n\nAdapt one of these if it fits this situation, or propose something better.`
      : ""
  const avoided =
    avoidedStrategies.length > 0
      ? `\n\nDo NOT repeat these — they were tried and did not work:\n${avoidedStrategies.map((item) => `- ${item}`).join("\n")}`
      : ""

  return `You are the NII strategy coach. An agent is stuck on a task and has already tried the approaches below without success.

Already tried or failed:
${list}
${known}${avoided}

Propose ONE genuinely different approach — a different mechanism, not a parameter change or a re-run. Include:
1. the approach in two or three sentences;
2. the smallest first step that could be taken now;
3. the observable evidence that would prove it worked.

Do not conclude with a refusal or a claim that the goal cannot be reached, and do not suggest simply trying harder. Respond in under 150 words.`
}
