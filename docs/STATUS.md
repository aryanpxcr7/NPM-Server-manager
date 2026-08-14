# Project status

**Last updated:** 2026-08-14
**Version:** 0.3.6 (plus an unreleased integrated terminal on `main`)
**Source:** https://github.com/aryanpxcr7/NPM-Server-manager
**Releases:** https://github.com/aryanpxcr7/NPM-SM-Releases  (installers are published here, not to the source repo)

Keep this file current. When you finish a work session, update the date, move
items between sections, and record anything you verified or discovered.

**Commit and push every time.** Standing instruction from the repo owner — finished
work should not sit unpushed waiting for confirmation. Git Credential Manager is
configured and `git push` works non-interactively; the `gh` CLI is *not*
authenticated, so use plain git. This covers ordinary commits to `main`, not
force-pushes or history rewrites.

---

## Where things stand

The app is feature-complete for the original brief and runs. It builds, typechecks
and packages into a working Windows installer, and is published to the GitHub repo
above.

Most recent changes: dev servers now **outlive the app** rather than being killed
on quit (reversed `docs/DECISIONS.md` §8; read §10 before touching `servers.ts`),
and the app **checks for its own updates** against the releases repo.

0.3.6 added the **settings dialog** (25 themes, behaviour, rebindable shortcuts),
**keyboard shortcuts**, **open in browser when ready** on the Start Server dialog,
and **Ctrl+click links** in the log panel.

Unreleased on `main`: an **integrated terminal** (real ConPTY through node-pty,
drawn with xterm.js) in a resizable bottom dock that now has two tabs, *Logs* and
*Terminal*. Verified end to end against a running app — see the table below and
`docs/DECISIONS.md` §19. **This has not been released yet:** `package.json` is
still 0.3.6, and cutting 0.3.7 means following the release procedure below.

Published: **v0.1.0** (history only), **v0.2.0** (defective — see below),
**v0.3.0**, **v0.3.1**, **v0.3.2**, **v0.3.3**, **v0.3.4**, **v0.3.5**,
**v0.3.6** (current).

**Releases before 0.3.2 are retired** — installers deleted, notes annotated, and
`update-policy.json` sets a minimum supported version of 0.3.2 so those builds get
an undismissable update prompt. See `docs/DECISIONS.md` §17.

**Versioning: step by patch from here** (0.3.2, 0.3.3, …) unless something
genuinely warrants a minor bump. The 0.1 → 0.2 → 0.3 run was too coarse for
changes of this size.

> **v0.2.0's installer does not contain the update checker its notes describe.**
> It was packaged from a stale `out/` after a broken shell chain skipped the build
> step. The release notes now carry a warning. `npm run dist` gained a
> `verify-build` guard so this cannot recur — see `docs/DECISIONS.md` §15.

**Repo visibility matters and is easy to get wrong.** The source repo
`NPM-Server-manager` is **private**; the releases repo `NPM-SM-Releases` must stay
**public**, because the updater reads the GitHub API unauthenticated and the
installer is downloaded anonymously. It was briefly switched to private on
2026-08-14, which made the updater report "you're up to date" to everyone. Do not
ship a token to work around this — it would hand every user access to the repo.

---

## Releasing

1. Update `CHANGELOG.md` with the new version.
2. Bump `version` in `package.json`.
3. `npm run build`, then run `electron-builder --win` with
   `--config.directories.output=<dir>`.
4. Create the GitHub release on `aryanpxcr7/NPM-SM-Releases` and attach the
   `.exe`, its `.blockmap`, **`SHA256SUMS.txt` and `update-policy.json`** (the updater verifies against
   it; see `docs/DECISIONS.md` §16). Tag as `vX.Y.Z`; the updater strips the leading `v`.
5. Push the source repo.

**Build output must go outside the project folder.** Something on this machine
(the `Orca` app, per the Windows Restart Manager) holds a handle on
`release/win-unpacked/resources/app.asar` and blocks electron-builder from
cleaning it up. `release*/` is gitignored, so an absolute path into a temp
directory works fine.

