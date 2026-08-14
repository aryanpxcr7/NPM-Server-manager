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

## 8. Quitting the app leaves its servers running

**Decided:** 2026-08-14. **Reversed the same day** — see below.

Closing the manager does not stop the dev servers it started. On quit the app
stops tailing their logs, writes out the run index, and exits. On next launch the
first port scan validates those records against live processes and reattaches, so
a surviving server reappears in the UI marked `reattached`, with its log history
replayed and streaming again.

**Originally decided the opposite:** that an app for cleaning up stray dev servers
should not leave its own processes behind, so `before-quit` killed every run.

That was wrong for how the tool is actually used. Closing a manager window is not
a statement about the work in progress behind it, and a dev server that dies
because you closed an unrelated window is a hostile surprise. Stopping a server is
already an explicit action with a button.

**This reversal is not a one-line change**, and the reason is worth keeping:
a child spawned with piped stdio **dies when the app exits anyway**, because its
next write hits a broken pipe. Measured — an attached child stopped 4 ticks after
the parent exited; detached-with-pipes survived only ~600 ms longer. Simply
deleting the quit handler would have produced servers that die unpredictably a
moment after close, which is worse than killing them deliberately. Survival
required the spawn changes in §10.

Servers *not* started by the app were never touched on quit and still are not.

---

## 9. Projects are stored as plain JSON, not `electron-store`

**Decided:** 2026-08-14.

`store.ts` writes `projects.json` in `app.getPath('userData')` via write-to-temp
then rename, so a crash mid-write cannot truncate the file. A corrupt file is
renamed aside rather than blocking startup.

The stored data is one small array. `electron-store` would add a dependency and ESM
interop friction for schema validation and migrations that are not needed yet.

---

## 10. Dev servers are spawned with an invisible console, logs written to a file

**Decided:** 2026-08-14. **Corrected the same day** — an earlier version of this
section said `detached: true` was required. It is not, and it caused a visible
terminal window to pop up on every server start.

```ts
spawn(nodeExe, [npmCli, 'run', script], {
  windowsHide: true,            // invisible console, inherited by npm's cmd.exe
  stdio: ['ignore', fd, fd]     // fd is an append handle on a log file
})
```

**Do not add `detached: true` here.** The two Windows creation flags behave very
differently for a child that itself spawns a console program:

| Flag | Console given to the child | npm's `cmd.exe` then... |
| --- | --- | --- |
| `windowsHide` → `CREATE_NO_WINDOW` | one that exists but is not shown | inherits it — nothing appears |
| `detached` → `DETACHED_PROCESS` | **none at all** | has to allocate a fresh **visible** one |

`npm run <script>` executes the script through `cmd.exe`. With `DETACHED_PROCESS`
that `cmd.exe` had no console to inherit, so Windows gave it a new visible one —
the terminal window that used to flash up. `windowsHide` cannot suppress it,
because Windows documents `CREATE_NO_WINDOW` as *ignored* when combined with
`DETACHED_PROCESS`.

**File-backed stdio is still required.** A child writing to a pipe dies as soon as
the app exits and it next writes to the now-broken pipe — roughly 600 ms of
survival, measured. Writing to a file removes that dependency entirely.

**Detached was never needed for survival.** Windows does not reap children when
their parent exits. Measured with Electron as the parent (a GUI process, which is
what makes this different from testing under `node.exe`):

| stdio | detached | Console popup | Survives app quit |
| --- | --- | --- | --- |
| pipe | no | none | **no** — broken pipe |
| pipe | yes | — | no |
| file | yes | **YES** | yes |
| **file** | **no** | **none** | **yes** ← shipped |

An earlier round of testing wrongly concluded that a non-detached child dies with
its parent. That was an artefact of the test harness killing the whole process
tree when its command finished, not Windows behaviour. **When testing process
lifetime, launch the parent so that nothing else can reap its tree** — e.g. via
`Start-Process` — or the result is meaningless.

Live output comes from **tailing the log file** (`main/logtail.ts`), polled rather
than `fs.watch`-ed, because `fs.watch` on Windows does not fire reliably for
appends to an already-open file. The tailer handles partial lines, CRLF,
multi-byte characters split across reads, and truncation.

