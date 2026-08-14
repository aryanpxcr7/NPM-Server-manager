# Project status

**Last updated:** 2026-08-14
**Version:** 0.1.0
**Published at:** https://github.com/aryanpxcr7/NPM-Server-manager

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

Most recent change: dev servers now **outlive the app** rather than being killed on
quit, and are reattached on next launch. That reversed `docs/DECISIONS.md` §8 and
required rewriting how servers are spawned — see §10 before touching `servers.ts`.

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
| `LogTailer` | 8/8 assertions against the real module: live appends, partial lines, CRLF, multi-byte split across reads, truncation resync, flush on stop |

---

## Not yet verified

These paths exist and typecheck but have never been executed. Do not describe them
as working.

- **The update write path.** `npm update` / `npm install pkg@latest` has never
  actually run. Scan → plan → preview dialog is verified; pressing the final
  confirm button is not. Testing this mutates a real project's `node_modules`, so
  it needs either a throwaway fixture project or the user's go-ahead.
- **Stop / restart via the UI buttons.** The underlying `taskkill /T /F` works (it
  was used to clean up a test server), but the buttons themselves were never
  clicked.
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

### 2. `electron-updater` is an unused dependency
Listed in `dependencies` in `package.json`, never imported. Either wire up
auto-update (needs a publish target in `electron-builder.yml`, currently
`publish: null`) or drop the dependency.

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
- Detecting a dev server's URL from its stdout rather than inferring from ports
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
  bound. The scanner then shows it as external, which is stoppable but not
  restartable.

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

**Duplicate rows for one server** (fixed 2026-08-14). The scanner listed both npm
and its port-holding child as separate servers, because the "run with no port yet"
fallback deduplicated on `projectId + script` rather than on the run itself.
`DetectedServer` now carries `runId`, dedupe keys on it, and the UI uses it to act
on a run directly instead of searching for a match.

**Project name lost for a running server** (fixed 2026-08-14). The scanner re-looked
up the project record for a run that already knew its own project, so a server
whose project had been removed showed as `node.exe` and triggered a spurious
"Project not found". It now trusts the run's own `projectId`/`projectName`.
