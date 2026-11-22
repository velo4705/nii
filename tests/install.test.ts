import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const INSTALLER = join(ROOT, "scripts", "install.mjs")
const SOURCE = join(ROOT, ".opencode", "plugins", "nii")

function run(args: string[], env: Record<string, string> = {}, input?: string) {
  return execFileSync(process.execPath, [INSTALLER, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    ...(input === undefined ? {} : { input }),
  })
}

function sandbox() {
  return mkdtempSync(join(tmpdir(), "nii-install-test-"))
}

test("local install copies the plugin and is idempotent", () => {
  const dir = sandbox()
  try {
    const output = run([dir])
    assert.match(output, /Creating .*\.opencode\/plugins\/nii/)
    assert.ok(existsSync(join(dir, ".opencode/plugins/nii/index.ts")))
    assert.ok(existsSync(join(dir, ".opencode/plugins/nii/SKILL.md")))

    const again = run([dir])
    assert.match(again, /already installed/)
    assert.doesNotMatch(again, /Replacing/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("the npx-style setup subcommand is accepted", () => {
  const dir = sandbox()
  try {
    const output = run(["setup", dir])
    assert.match(output, /Creating .*\.opencode\/plugins\/nii/)
    assert.ok(existsSync(join(dir, ".opencode/plugins/nii/index.ts")))

    const help = run(["help"])
    assert.match(help, /npx opencode-nii@latest setup/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("dry run creates nothing", () => {
  const dir = sandbox()
  try {
    const target = join(dir, "project")
    const output = run([target, "--dry-run"])
    assert.match(output, /Would create/)
    assert.equal(existsSync(join(target, ".opencode/plugins/nii")), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("the setup banner is printed", () => {
  const output = run(["setup", "--help"])
  assert.match(output, /N O T H I N G   I S   I M P O S S I B L E/)
  assert.match(output, /OpenCode plugin · setup/)
  assert.match(output, /Usage:/)
})

test("piped stdin does not block and defaults to local install", () => {
  const dir = sandbox()
  try {
    const output = run([dir], {}, "2\n")
    assert.match(output, /Target:\s+this project/)
    assert.ok(existsSync(join(dir, ".opencode/plugins/nii/index.ts")))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("--cli connects to the native OpenCode config", () => {
  const dir = sandbox()
  try {
    const configHome = join(dir, "config")
    const output = run(["setup", "--cli"], { XDG_CONFIG_HOME: configHome })
    assert.match(output, /Target:\s+OpenCode CLI \/ Desktop/)
    assert.ok(existsSync(join(configHome, "opencode/plugins/nii/index.ts")))
    const config = JSON.parse(readFileSync(join(configHome, "opencode/opencode.json"), "utf8"))
    assert.equal(config.plugins.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("--flatpak connects to the Flatpak sandbox config", () => {
  const dir = sandbox()
  try {
    const flatpakDir = join(dir, "flatpak-config")
    const output = run(["setup", "--flatpak"], { NII_FLATPAK_CONFIG_DIR: flatpakDir })
    assert.match(output, /Target:\s+Flatpak \(Linux\)/)
    assert.ok(existsSync(join(flatpakDir, "plugins/nii/index.ts")))
    const config = JSON.parse(readFileSync(join(flatpakDir, "opencode.json"), "utf8"))
    assert.equal(config.plugins.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("uninstall removes only the NII entry from the native config", () => {
  const dir = sandbox()
  try {
    const configHome = join(dir, "config")
    const env = { XDG_CONFIG_HOME: configHome }
    run(["setup", "--cli"], env)
    const configPath = join(configHome, "opencode", "opencode.json")
    const config = JSON.parse(readFileSync(configPath, "utf8"))
    config.plugins.push("some-other-plugin")
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8")

    const output = run(["uninstall", "--cli"], env)
    assert.match(output, /removed 1 NII entry/)
    const after = JSON.parse(readFileSync(configPath, "utf8"))
    assert.deepEqual(after.plugins, ["some-other-plugin"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("uninstall works with the Flatpak config", () => {
  const dir = sandbox()
  try {
    const flatpakDir = join(dir, "flatpak-config")
    const env = { NII_FLATPAK_CONFIG_DIR: flatpakDir }
    run(["setup", "--flatpak"], env)
    const configPath = join(flatpakDir, "opencode.json")
    assert.equal(JSON.parse(readFileSync(configPath, "utf8")).plugins.length, 1)

    const output = run(["uninstall", "--flatpak"], env)
    assert.match(output, /Target:\s+Flatpak \(Linux\)/)
    assert.match(output, /removed 1 NII entry/)
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")).plugins, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("uninstall is safe when there is nothing to remove", () => {
  const dir = sandbox()
  try {
    const configHome = join(dir, "config")
    mkdirSync(join(configHome, "opencode"), { recursive: true })
    writeFileSync(join(configHome, "opencode", "opencode.json"), '{ "plugins": ["other"] }\n', "utf8")
    const output = run(["uninstall", "--cli"], { XDG_CONFIG_HOME: configHome })
    assert.match(output, /No NII entry found/)
    assert.match(output, /Plugin files were left in place/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("setup warns when NII is already connected on the other platform", () => {
  const dir = sandbox()
  try {
    const configHome = join(dir, "config")
    const flatpakDir = join(dir, "flatpak-config")
    run(["setup", "--flatpak"], { NII_FLATPAK_CONFIG_DIR: flatpakDir })

    const output = run(["setup", "--cli"], { XDG_CONFIG_HOME: configHome, NII_FLATPAK_CONFIG_DIR: flatpakDir })
    assert.match(output, /also connected in the Flatpak \(Linux\) config/)
    assert.match(output, /running both can register hooks twice/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("uninstall defaults to removing NII from both platforms", () => {
  const dir = sandbox()
  try {
    const configHome = join(dir, "config")
    const flatpakDir = join(dir, "flatpak-config")
    const env = { XDG_CONFIG_HOME: configHome, NII_FLATPAK_CONFIG_DIR: flatpakDir }
    run(["setup", "--cli"], env)
    run(["setup", "--flatpak"], env)

    const output = run(["uninstall"], env)
    assert.match(output, /Target:\s+OpenCode CLI \/ Desktop/)
    assert.match(output, /Target:\s+Flatpak \(Linux\)/)
    assert.match(output, /disconnected from 2 platform/)
    assert.deepEqual(JSON.parse(readFileSync(join(configHome, "opencode/opencode.json"), "utf8")).plugins, [])
    assert.deepEqual(JSON.parse(readFileSync(join(flatpakDir, "opencode.json"), "utf8")).plugins, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("uninstall --cli leaves the Flatpak entry intact", () => {
  const dir = sandbox()
  try {
    const configHome = join(dir, "config")
    const flatpakDir = join(dir, "flatpak-config")
    const env = { XDG_CONFIG_HOME: configHome, NII_FLATPAK_CONFIG_DIR: flatpakDir }
    run(["setup", "--cli"], env)
    run(["setup", "--flatpak"], env)

    run(["uninstall", "--cli"], env)
    assert.deepEqual(JSON.parse(readFileSync(join(configHome, "opencode/opencode.json"), "utf8")).plugins, [])
    assert.equal(JSON.parse(readFileSync(join(flatpakDir, "opencode.json"), "utf8")).plugins.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("an edited install is replaced by default", () => {
  const dir = sandbox()
  try {
    run([dir])
    const edited = join(dir, ".opencode/plugins/nii/index.ts")
    writeFileSync(edited, "// edited\n", "utf8")

    const output = run([dir])
    assert.match(output, /Replacing existing install/)
    assert.equal(readFileSync(edited, "utf8"), readFileSync(join(SOURCE, "index.ts"), "utf8"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("global install writes one file:// entry and never duplicates it", () => {
  const dir = sandbox()
  try {
    const configHome = join(dir, "config")
    const env = { XDG_CONFIG_HOME: configHome }
    const output = run(["--global"], env)
    assert.match(output, /Updating .*opencode\.json/)

    const configPath = join(configHome, "opencode", "opencode.json")
    const config = JSON.parse(readFileSync(configPath, "utf8"))
    assert.equal(config.plugins.length, 1)
    assert.match(config.plugins[0], /^file:\/\//)
    assert.match(config.plugins[0], /plugins\/nii$/)
    assert.ok(existsSync(join(configHome, "opencode", "plugins", "nii", "index.ts")))

    run(["--global"], env)
    const after = JSON.parse(readFileSync(configPath, "utf8"))
    assert.equal(after.plugins.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
