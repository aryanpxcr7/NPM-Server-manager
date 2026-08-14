# Design decisions

Why the architecture looks the way it does. Several of these rule out changes that
look like obvious improvements — read the reasoning before reversing one.

---

## 1. Electron rather than Tauri, C# or Python

**Decided:** 2026-08-14, at project start.

The app's entire job is Node tooling. Every feature maps onto something Node does
natively: `npm outdated --json` produces exactly the red/amber/green data the table
needs, `child_process.spawn` runs the dev servers, `npm ls --depth=0 --json` lists
installed packages.

A Rust or C# backend would shell out to `npm` for all of the same work while adding
a language boundary and a toolchain that was not installed on the target machine
(no Rust, no .NET SDK were present). The smaller binary would buy nothing in
leverage.

**Cost accepted:** ~79 MB installer, ~271 MB unpacked, and Chromium-level idle RAM.
Judged worth it for a developer tool that is not memory-constrained.

**A concern raised and resolved:** whether Electron means running a server to launch
the app. It does not. The Vite dev server exists only during `npm run dev`; the
packaged app calls `mainWindow.loadFile()` and loads static files over `file://`.
Nothing binds a port. This matters more than usual here, because an app whose
purpose is finding stray servers should not be one.

---

## 2. npm is spawned as `node npm-cli.js`, never through a shell

**Decided:** 2026-08-14. **This is the most important decision in the codebase.**

`main/toolchain.ts` locates the user's `node.exe` on `PATH`, then finds
`npm-cli.js` beside it, and spawns `node npm-cli.js run <script>` with `shell: false`.

Three reasons, in order of importance:

**Security.** Project paths and script names come off the filesystem. With
`shell: true`, a folder named `my app & calc` becomes a command separator. With
argv passed straight to `CreateProcess`, it is just a folder name. There is no
escaping to get wrong.

**Node version fidelity.** Electron bundles its own Node. Running project scripts
under it would ignore nvm switches and `engines` constraints, and break native
addons compiled against a different ABI. Using the `node.exe` on `PATH` gives
projects the runtime the developer actually chose.

**Correctness on modern Node.** Since the CVE-2024-27980 fix, Node refuses to spawn
`.cmd` files without `shell: true` — so `npm.cmd` would have forced the shell back
on. Going through `npm-cli.js` sidesteps the problem entirely.

**Do not "simplify" this to `spawn('npm', ...)` with `shell: true`.**

A fallback path for when `npm-cli.js` cannot be found is a reasonable future
addition; it must validate script names against the keys actually present in
`package.json` before letting anything near a shell.

---

## 3. `netstat` + one CIM query, not `Get-NetTCPConnection`

**Decided:** 2026-08-14.

Port discovery runs on a 4-second poll while the window is visible, so startup cost
dominates. `netstat -ano` starts in milliseconds and needs no elevation;
`Get-NetTCPConnection` pays PowerShell startup (~300–700 ms) every time.

Process metadata is a separate concern and comes from a single
`Get-CimInstance Win32_Process` call that returns names, command lines and parent
PIDs for everything at once. Command lines are what make it possible to attribute a
port to a project folder, and parent PIDs are what let a grandchild of npm be
traced back to the run that started it.

CIM can be blocked by policy, so `scan.ts` falls back to `tasklist /FO CSV`, losing
command lines but keeping the app functional.

**Verified:** 19/19 listening PIDs resolved to named processes; 336 processes
returned, 179 with command lines.

---

## 4. Two distinct update modes

**Decided:** 2026-08-14.

"Update all" is ambiguous, and the two meanings have very different consequences:

- **Update all (safe)** → `npm update <pkgs>` → moves to *wanted*, staying inside
  the semver ranges already in `package.json`. Non-breaking by construction.
- **Update all to latest** → `npm install pkg@latest` → moves to *latest*, crossing
  major versions and **rewriting the ranges in `package.json`**.

Collapsing these into one button would either leave majors permanently stuck or
silently rewrite the manifest. Both modes show the full `from → to` list in a
confirmation dialog before anything runs.

This is also why the table has separate *Wanted* and *Latest* columns — they are
frequently different, and the difference is what tells you whether an update is
routine or risky.

---

## 5. A hand-rolled semver comparator instead of the `semver` package

**Decided:** 2026-08-14.

`packages.ts` needs exactly one thing: given two versions, report whether they
differ in major, minor or patch. That is ~10 lines. The `semver` package is a
dependency, a supply-chain surface and an update burden for a function this small.

Non-semver and prerelease versions fall through to a `wanted !== current` check and
are reported as `unknown` rather than guessed at.

Revisit if range *satisfaction* logic is ever needed — that is genuinely hard and
worth a dependency.

---

## 6. Renderer never imports from `src/preload/`

**Decided:** 2026-08-14, after TS6307 during the first typecheck.

The `NsmApi` interface lives in `src/shared/api.ts`, which imports no Electron
types. The preload script implements it; the renderer types `window.nsm` against
it. Neither program's tsconfig includes the other's sources.

Importing the preload module from the renderer drags Electron types into a program
that must not have Node access, and the two tsconfigs immediately conflict.

---

## 7. The main process owns run state; the renderer mirrors it

**Decided:** 2026-08-14.

`servers.ts` holds the authoritative registry of managed runs, plus a 2000-line ring
buffer of output per run. The renderer keeps its own copy fed by `servers:log-line`
and `servers:run-changed` events, with a matching cap so a chatty dev server cannot
grow renderer memory without bound.

Consequence: log history is lost if the renderer reloads, even though the main
process still has it. `servers.log(runId)` exists to fix this but is not yet called
— see `docs/STATUS.md` gap #3.

---

## 8. Quitting the app stops every server it started

**Decided:** 2026-08-14.

`before-quit` is intercepted, `stopAll()` kills every live run's process tree, and
only then does the app quit.

An app whose purpose is cleaning up stray dev servers must not leave its own
processes bound to ports on exit. Servers *not* started by the app are left alone —
the user started those deliberately somewhere else.

---

## 9. Projects are stored as plain JSON, not `electron-store`

**Decided:** 2026-08-14.

`store.ts` writes `projects.json` in `app.getPath('userData')` via write-to-temp
then rename, so a crash mid-write cannot truncate the file. A corrupt file is
renamed aside rather than blocking startup.

The stored data is one small array. `electron-store` would add a dependency and ESM
interop friction for schema validation and migrations that are not needed yet.
