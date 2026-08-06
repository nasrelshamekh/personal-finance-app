# Self-critique — the three weakest parts of the UI, and what was done about them

Phase 8 of `SPEC.md` §12 asks for this list. The rule I applied when choosing: a weakness
is something that makes the app *worse at its job*, not something that could be prettier.
All three below were found by using the app against real data rather than by reading the
code, and all three are fixed in this phase.

---

## 1. The app could not add to its own vocabulary

**What was wrong.** There was no way, anywhere in the interface, to create an account or a
category. The seed script made two accounts and fourteen categories on first run and that
was the permanent set. Getting a third account meant editing `prisma/seed.ts` and
re-running it.

This is worse than it sounds, because it is silently self-reinforcing. With no way to add
a category that fits, transactions get filed as Uncategorised — and on the test ledger,
seven of eight were. The dashboard then reports "Uncategorised 99%", which is a true
statement about a problem the interface created and offered no way to solve.

`SPEC.md` §9 lists category management and account management under Settings. They were
never built; each phase had a nearer deadline.

**What was done.**

- Settings gains a category manager: add, rename inline, archive, restore, nest one level,
  and a toggle for archived ones. Deleting goes through `DELETE /categories/:id`, which
  removes a category nothing references and archives one with history — so the button says
  "archive", because promising a deletion the server will refuse is worse than naming the
  real outcome.
- The Accounts screen gains create, edit and archive, with the same archive-or-delete rule.
  Opening balance, opening date and the rate frozen from them are creation-only and shown
  read-only afterwards: they are a historical fact, and letting them move would silently
  rewrite every past net-worth figure (D5).
- Accounts are managed on the Accounts screen rather than inside Settings, and Settings
  links there. Deciding anything about an account needs its balance in view.

---

## 2. Links that filtered did not filter

**What was wrong.** Every account card linked to `/transactions?accountId=…`. The
transactions page held its filters in `useState` and never read the URL, so the link
navigated and then showed *everything*. Clicking "6 transactions" on an account holding six
of the ledger's eight rows gave you all eight, with the filter bar showing no filter
applied.

That is the worst kind of bug in a money app: not an error, just a quietly wrong answer,
presented with the same confidence as a right one. Nothing on screen said the filter had
been ignored.

It also meant no filtered view could be linked, bookmarked, or reloaded. Refreshing the
page silently discarded whatever you had set up.

**What was done.** The URL is now the filter state rather than a copy of it —
`filtersFromUrl` derives the filters on every render, and changing a filter writes it back
with `replace: true` so the back button still means "the previous screen" rather than
"the previous filter keystroke". `accountId`, `categoryId`, `type`, `currency`, the date
range, the search text and both amount bounds all survive a reload and can be shared.

Verified: `/transactions?accountId=<bank>` returned 8 rows across both accounts before, and
returns exactly the 2 Bank (USD) rows now.

---

## 3. The dashboard's biggest finding was a dead end

**What was wrong.** "Where it went" is the panel that tells you something you did not
already know — one category ate the month. It rendered as inert text. The single most
useful thing you can do on seeing "Uncategorised 99%" is look at what is in it, and there
was no way to get there except the transactions page and rebuilding the filter by hand,
which — see #2 — would not have held anyway.

The same is true of the smaller slices: seeing that Groceries took 30% of the month is only
half a thought until you can see the rows behind it.

**What was done.** Every legend row is now a link into the transactions list, pre-filtered
to that category, that month, expenses only. The finding and the action on it are the same
click.

This needed one server change. `Uncategorised` is a real bucket, and usually the largest
one on a young ledger, but it has no id to filter by — so the `categoryId` filter now
accepts the sentinel `none`, meaning "rows with no category". A sentinel rather than an
empty value, because an empty query parameter is indistinguishable from not filtering at
all. It is offered in the filter dropdown too, so a filter arriving by link is
representable in the UI instead of showing as "Any category".

---

## Things I considered and did not count

- **The accounts screen has no per-account sparkline or drill-down** (`SPEC.md` §9). True,
  and it is a real gap — but it is a missing enhancement, not something that misleads.
- **The transactions table is dense at 1280px.** Genuinely tight, but it is the deliberate
  instrument-panel density from §10, and no figure is unreadable.
- **No undo on a bulk delete.** Worth having. It is a new feature with its own design
  questions, not a defect in something that already exists, and inventing it under the
  heading of "polish" is how a phase stops ending.

## What I would fix next

Inline mutation failures are quiet. The sheets surface an error properly; a single-button
action in a list — archive an account, archive a category — calls `mutate` and shows
nothing if it fails. Nothing is lost, and the row snaps back when the query refetches, but
a failure should say so. That wants one shared surface for it rather than an error line
copy-pasted into a dozen components, which is a small piece of design rather than a patch.
