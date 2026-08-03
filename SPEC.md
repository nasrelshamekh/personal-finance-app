# SPEC.md — Ledger EG (personal finance manager)

> **How to use this file:** drop it in the root of an empty repo, then in Claude Code run:
>
> ```
> Read SPEC.md fully. Do not write any code yet. Summarise the plan back to me in
> ~15 lines, list every assumption you're making, and list anything in the spec
> that is ambiguous or that you disagree with. Then wait.
> ```
>
> After you approve: `Implement Phase 0 and Phase 1 only. Run the acceptance checks at the end of each phase, then stop and report.`

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

**Tooling**
- npm workspaces, `tsx` for dev, `vitest` for tests
- ESLint + Prettier
- Docker Compose for Postgres only (app runs on host in dev)

**Do not add any dependency not listed here without asking me first.** In particular: no state management library beyond TanStack Query + React context, no `mathjs`, no ORM other than Prisma, no UI kit other than shadcn/ui.

---

## 3. Repo layout

```
/
├── docker-compose.yml          # postgres 16 + volume, nothing else
├── package.json                # npm workspaces root, top-level scripts
├── .env.example
├── SPEC.md
├── CLAUDE.md                   # you will generate this in Phase 0
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

**Feature pattern (client):** every feature folder owns its components, its `api.ts` (typed fetch calls), and its `queries.ts` (TanStack Query hooks + query key factory). Components never call `fetch` directly.

---

## 4. Money rules (non-negotiable)

These are the rules I care about most. Get them wrong and the app is worthless.

1. **Never use JavaScript `number` for a monetary value.** Server-side: Prisma `Decimal @db.Decimal(18, 4)`. In code: `Decimal` from `decimal.js`.
2. **Money crosses the wire as a string.** `{ "amount": "1250.0000", "currency": "USD" }`. Never a float. The client parses to `Decimal` only when it needs arithmetic, and formats via `Intl.NumberFormat` for display.
3. **Every transaction stores three things:** the original `amount` + `currency`, the `rateToEgp` used at the time, and the derived `amountEgp`. Rates change; history must not.
4. **`amountEgp` is computed once on write, never recomputed on read.** If I edit a transaction's date or amount, recompute it then, and only then.
5. **Rounding:** store 4 decimal places, display 2. Round half-up at display time only.
6. **Exchange rates have a `fetchedAt` and a `source`.** If the newest rate for a pair is older than 24h, the UI must visibly mark converted totals as stale — a subtle amber dot next to the figure with a tooltip giving the rate's age. Do not hide this.

Write `server/src/lib/money.ts` first, with `toDecimal`, `add`, `sub`, `mul`, `div`, `convert(amount, rate)`, `formatEgp`, `format(amount, currency)`. Unit-test it before anything else uses it. Mirror a display-only version in `client/src/lib/money.ts`.

---

## 5. Data model

Write this as Prisma schema. Names are indicative; improve them if you have a good reason, but tell me what you changed.

```prisma
enum Currency { EGP USD EUR GBP }
enum AccountType { CASH BANK WALLET SAVINGS CREDIT_CARD }
enum TxType { INCOME EXPENSE TRANSFER }
enum DebtDirection { I_OWE OWED_TO_ME }
enum DebtStatus { ACTIVE SETTLED }
enum RateSource { MANUAL API }
```

**Account** — id, name, type, currency, openingBalance (Decimal), color, icon, isArchived, createdAt. Current balance is derived, never stored.

**Category** — id, name, kind (INCOME | EXPENSE), color, icon, parentId (self-relation, one level of nesting only), isArchived.

**Transaction** — id, type, amount (Decimal), currency, rateToEgp (Decimal), amountEgp (Decimal), date (DateTime), note, accountId, categoryId (nullable for TRANSFER), transferAccountId (nullable, only for TRANSFER), debtPaymentId (nullable), savingsContributionId (nullable), createdAt, updatedAt. Index on `(date)` and `(accountId, date)`.

**Debt** — id, counterparty, direction, principal (Decimal), currency, interestRatePct (Decimal, nullable, simple interest only), startDate, dueDate (nullable), status, note. Remaining balance is derived from payments.

**DebtPayment** — id, debtId, amount, currency, rateToEgp, amountEgp, date, note.

**SavingsGoal** — id, name, targetAmount (Decimal), currency, deadline (nullable), color, icon, isArchived.

**SavingsContribution** — id, goalId, amount, currency, rateToEgp, amountEgp, date.

**Budget** — id, categoryId, month (first day of month, DateTime), limitEgp (Decimal). Unique on `(categoryId, month)`.

**ExchangeRate** — id, base (Currency), quote (Currency), rate (Decimal(18,8)), fetchedAt, source (RateSource). Unique on `(base, quote, fetchedAt)`. Index on `(base, quote, fetchedAt desc)`.

**Setting** — single-row table (id fixed to `1`): baseCurrency (default EGP), locale, rateSource, ratesApiEnabled (bool), themePreset, themeMode, updatedAt.

**Seed** (`prisma/seed.ts`): one EGP cash account, one USD bank account, ~14 sensible categories (Salary, Freelance, Rent, Groceries, Transport, Utilities, Internet, Eating out, Health, Subscriptions, Hardware, Gifts, Transfer fees, Other), a default settings row, and one seeded rate per pair so the app is never empty on first run.

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
- **`ManualRateProvider`** — reads whatever I typed into Settings. **This is the default.** The app must be fully functional with zero internet access.
- **`ApiRateProvider`** — `GET https://open.er-api.com/v6/latest/{BASE}` (free, no API key, includes EGP). Only used when `ratesApiEnabled` is true in settings.

