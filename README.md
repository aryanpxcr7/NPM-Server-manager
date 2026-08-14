# NPM Server Manager

A Windows desktop app for finding, controlling and updating the Node dev servers and projects on your machine.

![Electron](https://img.shields.io/badge/Electron-33-47848F) ![React](https://img.shields.io/badge/React-19-61DAFB) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6)

## What it does

**Find every server that's running.** Scans all listening TCP ports on your PC and shows which process owns each one — including servers you started in a terminal hours ago and forgot about. Node, Bun, Deno, Python, Java and friends are recognised; system services are filtered out.

**Stop and restart them.** Any detected server can be stopped, whether this app started it or not. Stops kill the whole process tree, so `npm run dev` doesn't leave an orphaned bundler holding the port.

**Add folders as projects.** Point it at any folder with a `package.json`. Projects persist between launches.

**Start servers from a clean popup.** Open a project, hit **Start Server**, and pick from a dialog that leads with *Start Dev Server* and *Start Build Server*, with every other npm script one click away. Output streams into a log panel at the bottom.

**Work in a real terminal, without leaving.** **Ctrl+`** opens a terminal in the bottom panel — a Windows pseudoconsole behind xterm.js, so prompts, colours, arrow keys, tab completion, history, Ctrl+C and progress bars all behave exactly as they do in Windows Terminal. It opens in the folder of the project you have selected. Open as many as you like as tabs, in PowerShell, Command Prompt or Git Bash, and it follows whichever of the 25 themes you are using.

**Manage dependencies.** Every package is listed with its installed, wanted and latest version:

| Colour | Meaning |
| --- | --- |
| 🔴 Red | A major version behind, or not installed |
| 🟡 Amber | A minor or patch version behind |
| ⚪ Grey | Up to date |

**Check for updates** re-reads the registry. **Update all (safe)** moves packages to the newest version allowed by the ranges already in `package.json`. **Update all to latest** crosses major versions and rewrites those ranges. Both show you exactly what will change before anything runs, and you can tick individual packages to update only those.

## Running it

```bash
npm install
npm run dev      # hot-reloading development window
```

```bash
npm run dist     # builds a Windows installer into release/
```

The packaged app loads its UI straight off disk via `file://`. Nothing binds a port and no local server runs — the only Node processes you'll see are the dev servers you start yourself.

## How it works

| Concern | Approach |
| --- | --- |
| Port discovery | `netstat -ano`, parsed for `LISTENING` rows |
| Process attribution | One `Get-CimInstance Win32_Process` query for names, command lines and parent PIDs |
| Matching a port to a project | Project path matched against the process command line, longest path first |
| Running npm | `node npm-cli.js <args>` spawned directly — **no shell**, so nothing in a folder name or script name can be interpreted as a command |
| Which Node | The `node.exe` on your `PATH`, not Electron's bundled copy, so nvm switches and engine constraints are respected |
| Stopping a server | `taskkill /T /F` on the process tree |
| The integrated terminal | A real ConPTY per session via node-pty, drawn with xterm.js; the shell is spawned with the project folder as its working directory, never sent a `cd` |

Dev servers started through the app **keep running when you close it**, and are picked back up on the next launch — closing a manager window is not a decision about the work behind it. When servers are running, closing the window asks whether to stop them first. Integrated terminals are the other way round: they close with the app, because a shell nobody can type into is not doing anything.

## Layout

```
src/
  main/        Electron main process
    toolchain.ts   locates node.exe and npm-cli.js
    scan.ts        port + process scanner
    servers.ts     spawns, tracks and kills dev servers
    packages.ts    npm ls / outdated / update
    projects.ts    package.json reading, script classification
    store.ts       project persistence
    terminal.ts    pty sessions for the integrated terminal
    ipc.ts         typed IPC surface
  preload/     contextBridge API (contextIsolation on, nodeIntegration off)
  renderer/    React UI
  shared/      types shared across all three
```

## Contributing

| Document | Purpose |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | Conventions, commands and codebase-specific rules |
| [`docs/STATUS.md`](docs/STATUS.md) | Current state, what's verified, what's pending |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why the architecture is the way it is |

Start with `docs/STATUS.md`. Check `docs/DECISIONS.md` before changing a core
mechanism — several obvious-looking improvements have already been ruled out for
concrete reasons.

## Requirements

Windows 10/11 and Node.js on your `PATH`. The app reports the Node and npm versions it found in the bottom-left corner.

## Licence

MIT
