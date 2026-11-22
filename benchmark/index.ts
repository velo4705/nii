/**
 * Benchmark CLI. Kept outside the published npm package.
 *
 *   node benchmark/index.ts sample        # generate synthetic results + dashboard
 *   node benchmark/index.ts report FILE   # render a real results JSON file
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { renderDashboard } from "./visualize.ts"
import { sampleResults } from "./sample.ts"
import type { Results } from "./types.ts"

const OUT = join(process.cwd(), "benchmark", "out")

async function main() {
  const [command, file] = process.argv.slice(2)
  await mkdir(OUT, { recursive: true })

  let results: Results
  if (command === "sample") {
    results = sampleResults()
  } else if (command === "report" && file) {
    results = JSON.parse(await readFile(file, "utf8")) as Results
  } else {
    console.log("Usage: node benchmark/index.ts sample | report <results.json>")
    return
  }

  const json = join(OUT, "results.json")
  const html = join(OUT, "dashboard.html")
  await writeFile(json, `${JSON.stringify(results, null, 2)}\n`, "utf8")
  await writeFile(html, renderDashboard(results), "utf8")
  console.log(`Wrote ${json}`)
  console.log(`Wrote ${html}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
