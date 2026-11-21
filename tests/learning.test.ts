import assert from "node:assert/strict"
import { test } from "node:test"
import {
  ineffectiveStrategies,
  isDistinctEnough,
  matchingStrategies,
  MAX_LEARNING_ENTRIES,
  recordIneffective,
  recordLearning,
  type LearningEntry,
} from "../.opencode/plugins/nii/learning.ts"

test("a successful pivot is stored against every failure signature", () => {
  const entries = recordLearning([], ["a: fail", "b: fail"], "Try a different tool", 1)
  assert.deepEqual(
    entries.map((entry) => entry.signature),
    ["a: fail", "b: fail"],
  )
  assert.equal(entries[0]!.strategy, "Try a different tool")
})

test("reusing a signature increments its count and replaces the strategy", () => {
  const first = recordLearning([], ["a: fail"], "Old approach", 1)
  const second = recordLearning(first, ["a: fail"], "New approach", 2)
  assert.equal(second.length, 1)
  assert.equal(second[0]!.uses, 2)
  assert.equal(second[0]!.updated, 2)
  assert.equal(second[0]!.strategy, "New approach")
})

test("empty inputs do not mutate stored learning", () => {
  const existing: LearningEntry[] = [{ signature: "a", strategy: "x", uses: 1, updated: 1 }]
  assert.deepEqual(recordLearning(existing, [], "something", 2), existing)
  assert.deepEqual(recordLearning(existing, ["a"], "   ", 2), existing)
})

test("the memory is capped and the oldest of equal-ranked entries is dropped", () => {
  let entries: LearningEntry[] = []
  for (let i = 0; i < MAX_LEARNING_ENTRIES + 5; i++) {
    entries = recordLearning(entries, [`sig-${i}`], `strategy ${i}`, i)
  }
  assert.equal(entries.length, MAX_LEARNING_ENTRIES)
  assert.ok(!entries.some((entry) => /^sig-0$/.test(entry.signature)))
  assert.ok(entries.some((entry) => /^sig-49$/.test(entry.signature)))
})

test("matching returns each distinct strategy at most once", () => {
  const entries: LearningEntry[] = [
    { signature: "a", strategy: "shared", uses: 1, updated: 1 },
    { signature: "b", strategy: "shared", uses: 1, updated: 2 },
    { signature: "c", strategy: "other", uses: 1, updated: 3 },
  ]
  assert.deepEqual(matchingStrategies(entries, ["a", "b", "c"]), ["shared", "other"])
  assert.deepEqual(matchingStrategies(entries, ["missing"]), [])
})

test("ineffective strategies are marked and excluded from matching", () => {
  const learned = [
    { signature: "a", strategy: "retry same thing", uses: 2, updated: 1, ineffective: false },
    { signature: "a", strategy: "try something new", uses: 0, updated: 5, ineffective: true },
  ]
  assert.deepEqual(matchingStrategies(learned, ["a"]), ["retry same thing"])
  assert.deepEqual(ineffectiveStrategies(learned, ["a"]), ["try something new"])
  assert.deepEqual(matchingStrategies(recordIneffective([], ["b"], "x"), ["b"]), [])
  assert.deepEqual(recordIneffective([], [], "x"), [])
})

test("diversity guard rejects near-duplicate proposals", () => {
  assert.equal(isDistinctEnough("add a unit test file", ["add unit tests"]), false)
  assert.equal(isDistinctEnough("switch to a different language", ["retry with python"]), true)
  assert.equal(isDistinctEnough("anything at all", []), true)
})

test("the diversity guard rejects empty and near-duplicate proposals", () => {
  assert.equal(isDistinctEnough("   ", ["old approach"]), false)
  assert.equal(isDistinctEnough("old approach", ["old approach"]), false)
  assert.equal(isDistinctEnough("use a graph database instead", ["old approach"]), true)
})

test("stored strategies are truncated to a compact hint", () => {
  const entries = recordLearning([], ["a"], "x".repeat(900), 1)
  assert.equal(entries[0]!.strategy.length, 400)
})
