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

---

## 14. A failed update check is reported, not swallowed

**Decided:** 2026-08-14, after it bit us.

`checkForUpdate()` originally treated a 404 from `/releases/latest` as "no
releases published yet" and returned quietly. When the releases repo was briefly
made private, every client got a 404 and was told **"you're up to date"** — the
worst possible way to be wrong, because nothing looks broken.

A 404 is now surfaced as an error. It is technically ambiguous — an empty repo
returns the same thing — but this app always has releases published, so in
practice a 404 means the repo is private, renamed or gone, and that is worth
saying out loud.

The general rule: **the updater may fail quietly on the network, never on
configuration.** A missing connection is the user's problem and self-correcting;
a repo that cannot be read is our problem and permanent.

`NPM-SM-Releases` must remain **public** for this reason. The source repo is
private and can stay that way.

---

## 15. Packaging verifies that `out/` is not stale

**Decided:** 2026-08-14, after shipping a release without its headline feature.

`npm run dist` runs `build`, then `verify-build`, then `electron-builder` — and
the first separator is a **semicolon, not `&&`**:

```
"dist": "npm run build; npm run verify-build && electron-builder --win"
```

`scripts/verify-build.mjs` fails if any file in `src/` is newer than the oldest
file in `out/`, or if the expected entry points are missing.

**What went wrong.** v0.2.0 was published with release notes describing in-app
update checking. The installer did not contain it. The build command was:

```
rm -rf release-new && npm run build && electron-builder ...
```

The `rm` failed on a locked file (another app held a handle on the previous
`app.asar`), `&&` short-circuited past **both** the build and the packaging, and a
later bare `electron-builder` invocation packaged the stale `out/` under the
already-bumped version number. Every step "succeeded"; the binary was simply from
before the feature existed.

**Two lessons, both encoded above:**

1. A cleanup step failing must never silently skip the build. Chain cleanup with
   `;`, and only chain *verification* with `&&`.
2. A version number is a claim about contents, and nothing was checking it. The
   mtime comparison is crude but it catches the whole class of "packaged the wrong
   thing" without needing a list of expected features to maintain.

A packaged asar can also be checked directly — it is a plain file, so
`fs.readFileSync(asar).includes(Buffer.from('some-marker'))` is enough to confirm
a feature made it in. That is what diagnosed this.

---

## 16. Never attach a `'data'` listener to a stream you are about to pipe

**Decided:** 2026-08-14, after shipping a corrupt installer.

`downloadUpdate()` reported progress like this:

```ts
const source = Readable.fromWeb(response.body)
source.on('data', (c) => onProgress(received += c.length, total))  // WRONG
await pipeline(source, createWriteStream(partial))
```

Attaching `'data'` switches a stream into flowing mode immediately. `pipeline`
then attaches its own consumer, and chunks already buffered can be re-delivered.
The result was an installer of **exactly the right size** with a 16 KB chunk
duplicated and everything after it shifted — 4.67% of the file wrong. NSIS
rejected it with "Installer integrity check has failed", which reads like a
network problem and is not.

Progress is now counted by a `Transform` inside the pipeline:

```ts
const counter = new Transform({
  transform(chunk, _enc, cb) { onProgress(received += chunk.length, total); cb(null, chunk) }
})
await pipeline(source, counter, createWriteStream(partial))
```

**The wider lesson: size is not integrity.** The corrupt file passed every check
in place at the time. Downloads are now verified on size, Windows executable
header, and SHA-256 against a `SHA256SUMS.txt` asset published with each release.
A file failing any check is deleted rather than launched, and the cached-download
reuse path runs the same verification — it previously accepted any file of the
right length.

Publishing `SHA256SUMS.txt` is therefore **part of the release procedure**, not
optional. A release without it degrades to the structural checks only.

---

## 17. Retiring a version is a server-side decision, published with the release

**Decided:** 2026-08-14.

Two mechanisms, because "stop people using old versions" has two halves:

**Stopping downloads.** Installers for retired versions are deleted from their
GitHub release; the notes stay, carrying a caution explaining why. History is
preserved, the binary is not.

**Stopping use.** Each release publishes `update-policy.json`:

```json
{ "minimumVersion": "0.3.2" }
```