Behaviour:
- `getRate(base, quote, atDate?)` returns the newest rate at or before `atDate` (default now). Falls back to the newest rate overall, then to a hardcoded emergency default, and flags the result as `stale: true` in either fallback case.
- API failures must never break a write. Log, fall back, continue.
- Manual rates always win over API rates with the same timestamp — if I type a rate, I mean it. (Parallel-market rates in Egypt can drift from the official one; I need the override.)
- A `POST /api/fx/refresh` endpoint pulls fresh rates on demand. No cron, no background jobs — I'll click a button.

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
| GET/POST | `/debts` | list includes `paidEgp`, `remainingEgp`, `progressPct` |
| GET/PATCH/DELETE | `/debts/:id` | |
| POST | `/debts/:id/payments` | optionally also creates a Transaction |
| GET/POST | `/savings-goals` | includes `savedEgp`, `progressPct`, `monthlyNeeded` |
| POST | `/savings-goals/:id/contributions` | |
| GET/PUT | `/budgets?month=YYYY-MM` | includes `spentEgp`, `remainingEgp`, `usagePct` |
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

Build `lib/expression.ts` — a **shunting-yard parser, no `eval`, no `Function` constructor, no `mathjs`**. Supports `+ - * / %`, parentheses, unary minus, decimals. Returns a `Decimal`. Returns a typed error for invalid input (`UnbalancedParen`, `UnexpectedToken`, `DivideByZero`) and the input shows a quiet inline message, not a toast.

Implement it identically on both sides (share the file if practical) so the client can preview and the server can accept an expression string too. **Test it thoroughly** — precedence, nesting, negatives, `10/3` precision, garbage input.

**B. A standalone calculator.** Reachable from anywhere via a keyboard shortcut and a persistent button in the topbar. Opens as a sheet on mobile, a popover on desktop. Full keyboard support, a running tape/history of the last ~20 calculations, click any tape entry to reuse it, and a "use this value" action that drops the result into the transaction form. Add a currency mode: convert the current result between any two of EGP/USD/EUR/GBP inline.

---

## 9. Features & screens

**Dashboard** (`/`) — month selector at top. Net worth in EGP with delta vs last month; income / expenses / net for the month; spending by category (donut) and daily spend (bar) for the month; the 6 most recent transactions; debts due in the next 30 days; savings goal progress bars; a compact FX strip showing today's 3 rates with their age.

**Transactions** (`/transactions`) — filterable, searchable, paginated table on desktop; grouped-by-day card list on mobile. Row shows original amount + currency prominently with the EGP equivalent secondary. Inline quick-add row at the top of the table. Bulk select → delete / recategorise. Keyboard shortcut `n` opens the add dialog.

**Accounts** (`/accounts`) — cards per account with balance in native currency + EGP, a sparkline of the last 30 days, and a drill-down to that account's transactions.

**Debts** (`/debts`) — two tabs, "I owe" and "Owed to me". Per-debt: progress bar, remaining, next due date, payment history, "log a payment" action. Sort by due date. Overdue items are visually distinct without being alarmist.

**Savings** (`/savings`) — goal cards with progress ring, amount remaining, deadline, and a computed "you need X/month to hit this". Contribution history.

**Budgets** (`/budgets`) — per-category monthly limits for the selected month, with spent / remaining / % bars. Over-budget categories are clearly marked. Copy last month's budgets in one click.

**Currency** (`/currency`) — a proper converter (amount + from + to, with the expression input), the current rate table with age and source per pair, manual rate override fields, and a "refresh from API" button that shows what changed.

**Settings** (`/settings`) — theme preset + light/dark/system, base currency, rate source toggle, category management, account management, export JSON, import JSON, and a "reset all data" with a typed confirmation.

---

## 10. Design direction

I asked for modern and very attractive. That means considered, not decorated. Read this section as a brief, not a suggestion.

**Concept: an instrument panel, not a dashboard template.** This is a tool I open every day to read numbers under pressure. Numbers are the hero — they get the largest type, the most contrast, and the most space. Everything else recedes. No hero cards with giant gradients, no glassmorphism, no emoji in the UI chrome.

**Typography**
- UI: a tight modern grotesque — Inter Tight or Geist. Sentence case everywhere.
- Numerals: a mono/tabular face for every monetary figure — JetBrains Mono or Geist Mono, `font-variant-numeric: tabular-nums` on all figures so columns align and digits don't jitter when they update.
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

---

## 12. Build order

Do these in order. **Stop after each phase, run its acceptance checks, and report to me before starting the next one.** Commit at the end of each phase with a conventional-commit message.

**Phase 0 — Foundation.** Workspaces, both apps scaffolded, TS strict on both, ESLint/Prettier, `docker-compose.yml` with Postgres 16, `.env.example`, root scripts (`dev`, `dev:client`, `dev:server`, `db:up`, `db:migrate`, `db:seed`, `db:studio`, `lint`, `test`). Generate `CLAUDE.md` capturing the conventions in this spec so future sessions don't drift. ✅ *Check:* `npm run dev` starts both; client shows a styled page proving Tailwind v4 is live; `/api/health` returns 200.

**Phase 1 — Data + money core.** Full Prisma schema, first migration, seed script, `lib/money.ts` with tests, `lib/expression.ts` with tests, env validation, error middleware, logger. ✅ *Check:* `db:migrate && db:seed` runs clean; `npm test` passes; expression tests cover precedence, nesting, unary minus, and every error case.

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

Don't build these. Don't scaffold for these. Do keep the data model from actively blocking them.
