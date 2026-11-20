import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { BASE_MANDATE, HELP_TEXT, SKILL_PLAYBOOK, statusText } from "../.opencode/plugins/nii/playbook.ts"

const projectRoot = new URL("../", import.meta.url)

test("the mandate carries the bounded-persistence contract", () => {
  for (const phrase of [
    "not yet solved with the current approach",
    "genuinely different",
    "observable evidence",
    "Genuine blocker",
    "/nii off",
  ]) {
    assert.ok(BASE_MANDATE.includes(phrase), `mandate is missing: ${phrase}`)
  }
})

test("the mandate stays short enough for a system-injected instruction", () => {
  assert.ok(BASE_MANDATE.length < 1500, `mandate is ${BASE_MANDATE.length} chars`)
})

test("the inline skill content matches SKILL.md exactly", () => {
  const skillFile = readFileSync(new URL(".opencode/plugins/nii/SKILL.md", projectRoot), "utf8")
  assert.equal(SKILL_PLAYBOOK.trim(), skillFile.trim())
})

test("help text documents all four commands", () => {
  for (const command of ["on", "off", "status", "help"]) {
    assert.ok(HELP_TEXT.includes(command), `help is missing: ${command}`)
  }
})

test("status text reflects the active state", () => {
  assert.match(statusText(true, "session"), /NII status: ON/)
  assert.match(statusText(false, "session"), /NII status: OFF/)
  assert.match(statusText(false, "session"), /disabled/)
})
