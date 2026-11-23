/** Pure builders for the visible ruled-out ledger and repo memory file. */

import type { LearningEntry } from "./learning.ts"
import type { StuckState } from "./stuck.ts"

export type MemoryFile = {
  version: 1
  project: string
  ruledOut: string[]
  pivots: string[]
  strategies: { signature: string; strategy: string; uses: number; ineffective: boolean; bounds?: string }[]
}

export function buildMemoryFile(
  project: string,
  stuck: StuckState,
  learned: readonly LearningEntry[],
): MemoryFile {
  return {
    version: 1,
    project,
    ruledOut: [...stuck.ruledOut],
    pivots: [...stuck.pivotsTried],
    strategies: learned.map((entry) => ({
      signature: entry.signature,
      strategy: entry.strategy,
      uses: entry.uses,
      ineffective: entry.ineffective === true,
      bounds: entry.validation?.bounds,
    })),
  }
}

export function ledgerText(stuck: StuckState, learned: readonly LearningEntry[]): string {
  const ruledOut = stuck.ruledOut.length > 0 ? stuck.ruledOut.map((item) => `- ${item}`).join("\n") : "- none recorded"
  const pivots = stuck.pivotsTried.length > 0 ? stuck.pivotsTried.map((item, i) => `${i + 1}. ${item}`).join("\n") : "- none delivered"
  const strategies = learned.length > 0
    ? learned.map((entry) => `- ${entry.strategy} (${entry.ineffective ? "ineffective" : "worked"}, ${entry.validation?.bounds ?? "no bounds"})`).join("\n")
    : "- none learned"

  return `NII ledger for this project

Ruled-out paths:
${ruledOut}

Pivots delivered:
${pivots}

Learned strategies:
${strategies}`
}
