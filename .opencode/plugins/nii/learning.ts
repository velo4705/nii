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
      next.push({ signature, strategy: snippet, uses: 1, updated: now })
    } else {
      next[index] = {
        ...next[index],
        strategy: snippet,
        uses: next[index].uses + 1,
        updated: now,
      }
    }
  }

  // Most-used first; among ties, most recently reinforced first.
  return next
    .sort((a, b) => b.uses - a.uses || b.updated - a.updated)
    .slice(0, MAX_LEARNING_ENTRIES)
}

export function matchingStrategies(
  entries: readonly LearningEntry[],
  signatures: readonly string[],
): string[] {
  const matched = entries
    .filter((entry) => signatures.includes(entry.signature))
    .map((entry) => entry.strategy)

  return [...new Set(matched)].slice(0, 3)
}
