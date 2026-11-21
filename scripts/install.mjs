#!/usr/bin/env node
/**
 * NII — Nothing Is Impossible
 * OpenCode plugin setup
 *
 * Interactive menu:
 *   1) OpenCode CLI / Desktop  — native global config
 *   2) Flatpak (Linux only)    — OpenCode Flatpak sandbox config
 *   3) This project only       — .opencode/plugins/nii
 *
 * Non-interactive flags (CI / npx scripts): --cli, --flatpak, --local,
 * --global (alias of --cli), or a project directory.
 */

import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir, platform } from "node:os"
import { dirname, join, resolve } from "node:path"
import { createInterface } from "node:readline/promises"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SOURCE = join(ROOT, ".opencode", "plugins", "nii")

const NATIVE_CONFIG = process.env.XDG_CONFIG_HOME
  ? join(process.env.XDG_CONFIG_HOME, "opencode")
  : join(homedir(), ".config", "opencode")
const FLATPAK_CONFIG =
  process.env.NII_FLATPAK_CONFIG_DIR ??
  join(homedir(), ".var", "app", "ai.opencode.opencode", "config", "opencode")

function banner() {
  // NII — standard ANSI Shadow glyphs. The N's diagonal already runs
  // down-right into its right stem (the "/" slant), and the I's are plain
  // vertical bars — the bar-and-middle-bar glyph is E, not I.
  const art = [
    "███╗   ██╗ ██╗ ██╗",
    "████╗  ██║ ██║ ██║",
    "██╔██╗ ██║ ██║ ██║",
    "██║╚██╗██║ ██║ ██║",
    "██║ ╚████║ ██║ ██║",
    "╚═╝  ╚═══╝ ╚═╝ ╚═╝",
  ]
  const artWidth = Math.max(...art.map((line) => [...line].length))
  const artBlock = art.map((line) => line + " ".repeat(artWidth - [...line].length))
  const lines = [
    "",
    ...artBlock,
    "",
    "N O T H I N G   I S   I M P O S S I B L E",
    "OpenCode plugin · setup",
    "",
  ]
  const width = Math.max(...lines.map((line) => [...line].length))
  console.log(`╭${"─".repeat(width + 2)}╮`)
  for (const line of lines) {
    const pad = width - [...line].length
    const left = Math.floor(pad / 2)
    const right = pad - left
    console.log(`│ ${" ".repeat(left)}${line}${" ".repeat(right)} │`)
  }
  console.log(`╰${"─".repeat(width + 2)}╯`)
}

function usage() {
  console.log(`NII — Nothing Is Impossible · setup

Usage:
  npx opencode-nii@latest setup                 # interactive menu
  npx opencode-nii@latest setup [project-dir]   # local project, no prompt
  npx opencode-nii@latest setup --cli           # OpenCode CLI / Desktop
  npx opencode-nii@latest setup --flatpak       # Flatpak (Linux only)
  npx opencode-nii@latest setup --local         # current project

  npx opencode-nii@latest uninstall              # interactive menu
  npx opencode-nii@latest uninstall --cli        # native config only
  npx opencode-nii@latest uninstall --flatpak    # Flatpak config only
  npx opencode-nii@latest uninstall --both       # both configs

Options:
  --cli          connect to native OpenCode CLI / Desktop config
  --flatpak      connect to the Flatpak sandbox config (Linux only)
  --local        install into the current project only
  --global       alias of --cli (backwards compatibility)
  --both         uninstall from both Native and Flatpak configs (default)
  --force        overwrite an existing, different install
  --dry-run      show what would be done without writing anything
  --help         show this message
`)
}

