import { averages, favorableRate, perTask, quitHistogram, solveRate, survivalCurve } from "./aggregate.ts"
import type { Results } from "./types.ts"

const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

function svg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img">${body}</svg>`
}

export function barChart(
  title: string,
  labels: string[],
  values: number[],
  colors: string[] = ["#64748b", "#818cf8"],
): string {
  const width = 640
  const height = 300
  const top = 40
  const bottom = 40
  const max = Math.max(1, ...values)
  const group = (width - 80) / Math.max(1, labels.length)
  const bar = Math.min(70, group * 0.5)

  const bars = labels
    .map((label, index) => {
      const value = values[index] ?? 0
      const h = ((height - top - bottom) * value) / max
      const x = 60 + index * group + (group - bar) / 2
      const y = height - bottom - h
      return `<rect x="${x}" y="${y}" width="${bar}" height="${h}" rx="6" fill="${colors[index % colors.length]}"/>
<text x="${x + bar / 2}" y="${y - 8}" text-anchor="middle" font-size="14" fill="#e2e8f0">${value.toFixed(2)}</text>
<text x="${x + bar / 2}" y="${height - 14}" text-anchor="middle" font-size="13" fill="#94a3b8">${esc(label)}</text>`
    })
    .join("\n")

  return svg(
    width,
    height,
    `<rect width="${width}" height="${height}" fill="#0b1020"/>
<text x="20" y="26" font-size="16" fill="#f8fafc">${esc(title)}</text>
<line x1="50" y1="${height - bottom}" x2="${width - 20}" y2="${height - bottom}" stroke="#334155"/>
${bars}`,
  )
}

export function survivalChart(results: Results): string {
  const width = 640
  const height = 300
  const colors = { control: "#64748b", treatment: "#818cf8" }
  const series = (["control", "treatment"] as const).map((arm) => ({
    arm,
    points: survivalCurve(results.trials, arm),
  }))
  const maxAttempt = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.attempt)))
  const x = (attempt: number) => 50 + ((width - 80) * (attempt - 1)) / Math.max(1, maxAttempt - 1)
  const y = (value: number) => height - 40 - (height - 80) * value

  const paths = series
    .map((s) => {
      const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.attempt)} ${y(p.unsolved)}`).join(" ")
      return `<path d="${d}" fill="none" stroke="${colors[s.arm]}" stroke-width="3"/>`
    })
    .join("\n")

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((v) => `<line x1="50" y1="${y(v)}" x2="${width - 20}" y2="${y(v)}" stroke="#1e293b"/>`)
    .join("\n")

  return svg(
    width,
    height,
    `<rect width="${width}" height="${height}" fill="#0b1020"/>
<text x="20" y="26" font-size="16" fill="#f8fafc">Still unsolved after each attempt</text>
${grid}${paths}
<text x="20" y="${height - 12}" font-size="12" fill="#94a3b8">attempt 1</text>
<text x="${width - 90}" y="${height - 12}" font-size="12" fill="#94a3b8">attempt ${maxAttempt}</text>`,
  )
}

export function taskStrip(results: Results): string {
  const rows = perTask(results)
  const cell = (value: string | null) =>
    value === null ? "?" : value === "blocked-correctly" ? "blocked" : value === "solved" ? "solved" : "unsolved"

  const body = rows
    .map((row, index) => {
      const y = 50 + index * 26
      return `<text x="20" y="${y}" font-size="13" fill="#cbd5e1">${esc(row.taskId)}</text>
<text x="340" y="${y}" font-size="13" fill="#94a3b8">control: ${cell(row.control)}</text>
<text x="500" y="${y}" font-size="13" fill="#a5b4fc">NII: ${cell(row.treatment)}</text>`
    })
    .join("\n")

  return svg(
    680,
    Math.max(90, 60 + rows.length * 26),
    `<rect width="680" height="${Math.max(90, 60 + rows.length * 26)}" fill="#0b1020"/>
<text x="20" y="26" font-size="16" fill="#f8fafc">Per-task outcome</text>${body}`,
  )
}

export function renderDashboard(results: Results): string {
  const control = solveRate(results.trials, "control")
  const treatment = solveRate(results.trials, "treatment")
  const favorableControl = favorableRate(results.trials, "control")
  const favorableTreatment = favorableRate(results.trials, "treatment")
  const quit = quitHistogram(results.trials)
  const avgControl = averages(results.trials, "control")
  const avgTreatment = averages(results.trials, "treatment")

  const stat = (label: string, value: string) =>
    `<div class="stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`

  const table = quit
    .map((row) => `<tr><td>${esc(row.category)}</td><td>${row.count}</td></tr>`)
    .join("\n")

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>NII benchmark</title><style>
body{margin:0;padding:24px;background:#0b1020;color:#e2e8f0;font:14px system-ui}
h1{font-size:22px;margin:0 0 16px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.stat{background:#111a2e;border:1px solid #1e293b;border-radius:10px;padding:12px 16px;min-width:150px}
.stat span{display:block;color:#94a3b8;font-size:12px}
.stat strong{display:block;font-size:20px;margin-top:4px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:20px}
.panel{background:#111a2e;border:1px solid #1e293b;border-radius:10px;padding:12px}
table{border-collapse:collapse;width:100%}td{padding:4px 8px;border-bottom:1px solid #1e293b}
</style></head><body>
<h1>NII benchmark - ${esc(results.model)}</h1>
<div class="cards">
${stat("Control solve rate", `${(control * 100).toFixed(0)}%`)}
${stat("NII solve rate", `${(treatment * 100).toFixed(0)}%`)}
${stat("Control favorable", `${(favorableControl * 100).toFixed(0)}%`)}
${stat("NII favorable", `${(favorableTreatment * 100).toFixed(0)}%`)}
${stat("Control attempts", avgControl.distinctApproaches.toFixed(1))}
${stat("NII attempts", avgTreatment.distinctApproaches.toFixed(1))}
${stat("Avg NII pivots", avgTreatment.pivots.toFixed(1))}
${stat("Trials", String(results.trials.length))}
</div>
<div class="grid">
<div class="panel">${barChart("Solve rate", ["control", "NII"], [control, treatment])}</div>
<div class="panel">${survivalChart(results)}</div>
<div class="panel">${barChart("Distinct approaches", ["control", "NII"], [avgControl.distinctApproaches, avgTreatment.distinctApproaches])}</div>
<div class="panel">${barChart("Quit signals", quit.map((q) => q.category), quit.map((q) => q.count), ["#818cf8"])}</div>
<div class="panel">${taskStrip(results)}</div>
<div class="panel"><h2>Quit signal counts</h2><table><tr><th>Signal</th><th>Count</th></tr>${table}</table></div>
</div>
</body></html>`
}
