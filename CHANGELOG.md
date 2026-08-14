# Changelog

Releases are published to
[NPM-SM-Releases](https://github.com/aryanpxcr7/NPM-SM-Releases/releases).

This project uses [semantic versioning](https://semver.org/).

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