The updater reads it and sets `mandatory` when the running build is below the
floor. The prompt then has no *Later* and no close button.

**The floor lives with the release, not in the app.** A version can only be
retired *after* it is already installed on someone's machine — which is exactly
when a compile-time constant is useless. Publishing the floor means the decision
can be made retroactively, which is the only time it is ever needed.

**A retired version is nagged, not disabled.** It was tempting to refuse to run,
since 0.3.0 and 0.3.1 cannot even update themselves correctly. But this is a local
development tool, and its own update check depends on reaching GitHub. Bricking
someone's server manager because their network is down — or because the releases
repo moved — would be a worse failure than the one being prevented. The banner is
unmissable and permanent; that is enough.

**Why 0.3.2 is the floor:** it is the first release whose downloader produces a
correct file. 0.2.0 shipped with no updater at all, and 0.3.0/0.3.1 silently
corrupted what they downloaded, so every earlier build is unable to repair itself.

---

## 18. Themes are eighteen custom properties, everything else is `color-mix()`

`src/renderer/src/lib/themes.ts` holds one object per theme: eighteen colours,
written onto `<html>` as inline custom properties by `applyTheme()`. Inline
properties beat the `:root` rule in `styles.css`, so that rule keeps the default
theme and every *derived* colour.

**The derivations are the point.** Before this, the stylesheet contained twenty-odd
literals like `rgba(76, 141, 255, 0.25)` — the accent at 25% — scattered through
badge fills, hover tints and outlines. Those are now
`color-mix(in srgb, var(--accent) 25%, transparent)`. A theme therefore ships no
CSS at all: add an entry to the array and the whole UI follows, including the
stderr colour (`--red` mixed toward `--text`, so it lightens on dark themes and
darkens on light ones) and the scrollbar hover.

Chromium 130 is the floor for `color-mix()` and Electron 33 ships 130, so there is
no fallback path and none is needed.

**Three things are not in the palette** and are set by `applyTheme()` from the
theme's `dark` flag: the modal scrim, the drop shadows and `color-scheme`. A scrim
tuned for a dark UI is a black smear over a light one, and without `color-scheme`
Chromium draws dark form controls on a light theme.

**Why `localStorage` and not the main-process store.** Settings are pure renderer
preference, and `localStorage` is already scoped to the data directory — so a
`npm run dev` run keeps its own theme, exactly as it keeps its own project list.
Putting them in `store.ts` would have meant an IPC round trip before the first
paint, and a flash of the default theme on every launch.

**Palettes are checked, not eyeballed.** `npm run check:themes` bundles the module
and measures the contrast of every pair the UI actually renders. Each palette is
transcribed by hand from a published theme, and one wrong digit produces text
nobody can read; Ayu Light's own accent (`#fa8d3e`, 2.3:1 on its background) was
caught this way and darkened.

---

## 19. The integrated terminal is a real pseudoterminal, not a piped shell

**Decided:** 2026-08-14.

`main/terminal.ts` starts each session with **node-pty over ConPTY** and draws it
in the renderer with **xterm.js**.

**Why not `spawn('powershell.exe')` with pipes**, which would have added no
dependency at all? Because a shell asks the OS whether it is talking to a
terminal, and behaves completely differently when the answer is no: no prompt
redraw, no colour, no arrow keys, no history, no Ctrl+C, and anything that draws a
progress bar or a spinner — `npm install`, `vite`, `next dev` — emits either
nothing or a wall of escape codes. A pipe gives you a command runner. The point of
this feature is a terminal.

**Why `@lydell/node-pty` rather than `node-pty` itself.** Both are the same code;
the fork ships **only the current platform's prebuilt binary** and never falls back
to node-gyp. Upstream carries prebuilds for six platforms plus winpty, which
electron-builder would pack into a Windows-only installer. The binaries are
Node-API, so they load in Electron with no rebuild step — verified by loading the
module under this project's Electron and driving a real ConPTY before any of this
was built on top of it.

**The shell rule in `CLAUDE.md` still stands, and this is not an exception to it.**
§2 forbids running *npm* through a shell because project paths and script names
come off the filesystem and must never be parsed as commands. Here the shell is
the product: the user picks it and types into it. What matters is that **nothing
the app derives goes into it** — the only thing this app ever writes to a pty is
the user's own keystrokes and a clipboard paste they asked for. The folder to
start in is passed as `cwd` in the spawn options, never as a `cd` command, so a
project called `my app & calc` is a directory name and not two commands.

