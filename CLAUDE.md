# CLAUDE.md

Guidance for Claude Code (and any other agent) working in this repository.

> **Read `docs/STATUS.md` first.** It holds the current state of the work, what is
> verified, and what is still pending. `docs/DECISIONS.md` explains *why* the
> architecture looks the way it does — check it before changing a core mechanism,
> because several obvious-looking "improvements" have already been considered and
> rejected for concrete reasons.

## What this is

A Windows desktop app (Electron + React + TypeScript) that finds every server
listening on a TCP port on the machine, lets you start/stop/restart them, and
manages npm dependencies for folders you register as projects.

## Commands

```bash
npm run dev          # hot-reloading dev window (Vite dev server + Electron)
npm run typecheck    # tsc --noEmit over both projects; run this before claiming done
npm run build        # typecheck + bundle to out/
npm run check:themes # contrast check over every theme palette
npm run dist         # build + package a Windows installer into release/
```

There is no test suite yet. `npm run typecheck` is the general gate — do not
report work as complete without running it — and `npm run check:themes` is the
gate for anything touching `lib/themes.ts`.

## Architecture

Three TypeScript programs with separate tsconfigs, sharing one types package:

```
src/main/      Node/Electron main process   -> tsconfig.node.json
src/preload/   contextBridge only           -> tsconfig.node.json
src/renderer/  React UI, no Node access     -> tsconfig.web.json
src/shared/    types imported by all three  -> both
```

The renderer has `nodeIntegration: false` and `contextIsolation: true`. It reaches
the main process **only** through `window.nsm`, whose shape is declared in
`src/shared/api.ts` and implemented in `src/preload/index.ts`.

### Adding an IPC method

Four files, in order:

1. `src/shared/api.ts` — add the method to the `NsmApi` interface
2. `src/main/<module>.ts` — write the implementation
3. `src/main/ipc.ts` — register it with `handle('channel:name', ...)`
4. `src/preload/index.ts` — add the one-line forwarder

`handle()` wraps every result in `{ ok, data } | { ok, error }` so a throw in the
main process becomes a rejected promise in the renderer instead of an unhandled
IPC error. Never call `ipcMain.handle` directly; always go through `handle()`.

### Key modules

| File | Responsibility |
| --- | --- |
| `main/toolchain.ts` | Locates the user's `node.exe` and `npm-cli.js`; `runNpm()` lives here |
| `main/scan.ts` | `netstat` + `Win32_Process` → `DetectedServer[]` |
| `main/servers.ts` | Spawns, tracks, kills dev servers; owns the run registry and log ring buffer |
| `main/packages.ts` | `npm ls` / `npm outdated` parsing, severity, update planning |
| `main/projects.ts` | `package.json` reading, script classification |
| `main/store.ts` | Project persistence (atomic JSON writes to `userData`) |
| `renderer/src/lib/themes.ts` | Theme palettes and `applyTheme()` |
| `renderer/src/lib/settings.ts` | User settings (localStorage), read through `SettingsProvider` |
| `renderer/src/lib/shortcuts.ts` | The shortcut table — reference list *and* dispatch keys |
| `renderer/src/lib/links.ts` | URL detection in log output |

## Rules specific to this codebase

**Never hardcode a colour in `styles.css`.** Every colour is either one of the
eighteen theme tokens or a `color-mix()` over them, or 25 themes break one at a
time. Add a theme by appending to `THEMES`, then run `npm run check:themes`. See
`docs/DECISIONS.md` §18.

**Never spawn npm through a shell.** Use `runNpm()` from `main/toolchain.ts`, or
spawn `nodeExe` with `npmCli` as the first argument. Project paths and script
names come from the filesystem and must never reach a command interpreter. See
`docs/DECISIONS.md` §2.

**Never assume Windows paths lack spaces.** `C:\Program Files` and the developer's
own `VibeCoding Projects` folder both contain them. A `\S+` or `[^\s]+` regex over
a command line is a bug — this has already caused one. Quoted arguments must be
matched as a whole.

**Kill process trees, not processes.** `npm run dev` spawns the real server as a
child. Killing only npm's PID leaves the port bound. Always `taskkill /T /F`.

**`npm outdated` and `npm ls` exit non-zero on success.** `outdated` returns 1 when
it finds outdated packages; `ls` returns non-zero on unmet peer deps. Inspect
stdout, not the exit code. `runNpm()` returns the code rather than throwing for
exactly this reason.

**Don't add a semver dependency.** `packages.ts` has a ~10-line comparator that
covers the one case needed. See `docs/DECISIONS.md` §5.

## Platform

Windows-only by design — `netstat`, `taskkill` and `Get-CimInstance` are all
Windows-specific. There is no abstraction layer for other platforms and adding
one is not currently planned.

## Watching changes without reinstalling

```bash
npm run dev
```

Vite hot-reloads the renderer, and electron-vite restarts the main process when
`src/main/` or `src/preload/` changes. No rebuild, no version bump, no installer.

A development run uses a **separate** data directory (`…\npm-server-manager-dev`),
so it has its own project list and run index. That is deliberate: the
single-instance lock is keyed on the data directory, and sharing one meant
`npm run dev` exited instantly and silently whenever an installed copy was
already open.
