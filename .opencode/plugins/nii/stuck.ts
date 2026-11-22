/**
 * Pure stuckness and quit-signal detection for NII.
 *
 * No I/O here on purpose: every decision can be tested directly. The plugin
 * only counts outcomes, counts pivots, and produces a coach prompt.
 */

export const FAILURE_THRESHOLD = 3
/** Zero means no ceiling: keep generating approaches until one works. */
export const MAX_PIVOTS = 0

export function isUnlimitedPivots(maxPivots: number): boolean {
  return maxPivots <= 0
}
export const FAILURE_WINDOW = 10
const MAX_RULED_OUT = 8

/** Number of refusals needed to escalate from text alone. */
export const REFUSAL_ESCALATION_THRESHOLD = 2

export type StuckState = {
  /** Recent tool outcomes: "" means success, otherwise a failure signature. */
  recent: string[]
  /** Strategy pivots already issued in this session. */
  pivots: number
  /** Total failures seen, never trimmed by the window. */
  totalFailures: number
  /** Total-failure count at which the last pivot was issued. */
  lastPivotFailureCount: number
  /** Short signatures of approaches/errors already observed. */
  ruledOut: string[]
  /** Most recent pivot proposal, for /nii status. */
  lastPivot?: string
  /** Strategies already delivered, used as a diversity guard. */
  pivotsTried: string[]
  /**
   * Claims of inability or handoff in assistant text. A single claim is
   * recorded; two (or one plus a real tool failure) escalate the mandate.
   */
  refusals: number
  /**
   * "Done!" style claims made while failures are still in the window.
   * Reset by a successful tool call, which is the evidence being demanded.
   */
  successClaims: number
  /**
   * Genuine blockers detected in tool output — missing credentials, denied
   * permissions, proven limits. Pivoting stops when one of these appears.
   */
  blockers: number
  /**
   * A pivot that was decided but not yet delivered. Durable so a crash or
   * provider interruption can replay the exact same pivot instead of
   * spending the budget without telling the agent.
   */
  inflight?: InflightPivot
}

export type InflightPivot = { proposal: string; signatures: string[] }

export const MAX_REFUSALS = 10
export const MAX_SUCCESS_CLAIMS = 10
export const MAX_BLOCKERS = 10

/**
 * Every text pattern that means "I'm quitting" in a solvable task. Grouped so
 * the reports can say *how* the agent tried to exit.
 *
 * Deliberately excludes "verify": "I can't verify the API key" is a genuine
 * blocker, handled by BLOCKER_PATTERNS instead.
 */