**Terminals die with the app; servers do not.** §8 makes dev servers outlive the
window because closing a manager is not a statement about the work behind it. A
terminal is the opposite: it is a window into a shell, and a shell nobody can type
into is not doing anything useful — it is just a process holding a folder open.
`before-quit` closes every session. `pty.kill()` goes through ConPTY's console
process list, which covers the whole tree (measured at ~145 ms including a
grandchild `node`); `taskkill /T /F` remains as a two-second backstop, because the
one failure that matters is a shell that will not die.

**The session lives in the main process, the panel only draws it.** Same shape as
§7: `terminal.ts` keeps 256 KB of scrollback per session, and the panel asks for it
on mount. That is what makes switching to the Logs tab, closing the dock or
reloading the renderer harmless — the shell keeps running and the panel redraws
from the buffer. Live output arriving *during* that request is held in a queue and
merged by a per-session chunk counter, so nothing is printed twice and nothing is
dropped.

**xterm gets a palette, not a stylesheet.** It paints to a canvas and cannot read
CSS custom properties, so `lib/terminal-theme.ts` is the one place a colour is
computed in TypeScript. It follows §18's rule anyway: every value comes out of the
eighteen tokens, and the bright ANSI colours are mixed *towards the theme's own
text colour* rather than towards white — which is what makes them read correctly
on the seven light themes instead of vanishing.

**Ctrl is the shell's, with one exception.** While a terminal has focus the app's
shortcut handler stands down completely: Ctrl+L clears the screen, Ctrl+R searches
history, Ctrl+C interrupts. Only the combo that toggles the panel (Ctrl+` by
default) is intercepted, because a panel you cannot close from the keyboard is a
trap. Ctrl+C copies instead of interrupting when — and only when — there is a
selection, which is what every Windows terminal does.

---

## 20. An external server is restarted by re-running its script, not by replaying its command line

**Decided:** 2026-08-14.

Servers this app did not start have always been stoppable — `taskkill /T /F` needs
nothing but a pid. Restarting them needs to know *what to run again*, and there
were two ways to find out.

**Rejected: re-run the command line we found.** The process table hands us the
exact command line, so restarting looks like a matter of replaying it. It is not.
Reconstructing argv from a Windows command-line string is the quoting problem in
reverse, and getting it wrong on a path like `C:\Program Files\…` means running
something other than what was there before. It would also need the working
directory, which is only ever *guessed* (`guessCwd`), and would reproduce the same
unmanaged, unlogged process we started with.

**Chosen: recover the npm script and start it as a managed run.** `scan.ts` walks
up the process tree from the port holder looking for `npm-cli.js run <script>` — a
dev server is typically a grandchild (npm → cmd.exe → vite), so the listening
process's own command line says nothing. With a script name and a project match,
restarting is exactly `stopServer` + `startServer`, code that already exists and
is already trusted with paths.

The result is deliberately better than a restart: the server comes back **owned by
the app**, with streaming logs, a stop button and a run record that survives a
relaunch. The button says *Restart here* rather than *Restart* for that reason.

**The recovered name is validated before it runs.** It came off a process listing,
which is not a trusted source, so `restartExternal` checks it against the keys in
the project's own `package.json` and refuses if it is not there. This is the same
principle as §2: never let a string from outside reach an execution path
unchecked, even when there is no shell involved.

**Only npm is recognised, and that is a real limitation, not an oversight.** Yarn
and pnpm servers are detected and stoppable, but not restartable, because this app
runs npm unconditionally (`docs/STATUS.md` gap #1) and restarting a pnpm project
with npm can rewrite its lockfile state. A greyed-out button is a much smaller
problem than that. Fixing gap #1 is what would unlock it.

**The whole tree goes, not just the port holder.** Killing the listening process
with `/T` was measured to take its `cmd.exe` shim and the npm parent with it — all
three were gone afterwards — so there is no orphaned npm left behind. The new run
then waits for the old pid to actually disappear before starting, because
otherwise the replacement races the old process for the port and dies on
`EADDRINUSE` in a way that looks like the app's fault.
