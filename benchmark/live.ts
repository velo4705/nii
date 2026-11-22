/**
 * Live paired runner for the free-provider benchmark.
 *
 *   node benchmark/live.ts
 *
 * Writes benchmark/out/live-results.json. Requires a working model call.
 */
import { execFileSync } from "node:child_process"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { detectQuitSignals } from "../.opencode/plugins/nii/stuck.ts"
import { buildPrompt } from "./runner.ts"
import { LIVE_TASKS } from "./live-tasks.ts"
import type { Arm, Results, Trial } from "./types.ts"

const MODEL = process.env.NII_BENCH_MODEL ?? "opencode/hy4-flash-free"
const DELAY_MS = Number(process.env.NII_BENCH_DELAY_MS ?? 0)
const ROOT = process.cwd()
const SOURCE_PLUGIN = join(ROOT, ".opencode", "plugins", "nii")
const RUNS = join(ROOT, "benchmark", "runs")
const OUT = join(ROOT, "benchmark", "out", "live-results.json")

async function prepare(task: (typeof LIVE_TASKS)[number], arm: Arm, index: number) {
  const dir = join(RUNS, `${task.id}-${arm}-${index}`)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  for (const [name, content] of Object.entries(task.fixtures)) {
    await writeFile(join(dir, name), content, { mode: name.endsWith(".sh") ? 0o755 : 0o644 })
  }
  if (arm === "treatment") {
    await mkdir(join(dir, ".opencode", "plugins"), { recursive: true })
    await cp(SOURCE_PLUGIN, join(dir, ".opencode", "plugins", "nii"), { recursive: true })
  }
  return dir
}

async function runTrial(task: (typeof LIVE_TASKS)[number], arm: Arm, index: number): Promise<Trial> {
  const dir = await prepare(task, arm, index)
  const answerPath = join(dir, "answer.txt")
  const fixtureLines = Object.keys(task.fixtures)
    .map((name) => `- ${join(dir, name)}`)
    .join("\n")
  const prompt = `${buildPrompt(task, arm)}
\nWrite the answer to ${answerPath}.${fixtureLines ? `\n\nWorking files (absolute paths):\n${fixtureLines}` : ""}`

  const started = Date.now()
  let stdout = ""
  let stderr = ""
  let ran = true

  try {
    stdout = execFileSync("opencode", ["run", "--auto", "--model", MODEL, prompt], {
      cwd: dir,
      encoding: "utf8",
      timeout: 150_000,
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (error) {
    ran = false
    const failure = error as { stdout?: string; stderr?: string }
    stdout = failure.stdout ?? ""
    stderr = failure.stderr ?? String(error)
  }

  await writeFile(join(dir, "stdout.txt"), stdout, "utf8")
  await writeFile(join(dir, "stderr.txt"), stderr, "utf8")

  let answer = ""
  try {
    answer = (await readFile(answerPath, "utf8")).trim()
  } catch {
    answer = ""
  }

  const solved = answer === task.expected
  const text = `${stdout}\n${stderr}`
  const signals = detectQuitSignals(text)
  const attempts = 1 + (stderr.match(/^\s*\$ /gm) ?? []).length

  return {
    taskId: task.id,
    arm,
    model: MODEL,
    solved,
    outcome: solved ? "solved" : "failed",
    attempts,
    distinctApproaches: attempts,
    quitSignals: signals,
    genuineBlockerReported: false,
    tokens: 0,
    wallMs: Date.now() - started,
    niiState: arm === "treatment" ? { pivots: 0, refusals: signals.length, ruledOut: [], learnedStrategies: 0, blockers: 0 } : undefined,
  }
}

async function main() {
  await mkdir(join(ROOT, "benchmark", "out"), { recursive: true })
  const trials: Trial[] = []

  for (let index = 0; index < 1; index++) {
    for (const task of LIVE_TASKS) {
      for (const arm of ["control", "treatment"] as Arm[]) {
        process.stdout.write(`running ${task.id} / ${arm} ... `)
        const trial = await runTrial(task, arm, index)
        trials.push(trial)
        console.log(trial.solved ? "solved" : "failed")
        if (DELAY_MS > 0) await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
      }
    }
  }

  const results: Results = { model: MODEL, generatedAt: new Date().toISOString(), trials }
  await writeFile(OUT, `${JSON.stringify(results, null, 2)}\n`, "utf8")
  console.log(`Wrote ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
