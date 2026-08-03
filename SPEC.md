# SPEC.md — Ledger EG (personal finance manager)

> **Status:** this file is the single source of truth. Decisions D1–D11 from `DECISIONS.md`
> have been folded in; `DECISIONS.md` remains as a changelog of what changed and why.
> Where this file and `DECISIONS.md` still appear to differ, this file wins.

---

## 1. What we're building

A single-user, self-hosted personal finance manager that runs on my own machine against a local PostgreSQL instance. It tracks accounts, transactions, debts, savings goals and budgets, and it normalises everything into **EGP (Egyptian Pounds)** from USD / EUR / GBP.

It is not a SaaS. There is no signup, no multi-tenancy, no billing. Optimise for: fast daily data entry, honest numbers, and a UI I actually enjoy opening.

**Primary user:** me. Alexandria, Egypt. I earn partly in foreign currency and spend in EGP, so the FX layer is the core of the product, not a side feature.

**The three things this app must nail:**
1. Enter a transaction in under 5 seconds, in any of 4 currencies, on my phone.
2. Tell me my real net worth in EGP at any moment, and what the number was made of.
3. Never lie about money — no floating point drift, no silently stale exchange rates.

---

## 2. Tech stack (fixed — do not substitute)

**Frontend**
- React 18 + TypeScript (strict)
- Vite
- Tailwind CSS **v4** (CSS-first config, `@tailwindcss/vite` plugin, **no `tailwind.config.js`**)
- shadcn/ui (New York style, `lucide-react` icons)
- React Router v6 (`createBrowserRouter`)
- TanStack Query v5 for all server state
- `react-hook-form` + `zod` + `@hookform/resolvers`
- `recharts` for charts
- `date-fns` for dates

