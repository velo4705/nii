import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import {
  BASE_MANDATE,
  BLOCKER_MANDATE,
  ESCALATED_MANDATE,
  EXHAUSTED_MANDATE,
  REFUSAL_MANDATE,
  fallbackProposal,
  HELP_TEXT,
  motivationFor,
  SKILL_PLAYBOOK,
  statusText,
  STUCK_NUDGE,
} from "../.opencode/plugins/nii/playbook.ts"
import { emptyStuckState } from "../.opencode/plugins/nii/stuck.ts"

const projectRoot = new URL("../", import.meta.url)

const stuckWith = (failures: number, pivots = 0, refusals = 0, blockers = 0) => ({
  ...emptyStuckState(),
  recent: Array.from({ length: failures }, () => "shell: failed"),
  pivots,
  refusals,
  blockers,
})

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

test("motivation stays steady below the first signal", () => {
  assert.equal(motivationFor(stuckWith(1), 3), BASE_MANDATE)
})

test("motivation escalates with failures and pivots", () => {
  assert.equal(motivationFor(stuckWith(2), 3), `${BASE_MANDATE}\n\n${STUCK_NUDGE}`)
  assert.equal(motivationFor(stuckWith(3), 3), `${BASE_MANDATE}\n\n${ESCALATED_MANDATE}`)
  assert.equal(motivationFor(stuckWith(2, 1), 3), `${BASE_MANDATE}\n\n${ESCALATED_MANDATE}`)
})

test("repeated refusals escalate with a refusal-specific mandate", () => {
  assert.equal(motivationFor(stuckWith(0, 0, 1), 3), BASE_MANDATE)
  assert.equal(motivationFor(stuckWith(0, 0, 2), 3), `${BASE_MANDATE}\n\n${REFUSAL_MANDATE}`)
  assert.equal(motivationFor(stuckWith(1, 0, 1), 3), `${BASE_MANDATE}\n\n${REFUSAL_MANDATE}`)
})

test("a genuine blocker outranks persistence and stops the agent", () => {
  assert.equal(motivationFor(stuckWith(5, 3, 9, 1), 3), `${BASE_MANDATE}\n\n${BLOCKER_MANDATE}`)
  assert.match(BLOCKER_MANDATE, /Stop attempting new approaches/)
})

test("motivation ends with a report-and-stop mandate when the budget is spent", () => {
  assert.equal(motivationFor(stuckWith(0, 3), 3), `${BASE_MANDATE}\n\n${EXHAUSTED_MANDATE}`)
})

test("fallback proposal is deterministic and references ruled-out approaches", () => {
  const text = fallbackProposal(["shell: build failed", "read: file missing"])
  assert.match(text, /playbook directly/)
  assert.match(text, /shell: build failed/)
  assert.match(text, /strategy move you have not used yet/)
  assert.ok(fallbackProposal([]) !== text)
})

test("help text documents the reset command", () => {
  assert.ok(HELP_TEXT.includes("reset"))
})

test("status text shows the last pivot", () => {
  assert.match(statusText(true, "session", 0, 3, 4, "try a different tool"), /Last pivot: try a different tool/)
})
