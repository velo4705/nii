# Installing NII

NII needs OpenCode **V2** (`v2.0.32` or later). There are two supported setups.

## 1. Local install (recommended for a single project)

This copies the plugin into your project and needs **no config edit** — OpenCode auto-loads anything under `.opencode/plugins/`.

From this repository:

```sh
# Install into the current directory
node scripts/install.mjs

# Or install into another project
node scripts/install.mjs /path/to/your/project
```

Once published, the npx form is:

```sh
npx opencode-nii@latest setup
```

It opens a menu (beautifully formatted banner included):

```
Where should NII be connected?

  1) OpenCode CLI / Desktop   — native global config
  2) Flatpak (Linux only)     — OpenCode Flatpak sandbox
  3) This project only        — .opencode/plugins/nii
  4) Cancel

Choose [1]:
```

Pick `1` for native CLI/Desktop, `2` for the Flatpak sandbox (Linux only), or `3` for a single project. For scripts and CI, skip the menu with a flag or a directory:

```sh
npx opencode-nii@latest setup --cli
npx opencode-nii@latest setup --flatpak
npx opencode-nii@latest setup --local
npx opencode-nii@latest setup /path/to/your/project
```

`setup` is the canonical subcommand; `install` is an alias. The exact command `npx nii@latest setup` is **not available** because the `nii` name on npm already belongs to an unrelated framework. If you publish a scoped alias `@nii/nii`, the `nii` bin is already wired, so `npx @nii/nii@latest setup` will work too.

Then:

```sh
cd /path/to/your/project
opencode
/nii status
```

You should see `NII status: ON (session)`.

## 2. Global install (all projects)

```sh
node scripts/install.mjs --global
```

This copies the plugin to `~/.config/opencode/plugins/nii` and adds an absolute `file://` entry to `~/.config/opencode/opencode.json`. Restart OpenCode afterwards. In any project, `/nii status` should report ON.

If your global config is JSONC (with comments), the installer will not rewrite it — it prints the single line to add manually instead.

## 3. Manual install (no script)

Copy the contents of `.opencode/plugins/nii/` into your project at `.opencode/plugins/nii/`. That's it — no config, no build step, no dependencies.

Or, once published to npm, add to `opencode.json(c)`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-nii"]
}
```

See [`examples/opencode.jsonc`](examples/opencode.jsonc) for all options.

## Installer options

| Flag | Effect |
| --- | --- |
| `--cli` | OpenCode CLI / Desktop native config |
| `--global` | Alias of `--cli` |
| `--flatpak` | Flatpak sandbox config (Linux only) |
| `--local` | Current project only |
| `--force` | Accepted for compatibility; installs replace by default |
| `--dry-run` | Show planned changes without writing |
| `--help` | Show usage |

Flatpak path: `~/.var/app/ai.opencode.opencode/config/opencode`. Override for testing with `NII_FLATPAK_CONFIG_DIR`.

Re-running the installer on an identical install is a no-op. If the destination contains an older or edited NII install, setup replaces it automatically so a published version always wins. Use `--dry-run` first if you want to see what would change.

## Verify the install

1. `opencode` in the target project.
2. `/nii status` — reports ON, pivots used, and strategies learned.
3. `/nii help` — lists all commands.
4. Check the server log for: `loading plugin .../.opencode/plugins/nii`.

## Uninstall

```sh
npx opencode-nii@latest uninstall
```

The `uninstall` command removes **only the NII entries from `opencode.json`**. Since NII can be connected to both Native CLI/Desktop and Flatpak on the same machine, the default is **both platforms** — this avoids leaving a second instance registered (which would double-run hooks).

The interactive menu lets you pick one platform or both; non-interactive forms:

```sh
npx opencode-nii@latest uninstall --cli       # native only
npx opencode-nii@latest uninstall --flatpak   # Flatpak only
npx opencode-nii@latest uninstall --both      # both (same as default)
```

Setup also warns if NII is already connected on the other platform.

Plugin files are intentionally left in place; nothing is deleted. For a local project install, delete `.opencode/plugins/nii` from that project.

If your config is JSONC, the command prints the line to remove instead of rewriting the file.

## Troubleshooting

- **`/nii status` says OFF** — run `/nii on` for the current session.
- **No plugin load line in the log** — confirm the directory is `<project>/.opencode/plugins/nii` and contains `index.ts`. `opencode service restart` if the watcher missed it.
- **Setup says "Replacing existing install"** — it found an older or edited copy and is replacing it with the published version. That is the intended behavior. If you want to keep your edits, copy them elsewhere first.
- **Model transport errors** — NII's bounded retry hook handles 429s and transient 5xx, but if the provider is fully down, sessions can hang. That is external to the plugin; resume the same session when it recovers.
