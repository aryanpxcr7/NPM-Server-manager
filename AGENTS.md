# Agent instructions

Read `CLAUDE.md` before making changes. It is the primary repository guidance.
Then read `docs/STATUS.md` and the relevant sections of `docs/DECISIONS.md` before
changing an established mechanism.

Keep documentation current when behavior changes, especially `docs/STATUS.md`,
`CHANGELOG.md`, and `docs/DECISIONS.md` when a design choice is introduced.
Run `npm run typecheck` before declaring work complete; run the other gates named
by `CLAUDE.md` when their scope applies.

Preserve existing user changes, use the shared IPC API for renderer-to-main
communication, and do not claim a path is verified unless it was actually run.
