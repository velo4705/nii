import assert from "node:assert/strict"
import { test } from "node:test"
import { parseNiiCommand } from "../.opencode/plugins/nii/commands.ts"

test("parses every supported /nii subcommand", () => {
  assert.equal(parseNiiCommand("on"), "on")
  assert.equal(parseNiiCommand("off"), "off")
  assert.equal(parseNiiCommand("RESET"), "reset")
  assert.equal(parseNiiCommand("status"), "status")
  assert.equal(parseNiiCommand("ledger"), "ledger")
  assert.equal(parseNiiCommand("help"), "help")
})

test("is case-insensitive and ignores surrounding whitespace", () => {
  assert.equal(parseNiiCommand("  OFF  "), "off")
  assert.equal(parseNiiCommand("\tStatus\n"), "status")
})

test("uses only the first token", () => {
  assert.equal(parseNiiCommand("on please"), "on")
})

test("falls back to help for empty or unknown input", () => {
  assert.equal(parseNiiCommand(""), "help")
  assert.equal(parseNiiCommand("   "), "help")
  assert.equal(parseNiiCommand("toggle"), "help")
})