**Tag naming matters.** `updates.ts` reads `tag_name`, strips a leading `v`, and
compares numerically. A tag that does not parse as `X.Y.Z` is treated as *not
newer*, so the update silently never offers — do not get creative here.

GitHub rewrites spaces in asset filenames to dots, so the uploaded installer is
`NPM.Server.Manager-X.Y.Z-Setup.exe`. The updater uses the API's
`browser_download_url`, so this does not matter, but do not hardcode the name.

---

## Verified working

Each of these was checked against real data, not assumed:

| Area | Evidence |
| --- | --- |
| Toolchain detection | Resolved `C:\Program Files\nodejs\node.exe` and npm-cli.js; reported node v24.18.0 / npm 11.16.0 |
| `netstat` parsing | 19 listening entries parsed, 19/19 resolved to a named process |
| `Win32_Process` query | 336 processes returned, 179 with command lines |
| `npm ls --json` | Parsed 13 installed deps on this repo |
| `npm outdated --json` | Parsed 8 outdated packages; exit code 1 correctly treated as success |
| Port → server detection | Servers count went 0 → 2 when Node servers began listening |
| Start Server → live logs | `next dev --turbopack` started, output streamed into the log panel |
| Severity colouring | `@types/node` 20.19→26.2 red *Major*; `@base-ui/react` 1.6→1.7 amber *Minor*; wanted vs latest correctly distinguished for `next` |
| Installer packaging | `release/NPM Server Manager-0.1.0-Setup.exe`, 79 MB (271 MB unpacked) |
| Servers outlive the app | A real `npm run dev` kept its port bound and kept logging after the manager exited; HTTP still answered |
| Reattach on next launch | Seeded run record adopted on startup, shown as `reattached`, log history replayed |
| Update check | Live against the published repo: as 0.1.0 it offers 0.2.0; as 0.2.0 it reports up to date |
| Update download | Real 78.3 MB installer fetched in 15.5 s, byte size matched the release asset exactly, file verified as a Windows PE binary |
| Stale-build guard | `verify-build` exits 1 when a source file is newer than the bundle, 0 after a rebuild |
| Updater against a private repo | Reproduced the silent failure, then confirmed anonymous 200 + downloadable asset once public |
| Version comparator | 13/13 cases incl. `0.10.0 > 0.9.0`, prerelease ordering, and unparseable input |
| `LogTailer` | 8/8 assertions against the real module: live appends, partial lines, CRLF, multi-byte split across reads, truncation resync, flush on stop |
| The UI, driven for real | An Electron window loading the renderer with a stubbed `window.nsm`, driven by `webContents.sendInputEvent` (real mouse and key events, not synthetic ones): the settings dialog opens on Ctrl+, 25 theme cards render, clicking Gruvbox Dark repaints the window and persists, the Shortcuts tab records a real Ctrl+Alt+K, and the rebound combo dispatches while the old one no longer does. Ctrl+T/Ctrl+E/Ctrl+/ all reach their handlers |
| Reset is scoped to its tab | Same harness: pick Gruvbox Dark → rebind a shortcut → reset from the Shortcuts tab. Bindings clear, the theme is untouched (both stored and live), and the button disables itself. From Appearance the same button reads *Reset theme* and resets only that |
| Shortcut binding logic | 30/30 assertions against the real `lib/shortcuts.ts` and `lib/settings.ts` (esbuild → node, with a localStorage stub): combo validation, override resolution, the combo→id lookup, key-chip labels, round-tripping through storage, and coercion of stored bindings that are invalid, duplicated, unknown, or for a shortcut that has since become fixed |
| Theme palettes | `npm run check:themes` measures all 25 against the pairs the UI actually renders (body/dim/faint text on the background, button label on the accent, accent on the background) and the dark/light flag against the background's luminance: 25/25 pass. Ayu Light needed its accent darkened — the published `#fa8d3e` is 2.3:1 on its own background |
| The 0.3.6 release itself | Anonymous check of what a user's app sees: `releases/latest` returns tag `v0.3.6`, not a draft, with all four assets. The installer downloaded anonymously is 82,130,032 bytes, starts `MZ`, and its SHA-256 matches the published `SHA256SUMS.txt`. Before upload, the packaged `app.asar` was grepped for markers of all four of the day's changes, so it cannot be a stale bundle like v0.2.0 |
| node-pty under this Electron | Loaded `@lydell/node-pty` in Electron 33, spawned a real ConPTY, wrote `echo`, got the output back, and killed it. Kill behaviour measured both ways: `pty.kill()` took 145 ms and took a grandchild `node` with it; `taskkill /T /F` took 1.1 s for the same result. This was checked *before* anything was built on it |
| The integrated terminal, driven for real | 28 checks over three passes against the built app, driven over CDP with real key events (`Input.dispatchKeyEvent`), reading back the text on screen. Pass 1 (12): the panel opens a session by itself, PowerShell draws its prompt, typing `echo NSM-PROBE-4242` comes back echoed, output survives switching to Logs and back, the + button opens a second terminal, closing one tab leaves the other running, and Ctrl+` hides and restores the dock *from inside the shell*. Pass 2 (9): opened from a project's toolbar, the session's cwd is the project folder, the prompt shows it, `node -e "console.log(process.cwd())"` prints `…\VibeCoding Projects\NPM Server manager` — a path with a space, which has broken this codebase before — and typing `exit` marks the tab exited and says so on screen. Pass 3 (7): three shells detected, the picker offers them, and a Git Bash session opens and draws its MINGW64 prompt |
| Control over external servers | 21 checks against a fixture started the way a user's terminal starts one (`Start-Process` → `npm run dev`, in a folder whose name contains a space), driven over CDP. The port holder is detected, its `dev` script is recovered by walking npm → cmd.exe → node, it is *not* restartable until the folder is registered as a project and is immediately afterwards, it appears as a chip on the project page, and the Start dialog greys out the script it is already running. *Restart here* stopped pid 16544 and brought the server back on the same port as managed pid 37028 with its output captured; the old tree — node, its `cmd.exe` shim and the npm parent — was entirely gone. Stopping one from the project page freed the port and removed the chip |
| Terminals do not outlive the app | Both driven runs ended with a graceful quit; every shell pid was gone afterwards, with no stray `powershell`/`cmd`/`bash` left behind |
| Log link parser | 13/13 cases through the real `lib/links.ts` (esbuild → node): Vite/Next banners, bare `localhost:8080`, trailing `.` and `)`, ANSI-wrapped URLs, `0.0.0.0` → `localhost`, `[::1]`, two URLs on one line, and non-loopback links correctly *not* auto-opened |

---

## Not yet verified

- **Port-based run adoption (added 2026-08-14, unverified end to end).** The
  earlier pid-based scheme provably could not work: the recorded pid is npm's,
  and npm dies when the app closes while the server it spawned — a grandchild —
  keeps the port. Confirmed by observation: recorded pid 21528 was gone while the
  server ran as pid 22736 with all its ancestors dead. Adoption now keys on the
  ports a run was last seen holding. The logic typechecks and the reasoning is
  sound, but the two-phase test harness hung before producing a result, so
  **treat this as unproven** until a start → quit → relaunch cycle is watched by
  hand.
- **The simplified quit dialog, the run chip's stop/restart buttons, and the
  folder button on external server rows** — all typecheck, none clicked.
- **How the themes actually *look*.** All 25 are measured for contrast and one
  (Gruvbox Dark) has been seen applied, but nobody has looked at the other 24.
  The `color-mix` derivations under a *light* theme are the least-exercised part,
  since every hardcoded `rgba()` fill was replaced by a mix over the palette.
- **`Esc` during a recording.** The capture-phase listener has to swallow it
  before `Modal` sees it, or cancelling a rebind closes the whole dialog. Reasoned
  through, never pressed.
- **"Open in browser when ready" and Ctrl+click in the log (added 2026-08-14).**
  The URL parser underneath is tested (see above) and the app builds, but neither
  the checkbox nor a Ctrl+click has been exercised in a running window. The
  wiring to verify: the log fast path (`firstServerUrl` in `App.tsx`'s `onLog`),
  the port fallback (the effect over `runs`), and the 90 s give-up toast.

- **Terminal paths not covered by the three driven passes:** dragging the dock's
  resize handle (the height *setting* round-trips, the drag itself was never
  performed), the terminal font-size buttons in Settings, copy and paste
  (`Ctrl+C`/`Ctrl+V`/right-click through the Electron clipboard), PowerShell 7 —
  `pwsh.exe` is not installed on this machine, so only its `existsSync` lookup is
  exercised — and the 16-session cap.
- **The terminal in a packaged build.** It works from `out/`, but the native
  binary has to be *outside* the asar; `electron-builder.yml` now unpacks
  `node_modules/@lydell/**` for that reason. Nobody has run `npm run dist` since,
  so confirm a terminal opens in the installed copy before publishing 0.3.7.

These paths exist and typecheck but have never been executed. Do not describe them
as working.

- **The update write path.** `npm update` / `npm install pkg@latest` has never
  actually run. Scan → plan → preview dialog is verified; pressing the final
  confirm button is not. Testing this mutates a real project's `node_modules`, so
  it needs either a throwaway fixture project or the user's go-ahead.
- **Stop / restart of a *managed* run via its own buttons.** The external server's
  stop chip and *Restart here* have now been clicked for real (see the table
  above), and stopping a managed run has been driven through the IPC, but the
  managed run's own stop and restart buttons still have not been pressed.
- **`npm install` button** shown when `node_modules` is missing.
- **Multi-port servers**, and the `+N more ports` badge.
- **The corrupt-store recovery path** in `store.ts` (renaming a bad
  `projects.json` and starting fresh).

---

## Known gaps

Confirmed by grep on 2026-08-14 — these are real, not speculative.

### 1. Yarn and pnpm projects silently get npm commands
`detectPackageManager()` reads the lockfile and stores `packageManager` on every
project, but **nothing ever reads that field.** `runNpm()` is used unconditionally.
Running "Update all" on a pnpm project will use npm and can corrupt the lockfile
state.

Either honour the field or remove it — the current half-implementation is worse
than either. This is the most user-visible gap.

It is also what keeps *Restart here* off yarn and pnpm servers: they are detected
and stoppable, but only an `npm run <script>` ancestor makes one restartable, since
restarting means running the script again and this app would run it with npm. See
`docs/DECISIONS.md` §20.

### 2. `electron-updater` is an unused dependency
Still listed in `dependencies`, still never imported. Update checking was built
directly on the GitHub API instead -- see `docs/DECISIONS.md` §11 for why. The
dependency should now simply be **dropped**, unless differential downloads or
signature verification are wanted later.

### 3. Dead IPC surface
Wired end-to-end but never called from the renderer:
- `servers.log(runId)` — the renderer accumulates logs from live events instead,
  so log history is lost if the renderer reloads while main still has it
- `projects.rename(id, name)` — no rename UI exists
- `projects.add(dir)` — the renderer only uses `projects.pick()`

### 4. No app icon
`electron-builder` logs "default Electron icon is used". Needs a 256×256 `.ico` at
`build/icon.ico`.

### 5. Installer is unsigned
SmartScreen warns on first install. Requires a code-signing certificate.

### 6. No tests
`npm run typecheck` is the only gate. The highest-value targets, in order:
`guessCwd()` path parsing, `semverDiff()` / `severityOf()`, and the `netstat`
line parser — all are pure functions over string input and easy to test.

---

## Ideas not yet committed to

Not promised to anyone; think before building.

- System tray icon with running-server count, and minimise-to-tray
- Using the URL a dev server prints (now parsed by `renderer/src/lib/links.ts` for
  the log links and the open-on-start option) as the server's address everywhere,
  instead of inferring `localhost:<port>` from the port table
- Per-project environment variable overrides
- Remembering window size and position
- A "kill everything on port N" action for stuck ports
- Workspace/monorepo support (`npm outdated` returns arrays per package in
  workspaces; `packages.ts` currently takes `[0]` and ignores the rest)

---

## Behaviour worth knowing

**Closing the app does not stop its dev servers** (changed 2026-08-14 at the owner's
request; see `docs/DECISIONS.md` §8 and §10). They keep running and are reattached
on next launch. Consequences:

- A server can outlive several app sessions. `runs.json` in `userData` is the index
  used to find them again; `userData/logs/<runId>.log` holds their output.
- Log files are never pruned. A long-lived chatty server will grow one
  indefinitely. Worth adding a size cap or a cleanup of logs for finished runs.
- Adoption guards against PID reuse by requiring the process to still be node/bun/deno
  running `npm-cli.js` with the same script. A process that fails the check is
  simply not adopted; it will still appear as an *external* server.
- If npm exits but its child keeps the port, the run retires while the port stays
  bound. The scanner then shows it as external — still stoppable, and restartable
  too as long as the `npm run <script>` that produced it is still visible somewhere
  in the process tree. See `docs/DECISIONS.md` §20.

---

**Integrated terminals do the opposite: they close when the app quits.** A shell
nobody can type into is not work in progress, it is a process holding a folder
open, so `before-quit` ends every session. Consequences worth knowing:

- Something long-running started *in a terminal* (a build, a watch) dies with the
  window, and the quit dialog does not mention it — that dialog is still gated on
  dev servers only. Start anything you want to survive as a server, not a terminal.
- Terminal scrollback is memory only, capped at 256 KB per session. It is not
  written to disk the way server logs are, and it does not survive a quit.

---

## Bugs found and fixed

**Path regex broke on spaces** (fixed 2026-08-14, in the initial commit).
`guessCwd()` used `[A-Za-z]:\\[^"'\s]+`, which truncated
`"C:\Program Files\nodejs\node.exe"` to `C:\Program`. This broke project matching
for any path containing a space — including the developer's own
`VibeCoding Projects` folder. Now matches quoted arguments as a whole and skips
the interpreter's own path in argv[0].

Regression guard: a dev server running from a spaced project path must still match
its project. There is no automated test for this yet — see gap #6.

**"Reset to defaults" reset everything from every tab** (fixed 2026-08-14, before
release). One global reset button in the footer of a tabbed dialog reads as
"reset this tab": pressing it from the Shortcuts tab threw away the user's theme.
It is now scoped — *Reset theme* / *Reset behaviour* / *Reset shortcuts*, disabled
when that tab is already at its defaults. The redundant "Reset all shortcuts"
button inside the pane went with it.

**Rebinding rejected the chord as you pressed it** (fixed 2026-08-14, before
release). Holding Ctrl fires its own `keydown` with `key === 'Control'`, so the
combo for that event is `ctrl+control`. The recorder's "still holding modifiers"
test matched on the *prefix* names (`ctrl|alt|shift|meta`) and so did not
recognise `control`, fell through to validation, and displayed **"Hold a modifier
and press another key"** the instant the user pressed Ctrl. The binding still
worked if you carried on, but it read as a rejection and the feature looked
broken. `isChordInProgress()` now tests the names `KeyboardEvent.key` actually
reports.

A synthetic `KeyboardEvent` cannot catch this — it carries `ctrlKey: true` with
the final key already set, skipping the modifier keydowns entirely. It took
driving the window with `sendInputEvent`, and it is the reason the probe in the
verified table exists.

**Duplicate rows for one server** (fixed 2026-08-14). The scanner listed both npm
and its port-holding child as separate servers, because the "run with no port yet"
fallback deduplicated on `projectId + script` rather than on the run itself.
`DetectedServer` now carries `runId`, dedupe keys on it, and the UI uses it to act
on a run directly instead of searching for a match.

**Project name lost for a running server** (fixed 2026-08-14). The scanner re-looked
up the project record for a run that already knew its own project, so a server
whose project had been removed showed as `node.exe` and triggered a spurious
"Project not found". It now trusts the run's own `projectId`/`projectName`.
