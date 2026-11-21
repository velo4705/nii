import assert from "node:assert/strict"
import { test } from "node:test"
import type { NiiContext } from "../.opencode/plugins/nii/state.ts"
import {
  clearSessionOverride,
  isEnabled,
  projectScope,
  readLearning,
  setSessionEnabled,
  writeLearning,
} from "../.opencode/plugins/nii/state.ts"

function makeCtx(initial: Record<string, unknown> = {}, options: Record<string, unknown> = {}, projectID?: string) {
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
    location: { directory: `/work/${projectID ?? "default"}`, project: { id: projectID ?? "default" } },
    options,
  }
  return { ctx, data }
}

test("defaults to enabled when nothing is stored", async () => {
  const { ctx } = makeCtx()
  assert.equal(await isEnabled(ctx, "session-1"), true)
})

test("a project-level false disables sessions without an override", async () => {
  const { ctx } = makeCtx({ "nii:p:default:enabled": false })
  assert.equal(await isEnabled(ctx, "session-1"), false)
})

test("a session override wins over the project switch", async () => {
  const { ctx } = makeCtx({ "nii:p:default:enabled": false })
  await setSessionEnabled(ctx, "session-1", true)
  assert.equal(await isEnabled(ctx, "session-1"), true)
  assert.equal(await isEnabled(ctx, "session-2"), false)
})

test("/nii off then /nii on restores the inherited state", async () => {
  const { ctx } = makeCtx({ "nii:p:default:enabled": true })
  await setSessionEnabled(ctx, "s1", false)
  assert.equal(await isEnabled(ctx, "s1"), false)
  await clearSessionOverride(ctx, "s1")
  assert.equal(await isEnabled(ctx, "s1"), true)
})

test("storage keys are scoped to project and session", async () => {
  const { ctx, data } = makeCtx()
  await setSessionEnabled(ctx, "abc", false)
  assert.deepEqual([...data.keys()], ["nii:p:default:session:abc:enabled"])
})

test("projectScope falls back to the directory when no project id is present", () => {
  const data = new Map<string, unknown>()
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
    location: { directory: "/work/alias", project: {} },
  }
  assert.equal(projectScope(ctx), "/work/alias")
})

test("separate projects do not share state", async () => {
  const alpha = makeCtx({}, {}, "alpha")
  const beta = makeCtx({}, {}, "beta")
  assert.equal(projectScope(alpha.ctx), "alpha")
  assert.equal(projectScope(beta.ctx), "beta")
  await setSessionEnabled(alpha.ctx, "s1", false)
  assert.equal(await isEnabled(alpha.ctx, "s1"), false)
  assert.equal(await isEnabled(beta.ctx, "s1"), true)
})

test("learning is per project by default and globally shared on request", async () => {
  const entry = { signature: "x", strategy: "y", uses: 1, updated: 1 }
  const privateA = makeCtx({}, {}, "alpha")
  const privateB = makeCtx({}, {}, "beta")
  const shared = makeCtx({}, { shareLearning: true }, "beta")

  await writeLearning(privateA.ctx, [entry])
  assert.equal((await readLearning(privateA.ctx)).length, 1)
  assert.equal((await readLearning(privateB.ctx)).length, 0)
  assert.equal((await readLearning(shared.ctx)).length, 0)

  await writeLearning(shared.ctx, [entry])
  assert.equal((await readLearning(shared.ctx)).length, 1)
  assert.equal((await readLearning(privateB.ctx)).length, 0)
})