**Backend**
- Node.js + **Express 5** + TypeScript (strict)
- Prisma ORM
- PostgreSQL (local, via Docker Compose)
- `zod` for request validation
- `decimal.js` (or Prisma's `Decimal`) for all money math
- `pino` + `pino-http` for logging
- `helmet`, `cors`

**Shared** (`shared/` workspace — D7)
- `decimal.js` (the expression parser returns `Decimal` on both sides)
- `zod` (the DTO schemas both sides validate against)

**Tooling**
- npm workspaces, `tsx` for dev, `vitest` for tests
- `concurrently` for the root `dev` script, colour-prefixed streams (D8)
- `supertest` for route-level tests (D-assumptions)
- `@fontsource-variable/inter-tight` + `@fontsource-variable/jetbrains-mono`, self-hosted (D9)
- ESLint + Prettier
- Docker Compose for Postgres only (app runs on host in dev)

**Do not add any dependency not listed here without asking me first.** In particular: no state management library beyond TanStack Query + React context, no `mathjs`, no ORM other than Prisma, no UI kit other than shadcn/ui.

**Decimal discipline across boundaries.** `Prisma.Decimal` and `decimal.js` must never coexist as
live values. Prisma returns `Prisma.Decimal` → `.toString()` immediately at the Prisma boundary →
`decimal.js` for all arithmetic inside services → `.toFixed(4)` string on the way out to JSON.
Strings are the only interchange format, so the wire format and the DB format are the same thing.
`decimal.js` instances are free to move within app code (`money.ts` returns them by design); what is
forbidden is a `Prisma.Decimal` escaping the repository layer, or any `Decimal` being serialised.

---

## 3. Repo layout

```
/
├── docker-compose.yml          # postgres 16 + volume, nothing else
├── package.json                # npm workspaces root, top-level scripts
├── .env.example
├── SPEC.md
├── DECISIONS.md                # changelog of D1–D11, folded into this spec
├── CLAUDE.md                   # you will generate this in Phase 0
├── shared/                     # leaf workspace — never imports Prisma, client or server
│   └── src/
│       ├── expression.ts       # single shunting-yard implementation, used by both sides
│       ├── currency.ts         # Currency union + money formatting helpers
│       ├── money.ts            # display-only formatting shared by both sides
│       └── dto/                # API DTO types + zod schemas both sides validate against
├── server/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts
│   └── src/
│       ├── index.ts            # express app bootstrap
│       ├── env.ts              # zod-validated process.env
│       ├── prisma.ts           # singleton client
│       ├── middleware/         # error handler, request logger, validate()
│       ├── lib/                # money.ts, fx/, expression.ts
│       ├── modules/
│       │   ├── accounts/       # router.ts, service.ts, schema.ts
│       │   ├── categories/
│       │   ├── transactions/
│       │   ├── debts/
│       │   ├── savings/
│       │   ├── budgets/
│       │   ├── fx/
│       │   ├── dashboard/
│       │   └── settings/
│       └── types/
└── client/
    └── src/
        ├── main.tsx
        ├── router.tsx
        ├── index.css           # tailwind v4 entry + all theme tokens
        ├── components/
        │   ├── ui/             # shadcn generated — do not hand-edit
        │   ├── layout/         # AppShell, Sidebar, MobileNav, Topbar
        │   └── shared/         # MoneyInput, CurrencyPicker, StatCard, EmptyState…
        ├── features/           # dashboard/, transactions/, debts/, savings/…
        ├── hooks/
        ├── lib/                # api.ts, money.ts, expression.ts, cn.ts
        ├── providers/          # ThemeProvider, QueryProvider
        └── types/
```

**Module pattern (server):** every module is exactly three files — `schema.ts` (zod in/out), `service.ts` (all Prisma + business logic, no `req`/`res`), `router.ts` (thin, validates then calls service). Routers never touch Prisma directly.

**Where schemas live (D7).** `shared/src/dto/` owns the wire contract: response DTO types and the
request schemas both sides validate against. A server module's `schema.ts` re-exports those and
extends them with server-only concerns (query coercion, params, pagination). The client imports the
same DTOs, which is where the end-to-end typing comes from. `shared/` stays leaf-level: it imports
neither Prisma nor anything from `client/` or `server/`.

**The `Currency` enum exists twice by necessity** — once in `schema.prisma`, once as a zod enum in
`shared/src/currency.ts` — because `shared/` cannot import Prisma. A compile-time assertion in the
server keeps the two member lists identical; if you add a currency, both must change.

**Feature pattern (client):** every feature folder owns its components, its `api.ts` (typed fetch calls), and its `queries.ts` (TanStack Query hooks + query key factory). Components never call `fetch` directly.

---

## 4. Money rules (non-negotiable)

These are the rules I care about most. Get them wrong and the app is worthless.

1. **Never use JavaScript `number` for a monetary value.** Server-side: Prisma `Decimal @db.Decimal(18, 4)`. In code: `Decimal` from `decimal.js`.
2. **Money crosses the wire as a string.** `{ "amount": "1250.0000", "currency": "USD" }`. Never a float. The client parses to `Decimal` only when it needs arithmetic, and formats via `Intl.NumberFormat` for display.
3. **Every transaction stores three things:** the original `amount` + `currency`, the `rateToEgp` used at the time, and the derived `amountEgp`. Rates change; history must not.
4. **`amountEgp` is computed once on write, never recomputed on read.** If I edit a transaction's date or amount, recompute it then, and only then.
5. **Rounding:** store 4 decimal places, display 2. Round half-up. Persisting a derived
   `amountEgp` rounds to 4dp at write time; that is storage precision, not display rounding.
6. **Exchange rates have an `asOf` and a `source`.** `asOf` means "the moment this rate takes
   effect" — the provider's own timestamp for `API` rows, the moment I typed it for `MANUAL` rows.
   A rate is stale once `now` is past its `nextUpdateAt`, or — when the provider gave no
   `nextUpdateAt` — once it is more than **30h** old. Stale converted totals are visibly marked: a
   subtle amber dot next to the figure with a tooltip giving the rate's age. Do not hide this.
7. **Amounts are stored signed.** `INCOME` is positive, `EXPENSE` is negative, and a `TRANSFER`
   pair is negative on the outflow row and positive on the inflow row. `amountEgp` carries the same
   sign as `amount`. An account balance is therefore a plain sum with no type-dependent branching,
   and D5's net-worth formula holds without special cases. Display flips the sign where a bare
   magnitude reads better; storage never does.

Write `server/src/lib/money.ts` first, with `toDecimal`, `add`, `sub`, `mul`, `div`, `convert(amount, rate)`, `formatEgp`, `format(amount, currency)`. Unit-test it before anything else uses it. The display-only half (`format`, `formatEgp`) lives in `shared/src/money.ts` so client and server format identically; `client/src/lib/money.ts` re-exports it.

---

## 5. Data model

Write this as Prisma schema. Names are indicative; improve them if you have a good reason, but tell me what you changed.

```prisma
enum Currency { EGP USD EUR GBP }
enum AccountType { CASH BANK WALLET SAVINGS CREDIT_CARD }
enum TxType { INCOME EXPENSE TRANSFER }
enum DebtDirection { I_OWE OWED_TO_ME }
enum DebtStatus { ACTIVE SETTLED }
enum RateSource { MANUAL API }   // declaration order is load-bearing — see ExchangeRate
```

All primary keys are UUIDs (`@db.Uuid`), for consistency with `Transaction.transferGroupId`.

**Account** — id, name, type, currency, openingBalance (Decimal), **openingDate (DateTime)**,
**openingRateToEgp (Decimal(18,8))**, **openingBalanceEgp (Decimal)**, color, icon, isArchived,
createdAt. The three opening fields are frozen at account creation (D5); `openingBalanceEgp` is
derived once and stored, which is what makes historical net worth a comparison of frozen figures
rather than two snapshots of today's rate. For EGP accounts `openingRateToEgp` is exactly `1`.
Current balance is derived, never stored.

**Accounts are single-currency (D3).** A transaction's `currency` must equal its account's
`currency` — enforced in the zod schema *and* at the service layer. If I spend USD cash, that is a
separate USD cash account. Native balance is then exact arithmetic over same-currency rows, and
`balanceEgp` is a sum of frozen `amountEgp` values. Cross-currency movement has exactly one
representation: a transfer. For EGP accounts `rateToEgp` is always exactly `1`.

**Category** — id, name, kind (INCOME | EXPENSE), color, icon, parentId (self-relation, one level of nesting only), isArchived.

**Transaction** — id, type, amount (Decimal, **signed** — see §4.7), currency, rateToEgp (Decimal), amountEgp (Decimal, signed), **rateAsOf (DateTime)**, date (DateTime), note, accountId, categoryId (nullable for TRANSFER), **transferGroupId (String? @db.Uuid, indexed — only for TRANSFER)**, debtPaymentId (nullable), savingsContributionId (nullable), createdAt, updatedAt. Index on `(date)`, `(accountId, date)` and `(transferGroupId)`.

`rateAsOf` is the `asOf` of the rate actually used, frozen alongside `rateToEgp`. When it is later
than `date`, the rate post-dates the transaction and the EGP figure is an approximation — see D12
in §6. `DebtPayment` and `SavingsContribution` carry the same field for the same reason.

**Transfers are two linked rows (D2).** A transfer writes two `TRANSFER` rows in one Prisma
transaction sharing a `transferGroupId`: an outflow on the source account in the source account's
currency (negative), and an inflow on the destination account in the destination account's currency
(positive). Each row freezes its own `amount`, `currency`, `rateToEgp`, `amountEgp` independently,
exactly like any other row.

For a cross-currency transfer **I enter both sides.** The form pre-fills the destination amount
from the current rate and I can overwrite it. That is the point, not a convenience: when $500 lands
in my EGP account the amount that actually arrives reflects the bank's spread, not the mid-market
rate, and forcing the app's rate onto the destination would make the balance wrong.

**Aggregation rule:** `TRANSFER` rows are excluded from every income / expense / category / budget
aggregate. They affect account balances and nothing else.

**Conversion cost (D2).** Where a transfer group's two rows have different currencies, the
difference between the outflow's `amountEgp` and the inflow's `amountEgp` is the real cost of the
conversion. Expose it as a derived `conversionCostEgp` per group and surface the monthly total on
the dashboard as "Cost of converting."

**Debt** — id, counterparty, direction, principal (Decimal), currency, startDate, dueDate (nullable), status, note. Remaining balance is derived from payments.

**Debt balances live in the debt's native currency (D4).** `remaining = principal − Σ
amountInDebtCurrency`, computed entirely in the debt's currency. `remainingEgp` is a display-only
conversion at the current rate and carries the same stale flag as any other live conversion. Never
subtract historical-rate payments from a current-rate principal.

**DebtPayment** — id, debtId, amount, currency, **rateToDebtCurrency (Decimal(18,8))**,
**amountInDebtCurrency (Decimal)**, rateToEgp, amountEgp, date, note. Payments may be in a
different currency than the debt; all five figures are frozen at the payment date. Verbose, but
every figure is defensible. Where payment currency equals debt currency, `rateToDebtCurrency` is
exactly `1`.

**SavingsGoal** — id, name, targetAmount (Decimal), currency, deadline (nullable), color, icon, isArchived.

**SavingsContribution** — id, goalId, amount, currency, **rateToGoalCurrency (Decimal(18,8))**,
**amountInGoalCurrency (Decimal)**, rateToEgp, amountEgp, date.

**Savings progress mirrors debts (D4b).** This is the same incoherence D4 removed from debts:
a goal has its own currency, so `savedEgp ÷ targetAmount` would divide historical-rate
contributions by a current-rate target. Progress is therefore computed in the **goal's** currency —
`saved = Σ amountInGoalCurrency`, `progressPct = saved ÷ targetAmount` — and `savedEgp` is a
display-only conversion carrying the stale flag. `monthlyNeeded` is likewise in the goal's currency,
and is `null` when the goal has no deadline.

**Budget** — id, categoryId, month (first day of month, DateTime), limitEgp (Decimal). Unique on `(categoryId, month)`. Budgets are EGP-only, deliberately: budgets control spending and I spend in EGP, so a multi-currency budget would need a rate policy that adds nothing.

**ExchangeRate** — id, base (Currency), quote (Currency), rate (Decimal(18,8)), **asOf (DateTime)**, **nextUpdateAt (DateTime?)**, source (RateSource). Unique on **`(base, quote, source, asOf)`**. Index on `(base, quote, asOf desc)`.

`nextUpdateAt` holds the provider's `time_next_update_unix` when it gave one, and drives the
staleness rule in §4.6; it is null for manual rates, which fall back to the 30h window.

Because `MANUAL` is declared before `API` in `enum RateSource`, Postgres sorts `MANUAL` first, so
D1's tie-break needs no raw SQL — `orderBy: [{ asOf: 'desc' }, { source: 'asc' }]` is sufficient.

**Setting** — single-row table (id fixed to `1`): baseCurrency (default EGP, **locked** — see §11), locale, rateSource (**default API**), ratesApiEnabled (bool, **default true** — D12), **ratesApiEolAt (DateTime?)**, themePreset, themeMode, updatedAt.

`ratesApiEolAt` persists the provider's `time_eol_unix` (D10); non-null means the endpoint has an
announced death date and Settings must warn about it.

**Seed** (`prisma/seed.ts`): one EGP cash account, one USD bank account, ~14 sensible categories (Salary, Freelance, Rent, Groceries, Transport, Utilities, Internet, Eating out, Health, Subscriptions, Hardware, Gifts, Transfer fees, Other), a default settings row, and one seeded rate per pair so the app is never empty on first run. Seed rates, verified 2026-08-03, written as `source: MANUAL`, `asOf: 2026-08-03` — a starting point, not a claim of accuracy:

| Pair | Rate |
|---|---|
| USD → EGP | 51.1232 |
| EUR → EGP | 58.86 |
| GBP → EGP | 68.81 |

---

## 6. FX engine

`server/src/lib/fx/` with a `RateProvider` interface:

```ts
interface RateProvider {
  name: RateSource;
  fetchRates(base: Currency, quotes: Currency[]): Promise<Rate[]>;
}
```

Two implementations:
- **`ApiRateProvider`** — `GET https://open.er-api.com/v6/latest/{BASE}` (free, no API key, includes EGP). **This is the default** (D12): `ratesApiEnabled` defaults to true, and rates top themselves up automatically. I should never have to type a rate to record a foreign transaction.
- **`ManualRateProvider`** — reads whatever I typed on the Currency page. The escape hatch, not the daily path. It is what makes the app fully functional with zero internet access, and what lets me record the rate I *actually* got when it differs from the published one.

**Automatic refresh (D12).** `ensureFreshRates()` tops rates up when they have gone stale,
so opening any screen keeps them current. Three properties matter more than freshness:

1. **It never throws.** A provider outage degrades to stored rates, exactly as being
   offline does. Rate *resolution* still touches no network, ever.
2. **It gives up quickly** — a 3s provider timeout, against 10s for the manual button.
   Automatic fetching happens while I'm trying to do something else; being offline must
   not cost me three seconds a screen.
3. **It backs off** for five minutes after a failure, so a machine with no connection
   doesn't attempt a doomed fetch on every request.

`GET /api/fx/rates` runs it before reading and reports what happened in `autoRefresh`
(`FRESH` / `REFRESHED` / `PENDING` / `THROTTLED` / `DISABLED` / `FAILED`). Pass
`?refresh=false` to read without fetching. **A write never blocks on the network** — it
converts with whatever is stored.

Behaviour:

**`getRate(base, quote, atDate?)` resolution order (D1):**
1. `WHERE base, quote, asOf <= atDate` → `ORDER BY asOf DESC, source ASC` (MANUAL first) → take first.
2. Nothing at-or-before → newest row overall, `stale: true`, reason `NoRateAtOrBeforeDate`.
3. No rows at all → hardcoded emergency default, `stale: true`, reason `NoRateAtAll`.

The result carries the `asOf` of the rate actually used and the fallback reason, because callers
(§8, D11) need to tell me *which date* the number came from, not just that it's suspect.

- Manual rates always win over API rates at the same `asOf` — if I type a rate, I mean it. (Parallel-market rates in Egypt can drift from the official one; I need the override.)
- API failures must never break a write. Log, fall back, continue.
- A `POST /api/fx/refresh` endpoint pulls fresh rates on demand. No cron, no background jobs — I'll click a button.
- Inverse pairs are derived by division; `1 base = rate quote` is the stored direction.

**Free-tier constraints that shape the design** (verified 2026-08-03: no key, no signup, CORS
enabled, `result: "success"`, EGP present): once-daily updates, **no historical rates**,
attribution required, redistribution forbidden.

**Attribution is a licence condition, not a nicety (D10).** Render a small "Rates by Exchange Rate
API" link to `https://www.exchangerate-api.com` in the footer of `/currency` and in Settings,
shown whenever `ratesApiEnabled` is true. Not optional — it is the terms of the endpoint.

Read `time_eol_unix` on every refresh and persist it to `Setting.ratesApiEolAt`. If it ever comes
back non-zero, surface a persistent warning in Settings with the deprecation date, so I can switch
providers before the endpoint dies rather than after.

**Backdated entries save immediately and are flagged, not blocked (D11, revised by D12).**
The free endpoint returns today's rates only, so a transaction dated in the past with no stored
rate at-or-before it resolves via fallback rule 2 above — correct for a *live* conversion,
approximate for a *historical* one. That must never stop the write and must never demand a typed
rate.

Every money-bearing row therefore stores **`rateAsOf`**: the `asOf` of the rate actually used.
The rule is a comparison, not a stored boolean:

```
approximate  ⟺  rateAsOf > date        (the rate post-dates the transaction)
```

Rows where that holds are marked in the UI — the same amber treatment as a stale figure, with a
tooltip naming both dates ("rate from 3 Aug, transaction dated 12 Mar"). The manual override on
the Currency page remains available to correct one, but nothing is ever *required* of me. The
import path gets the same treatment: backdated rows resolved by fallback are flagged in the
dry-run diff rather than imported silently.

Rationale, so it isn't optimised away later: backfilling several months of history at today's rate
produces a net-worth chart that looks smooth and is entirely fiction. Flagging the rows is what
keeps that visible.

---

## 7. API

Base path `/api`. JSON only. All list endpoints paginated with `?page=1&pageSize=25` returning `{ data, meta: { page, pageSize, total, totalPages } }`.

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/accounts` | list includes derived `balance` + `balanceEgp` |
| GET/PATCH/DELETE | `/accounts/:id` | delete = archive if it has transactions |
| GET/POST | `/categories` | tree-shaped on GET |
| PATCH/DELETE | `/categories/:id` | |
| GET | `/transactions` | filters: `from`, `to`, `type`, `accountId`, `categoryId`, `currency`, `q`, `minAmount`, `maxAmount`; sort by date desc |
| POST/PATCH/DELETE | `/transactions[/:id]` | TRANSFER creates a linked pair atomically |
| GET/POST | `/debts` | remaining in debt currency; `remainingEgp` display-only (D4) |
| GET/PATCH/DELETE | `/debts/:id` | |
| POST | `/debts/:id/payments` | optionally also creates a Transaction |
| GET/POST | `/savings-goals` | progress in goal currency; `savedEgp` display-only (D4b) |
| POST | `/savings-goals/:id/contributions` | |
| GET/PUT | `/budgets?month=YYYY-MM` | PUT is a bulk upsert of the whole month; includes `spentEgp`, `remainingEgp`, `usagePct` |
| POST | `/budgets/copy` | `{ fromMonth, toMonth, overwrite: boolean }` |
| GET | `/fx/rates` | latest per pair + age |
| POST | `/fx/refresh` | pull from API provider |
| PUT | `/fx/manual` | set a manual rate for a pair |
| GET | `/fx/convert?amount=&from=&to=&date=` | |
| GET | `/dashboard?month=YYYY-MM` | one call, everything the dashboard needs |
| GET/PUT | `/settings` | |
| GET | `/export` | full JSON dump |
| POST | `/import` | restore from dump, transactional, with a dry-run mode |
| GET | `/health` | |

**Express 5 specifics — get these right:**
- Async route handlers propagate rejections automatically; do **not** wrap in `asyncHandler`.
- `path-to-regexp` v8: bare `*` is invalid. Use `/*splat` for catch-alls, `{/:id}` for optional params.
- One central error middleware `(err, req, res, next)` mapping a custom `AppError` class + `ZodError` + `Prisma.PrismaClientKnownRequestError` (P2002 → 409, P2025 → 404) to consistent `{ error: { code, message, details? } }`. Never leak stack traces when `NODE_ENV === 'production'`.

---

## 8. The calculator requirement

Two deliverables, one shared implementation.

**A. Expression-capable amount inputs.** Every field where I type money accepts arithmetic. I type `1200*3+450` and on blur or Enter it resolves to `4050.00`, with a small live preview of the result underneath while I'm typing. `Esc` reverts to the raw expression.

Build `shared/src/expression.ts` — a **shunting-yard parser, no `eval`, no `Function` constructor, no `mathjs`**. Supports `+ - * / %`, parentheses, unary minus, decimals. Returns a `Decimal`. Returns a typed error for invalid input (`UnbalancedParen`, `UnexpectedToken`, `DivideByZero`) and the input shows a quiet inline message, not a toast.

It lives in the `shared/` workspace as **one implementation** (D7), imported by both sides, so the client can preview and the server can accept an expression string too — no duplicate to drift. **Test it thoroughly** — precedence, nesting, negatives, `10/3` precision, garbage input.

**B. A standalone calculator.** Reachable from anywhere via a keyboard shortcut and a persistent button in the topbar. Opens as a sheet on mobile, a popover on desktop. Full keyboard support, a running tape/history of the last ~20 calculations, click any tape entry to reuse it, and a "use this value" action that drops the result into the transaction form. Add a currency mode: convert the current result between any two of EGP/USD/EUR/GBP inline.

---

## 9. Features & screens

**Dashboard** (`/`) — month selector at top. Net worth in EGP with delta vs last month; income / expenses / net for the month; **"Cost of converting" for the month** (D2); spending by category (donut) and daily spend (bar) for the month; the 6 most recent transactions; debts due in the next 30 days; savings goal progress bars; a compact FX strip showing today's 3 rates with their age.

Net worth at any date is computed from frozen figures only (D5):

```
netWorthEgp(at) = Σ accounts [ openingBalanceEgp + Σ amountEgp WHERE date <= at ]
```

so "delta vs last month" is a real comparison, not two snapshots of today's rate wearing different
hats. No recomputation, no §4.4 violation.

**Transactions** (`/transactions`) — filterable, searchable, paginated table on desktop; grouped-by-day card list on mobile. Row shows original amount + currency prominently with the EGP equivalent secondary. Inline quick-add row at the top of the table. Bulk select → delete / recategorise. Keyboard shortcut `n` opens the add dialog.

**Accounts** (`/accounts`) — cards per account with balance in native currency + EGP, a sparkline of the last 30 days, and a drill-down to that account's transactions.

**Debts** (`/debts`) — two tabs, "I owe" and "Owed to me". Per-debt: progress bar, remaining, next due date, payment history, "log a payment" action. Sort by due date. Overdue items are visually distinct without being alarmist.

**Savings** (`/savings`) — goal cards with progress ring, amount remaining, deadline, and a computed "you need X/month to hit this". Contribution history.

**Budgets** (`/budgets`) — per-category monthly limits for the selected month, with spent / remaining / % bars. Over-budget categories are clearly marked. Copy last month's budgets in one click.

**Currency** (`/currency`) — a proper converter (amount + from + to, with the expression input), the current rate table with age and source per pair, manual rate override fields, and a "refresh from API" button that shows what changed.

**Settings** (`/settings`) — theme preset + light/dark/system, base currency (**disabled field reading "EGP — fixed in this version"**, D6), rate source toggle, API attribution link when enabled and the EOL warning if `ratesApiEolAt` is set (D10), category management, account management, export JSON, import JSON, and a "reset all data" with a typed confirmation.

---

## 10. Design direction

I asked for modern and very attractive. That means considered, not decorated. Read this section as a brief, not a suggestion.

**Concept: an instrument panel, not a dashboard template.** This is a tool I open every day to read numbers under pressure. Numbers are the hero — they get the largest type, the most contrast, and the most space. Everything else recedes. No hero cards with giant gradients, no glassmorphism, no emoji in the UI chrome.

**Typography**
- UI: Inter Tight, self-hosted via `@fontsource-variable/inter-tight` (D9). Sentence case everywhere.
- Numerals: JetBrains Mono, self-hosted via `@fontsource-variable/jetbrains-mono`, with `font-variant-numeric: tabular-nums` on every monetary figure so columns align and digits don't jitter when they update.
- No CDN font links: they would contradict the offline requirement and add a render-blocking request for no benefit.
- Currency codes and units are set smaller and in a muted tone next to their figure — `12,480.00` big, `EGP` small. Never the same weight.
- A real type scale. Big numbers are genuinely big (36–48px on dashboard stats), labels are genuinely small (11–12px, letter-spaced, muted).

**Colour**
- Semantic money colours are separate tokens from the theme accent: `--money-positive`, `--money-negative`, `--money-neutral`. Income and expenses must stay readable in every preset — do not let a theme preset repaint them.
- Do not colour-code with red/green alone; pair with a sign and a direction glyph for accessibility.

**Density & layout**
- Desktop: persistent left sidebar (icon + label, collapsible to icons), content max-width ~1400px, 8px spacing grid.
- Mobile: bottom tab bar with 5 destinations (Home, Transactions, Add, Debts, More). The centre "Add" is a prominent FAB-style button that opens the transaction sheet.
- Tables become grouped cards below `md`. No horizontal scrolling on mobile, ever.

**Motion** — restrained and functional. Numbers count up on first load only (respecting `prefers-reduced-motion`). Sheet/dialog transitions use shadcn defaults. Nothing loops, nothing floats, nothing pulses.

**Signature element** — the **FX strip**: a thin, always-visible band that shows USD/EUR/GBP against EGP with a live age indicator and micro-sparkline per pair. It sits under the topbar on desktop and collapses into a swipeable row on mobile. It's the one thing that makes this app look like it belongs to someone who gets paid in dollars and pays rent in pounds. Give it real craft.

**Quality floor, unannounced:** every list has a designed empty state that tells me what to do next; every async surface has a skeleton, not a spinner; every destructive action has a confirm; focus rings are visible and keyboard nav works throughout; forms show field-level errors, not toasts. Error copy states what happened and how to fix it, in plain language, and doesn't apologise.

---

## 11. Theming implementation (Tailwind v4)

This is the part most likely to be done wrong. Follow it exactly.

- `client/src/index.css` starts with `@import "tailwindcss";` and `@import "tw-animate-css";` (or the shadcn-recommended animate import for v4).
- Declare `@custom-variant dark (&:is(.dark *));`
- Define shadcn's token set as CSS custom properties on `:root` and `.dark`, then expose them with `@theme inline { --color-background: var(--background); … }`.
- **No `tailwind.config.js` exists.** All config is CSS. Use `@theme` for fonts, radii, and any custom spacing.
- `@tailwindcss/vite` in `vite.config.ts`, plus a `@` → `./src` alias mirrored in `tsconfig.app.json` `paths` (shadcn's init needs both).
- shadcn components via `npx shadcn@latest add …`. Files in `components/ui/` are generated — extend by wrapping, don't hand-edit unless there's no alternative, and note it in CLAUDE.md if you do.

**Two independent axes:**

1. **Mode** — `light` | `dark` | `system`. Applied as a `.dark` class on `<html>`. Must be applied by a small blocking inline script in `index.html` *before* React mounts, so there is no flash of the wrong theme.
2. **Preset** — applied as `data-theme="<preset>"` on `<html>`. Each preset is a CSS block that overrides only `--primary`, `--primary-foreground`, `--accent`, `--ring`, and `--chart-1..5`, in both light and dark variants. Base neutrals stay shared.

Ship **6 presets**, each with a real name and a distinct temperature — not six hues of the same blue. Give me at least one warm/earth option, one cool/technical option, one high-contrast monochrome, and one that leans into deep teal or violet. Pick palettes that hold up in both modes; check contrast on `--primary-foreground` over `--primary` in both.

Both settings persist to `localStorage` immediately and sync to the `Setting` row in the background. A `ThemeProvider` exposes `{ mode, setMode, preset, setPreset, resolvedMode }`. The Settings page renders presets as swatch buttons showing the actual colours, with the active one clearly marked.

**Base currency is EGP-locked in v1 (D6).** The `Setting.baseCurrency` column stays for schema
stability, the value is hard-locked to `EGP`, and Settings renders it as a disabled field labelled
"EGP — fixed in this version" — visible so I know where it will live, honest about doing nothing.
Do **not** rename `amountEgp` → `amountBase`; that is churn for a feature that isn't shipping.

---

## 12. Build order

Do these in order. **Stop after each phase, run its acceptance checks, and report to me before starting the next one.** Commit at the end of each phase with a conventional-commit message.

**Phase 0 — Foundation.** Three workspaces (`client`, `server`, `shared`), both apps scaffolded, TS strict on all three, ESLint/Prettier, `docker-compose.yml` with Postgres 16, `.env.example`, root scripts (`dev`, `dev:client`, `dev:server`, `db:up`, `db:migrate`, `db:seed`, `db:studio`, `lint`, `test`) with `dev` running both through `concurrently`. Generate `CLAUDE.md` capturing the conventions in this spec so future sessions don't drift. ✅ *Check:* `npm run dev` starts both; client shows a styled page proving Tailwind v4 is live; `/api/health` returns 200.

**Phase 1 — Data + money core.** Full Prisma schema, first migration, seed script, `server/src/lib/money.ts` with tests, `shared/src/expression.ts` with tests, env validation, error middleware, logger. ✅ *Check:* `db:migrate && db:seed` runs clean; `npm test` passes; expression tests cover precedence, nesting, unary minus, and every error case.

**Phase 2 — FX engine.** Rate providers, `getRate` with fallback + staleness, all `/api/fx/*` endpoints. ✅ *Check:* rates resolve correctly with the network disabled; staleness flag behaves; manual override wins.

**Phase 3 — Core API.** Accounts, categories, transactions (incl. atomic transfers), dashboard aggregate, settings. ✅ *Check:* I can exercise every endpoint via a `.http` file you provide; balances are correct after a transfer; deleting an account with transactions archives instead.

**Phase 4 — App shell + theming.** Router, layout, sidebar, mobile bottom nav, `ThemeProvider`, all 6 presets, dark mode with no flash, the FX strip, typography and token system fully in place. ✅ *Check:* every preset × mode combination is legible; no FOUC on reload; nav works at 375px and 1440px.

**Phase 5 — Transactions + dashboard.** `MoneyInput` with expression support, `CurrencyPicker`, the add/edit sheet, the transactions table/card list with all filters, the full dashboard with charts. ✅ *Check:* I can add an income in USD and see it land correctly in EGP on the dashboard in under 5 seconds.

**Phase 6 — Debts, savings, budgets.** All three features end to end. ✅ *Check:* logging a debt payment optionally creates the matching transaction and the remaining balance updates.

**Phase 7 — Calculator + currency page.** Standalone calculator with tape and shortcut, the converter page, manual rate management UI. ✅ *Check:* keyboard-only operation of the calculator works fully.

**Phase 8 — Polish.** Export/import, reset data, empty states, skeletons, error boundaries, a11y pass (focus, labels, contrast), a README with setup steps, and a final self-critique: list the three weakest parts of the UI and fix them.

---

## 13. Working agreement

- **No `any`.** No `@ts-ignore`. If a type is hard, ask.
- **No placeholder code, no `// TODO: implement`, no mock data left in a shipped path.** If a phase is too big, tell me and split it — don't stub it.
- **Read before you write.** Check the existing file's conventions before adding to it.
- **Ask before:** adding a dependency, changing the schema after Phase 1, deviating from this spec in any way that I'd notice.
- **Explain trade-offs briefly when you make a judgement call.** One or two lines, not an essay.
- If something in this spec is wrong, impossible, or a bad idea — **say so and argue your case** rather than silently working around it.
- Prefer complete, working files over fragments when showing me code.
- Keep `CLAUDE.md` updated as conventions emerge.

---

## 14. Explicitly out of scope for v1

Auth, multi-user, receipt OCR, bank sync / open banking, recurring transactions, notifications, PWA/offline sync, Arabic localisation (keep strings centralised so it's easy later), mobile native app, deployment beyond localhost.

**Debt interest (D4).** Removed from v1. Simple interest with no accrual basis, no payment
allocation between principal and interest and no compounding schedule is a half-feature producing
numbers that can't be defended. These debts are person-to-person and interest-free. If it comes
back it gets its own spec with an explicit day-count convention.

**A configurable base currency (D6).** The column exists; the feature does not.

Don't build these. Don't scaffold for these. Do keep the data model from actively blocking them.
