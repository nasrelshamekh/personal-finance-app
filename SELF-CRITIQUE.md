# Self-critique — the three weakest parts of the UI, and what was done about them

Phase 8 of `SPEC.md` §12 asks for this list. The rule I applied when choosing: a weakness
is something that makes the app *worse at its job*, not something that could be prettier.
All of them were found by using the app against real data rather than by reading the code,
and all of them are fixed.

The fourth was listed as "what I would fix next" when this document was first written, and
was fixed straight afterwards.

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

- **The accounts screen has no per-account sparkline** (`SPEC.md` §9). True, and it is a
  real gap — but it is a missing enhancement, not something that misleads. *(The drill-down
  this entry originally also claimed was missing does exist: each card links through to
  `/transactions?accountId=…`.)*
- **The transactions table is dense at 1280px.** Genuinely tight, but it is the deliberate
  instrument-panel density from §10, and no figure is unreadable.
- **No undo on a bulk delete.** Worth having. It is a new feature with its own design
  questions, not a defect in something that already exists, and inventing it under the
  heading of "polish" is how a phase stops ending.

---

## 4. Inline mutation failures were silent (fixed after the first three)

**What was wrong.** The sheets surfaced errors properly, but a single-button action in a
list — archive an account, mark a debt settled, copy last month's budgets — called
`mutate()` with no error handler. TanStack Query caught the rejection, nothing rendered,
and the row snapped back on the next refetch. Nothing was lost, but the app looked like it
had simply ignored the click, which is indistinguishable from a dead button.

`bulkRecategorise` was the worst of them: it caught and discarded every failure in the
loop, so recategorising five expenses into an income category changed nothing and said
nothing.

**What was done.** `client/src/lib/action-feedback.ts` is one shared surface — a
module-level store the region in `AppShell` subscribes to. A call site is one argument
longer, not one hook heavier:

```tsx
remove.mutate(id, { onError: reportFailure(`${account.name} could not be archived.`) })
```

The headline must name its subject; with three rows on screen, "That could not be saved" is
barely better than silence. The server's own message becomes the second line, because it is
the specific half — "That account still has transactions."

Two things fell out of building it:

- **The messages do not auto-dismiss.** They started on a 10-second timer, and while
  testing I twice missed the message entirely because the timer beat me to it. An error
  that removes itself is the same silence the module exists to fix. They persist until
  dismissed, capped at three.
- **The region's bottom padding clears the mobile tab bar at `md`, not `sm`.** I first
  wrote `sm:pb-6`, but `MobileNav` is `md:hidden` — so between 640px and 768px the message
  sat on top of the tab bar, covering the way off the screen.

Bulk actions report a count rather than one message per row, and `bulkDelete` now
distinguishes a real failure from the expected 404 when both halves of a transfer are in
the same selection.

---

## 5. What using it on real data turned up

The four above came out of Phase 8's review, with the app open on one screen at a time.
These came out of actually *using* it afterwards — moving between months, following links
back and forth, reading the same figures from two directions. The ledger was eight
transactions, two accounts, one debt, one budget, and seven of the eight rows
uncategorised. That last detail is the point: seed data is tidy, and most of what follows
is invisible against tidy data.

**The dashboard described three different moments at once.** Stepping back to July showed
`NET WORTH 0.00` beside `ACCOUNTS 5,436.16` and a list of August transactions. Net worth
and the month totals were scoped to the month; the accounts panel and the recent list were
not. Each panel was individually correct, which is exactly why nothing caught it. The
account balances are now taken at the end of the month being read, from the same two terms
as `netWorthAt` — so the panel adds up to the figure printed above it, and a server test
asserts that invariant rather than trusting it.

**The month was the last piece of state hiding in `useState`.** `?month=2026-07` did
nothing, a reload dropped you back to today, and the dashboard's own category links carried
the month *out* to the transactions list while being unable to accept one back — so
following a link and pressing Back landed you in the current month. The same rule the
transaction filters already followed (`hooks/useMonth.ts`).

**Budgets reassured while ignoring 99% of the spending.** It read `BUDGETED 1,800 · SPENT
100 · LEFT 1,700` in a month where 9,423.84 went out, because only budgeted categories are
counted and almost everything was uncategorised. Both figures were true and the screen was
misleading. It now states what the totals cannot see, names the uncategorised part, and
links straight to those rows. Reported rather than folded in: money you did not budget for
is not money you overspent, but it is money you spent.

**The accounts total on the dashboard was a float sum.** `reduce((sum, a) => sum +
Number.parseFloat(a.balanceEgp), 0)` — on the one screen whose whole promise is not lying
about money (SPEC §4). Two accounts hide it completely; the rule does not care.

**The app held two opinions about what day it is.** Four sheets read the local date, the
account sheet read the UTC one. In Cairo those differ from 22:00, so for the last two hours
of every day a new account opened "yesterday" while a transaction entered a second later was
dated today. Found because a test I had written the evening before failed after midnight —
it was restating the rule in the other timezone rather than checking it. Both now go
through `lib/dates.ts`.

Still open, and deliberately not fixed here: the transactions list is a wall of
"Uncategorised" when rows carry neither note nor category; the row checkboxes are labelled
by date alone, so five rows on the same day are five identical labels; and bulk
recategorise offers income and expense categories mixed together, so part of a mixed
selection is guaranteed to fail. The server rejects the mismatches and the count is
reported honestly, so nothing breaks — it is just a choice offered that cannot work.