**Accepted cost:** stdout and stderr share one file, so their interleaving is
preserved but the stream distinction is lost. Error lines are recognised by shape
instead, which only affects colouring. Separate files would recover the
distinction but scramble the ordering, which is the more useful property in a
server log.

**Consequence to be aware of:** the app no longer receives an `exit` event for
adopted runs, since it holds no child handle across sessions. Liveness for those
is polled in `reconcileRuns()`, which piggybacks on the port scanner's existing
process query.

---

## 11. Releases live in a separate public repo, checked over the plain GitHub API

**Decided:** 2026-08-14.

Installers are published to
[`aryanpxcr7/NPM-SM-Releases`](https://github.com/aryanpxcr7/NPM-SM-Releases)
rather than to the source repo, keeping ~80 MB binaries out of the code
repository's release history.

`main/updates.ts` calls `GET /repos/{repo}/releases/latest` **unauthenticated**.
That caps at 60 requests/hour/IP, which is ample for one check per launch plus
occasional manual ones, and means no token ships in the app.

**Why not `electron-updater`**, which is already a dependency? It wants a
`publish` block pointing at the repo that produced the build, expects a
`latest.yml` alongside the installer, and pulls in a differential-download and
signature-verification path that would need its own setup to be trustworthy. A
single JSON fetch, a version compare and a download is the whole requirement, and
it is fully testable outside Electron — which is how the version comparator got
13 test cases and the download got verified end to end.

`electron-updater` remains an unused dependency; see `docs/STATUS.md`. Adopting it
properly, or dropping it, is still open.

**Safety properties worth preserving:**

- Downloads are restricted to `github.com` / `githubusercontent.com` over HTTPS,
  checked in `ipc.ts` before anything is fetched.
- The asset filename is passed through `path.basename()`, so a crafted release
  cannot write outside the updates folder.
- Files download to `<name>.part` and are renamed only on completion, so an
  interrupted download is never mistaken for a finished one.
- A failed or rate-limited check resolves with an `error` field rather than
  throwing; the app carries on regardless.

**Version comparison is hand-rolled** (`isNewer`), for the same reason as §5.
It compares dotted numbers numerically — `0.10.0` beats `0.9.0`, which a string
compare gets wrong — and ranks a release above its own prerelease.

---

## 12. Closing the window asks what should happen to running servers

**Decided:** 2026-08-14, refining §8.

§8 made servers outlive the app unconditionally. That is right when you are
stepping away, but it removes the ability to shut everything down by closing the
window — and a manager whose own exit leaves processes you now have to hunt is
only half a tool.

Closing the window therefore asks, but **only when servers are actually running**:

- **Minimise to tray** — the window hides, servers keep running, the tray shows a
  live count. Optionally remembered for the rest of the session.
- **Quit and stop servers** — `stopAll()` kills every tree, then quits.
- **Quit, leave servers running** — the §8 behaviour; the run index is written so
  the next launch reattaches.

With no servers running the window just closes. That matters: a tool this
frequently opened must not prompt on every exit, and "are you sure" on a no-op is
exactly the kind of friction that makes people stop using something.

The remembered choice is deliberately **session-only**. Persisting "always
minimise" would need a settings screen to undo it, and a user who cannot find why
their app stopped closing is worse off than one who answers a dialog again
tomorrow.

**The tray icon exists whenever the app runs**, not only while hidden, so the
running-server count is glanceable and the app can be reopened after minimising.

---

## 13. Icons are generated, not committed as binaries

**Decided:** 2026-08-14.

`scripts/make-icons.mjs` renders `build/icon.ico`, `icon.png` and `tray.png` from
code — a rounded gradient tile with a bolt glyph, matching the in-app brand mark.
Run with `npm run icons`.

It is about 150 lines of pixel maths plus a hand-rolled PNG/ICO encoder over
`node:zlib`, which is less than an image-processing dependency would cost and
keeps the artwork reviewable in a diff. The generated files are committed so a
plain `npm run dist` works without regenerating them.

Changing the artwork means editing the gradient stops or the `BOLT` polygon and
re-running the script.
