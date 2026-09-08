---
description: Work a KrishiChain ticket end to end (e.g. /ticket S1-08)
---

Work ticket **$ARGUMENTS**.

1. Read the ticket in `TASKS.md`. Note its **Scope**, **Files**, **Accept** and especially its
   **Non-goals** — the non-goals line exists to stop scope creep and it is binding.
2. Read the sections of `docs/PROTOCOL.md` and `docs/ARCHITECTURE.md` that the ticket touches
   **before** writing code. Most tickets here have their expected behaviour already specified.
3. Check `CLAUDE.md` for the hard invariants. In particular:
   - never edit `packages/core/fixtures/vectors.json` to make a test pass;
   - signing stays on the device;
   - the gateway verifies before it stores;
   - `UNVERIFIABLE` is a rendered state, never a swallowed error.
4. Write the test first wherever a golden vector or an acceptance criterion already defines the
   expected behaviour.
5. Implement the smallest change that satisfies the acceptance criteria.
6. Run the relevant suite (`npm test -w <workspace>`, or `pio test -e native` for firmware).
   Do not report done on red, and do not report "compiles" as "works" — say explicitly what
   you verified and how.
7. Stay inside the ticket's file scope. Four people and their agents share this repo; edits
   outside scope create conflicts someone else debugs at 3 a.m. If the ticket seems to need
   another owner's files, stop and say so.
8. Commit as `<type>(<scope>): <summary>` with the ticket ID in the body.
