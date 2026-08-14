# Changelog

Releases are published to
[NPM-SM-Releases](https://github.com/aryanpxcr7/NPM-SM-Releases/releases).

This project uses [semantic versioning](https://semver.org/).

---

## Unreleased

### An integrated terminal

**Ctrl+`** opens a terminal inside the app, in the bottom panel. It is a real
terminal — a Windows pseudoconsole behind xterm.js — not a box that prints command
output: prompts, colours, arrow keys, tab completion, history, Ctrl+C and progress
bars all work, because the shell knows it is talking to a terminal.

- **It starts where you are.** Opening it with a project selected starts the shell
  in that project's folder. *Terminal in this folder* on the project toolbar, and
  *Terminal here* on a project's right-click menu, always open a fresh one there.
- **Several at once**, as tabs. The **+** button opens another; the caret beside it
  picks a different shell. Windows PowerShell, PowerShell 7, Command Prompt and Git
  Bash are offered when they are installed, and Settings → Behaviour chooses which
  one new terminals use, along with the text size.
- **It matches your theme.** All sixteen ANSI colours are derived from the palette,
  so the terminal changes with the other 24 themes rather than staying on one.
- **Copy and paste as Windows does it**: Ctrl+C copies when there is a selection
  and interrupts when there is not, Ctrl+V pastes, and right-click does whichever
  makes sense. Every other Ctrl key belongs to the shell — Ctrl+L clears its
  screen, Ctrl+R searches its history — so only Ctrl+` is taken.

### Control over servers you didn't start here

Servers found on your machine — started in a terminal, by an IDE, or by a previous
session — could always be stopped from the Servers page. Now:

- **They show up on the project page too.** Open a project and anything of its own
  that is listening appears as an amber chip beside the managed ones, with its
  port, a stop button and a restart button. Opening a project no longer looks
  idle when its dev server is running in a terminal behind you.
- **Restart here** takes one over: it stops the server and runs the same npm
  script from the app, so it comes back with live output, a stop button and a run
  record that survives a relaunch. The script is worked out by walking up the
  process tree to the `npm run …` that started it, then checked against the
  project's `package.json` before anything runs.
- The Start Server dialog now greys out a script that is already listening,
  whoever started it, instead of letting you start a second one that cannot bind.

Yarn and pnpm servers are detected and stoppable but not restartable — restarting
means running the script again, and this app would run it with npm.

### The bottom panel has tabs now

*Logs* and *Terminal*, and it can be **dragged taller or shorter** by its top edge;
the height is remembered. Ctrl+L still toggles it on the log tab.

Terminals close when the app closes — unlike dev servers, which keep running.
A shell nobody can type into is not work in progress. Anything you want to survive
should be started as a server.

---

## 0.3.6 — 2026-08-14

### Settings, reachable from the gear beside the app name

A settings dialog (**Ctrl+,**) with three tabs:

- **Appearance** — 25 themes, applied the moment you click one.
- **Behaviour** — whether starting a server opens the browser, which script the
  start shortcut runs, and how often the port table is rescanned (2s to 30s; each
  scan shells out to netstat and the process table, so it is worth turning down if
  you keep the app open all day).
- **Shortcuts** — the full list, below.

Reset is per tab: the footer button reads *Reset theme*, *Reset behaviour* or
*Reset shortcuts* depending on where you are, and is greyed out when that tab is
already untouched. Nothing on the other tabs moves.

### 25 themes

Gruvbox Dark and Gruvbox Material, Dracula, Nord, Tokyo Night, Catppuccin Mocha,
One Dark, Monokai, Solarized Dark, Night Owl, Everforest, Rosé Pine, Kanagawa, Ayu
Dark, Material Ocean, Synthwave '84, Cobalt2, Zenburn and GitHub Dark — plus
GitHub Light, Gruvbox Light, Solarized Light, Catppuccin Latte, Rosé Pine Dawn and
Ayu Light for anyone who works in daylight.

Each one is eighteen colours; every fill, hover tint and outline in the app is
mixed from them, so the whole UI moves together — including the log panel, the
badges and the project swatches. `npm run check:themes` measures the contrast of
every pair the UI puts on screen, and all 25 pass.

### Keyboard shortcuts

| | |
| --- | --- |
| `Ctrl+D` | Start the dev server for the open project |
| `Ctrl+Enter` | Choose a script to start |
| `Ctrl+Shift+S` / `Ctrl+Shift+R` | Stop / restart the active server |
| `Ctrl+B` | Open the active server in the browser |
| `Ctrl+T` / `Ctrl+E` | Terminal / Explorer in the project folder |
| `Ctrl+1` … `Ctrl+9`, `Ctrl+0` | Jump to a project, or back to Servers |
| `Ctrl+L` / `Ctrl+R` | Toggle the log panel / rescan ports |
| `Ctrl+O` | Add a project folder |
| `Ctrl+,` / `Ctrl+/` | Settings / this list |

They are ignored while a dialog is open or while you are typing in a field.

**All of them are rebindable.** Click a shortcut in Settings → Shortcuts and press
the keys you want; a reset arrow appears beside anything you have changed. A combo
needs Ctrl, Alt or Win — a bare letter would fire while you read the log — and
`Ctrl+0` to `Ctrl+9` stay reserved for switching projects. Binding a combo that is
already taken says which shortcut has it rather than silently stealing it.

### Open the server in the browser when it is ready

The Start Server dialog has an **Open in browser when ready** checkbox. Tick it and
the address the server prints is opened as soon as it appears — no watching the log
for the moment `localhost:5173` shows up. The choice is remembered between starts.

The log is the fast path: a dev server announces itself seconds before the port
scanner notices it. If the server prints nothing, the first port it binds is opened
instead. Only loopback addresses are opened, so the documentation and telemetry
links in a startup banner are never followed. After 90 seconds with no address, the
attempt is dropped with a note rather than left hanging.

### Ctrl+click a link in the log

URLs in the log panel are now links, opened with **Ctrl+click** like in a terminal.
Plain clicks do nothing on purpose — the panel is text you select and copy, and a
link that navigated on a stray click would fight that. Links are only underlined
while Ctrl is held.

Bare `localhost:3000` is recognised as well as full URLs, `0.0.0.0` is rewritten to
`localhost` because a browser cannot use it, and trailing sentence punctuation is
kept out of the link.

---

## 0.3.5 — 2026-08-14

### No more menu bar on Alt

Pressing Alt revealed a File / Edit / View / Window / Help bar — Electron's
default template, which `autoHideMenuBar` only hides until Alt is pressed. The app
has no menu commands of its own, so the menu is now removed outright.

### The quit prompt is part of the app

Closing with servers running used to raise a Windows message box. It is now an
in-app dialog matching the rest of the UI — and it lists **which** servers are
running, with their project, script and port. The native dialog could only state a
count, which is not much to decide on.

The OS dialog survives as a fallback for the case where the window cannot draw it,
so a wedged renderer can never leave a window that refuses to close.

---

## 0.3.4 — 2026-08-14

### Update prompt on launch

The app checks for a new version every time it opens, and now shows a **dialog**
rather than only a strip along the bottom — with the release notes, *Update now*
and *Later*. Choosing *Later* leaves the bottom banner in place, so the update is
still one click away rather than hidden until the next launch.

It also re-checks whenever the window regains focus, at most once every fifteen
minutes. An app left open for days used to never notice a release.

A retired version cannot dismiss the dialog, matching the banner.

---

## 0.3.3 — 2026-08-14

### Older versions are retired

Every release before 0.3.2 shipped a broken in-app updater — either missing
entirely (0.2.0) or silently corrupting the installer it downloaded (0.3.0,
0.3.1). Leaving people on those builds is not a neutral choice, because the one
mechanism meant to get them off is the thing that is broken.

Installers for those versions have been **removed from the releases page**, so
they can no longer be downloaded. Their release notes remain as a record.

The app also now reads a minimum supported version published with each release.
Running a build below that floor shows an update prompt that **cannot be
dismissed** — no *Later*, no close button.

The app is not disabled. A local development tool that bricks itself because it
cannot reach GitHub would be worse than the problem it is solving.

---

## 0.3.2 — 2026-08-14

### Fixed: in-app update produced a corrupt installer

Updating from inside the app failed with *"Installer integrity check has failed"*.

The downloaded file was exactly the right size but 4.67% of its bytes were wrong:
a 16 KB chunk was duplicated, shifting everything after it. The cause was the
progress counter — a `'data'` listener attached to the response stream before the
pipeline consumed it, which puts the stream into flowing mode early and lets
chunks be re-delivered from the internal buffer.

Progress is now counted by a pass-through inside the pipeline, which cannot
reorder or duplicate anything.

Downloads are also **verified before use**: size, Windows executable header, and —
from this release on — a SHA-256 hash against a `SHA256SUMS.txt` published with
each release. A file that fails any check is deleted rather than launched. The
same verification is applied to a cached download, since a size check alone would
have accepted the corrupt file.

> **This fix cannot repair itself.** Version 0.3.1 and earlier download with the
> broken code, so update to 0.3.2 by downloading the installer manually. From
> 0.3.2 onward, in-app updates verify themselves.

---

## 0.3.1 — 2026-08-14

### Reattaching to running servers actually works

Closing and reopening the app used to show servers as *external* rather than
managed. The app recorded **npm's** process id, but npm does not survive the app
closing — the server it launched does, as a grandchild whose parents are all
gone. Reattaching by that pid could never have worked.

Runs now record the **ports** they are seen holding, and reattaching looks for a
runtime still bound to one of them. Adoption is retried across several scans
rather than discarding the saved index on the first miss.

### A simpler quit prompt

One question instead of four options: stop the servers, or leave them running.
The minimise-to-tray option and the tray icon are gone.

### Stop and restart from the project page

A running server shows as a chip with its script name, a clickable port link and
restart/stop buttons. *Start Server* becomes *Start another* while something runs.

### Folder access for external servers

Any server row matched to a project now has a folder button, managed or not.

---

## 0.3.0 — 2026-08-14

### No more terminal window

Starting a server no longer flashes up a console window.

The cause was `detached: true` on the spawn. That flag gives the process *no
console at all*, so when npm ran the script through `cmd.exe`, Windows had to
give that a fresh visible one. Servers are now spawned with an invisible console
instead, which npm's `cmd.exe` quietly inherits.

Detached turned out to be unnecessary for servers to outlive the app — Windows
does not stop children when their parent exits. So this fixes the window with no
loss of the 0.2.0 behaviour.

### Closing the app now asks

When servers are running, closing the window offers three choices: **minimise to
tray** (servers keep running, tray shows a live count), **quit and stop servers**,
or **quit and leave them running**. With nothing running the window just closes,
so there is no prompt to dismiss on a normal exit.

The app now lives in the notification area while running, showing how many servers
are up and letting you reopen or quit from there.

### Right-click a project

Projects in the sidebar have a context menu: open a terminal in the folder, open
the folder, assign one of eight colours, or remove from the list. Colours show on
the project icon so a long list stays scannable.

### Open in terminal

A terminal button sits in the project header, and in the context menu. It opens
Windows Terminal in the project folder, falling back to the classic console.

### Also

- The app finally has a real icon, in the window, taskbar, tray and installer.

---

## 0.2.0 — 2026-08-14

### Dev servers now survive closing the app

Closing NPM Server Manager no longer stops the servers it started. They keep
running, and the next launch reattaches to them — they reappear in the list marked
`reattached`, with their log history replayed and streaming again.

This turned out to need more than removing the shutdown step. A child process
spawned with piped output dies as soon as the app exits and it next writes to the
now-broken pipe — measured at roughly 600 ms of survival. Servers are now spawned
detached, with their output written to a log file that the app tails, which is the
only combination that actually survives on Windows.

**If you are upgrading from 0.1.0:** that version stops your dev servers when it
closes, including the last time you close it to install this update.

### Built-in update checking

The app checks the releases repo on launch and shows a notification along the
bottom when a newer version exists, with **Update now** and **Later**. Choosing to
update downloads the installer with a progress bar, then closes the app and opens
it. There is also a manual *check for updates* in the bottom-left corner.

Downloads are restricted to GitHub hosts, and a failed or rate-limited check is
silent rather than disruptive.

### Fixed

- **Duplicate rows for a single server.** npm and the child process actually
  holding the port were listed as two separate servers.
- **Project name lost for a running server.** A server whose project had been
  removed showed as `node.exe` and raised a spurious "Project not found".

---

## 0.1.0 — 2026-08-14

First release.

- **Find every listening server.** Scans all TCP ports and shows the process
  behind each one, including servers started in a terminal and forgotten. Node,
  Bun, Deno, Python, Java and others are recognised; system services are filtered
  out.
- **Stop and restart them**, whether or not this app started them. Stops kill the
  whole process tree, so no bundler is left holding a port.
- **Add folders as projects**, persisted between launches.
- **Start Server dialog** leading with *Start Dev Server* and *Start Build
  Server*, with every other npm script one click away, and live log output.
- **Dependency table** showing installed, wanted and latest versions, coloured red
  for a major version behind and amber for minor or patch.
- **Two update modes** — *Update all (safe)* stays inside the ranges already in
  `package.json`; *Update all to latest* crosses major versions and rewrites them.
  Both preview every change before running.

**Known issue in this version:** closing the app stops every dev server it
started. Fixed in 0.2.0.
