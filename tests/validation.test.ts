import assert from "node:assert/strict"
import { test } from "node:test"
import {
  buildValidationDirective,
  CASE_CATEGORIES,
  detectCaseCategories,
  makeValidationRecord,
  MAX_CASES,
  mergeValidationRecords,
} from "../.opencode/plugins/nii/validation.ts"
import { recordLearning, strategyHints } from "../.opencode/plugins/nii/learning.ts"

test("dumb and smart case phrasings are detected", () => {
  assert.deepEqual(detectCaseCategories("an empty input is the dumbest case"), ["trivial"])
  assert.deepEqual(detectCaseCategories("here is the typical, real case"), ["typical"])
  assert.deepEqual(detectCaseCategories("test the boundary / edge case"), ["boundary"])
  assert.deepEqual(detectCaseCategories("the adversarial impossible case should fail"), ["adversarial"])
})

test("one report can cover several categories", () => {
  const found = detectCaseCategories(
    "I ran a trivial sanity check, the typical case, an edge case, and an adversarial input.",
  )
  assert.deepEqual(found, [...CASE_CATEGORIES])
})

test("ordinary text is not a validation report", () => {
  assert.deepEqual(detectCaseCategories("I updated the parser and ran the suite"), [])
})

test("the directive requires observed results and forbids universal claims", () => {
  const text = buildValidationDirective(["shell: build failed"])
  assert.match(text, /Already failed: shell: build failed/)
  assert.match(text, new RegExp(`max ${MAX_CASES} cases`))
  assert.match(text, /OBSERVED result/)
  assert.match(text, /SHOULD fail gracefully/)
  assert.match(text, /Do not call the method proven for all cases/)
})

test("confidence reflects the fraction of categories actually named", () => {
  assert.equal(makeValidationRecord([]).confidence, 0)
  assert.match(makeValidationRecord([]).bounds, /unvalidated/)
  assert.equal(makeValidationRecord(["trivial", "typical"]).confidence, 0.5)
  assert.equal(makeValidationRecord([...CASE_CATEGORIES]).confidence, 1)
  assert.match(makeValidationRecord(["boundary"]).bounds, /validated on: boundary/)
})

test("records merge categories and keep a bounded report", () => {
  const first = makeValidationRecord(["trivial"], "trivial: passed")
  const merged = mergeValidationRecords(first, ["adversarial"], "adversarial: failed gracefully")
  assert.deepEqual(merged.categories, ["trivial", "adversarial"])
  assert.equal(merged.confidence, 0.5)
  assert.match(merged.report!, /trivial: passed \| adversarial: failed gracefully/)

  const long = mergeValidationRecords(undefined, ["typical"], "x".repeat(1000))
  assert.equal(long.report!.length, 400)
})

test("learned strategies carry their bounds into coach hints", () => {
  const learned = recordLearning(
    [],
    ["shell: fail"],
    "switch to streaming parser",
    1,
    makeValidationRecord(["trivial", "typical"]),
  )
  const [hint] = strategyHints(learned, ["shell: fail"])
  assert.match(hint!, /confidence 0.5/)
  assert.match(hint!, /validated on: trivial, typical/)

  const unvalidated = recordLearning([], ["shell: fail"], "try again", 2)
  assert.match(strategyHints(unvalidated, ["shell: fail"])[0]!, /unvalidated/)
})
