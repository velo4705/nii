/**
 * Pure, bounded case-matrix validation for NII.
 *
 * A method is never "proven for all cases" — only for the cases the agent
 * actually named and observed. This module builds the case directive, reads
 * the agent's report, and records honest bounds with the learned strategy.
 */

export const CASE_CATEGORIES = ["trivial", "typical", "boundary", "adversarial"] as const
export type CaseCategory = (typeof CASE_CATEGORIES)[number]
export const MAX_CASES = 7

const CATEGORY_PATTERNS: Record<CaseCategory, RegExp> = {
  trivial: /\b(trivial|dumb|absurd|simplest|sanity|empty input|empty file|no input|zero|null)\b/i,
  typical: /\b(typical|normal|representative|happy path|usual|common case|real case)\b/i,
  boundary: /\b(boundary|edge[ -]?case|limit|maximum|minimum|large input|deep(ly)? nested|concurrent)\b/i,
  adversarial: /\b(adversarial|impossible|should fail|malicious|invalid|corrupt|hostile|unexpected|garbage)\b/i,
}

/** What the agent actually named in its validation report. */
export function detectCaseCategories(text: string): CaseCategory[] {
  return CASE_CATEGORIES.filter((category) => CATEGORY_PATTERNS[category].test(text))
}

/** The directive delivered with a pivot, requiring a bounded case matrix. */
export function buildValidationDirective(ruledOut: readonly string[]): string {
  const tried = ruledOut.length > 0 ? `\n\nAlready failed: ${ruledOut.slice(0, 4).join("; ")}.` : ""

  return `Before adopting this method, validate it with a bounded case matrix (max ${MAX_CASES} cases).${tried}

Name each case, run it, and report the OBSERVED result (tool output, not reasoning):

1. Trivial / dumb case — the simplest or absurd input. If it fails here, discard the method.
2. Typical case — the actual shape of the task.
3. Boundary case — the edge condition that broke earlier attempts.
4. Adversarial / "impossible" case — one the method SHOULD fail gracefully on. If it claims success here, it does not understand its own limits.

Do not call the method proven for all cases. State the bounds you actually observed.`
}

export type ValidationRecord = {
  categories: CaseCategory[]
  /** Fraction of the four categories actually named. Self-reported coverage, not proof. */
  confidence: number
  bounds: string
  report?: string
}

export function makeValidationRecord(categories: readonly CaseCategory[], report = ""): ValidationRecord {
  const unique = CASE_CATEGORIES.filter((category) => categories.includes(category))
  const confidence = Math.round((unique.length / CASE_CATEGORIES.length) * 100) / 100
  const bounds =
    unique.length === 0
      ? "unvalidated — used without an observed case matrix"
      : `validated on: ${unique.join(", ")}`

  return { categories: unique, confidence, bounds, report: report.slice(0, 400) || undefined }
}

/** Merge additional categories reported across several text messages. */
export function mergeValidationRecords(
  existing: ValidationRecord | undefined,
  categories: readonly CaseCategory[],
  report = "",
): ValidationRecord {
  const combined = [...new Set([...(existing?.categories ?? []), ...categories])]
  const mergedReport = [existing?.report, report].filter(Boolean).join(" | ").slice(0, 400)
  return makeValidationRecord(combined, mergedReport)
}
