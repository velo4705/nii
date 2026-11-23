#!/usr/bin/env node
/** nii-evaluate — harness-neutral completion gate. Prints DONE or PUSH. */

import { evaluate, type EvaluateInput } from "./decide.ts"

function parse(argv: string[]): EvaluateInput {
  const input: EvaluateInput = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const value = argv[i + 1]
    switch (arg) {
      case "--text":
        input.text = value ?? ""
        i++
        break
      case "--exit-code":
        input.exitCode = Number(value ?? 1)
        i++
        break
      case "--verified":
        input.verified = true
        break
      case "--unverified":
        input.verified = false
        break
      case "--edits":
        input.edits = Number(value ?? 0)
        i++
        break
      case "--tools":
        input.tools = (value ?? "").split(",").filter(Boolean)
        i++
        break
      case "--cheats":
        input.cheats = (value ?? "").split(",").filter(Boolean)
        i++
        break
      case "--blocker":
        input.blocker = true
        break
      case "--user-gate":
        input.userGate = true
        break
      case "--completion-tag":
        input.completionTag = true
        break
      case "--help":
        console.log(`nii-evaluate — print DONE or PUSH

Flags:
  --text STRING        last assistant output
  --exit-code N        last command exit code
  --verified           verification passed
  --unverified         verification failed
  --edits N            number of file edits
  --tools a,b,c        tools used
  --cheats a,b         cheat signals
  --blocker            genuine blocker present
  --user-gate          user question or missing external gate
  --completion-tag     agent emitted <nii:done />
  --help               this message`)
        process.exit(0)
        break
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }
  return input
}

try {
  const result = evaluate(parse(process.argv.slice(2)))
  console.log(result.decision)
  if (result.decision === "PUSH" && result.prompt) console.log(result.prompt)
} catch (error) {
  console.error(`nii-evaluate failed: ${(error as Error).message}`)
  process.exitCode = 1
}
