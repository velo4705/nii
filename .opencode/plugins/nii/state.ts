/**
 * Storage-backed state for NII.
 *
 * A global switch plus an optional per-session override. Storage is plugin-
 * scoped and durable, so `/nii off` survives reloads and applies to the
 * session that issued it without silently changing other sessions.
 */

type Storage = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

import type { LearningEntry } from "./learning.ts"
import { emptyStuckState, type StuckState } from "./stuck.ts"

export type NiiContext = { storage: Storage }

export type PendingPivot = { signatures: string[]; strategy: string }

const GLOBAL_KEY = "nii:enabled"
const LEARNING_KEY = "nii:learning"
const sessionKey = (sessionID: string) => `nii:session:${sessionID}:enabled`
const stuckKey = (sessionID: string) => `nii:stuck:${sessionID}`
const pendingKey = (sessionID: string) => `nii:pending:${sessionID}`

export async function isEnabled(ctx: NiiContext, sessionID: string): Promise<boolean> {
  const override = await ctx.storage.get(sessionKey(sessionID))
  if (typeof override === "boolean") return override

  const global = await ctx.storage.get(GLOBAL_KEY)
  return global !== false
}

export async function setSessionEnabled(ctx: NiiContext, sessionID: string, enabled: boolean): Promise<void> {
  await ctx.storage.set(sessionKey(sessionID), enabled)
}

export async function clearSessionOverride(ctx: NiiContext, sessionID: string): Promise<void> {
  await ctx.storage.remove(sessionKey(sessionID))
}

export async function readStuck(ctx: NiiContext, sessionID: string): Promise<StuckState> {
  const raw = await ctx.storage.get(stuckKey(sessionID))
  if (!raw || typeof raw !== "object") return emptyStuckState()

  const value = raw as Partial<StuckState>
  return {
    recent: Array.isArray(value.recent) ? value.recent.filter((item) => typeof item === "string") : [],
    pivots: typeof value.pivots === "number" ? value.pivots : 0,
    lastPivotFailureCount:
      typeof value.lastPivotFailureCount === "number" ? value.lastPivotFailureCount : 0,
    ruledOut: Array.isArray(value.ruledOut) ? value.ruledOut.filter((item) => typeof item === "string") : [],
    lastPivot: typeof value.lastPivot === "string" ? value.lastPivot : undefined,
    pivotsTried: Array.isArray(value.pivotsTried)
      ? value.pivotsTried.filter((item) => typeof item === "string")
      : [],
  }
}

export async function writeStuck(ctx: NiiContext, sessionID: string, state: StuckState): Promise<void> {
  await ctx.storage.set(stuckKey(sessionID), state)
}

export async function clearStuck(ctx: NiiContext, sessionID: string): Promise<void> {
  await ctx.storage.remove(stuckKey(sessionID))
  await ctx.storage.remove(pendingKey(sessionID))
}

export async function readLearning(ctx: NiiContext): Promise<LearningEntry[]> {
  const raw = await ctx.storage.get(LEARNING_KEY)
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
  await ctx.storage.set(LEARNING_KEY, entries)
}

export async function readPending(ctx: NiiContext, sessionID: string): Promise<PendingPivot | undefined> {
  const raw = await ctx.storage.get(pendingKey(sessionID))
  if (!raw || typeof raw !== "object") return undefined

  const value = raw as Partial<PendingPivot>
  if (typeof value.strategy !== "string" || !Array.isArray(value.signatures)) return undefined
  return { signatures: value.signatures.filter((item) => typeof item === "string"), strategy: value.strategy }
}

export async function writePending(ctx: NiiContext, sessionID: string, pending: PendingPivot): Promise<void> {
  await ctx.storage.set(pendingKey(sessionID), pending)
}

export async function clearPending(ctx: NiiContext, sessionID: string): Promise<void> {
  await ctx.storage.remove(pendingKey(sessionID))
}
