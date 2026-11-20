/**
 * Pure strategy-learning logic for NII Phase 3.
 *
 * A strategy becomes "learned" when a pivot is followed by a successful tool
 * call before another failure. It is then reused as a hint in later sessions
 * whose failures share a signature.
 */

export const MAX_LEARNING_ENTRIES = 50
const MAX_STRATEGY_LENGTH = 400

export type LearningEntry = {
  signature: string
  strategy: string
  uses: number
  /** Monotonic recency marker; larger means more recently reinforced. */
  updated: number
  /** Set when the strategy was tried after a pivot and did not help. */
  ineffective?: boolean
}

export function recordLearning(
  entries: readonly LearningEntry[],
  signatures: readonly string[],
  strategy: string,
  now: number = Date.now(),
): LearningEntry[] {
  const snippet = strategy.trim().slice(0, MAX_STRATEGY_LENGTH)
  if (!snippet || signatures.length === 0) return [...entries]

  let next = [...entries]
  for (const signature of signatures) {
    const index = next.findIndex((entry) => entry.signature === signature)
    if (index === -1) {
      next.push({ signature, strategy: snippet, uses: 1, updated: now, ineffective: false })
    } else {
      next[index] = {
        ...next[index],
        strategy: snippet,
        uses: next[index].uses + 1,
        updated: now,
        ineffective: false,
      }
    }
  }

  // Most-used first; among ties, most recently reinforced first.
  return next
    .sort((a, b) => b.uses - a.uses || b.updated - a.updated)
    .slice(0, MAX_LEARNING_ENTRIES)
}

/** Mark a strategy as tried-and-ineffective for these failure signatures. */
export function recordIneffective(
  entries: readonly LearningEntry[],
  signatures: readonly string[],
  strategy: string,
  now: number = Date.now(),
): LearningEntry[] {
  if (signatures.length === 0 || !strategy.trim()) return [...entries]

  let next = [...entries]
  for (const signature of signatures) {
    const index = next.findIndex((entry) => entry.signature === signature)
    if (index === -1) {
      next.push({
        signature,
        strategy: strategy.trim().slice(0, MAX_STRATEGY_LENGTH),
        uses: 0,
        updated: now,
        ineffective: true,
      })
    } else {
      next[index] = { ...next[index], updated: now, ineffective: true }
    }
  }
  return next
}

export function matchingStrategies(
  entries: readonly LearningEntry[],
  signatures: readonly string[],
): string[] {
  const matched = entries
    .filter((entry) => !entry.ineffective && signatures.includes(entry.signature))
    .map((entry) => entry.strategy)

  return [...new Set(matched)].slice(0, 3)
}

export function ineffectiveStrategies(
  entries: readonly LearningEntry[],
  signatures: readonly string[],
): string[] {
  const matched = entries
    .filter((entry) => entry.ineffective && signatures.includes(entry.signature))
    .map((entry) => entry.strategy)

  return [...new Set(matched)].slice(0, 3)
}

/** Reject proposals that are mostly the same words as a strategy already tried. */
export function isDistinctEnough(proposal: string, previous: readonly string[]): boolean {
  const words = (text: string) =>
    new Set(text.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? [])
  const candidate = words(proposal)
  if (candidate.size === 0) return false

  return previous.every((text) => {
    const old = words(text)
    if (old.size === 0) return true
    let shared = 0
    for (const word of candidate) if (old.has(word)) shared++
    const overlap = shared / Math.min(candidate.size, old.size)
    return overlap < 0.6
  })
}