function parseArgs(argv) {
  const opts = {
    mode: null,
    target: null,
    force: false,
    dryRun: false,
    help: false,
    uninstall: false,
    both: false,
  }
  const rest = [...argv]

  const first = rest[0]
  if (first === "help") {
    opts.help = true
    rest.shift()
  } else if (first === "setup" || first === "install") {
    rest.shift()
  } else if (first === "uninstall") {
    opts.uninstall = true
    rest.shift()
  }

  for (const arg of rest) {
    switch (arg) {
      case "--cli":
      case "--global":
        opts.mode = "cli"
        break
      case "--flatpak":
        opts.mode = "flatpak"
        break
      case "--local":
        opts.mode = "local"
        break
      case "--both":
        opts.both = true
        break
      case "--force":
        opts.force = true
        break
      case "--dry-run":
        opts.dryRun = true
        break
      case "--help":
      case "-h":
        opts.help = true
        break
      default:
        if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`)
        if (opts.target) throw new Error(`unexpected argument: ${arg}`)
        opts.target = arg
    }
  }
  if (opts.mode && opts.target && opts.mode !== "local") {
    throw new Error("a project directory can only be used with --local")
  }
  return opts
}

async function promptMenu() {
  const linux = platform() === "linux"
  const choices = [
    ["1) OpenCode CLI / Desktop", "native global config"],
    ...(linux ? [["2) Flatpak (Linux only)", "OpenCode Flatpak sandbox"]] : []),
    ["3) This project only", ".opencode/plugins/nii"],
    ["4) Cancel", ""],
  ]
  const labelWidth = Math.max(...choices.map(([label]) => label.length))
  console.log("\nWhere should NII be connected?\n")
  for (const [label, detail] of choices) {
    console.log(`  ${detail ? label.padEnd(labelWidth) : label}${detail ? `  — ${detail}` : ""}`)
  }
  console.log("")

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question("Choose [1]: ")).trim()
    if (answer === "" || answer === "1") return { mode: "cli", configDir: NATIVE_CONFIG, label: "OpenCode CLI / Desktop" }
    if (answer === "2") {
      if (!linux) throw new Error("Flatpak is only available on Linux")
      return { mode: "flatpak", configDir: FLATPAK_CONFIG, label: "Flatpak (Linux)" }
    }
    if (answer === "3") return { mode: "local", label: "this project" }
    if (answer === "4") return null
    throw new Error(`invalid choice: ${answer}`)
  } finally {
    rl.close()
  }
}

function resolveTarget(opts) {
  if (opts.mode === "cli") {
    return { mode: "cli", configDir: NATIVE_CONFIG, label: "OpenCode CLI / Desktop" }
  }
  if (opts.mode === "flatpak") {
    if (platform() !== "linux") throw new Error("Flatpak is only available on Linux")
    return { mode: "flatpak", configDir: FLATPAK_CONFIG, label: "Flatpak (Linux)" }
  }
  if (opts.mode === "local" || opts.target) {
    return { mode: "local", label: "this project" }
  }
  if (process.stdin.isTTY) return promptMenu()
  // CI / piped stdin: keep the historical non-interactive default.
  return { mode: "local", label: "this project" }
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(path)))
    else files.push(path)
  }
  return files.sort()
}

async function sameDirectory(a, b) {
  const aFiles = await listFiles(a)
  const bFiles = await listFiles(b)
  if (aFiles.length !== bFiles.length) return false
  for (let i = 0; i < aFiles.length; i++) {
    if (aFiles[i].slice(a.length) !== bFiles[i].slice(b.length)) return false
    const [left, right] = await Promise.all([readFile(aFiles[i]), readFile(bFiles[i])])
    if (!left.equals(right)) return false
  }
  return true
}

async function installTo(destination, { force, dryRun }) {
  if (existsSync(destination)) {
    if (await sameDirectory(SOURCE, destination)) {
      console.log(`NII already installed at ${destination}`)
      return false
    }
    if (!force) {
      throw new Error(`${destination} already contains a different NII install. Use --force to replace it.`)
    }
    console.log(`Replacing existing install at ${destination}`)
  } else {
    console.log(`${dryRun ? "Would create" : "Creating"} ${destination}`)
  }

  if (!dryRun) {
    await mkdir(destination, { recursive: true })
    await cp(SOURCE, destination, { recursive: true, force: true })
  }
  return true
}

async function addToConfig(destination, configPath, dryRun) {
  const entry = pathToFileURL(destination).href
  let raw = ""
  if (existsSync(configPath)) raw = await readFile(configPath, "utf8")

  let config
  try {
    config = raw.trim() ? JSON.parse(raw) : {}
  } catch {
    console.log(`\n${configPath} is not plain JSON (likely JSONC). Add this entry manually:`)
    console.log(`  plugins: [..., "${entry}"]`)
    return
  }

  const plugins = Array.isArray(config.plugins) ? config.plugins : []
  if (plugins.includes(entry) || plugins.includes(destination)) {
    console.log(`\nConfig already references NII.`)
    return
  }
  config.plugins = [...plugins, entry]

  console.log(`\n${dryRun ? "Would update" : "Updating"} ${configPath}`)
  if (!dryRun) await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
}

function isNiiEntry(entry) {
  if (typeof entry !== "string") return false
  const value = entry.toLowerCase()
  return (
    value === "opencode-nii" ||
    value === "@nii/nii" ||
    /^file:.*\/plugins\/nii\/?$/i.test(value) ||
    /(^|\/)plugins\/nii\/?$/i.test(value)
  )
}

/** Where NII could be connected. Native and Flatpak can both be installed. */
function allPlatformTargets() {
  const targets = [{ configDir: NATIVE_CONFIG, label: "OpenCode CLI / Desktop" }]
  if (platform() === "linux") {
    targets.push({ configDir: FLATPAK_CONFIG, label: "Flatpak (Linux)" })
  }
  return targets
}

async function configHasNii(configDir) {
  const path = join(configDir, "opencode.json")
  if (!existsSync(path)) return false
  try {
    const config = JSON.parse(await readFile(path, "utf8"))
    return Array.isArray(config.plugins) && config.plugins.some(isNiiEntry)
  } catch {
    return false
  }
}

/** Warn when the other platform already has NII — duplicate hooks are noisy. */
async function warnAboutOtherPlatforms(activeDir) {
  for (const target of allPlatformTargets()) {
    if (target.configDir === activeDir) continue
    if (await configHasNii(target.configDir)) {
      console.log(`\nNote: NII is also connected in the ${target.label} config. Running both can register hooks twice.`)
      console.log(`Use 'npx opencode-nii@latest uninstall' to clean up both.`)
    }
  }
}

/** Remove every NII reference from a config's plugins array. Files are kept. */
async function removeFromConfig(configDir, dryRun) {
  const configPath = join(configDir, "opencode.json")
  if (!existsSync(configPath)) {
    console.log(`\nNo config found at ${configPath} — nothing to remove.`)
    return
  }
  const raw = await readFile(configPath, "utf8")
  let config
  try {
    config = raw.trim() ? JSON.parse(raw) : {}
  } catch {
    console.log(`\n${configPath} is not plain JSON (likely JSONC). Remove the NII entry manually.`)
    return
  }

  const before = Array.isArray(config.plugins) ? config.plugins : []
  const remaining = before.filter((entry) => !isNiiEntry(entry))

  if (remaining.length === before.length) {
    console.log(`\nNo NII entry found in ${configPath}.`)
    return
  }

  config.plugins = remaining
  console.log(`\n${dryRun ? "Would update" : "Updating"} ${configPath} — removed ${before.length - remaining.length} NII entry/entries.`)
  if (!dryRun) await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
}

async function promptUninstallMenu() {
  const targets = allPlatformTargets()
  const flatpak = targets[1]
  const choices = [
    ["1) OpenCode CLI / Desktop", "native global config"],
    ...(flatpak ? [["2) Flatpak (Linux only)", "OpenCode Flatpak sandbox"]] : []),
    ["3) Both platforms", "remove all NII config entries"],
    ["4) Cancel", ""],
  ]
  const labelWidth = Math.max(...choices.map(([label]) => label.length))
  console.log("\nWhere should NII be disconnected?\n")
  for (const [label, detail] of choices) {
    console.log(`  ${detail ? label.padEnd(labelWidth) : label}${detail ? `  — ${detail}` : ""}`)
  }
  console.log("")

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question("Choose [3]: ")).trim()
    if (answer === "" || answer === "3") return targets
    if (answer === "1") return [targets[0]]
    if (answer === "2") {
      if (!flatpak) throw new Error("Flatpak is only available on Linux")
      return [flatpak]
    }
    if (answer === "4") return null
    throw new Error(`invalid choice: ${answer}`)
  } finally {
    rl.close()
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    banner()
    usage()
    return
  }

  banner()

  if (opts.uninstall) {
    const targets = allPlatformTargets()
    const flatpak = targets[1]
    let selected
    if (opts.mode === "flatpak") {
      if (!flatpak) throw new Error("Flatpak is only available on Linux")
      selected = [flatpak]
    } else if (opts.mode === "cli") {
      selected = [targets[0]]
    } else if (opts.both || !process.stdin.isTTY) {
      selected = targets
    } else {
      selected = await promptUninstallMenu()
    }
    if (!selected) {
      console.log("\nUninstall cancelled.")
      return
    }
    for (const target of selected) {
      console.log(`\n  Target: ${target.label}`)
      await removeFromConfig(target.configDir, opts.dryRun)
    }
    console.log(`\nNII disconnected from ${selected.length} platform(s). Plugin files were left in place.`)
    return
  }

  const target = await resolveTarget(opts)
  if (!target) {
    console.log("\nSetup cancelled.")
    return
  }

  if (target.mode !== "local") await warnAboutOtherPlatforms(target.configDir)

  const projectDir = resolve(opts.target ?? process.cwd())
  const destination =
    target.mode === "local"
      ? join(projectDir, ".opencode", "plugins", "nii")
      : join(target.configDir, "plugins", "nii")

  console.log("")
  console.log(`  Target:      ${target.label}`)
  console.log(`  Source:      ${SOURCE}`)
  console.log(`  Destination: ${destination}`)
  console.log(`  Mode:        ${opts.dryRun ? "dry run" : "install"}`)
  console.log("")

  if (!existsSync(SOURCE)) throw new Error(`plugin source missing: ${SOURCE}`)

  const changed = await installTo(destination, opts)
  if (target.mode !== "local") {
    const configPath = join(target.configDir, "opencode.json")
    if (changed || !existsSync(configPath)) {
      await addToConfig(destination, configPath, opts.dryRun)
    }
  }

  if (target.mode !== "local") {
    console.log(`\nConnected to ${target.label}. Restart OpenCode, then verify with /nii status.`)
  } else {
    console.log(`\nVerify: cd ${projectDir} && opencode, then /nii status`)
  }
}

main().catch((error) => {
  console.error(`\nNII setup failed: ${error.message}`)
  process.exitCode = 1
})
