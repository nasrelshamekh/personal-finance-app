# CLAUDE.md — working conventions for Ledger EG

`SPEC.md` is the single source of truth for *what* to build. This file records *how* this
repo is actually put together, so a future session doesn't drift. `DECISIONS.md` is the
changelog of decisions D1–D12 that were folded into SPEC.md. `README.md` is the setup and
orientation doc for a human; `SELF-CRITIQUE.md` is Phase 8's list of what was weakest and
what was done about it.

Keep this file updated as conventions emerge.

---

## Shape of the repo

Three npm workspaces:

| Workspace | Package | Role |
|---|---|---|
| `shared/` | `@ledger/shared` | Leaf. Expression parser, currency, formatting, wire DTOs. |
| `server/` | `@ledger/server` | Express 5 API, Prisma, business logic. |
| `client/` | `@ledger/client` | Vite + React 18 SPA. |

**`shared/` never imports Prisma, `client/` or `server/`.** It is consumed as TypeScript
*source*, not a build artefact — there is no build step to forget and no stale `dist` to
debug. Both sides resolve it through the `exports` field; the client additionally aliases
it in `vite.config.ts` so Vite transforms it like first-party code.

Because `shared/` can't see Prisma, `Currency` necessarily exists twice — once as a Prisma
enum, once as a zod enum in `shared/src/currency.ts`. A compile-time assertion in
`server/src/types/` keeps the member lists identical. **If you add a currency, change both.**

## Commands

```bash
npm run dev          # both apps, colour-prefixed (server cyan, client magenta)
npm run db:up        # Postgres 16 in Docker
npm run db:migrate   # prisma migrate dev
npm run db:seed      # prisma db seed
npm run lint         # eslint, whole repo
npm run typecheck    # tsc --noEmit in all three workspaces
npm test             # vitest run in every workspace that has tests
```

The server's port comes from **`API_PORT`, not `PORT`**. `PORT` is a convention meaning
"serve the app here" and outer tooling sets it freely — a preview runner setting it for the
whole `npm run dev` had the API try to bind the client's port, and `--env-file` could not
win it back because Node does not let an env file override an already-set variable.

Ports: API `4000`, client `5173`, **Postgres `5433`**. The client proxies `/api` → `:4000`,
so the client only ever calls same-origin relative URLs. `vite --host` is on by default so
the app is reachable from a phone on the LAN.

Postgres is on host port **5433**, not 5432: this machine runs a native PostgreSQL 18
service that already owns 5432, and host connections silently landed on it instead of the
container. The container-side port is still 5432 — only the host mapping moved.

`prisma generate` fails with `EPERM` on Windows if the dev server is running, because tsx
holds the query-engine DLL open. Stop `npm run dev` before migrating.

## Environment

One `.env` at the repo root — copy from `.env.example`. The server loads it with node's
`--env-file`. The Prisma CLI only looks next to the schema, so `server/prisma.config.ts`
calls `process.loadEnvFile()` on the root file explicitly. **Don't add `dotenv`**, and
don't create a second `.env` inside `server/`.

## TypeScript

