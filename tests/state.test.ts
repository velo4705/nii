import assert from "node:assert/strict"
import { test } from "node:test"
import type { NiiContext } from "../.opencode/plugins/nii/state.ts"
import { clearSessionOverride, isEnabled, setSessionEnabled } from "../.opencode/plugins/nii/state.ts"

function makeCtx(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial))
  const ctx: NiiContext = {
    storage: {
      async get(key: string) {
        return data.get(key)
      },
      async set(key: string, value: unknown) {
        data.set(key, value)
      },
      async remove(key: string) {
        data.delete(key)
      },
    },
  }
  return { ctx, data }
}

test("defaults to enabled when nothing is stored", async () => {
  const { ctx } = makeCtx()
  assert.equal(await isEnabled(ctx, "session-1"), true)
})

test("a global false disables sessions without an override", async () => {
  const { ctx } = makeCtx({ "nii:enabled": false })
  assert.equal(await isEnabled(ctx, "session-1"), false)
})

test("a session override wins over the global switch", async () => {
  const { ctx } = makeCtx({ "nii:enabled": false })
  await setSessionEnabled(ctx, "session-1", true)
  assert.equal(await isEnabled(ctx, "session-1"), true)
  assert.equal(await isEnabled(ctx, "session-2"), false)
})

test("/nii off then /nii on restores the inherited state", async () => {
  const { ctx } = makeCtx({ "nii:enabled": true })
  await setSessionEnabled(ctx, "s1", false)
  assert.equal(await isEnabled(ctx, "s1"), false)
  await clearSessionOverride(ctx, "s1")
  assert.equal(await isEnabled(ctx, "s1"), true)
})

test("storage keys are namespaced by plugin and session", async () => {
  const { ctx, data } = makeCtx()
  await setSessionEnabled(ctx, "abc", false)
  assert.deepEqual([...data.keys()], ["nii:session:abc:enabled"])
})
