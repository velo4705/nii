/**
 * Storage-backed state for NII.
 *
 * The plugin can be installed once, but state is scoped to a project so that
 * one repository's failures and learned strategies never leak into another.
 * Sessions are scoped within a project. Enable state also has a per-session
 * override, so `/nii off` affects only the session that issued it.
 *
 * Pass `options.shareLearning: true` to opt into a single global learning store.
 */

type Storage = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

import type { LearningEntry } from "./learning.ts"
import { emptyStuckState, type StuckState } from "./stuck.ts"
import { CASE_CATEGORIES, type ValidationRecord } from "./validation.ts"

export type NiiContext = {
  storage: Storage
  location?: { directory?: string; project?: { id?: string } }
  options?: Record<string, unknown>
}

export type PendingPivot = {
  signatures: string[]
  strategy: string
  validation?: ValidationRecord
}

/** Stable scope identifier for storage keys. */
export function projectScope(ctx: NiiContext): string {
  return ctx.location?.project?.id ?? ctx.location?.directory ?? "default"
}

const keyPrefix = (ctx: NiiContext) => `nii:p:${projectScope(ctx)}`
const enabledKey = (ctx: NiiContext) => `${keyPrefix(ctx)}:enabled`
const learningKey = (ctx: NiiContext) =>
  ctx.options?.shareLearning === true ? "nii:learning:shared" : `${keyPrefix(ctx)}:learning`
const sessionKey = (ctx: NiiContext, sessionID: string) => `${keyPrefix(ctx)}:session:${sessionID}:enabled`
const stuckKey = (ctx: NiiContext, sessionID: string) => `${keyPrefix(ctx)}:stuck:${sessionID}`
const pendingKey = (ctx: NiiContext, sessionID: string) => `${keyPrefix(ctx)}:pending:${sessionID}`

export async function isEnabled(ctx: NiiContext, sessionID: string): Promise<boolean> {
  const override = await ctx.storage.get(sessionKey(ctx, sessionID))
  if (typeof override === "boolean") return override

  const projectDefault = await ctx.storage.get(enabledKey(ctx))
  return projectDefault !== false
}

export async function setSessionEnabled(ctx: NiiContext, sessionID: string, enabled: boolean): Promise<void> {
  await ctx.storage.set(sessionKey(ctx, sessionID), enabled)
}

export async function clearSessionOverride(ctx: NiiContext, sessionID: string): Promise<void> {
  await ctx.storage.remove(sessionKey(ctx, sessionID))
}

export async function readStuck(ctx: NiiContext, sessionID: string): Promise<StuckState> {
  const raw = await ctx.storage.get(stuckKey(ctx, sessionID))
  if (!raw || typeof raw !== "object") return emptyStuckState()

  const value = raw as Partial<StuckState>
  return {
    recent: Array.isArray(value.recent) ? value.recent.filter((item) => typeof item === "string") : [],
    pivots: typeof value.pivots === "number" ? value.pivots : 0,
    totalFailures: typeof value.totalFailures === "number" ? value.totalFailures : 0,
    lastPivotFailureCount:
      typeof value.lastPivotFailureCount === "number" ? value.lastPivotFailureCount : 0,
    ruledOut: Array.isArray(value.ruledOut) ? value.ruledOut.filter((item) => typeof item === "string") : [],
    lastPivot: typeof value.lastPivot === "string" ? value.lastPivot : undefined,
    pivotsTried: Array.isArray(value.pivotsTried)
      ? value.pivotsTried.filter((item) => typeof item === "string")
      : [],
    refusals: typeof value.refusals === "number" ? value.refusals : 0,
    successClaims: typeof value.successClaims === "number" ? value.successClaims : 0,
    blockers: typeof value.blockers === "number" ? value.blockers : 0,
    inflight:
      value.inflight &&
      typeof value.inflight === "object" &&
      typeof value.inflight.proposal === "string" &&
      Array.isArray(value.inflight.signatures)
        ? {
            proposal: value.inflight.proposal,
            signatures: value.inflight.signatures.filter((item) => typeof item === "string"),
          }
        : undefined,
  }
}

export async function writeStuck(ctx: NiiContext, sessionID: string, state: StuckState): Promise<void> {
  await ctx.storage.set(stuckKey(ctx, sessionID), state)
}

export async function clearStuck(ctx: NiiContext, sessionID: string): Promise<void> {
  await ctx.storage.remove(stuckKey(ctx, sessionID))
  await ctx.storage.remove(pendingKey(ctx, sessionID))
}

export async function readLearning(ctx: NiiContext): Promise<LearningEntry[]> {
  const raw = await ctx.storage.get(learningKey(ctx))
  if (!Array.isArray(raw)) return []

  return raw
    .filter((item): item is LearningEntry =>
      Boolean(
        item &&
          typeof item === "object" &&
          typeof item.signature === "string" &&
          typeof item.strategy === "string" &&
          typeof item.uses === "number" &&
          typeof item.updated === "number",
      ),
    )
}

export async function writeLearning(ctx: NiiContext, entries: readonly LearningEntry[]): Promise<void> {
  await ctx.storage.set(learningKey(ctx), entries)
}

export async function readPending(ctx: NiiContext, sessionID: string): Promise<PendingPivot | undefined> {
  const raw = await ctx.storage.get(pendingKey(ctx, sessionID))
  if (!raw || typeof raw !== "object") return undefined

  const value = raw as Partial<PendingPivot>
  if (typeof value.strategy !== "string" || !Array.isArray(value.signatures)) return undefined

  const rawValidation = value.validation
  const validation: ValidationRecord | undefined =
    rawValidation && typeof rawValidation === "object" && Array.isArray(rawValidation.categories)
      ? {
          categories: rawValidation.categories.filter((item) => CASE_CATEGORIES.includes(item)),
          confidence: typeof rawValidation.confidence === "number" ? rawValidation.confidence : 0,
          bounds: typeof rawValidation.bounds === "string" ? rawValidation.bounds : "unvalidated",
          report: typeof rawValidation.report === "string" ? rawValidation.report : undefined,
        }
      : undefined

  return {
    signatures: value.signatures.filter((item) => typeof item === "string"),
    strategy: value.strategy,
    validation,
  }
}

export async function writePending(ctx: NiiContext, sessionID: string, pending: PendingPivot): Promise<void> {
  await ctx.storage.set(pendingKey(ctx, sessionID), pending)
}

export async function clearPending(ctx: NiiContext, sessionID: string): Promise<void> {
  await ctx.storage.remove(pendingKey(ctx, sessionID))
}
