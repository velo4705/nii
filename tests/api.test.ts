import assert from "node:assert/strict"
import { test } from "node:test"
import { resolveGenerateText } from "../.opencode/plugins/nii/api.ts"

test("uses the documented experimental.generate API when present", async () => {
  const experimentalText = async () => ({ text: "experimental" })
  const generateText = resolveGenerateText({
    experimental: { generate: { text: experimentalText } },
    generate: { text: async () => ({ text: "legacy" }) },
  })
  assert.equal((await generateText!({ model: { providerID: "a", id: "b" }, prompt: "x" })).text, "experimental")
})

test("falls back to generate.text on OpenCode 2.0.32", async () => {
  const generateText = resolveGenerateText({ generate: { text: async () => ({ text: "legacy" }) } })
  assert.equal((await generateText!({ model: { providerID: "a", id: "b" }, prompt: "x" })).text, "legacy")
})

test("returns undefined when neither API exists", () => {
  assert.equal(resolveGenerateText({}), undefined)
})
