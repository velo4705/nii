/**
 * Pure, bounded retry policy for provider failures.
 *
 * OpenCode's own retry policy and hard max-attempt limit still apply; NII only
 * extends transient rate-limit/server failures and vetoes clearly permanent
 * 4xx failures so they do not burn the session's attempts.
 */

export type RetryDecision = { retry: false } | { retry: true; delay: number }

export type RetryOptions = {
  /** Retries after the initial request. Default 3. */
  maxRetries?: number
  /** Base delay in ms, doubled each retry. Default 1000. */
  baseDelayMs?: number
  /** Upper bound for a single delay. Default 30_000. */
  maxDelayMs?: number
}

const DEFAULTS = { maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 30_000 }

function isRateLimit(status: number | undefined, text: string): boolean {
  return status === 429 || /rate.?limit|too many requests|quota|throttl/.test(text)
}

function isTransient(status: number | undefined, text: string): boolean {
  return (
    isRateLimit(status, text) ||
    status === 408 ||
    (status !== undefined && status >= 500) ||
    /timeout|timed out|overloaded|unavailable|socket|econnreset|econnrefused|temporar/.test(text)
  )
}

function isPermanent(status: number | undefined, text: string): boolean {
  return (
    (status !== undefined && status >= 400 && status < 500) ||
    /invalid.?request|unauthori[sz]ed|forbidden|bad request/.test(text)
  )
}

/**
 * Returns a decision to apply, or `undefined` to leave OpenCode's decision
 * untouched. `attempt` is physical: the initial request is 1.
 */
export function niiRetryDecision(
  error: { type?: string; message?: string; status?: number },
  attempt: number,
  options: RetryOptions = {},
): RetryDecision | undefined {
  const { maxRetries, baseDelayMs, maxDelayMs } = { ...DEFAULTS, ...options }
  const text = `${error.type ?? ""} ${error.message ?? ""}`.toLowerCase()

  // Initial attempt is 1; retries are 2..maxRetries+1.
  if (attempt > maxRetries + 1) return { retry: false }

  if (isPermanent(error.status, text) && !isRateLimit(error.status, text)) {
    return { retry: false }
  }

  if (!isTransient(error.status, text)) return undefined

  const base = isRateLimit(error.status, text) ? baseDelayMs * 4 : baseDelayMs
  const delay = Math.min(base * 2 ** Math.max(0, attempt - 1), maxDelayMs)
  return { retry: true, delay }
}
