import assert from "node:assert/strict"
import { test } from "node:test"
import { niiRetryDecision } from "../.opencode/plugins/nii/retry.ts"

test("429 rate limits are retried with a bounded backoff", () => {
  assert.deepEqual(niiRetryDecision({ status: 429, message: "Too Many Requests", type: "provider" }, 1), {
    retry: true,
    delay: 4_000,
  })
  assert.deepEqual(niiRetryDecision({ status: 429, message: "rate limit", type: "provider" }, 3), {
    retry: true,
    delay: 16_000,
  })
})

test("transient provider failures are retried with a shorter backoff", () => {
  assert.deepEqual(niiRetryDecision({ status: 503, message: "Service Unavailable", type: "provider" }, 2), {
    retry: true,
    delay: 2_000,
  })
  assert.deepEqual(niiRetryDecision({ message: "socket closed unexpectedly", type: "transport" }, 1), {
    retry: true,
    delay: 1_000,
  })
})

test("permanent 4xx failures are vetoed immediately", () => {
  assert.deepEqual(niiRetryDecision({ status: 401, message: "Unauthorized", type: "provider" }, 1), { retry: false })
  assert.deepEqual(niiRetryDecision({ status: 400, message: "invalid request", type: "provider" }, 2), {
    retry: false,
  })
})

test("unknown errors leave OpenCode's own decision untouched", () => {
  assert.equal(niiRetryDecision({ message: "some unusual failure", type: "unknown" }, 2), undefined)
})

test("the retry budget is capped and delays never exceed the ceiling", () => {
  assert.deepEqual(niiRetryDecision({ status: 429, message: "rate limit", type: "provider" }, 5), { retry: false })
  const capped = niiRetryDecision({ status: 429, message: "rate limit", type: "provider" }, 10, {
    maxRetries: 10,
    maxDelayMs: 5_000,
  })
  assert.deepEqual(capped, { retry: true, delay: 5_000 })
})

test("options can raise the cap", () => {
  assert.deepEqual(
    niiRetryDecision({ status: 429, message: "rate limit", type: "provider" }, 4, {
      maxRetries: 5,
      maxDelayMs: 100_000,
    }),
    { retry: true, delay: 32_000 },
  )
})