Strict everywhere, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`.

- **No `any`. No `@ts-ignore`.** Both are ESLint errors, not warnings. `@ts-expect-error`
  is allowed only with a description.
- `exactOptionalPropertyTypes` means you cannot pass `foo: undefined` for an optional
  property. Build the object conditionally and spread it — see `server/src/logger.ts`.
- All three workspaces are ESM (`"type": "module"`) with `moduleResolution: "Bundler"`,
  so relative imports are extensionless. `tsx` handles this at runtime.
- Path alias `@/*` → `./src/*` in both `client` and `server`. On the client it is mirrored
  in **both** `vite.config.ts` and `tsconfig.app.json` — shadcn's init needs both.

## Money — the rules that matter most

Read SPEC §4 in full before touching anything that holds a figure. The short version:

1. **Never a JS `number`.** `Decimal @db.Decimal(18,4)` in Postgres, `decimal.js` in code.
2. **Strings are the only interchange format.** `Prisma.Decimal` → `.toString()` the
   instant it leaves Prisma → `decimal.js` for arithmetic → `.toFixed(4)` string into
   JSON. A `Prisma.Decimal` must never escape the service layer, and no `Decimal` of
   either class is ever serialised. This is why the two Decimal classes can't collide.
3. **Amounts are stored signed** — income positive, expense negative, transfer outflow
   negative / inflow positive. A balance is therefore a plain sum with no branching on
   `type`. Display may show a bare magnitude; storage never does.
4. **`amountEgp` is frozen at write time** and recomputed only when the amount, currency
   or date is edited. Never on read.
5. **Accounts are single-currency.** A transaction's currency must equal its account's,
   enforced in zod *and* in the service. Cross-currency movement is a transfer, nothing else.
6. Store 4dp, display 2dp, round half-up.

**Import `Decimal` from `@ledger/shared`, never from `decimal.js` directly.**
`shared/src/decimal.ts` raises precision to 40 significant digits — decimal.js defaults to
20, which is barely above what a `Decimal(18,4)` column holds, so a chained division could
exhaust its headroom before the result was ever rounded. It is a global `Decimal.set`, not
a `Decimal.clone()`, on purpose: a clone is a different constructor whose instances fail
`instanceof Decimal`, which would reintroduce the two-Decimal-classes problem.

`Intl.NumberFormat.format()` is given a decimal **string**, never a number, so large
figures don't round-trip through a float. That needs `lib: ["ES2023"]` in every tsconfig,
plus the single `asNumericLiteral` assertion in `shared/src/money.ts` — TypeScript models
`Intl.StringNumericLiteral` as a template literal type no computed string can satisfy.

## Server module pattern

Every module under `server/src/modules/<name>/` is exactly three files:

- `schema.ts` — zod. Re-exports the wire schemas from `@ledger/shared/dto` and extends
  them with server-only concerns (param coercion, pagination).
- `service.ts` — all Prisma and all business logic. **No `req`, no `res`.**
- `router.ts` — thin. Validates, calls the service, returns. **Never touches Prisma.**

Express 5 specifics:

- Async handlers propagate rejections automatically. **Do not write an `asyncHandler`.**
- `path-to-regexp` v8: bare `*` is invalid. Use `/*splat` for catch-alls, `{/:id}` for
  optional params.
- One central error middleware maps `AppError`, `ZodError` and Prisma's
  `PrismaClientKnownRequestError` (P2002 → 409, P2025 → 404) to
  `{ error: { code, message, details? } }`. No stack traces when `NODE_ENV=production`.

## Writing a money-bearing row

Income and expense are entered as **magnitudes**; the sign comes from the type
(`TX_SIGN` in `shared/src/enums.ts`). A negative amount is rejected rather than quietly
flipped, because a negative expense is income.

`freeze()` in the transactions service resolves the rate once and returns
`{ rateToEgp, amountEgp, rateAsOf }`. Re-freeze **only** when the amount, currency or date
changes — editing a note or a category must never change what a transaction was worth.

A transfer is two rows sharing a `transferGroupId`, written through `inTransaction()` from
`server/src/lib/tx.ts`. That helper opens a transaction when handed the client and runs
inline when handed a transaction client, which is what lets a service be called both from
a router and from inside a test's rollback.

Deleting either row of a transfer deletes both. Deleting an account or category that
anything still references **archives** it instead — removing it would either orphan
history or take history with it, and both rewrite past figures.

## Client feature pattern

Every folder under `client/src/features/<name>/` owns its components, its `api.ts` (typed
fetch calls) and its `queries.ts` (TanStack Query hooks + a query-key factory).
**Components never call `fetch` directly** — they go through `lib/api.ts`, which only ever
uses same-origin relative URLs so the app works unchanged from a phone on the LAN.

Routes all render inside `AppShell`, so the sidebar, topbar and FX strip persist across
navigation instead of remounting. `components/layout/navigation.ts` is the single source of
truth for what the nav shows; `router.tsx` holds the matching destinations.

A file that exports a component must export *only* components, or Fast Refresh stops
working for it — that is why `theme-context.ts` and `hooks/useTheme.ts` sit beside
`ThemeProvider.tsx` rather than inside it.

**A filter lives in the URL, not in `useState`.** `TransactionsPage` derives its filters
from `useSearchParams` and writes them back with `replace: true`. It used to hold them in
state, which meant every `?accountId=…` link — the account cards, the dashboard categories
— navigated and then showed everything, looking exactly like a filter that had silently
failed. Anything filterable that something else links to must read the URL.

`categoryId=none` (the `UNCATEGORISED` constant in `shared/src/dto/transactions.ts`) means
"rows with no category". Uncategorised is a real bucket and usually the biggest one early
on, so it has to be filterable; a sentinel rather than an empty value, because an empty
query parameter is indistinguishable from not filtering.

Every route carries its **own** `errorElement` (`PageError`), not just the layout route.
React Router walks up to the nearest boundary, so a single one on the shell would let a
broken screen take the sidebar with it — leaving no way to navigate off the screen that
just failed. `RouteError` is the whole-app fallback and is reached only when the shell
itself throws.

`RouteAnnouncer` sets `document.title` and announces the destination into a live region.
A client-side navigation fires no page load, so without it a screen reader is given nothing
to say when you activate a nav link.

**A mutation fired from a list row must say when it fails.** There is nowhere in a row to
put an error, so `lib/action-feedback.ts` is the shared surface — a module-level store the
`ActionFeedback` region in `AppShell` subscribes to with `useSyncExternalStore`. A call
site adds one argument:

```tsx
remove.mutate(id, { onError: reportFailure(`${account.name} could not be archived.`) })
```

The headline **must name its subject**; with several rows on screen "That could not be
saved" is barely better than the silence it replaced. The `ApiError` message becomes the
second line automatically. Use `reportFailureNow` when the error is already in hand — a
bulk loop reports one count, not one message per row.

Messages **do not auto-dismiss** (capped at three, with a close button). A timer meant a
failure could disappear before it was read, which is the same silence again. The region's
bottom padding switches at `md`, matching `MobileNav`'s `md:hidden` — at `sm` it covers the
tab bar between 640px and 768px.

Components with a natural place for an error — the sheets, the category manager, the manual
rate editor — keep their inline message and do **not** also report, or the same failure is
stated twice.

**Don't name a context member `useSomething`.** `rules-of-hooks` decides what a hook is
from the name alone, so `const { useValue } = useCalculator()` makes every call site an
illegal hook call — even inside an `onClick`. The calculator's is `sendToTransaction`.

The calculator (`features/calculator/`) has **no arithmetic of its own**: it calls
`evaluateExpression` from `@ledger/shared`, the same parser behind `MoneyInput` and the
server, so `10/3` cannot mean three different things in three places. Its keypad is
`tabIndex={-1}` — every key is typable, and putting twenty buttons in the tab order would
bury the two controls that matter.

## Styling

Tailwind **v4, CSS-first**. There is no `tailwind.config.js` and there must never be one.
All configuration lives in `client/src/index.css`: `@import "tailwindcss"`, then
`@custom-variant dark`, then the token blocks, then `@theme inline` to expose them.

- Theme has two independent axes: **mode** (`.dark` class on `<html>`) and **preset**
  (`data-theme="…"`). Both are applied by the blocking inline script in `index.html`
  *before* React mounts — that script is the only thing preventing a flash of wrong theme,
  so don't move it into React.
- Presets override only `--primary`, `--primary-foreground`, `--accent`, `--ring` and
  `--chart-1..5`. Base neutrals are shared.
- **`--money-positive` / `--money-negative` / `--money-neutral` are not theme tokens.** A
  preset must never repaint income and expenses. Never signal by colour alone — pair every
  figure with a sign and a direction glyph.
- Every monetary figure uses `.font-numeric` (JetBrains Mono + `tabular-nums`) so columns
  align and digits don't jitter on update.
- Fonts are self-hosted via `@fontsource-variable`. **No CDN font links** — they'd break
  the offline requirement.
- Preset blocks are keyed on `[data-theme=…]`, **not** `:root[data-theme=…]`, so the
  selector also matches a nested element. That is what lets the Settings swatches render
  each preset's real palette — put `data-theme` (plus `dark`) on a div and everything
  inside picks it up — instead of keeping a second copy of the colours in JS. Every preset
  must define its `.dark` variant: `[data-theme=…]` ties with `.dark` on specificity and
  comes later in the file, so a light primary would otherwise win in dark mode.
- `npm run check:contrast --workspace client` reads the real oklch values out of
  `index.css` and reports WCAG ratios for all twelve preset × mode combinations. Run it
  after touching a preset; it exits non-zero below 4.5:1.
- **Reduced motion collapses durations to 0.01ms; it does not disable animations.** Radix
  keeps a closing dialog mounted until `animationend`, so `animation: none` would strand
  every sheet and dropdown on screen. Same trap if you ever suspend animations globally.
- `client/src/components/ui/` is shadcn-generated. Extend by wrapping, don't hand-edit. If
  you genuinely must, note it here.
  - `dropdown-menu.tsx`: the generated `checked={checked}` passes an explicit `undefined`,
    which `exactOptionalPropertyTypes` rejects. Changed to a conditional spread. Re-apply
    after any `shadcn add --overwrite` of that component.
  - `input.tsx`, `sheet.tsx` (`SheetOverlay`): **shadcn now generates for React 19**, where
    `ref` is an ordinary prop. This app is on React 18, so a plain function component
    silently drops any `ref` it is handed — you get a console warning and a `ref.current`
    that stays `null`, which is a dead `.focus()` rather than a crash. Both are wrapped in
    `forwardRef`. Check for this on **every** component you add: if anything ever passes it
    a `ref` — your code, or Radix's `Presence` measuring an exit animation — it needs one.

## FX

Resolution (`server/src/lib/fx/resolve.ts`) **never touches the network** — it reads only
what is already stored. That is what makes the app work offline and why a provider outage
can't break a write.

Rates are fetched **automatically** (D12): `ensureFreshRates()` in the fx service tops them
up when stale, and `GET /api/fx/rates` runs it. Nobody should ever have to type a rate.
Automatic fetches use a 3s timeout and back off 5 minutes after a failure; the manual
`POST /api/fx/refresh` button is the patient one at 10s. **Never make a write wait on a
fetch** — writes convert with whatever is stored.

Every money-bearing row stores `rateAsOf` alongside `rateToEgp`. A row is approximate when
`rateAsOf > date`, i.e. the rate post-dates the transaction — derive it, don't store a
second boolean that can drift.

Order: identity → stored direct → stored reverse (inverted) → triangulated through EGP →
hardcoded emergency default. Anything that isn't an exact stored match says so in
`derivation`, so a derived rate is never passed off as a recorded one.

**Rates are stored in one canonical direction, foreign → EGP.** Storing whichever
direction the provider was asked for would let a stale manual `USD→EGP` row shadow a fresh
API `EGP→USD` one, because resolution prefers a direct match over an inverted one. Refresh
therefore makes one request per foreign currency rather than one `/latest/EGP` call.

Staleness is measured against **the date being asked about**, not against now. For a live
conversion those are the same thing. For a historical one it stops every figure in last
year's history from wearing an amber dot, while still flagging a rate that was already
stale on the date in question.

`ageMs` is negative when a backdated lookup fell back to a newer rate
(`NO_RATE_AT_OR_BEFORE_DATE`). Show `asOf` in that case, not a "time ago".

## Backup, restore, reset

`server/src/modules/backup/` owns `GET /api/export`, `POST /api/import` and
`POST /api/reset`. Mounted at `/api` rather than under a resource, because they act on the
whole database.

- **Ids are preserved and frozen figures are restored verbatim.** `amountEgp`, `rateToEgp`
  and `rateAsOf` are written back exactly as exported, never recomputed — re-freezing on
  import would restate last year's history at today's rate, the one thing SPEC §4.4 exists
  to prevent. It also means an import never depends on the network.
- **An import replaces, it does not merge**, and runs in one transaction. Merging by id
  would make "restore" mean something different depending on what was already there.
- **`findProblems()` runs before anything is written**, and a dry run returns the same
  report an apply would. Postgres would catch most referential breakage anyway, but as one
  opaque constraint name *after* the wipe inside the transaction — a dry run is only worth
  having if it can name the offending row.
- `baseCurrency` is deliberately never restored: it is locked to EGP (D6), and a backup
  from a future version must not unlock it through the back door.
- The starter data lives in `server/src/lib/seed-data.ts` because both `prisma/seed.ts` and
  the reset service write it. Reset offers to restore it, on by default — a ledger with no
  categories cannot record an expense, so a bare wipe leaves the app unusable, not fresh.

## Testing

`vitest` per workspace; `npm test` at the root fans out. Route-level tests use `supertest`
against `createApp()` from `server/src/app.ts`, which is why app construction is separate
from `listen()`.

**Server tests need Postgres running** (`npm run db:up`). Rate resolution is an ORDER BY,
and a fake repository would test a reimplementation of the rule rather than the one that
runs. DB-backed tests use `withRollback()` from `server/src/test/db.ts` so they never
touch real data.

**Never write a test that assumes an empty table.** The developer's database holds real
data, and it is the same database the tests run against. Scope each assertion to the rows
the test made, or clear the table inside `withRollback` — and when you clear, clear what
references it first: `clearCategories()` deletes transactions before categories because
`Transaction.categoryId` is `onDelete: Restrict`, so one real categorised row is enough to
block the wipe.

`fileParallelism` is **off** in `server/vitest.config.ts`. Test files share one database,
and a rolled-back transaction isolates a test from its own file but not from another file
committing rows mid-transaction — which showed up as counts intermittently off by exactly
the number of rows another file had written.

## House rules

- No placeholder code, no `// TODO: implement`, no mock data in a shipped path. If a phase
  is too big, split it — don't stub it.
- Read a file's existing conventions before adding to it.
- Ask before: adding a dependency, changing the schema after Phase 1, or deviating from
  SPEC.md in a way the user would notice.
- Stop at each phase boundary, run that phase's acceptance checks, report, and commit with
  a conventional-commit message.
