# Changelog

Releases are published to
[NPM-SM-Releases](https://github.com/aryanpxcr7/NPM-SM-Releases/releases).

This project uses [semantic versioning](https://semver.org/).

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