export const QUIT_PATTERNS = {
  refusal: [
    /\b(?:i|we) cannot (?:do|fix|complete|finish|solve|run|make|figure out)\b/i,
    /\b(?:i|we) can(?:not|'t) (?:do|fix|complete|finish|solve|run|make|figure out)\b/i,
    /\b(?:it|that|this) can(?:not|'t) be (?:done|built|implemented|finished|solved)\b/i,
    /\bimpossible to (?:do|fix|complete|finish|solve|run|make|build)\b/i,
    /\bno way (?:to|around)\b/i,
    /\bnot feasible\b/i,
  ],
  handoff: [
    /\b(?:i|we) (?:give up|need (?:a|the) human|need you to (?:do|handle|finish))\b/i,
    /\byou(?:'ll| will) need to (?:do|handle|finish|complete)\b/i,
    /\bplease (?:do|handle|finish) (?:this|it) (?:manually|yourself)\b/i,
    /\b(?:i|we)(?:'ll| will) leave (?:the rest|this) to you\b/i,
  ],
  partial: [
    /\b(?:that|this)(?:'s| is) (?:all|the best) (?:i|we) can do\b/i,
    /\bbest (?:i|we) can (?:do|manage)\b/i,
    /\bpartial (?:solution|answer|implementation)\b/i,
    /\b(?:i|we)(?:'ve| have) done what (?:i|we) can\b/i,
  ],
  uncertainty: [
    /\b(?:i|we) (?:don't|do not) know (?:how|what|why)\b/i,
    /\bno idea (?:how|what|why)\b/i,
    /\bbeyond (?:my|our) (?:capabilit(?:y|ies)|abilities|scope)\b/i,
  ],
  // Treating a small attempt count as a reason to stop is a quit signal.
  exhaustion: [
    /\b(?:tried|attempted|tested)\s+(?:it\s+)?(?:two|three|2|3|a few|several)\s+(?:different\s+)?(?:ways|approaches|methods|times)\b/i,
    /\b(?:out of|no more|ran out of) (?:ideas|options|approaches|methods)\b/i,
  ],
} as const

export type QuitKind = keyof typeof QUIT_PATTERNS

export const QUIT_KINDS = Object.keys(QUIT_PATTERNS) as QuitKind[]

export function detectQuitSignals(text: string): QuitKind[] {
  return QUIT_KINDS.filter((kind) => QUIT_PATTERNS[kind].some((pattern) => pattern.test(text)))
}

/** Pull a stated attempt count out of text like "I tried it three ways". */
export function claimedAttemptCount(text: string): number | undefined {
  const match = text.match(
    /\b(?:tried|attempted|tested)\s+(?:it\s+)?(one|two|three|four|five|\d+)\s+(?:different\s+)?(?:ways|approaches|methods|times)\b/i,
  )
  if (!match) return undefined
  const word = match[1]!.toLowerCase()
  const named = { one: 1, two: 2, three: 3, four: 4, five: 5 } as Record<string, number>
  return named[word] ?? Number(word)
}

/** Backwards-compatible: any text-based quitting signal. */
export function isRefusal(text: string): boolean {
  return detectQuitSignals(text).length > 0
}

/** A claim of completion, used to demand evidence when failures remain. */
export const SUCCESS_CLAIM_PATTERNS: RegExp[] = [
  /\b(?:done|complete|completed|fixed|solved)\b/i,
  /\b(?:should|will) (?:now )?work\b/i,
  /\b(?:that|this) (?:should|will) (?:resolve|fix|do it)\b/i,
  /\ball (?:tests|checks) (?:pass|passing)\b/i,
]

export function isSuccessClaim(text: string): boolean {
  return SUCCESS_CLAIM_PATTERNS.some((pattern) => pattern.test(text))
}

/** Signals a real blocker the agent cannot be expected to reason past. */
export const BLOCKER_PATTERNS: RegExp[] = [
  /\bpermission denied\b/i,
  /\baccess denied\b/i,
  /\bunauthori[sz]ed\b/i,
  /\b403 forbidden\b/i,
  /\b401 unauthori[sz]ed\b/i,
  /\bcredential(?:s)? (?:missing|not found|invalid)\b/i,
  /\bmissing (?:api )?(?:credential|token|key)s?\b/i,
  /\bno such (?:token|credential|permission)\b/i,
  /\bEACCES\b/i,
  /\bEPERM\b/i,
]

export function isGenuineBlocker(text: string): boolean {
  return BLOCKER_PATTERNS.some((pattern) => pattern.test(text))
}

export function emptyStuckState(): StuckState {
  return {
    recent: [],
    pivots: 0,
    totalFailures: 0,
    lastPivotFailureCount: 0,
    ruledOut: [],
    pivotsTried: [],
    refusals: 0,
    successClaims: 0,
    blockers: 0,
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

export function toolFailureText(data: ToolOutcome): string {
  return (
    data.error?.message ??
    data.content?.map((part) => part.text ?? "").join("\n") ??
    "unknown failure"
  )
}

export function toolFailureSignature(data: ToolOutcome): string {
  const type = data.error?.type ?? (data.metadata?.exit !== undefined ? "shell" : "tool")
  return errorSignature(type, toolFailureText(data))
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
    totalFailures: state.totalFailures + 1,
    ruledOut,
  }
}

export function recordSuccess(state: StuckState): StuckState {
  return {
    ...state,
    recent: [...state.recent, ""].slice(-FAILURE_WINDOW),
    refusals: 0,
    successClaims: 0,
  }
}

export function recordRefusal(state: StuckState): StuckState {
  return { ...state, refusals: Math.min(state.refusals + 1, MAX_REFUSALS) }
}

export function recordSuccessClaim(state: StuckState): StuckState {
  return { ...state, successClaims: Math.min(state.successClaims + 1, MAX_SUCCESS_CLAIMS) }
}

/** Genuine blockers persist until the user explicitly resets the session. */
export function recordBlocker(state: StuckState): StuckState {
  return { ...state, blockers: Math.min(state.blockers + 1, MAX_BLOCKERS) }
}

/** True when a claim of completion needs evidence before the task is ended. */
export function needsVerification(state: StuckState): boolean {
  return state.successClaims > 0 && failureCount(state) > 0
}

/** True when a refusal is strong enough to escalate the mandate. */
export function shouldEscalateRefusal(state: StuckState): boolean {
  return state.refusals >= REFUSAL_ESCALATION_THRESHOLD || (state.refusals > 0 && failureCount(state) > 0)
}

export function shouldPivot(state: StuckState, maxPivots = MAX_PIVOTS): boolean {
  if (state.blockers > 0 || state.inflight) return false
  const count = failureCount(state)
  const triggered = count >= FAILURE_THRESHOLD || hasRepeatedFailure(state)
  return (
    triggered &&
    state.totalFailures > state.lastPivotFailureCount &&
    (isUnlimitedPivots(maxPivots) || state.pivots < maxPivots)
  )
}

/** Used by tests and simple callers; production code uses claim/finalize. */
export function markPivoted(state: StuckState): StuckState {
  return { ...state, pivots: state.pivots + 1, lastPivotFailureCount: state.totalFailures }
}

/** Claim a pivot before delivery. No budget is consumed yet. */
export function claimPivot(state: StuckState, proposal: string, signatures: string[]): StuckState {
  return { ...state, inflight: { proposal, signatures } }
}

/**
 * Consume the pivot only after the synthetic message was accepted. Safe to
 * call on state read fresh from storage at finalization time.
 */
export function finalizePivot(state: StuckState): StuckState {
  const pending = state.inflight
  if (!pending) return state

  return {
    ...state,
    pivots: state.pivots + 1,
    lastPivotFailureCount: state.totalFailures,
    pivotsTried: [...state.pivotsTried, pending.proposal].slice(-5),
    lastPivot: pending.proposal,
    inflight: undefined,
  }
}

export function clearInflight(state: StuckState): StuckState {
  return { ...state, inflight: undefined }
}

export function isExhausted(state: StuckState, maxPivots = MAX_PIVOTS): boolean {
  return !isUnlimitedPivots(maxPivots) && state.pivots >= maxPivots
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
