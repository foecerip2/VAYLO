# Build log (messenger/, web, React + Vite + TS, fake data layer)

Deviation from architecture.md: Expo was replaced by a Vite web app at mobile width so screens can be verified in a browser here. The data layer (`src/data/types.ts` `Api`) is the contract the real backend and an Expo client will use.
Built without reference screenshots; layout follows the component specs and is not compared to the original.

| ID | date | status | missing / notes |
| --- | --- | --- | --- |
| shell | 2026-11-09 | done | tokens wired (light + dark CSS), primitives, state router instead of a routing library |
| S01 phone | 2026-11-09 | done | validation error; no country picker |
| S02 code | 2026-11-09 | done | wrong code, 5 attempt lock; no resend timer; dev code 12345 |
| S03 profile | 2026-11-09 | partial | name only, no photo |
| S04 chat list | 2026-11-09 | done | loading skeleton, empty, offline banner; no folders, search, long-press |
| S06 conversation | 2026-11-09 | partial | send, retry of failed, long-text wrap, empty state; no reply/forward/edit/delete, reactions, attachments, voice |
| S05, S07-S19 | | not started | |

Verified: tsc clean, 8 unit tests, keyboard-only e2e at 390 and 1440 px, no console errors, no horizontal overflow. Found and fixed an infinite render loop (markRead emitted on every call).
Screenshots: `replica/telegram/clone-screens/`.
