# Ledger EG

A single-user, self-hosted personal finance manager for someone who earns in one currency
and spends in another. Multi-currency accounts, debts, savings goals and budgets, with
every figure converted to Egyptian pounds **at the moment it is written** and never
silently restated afterwards.

Runs entirely on your own machine. No accounts, no sync, no telemetry.

---

## What you need

| | |
|---|---|
| Node | 20.11+ (uses `--env-file` and `process.loadEnvFile`) |
| Docker | for Postgres 16 |

## Setup

```bash
npm install
```

npm 11 blocks lifecycle scripts by default, so Prisma cannot build its client until you
allow it:

```bash
npm approve-scripts prisma @prisma/client @prisma/engines esbuild
```

Copy the environment file. One `.env` at the repo root serves all three workspaces — do
not create a second one inside `server/`.

```bash
cp .env.example .env
```

Start the database, apply the schema, and put the starter data in:

```bash
npm run db:up && npm run db:migrate && npm run db:seed
```

Then run both apps:

```bash
npm run dev
```

- App — <http://localhost:5173>
- API — <http://localhost:4000/api/health>

`vite --host` is on, so the app is reachable from a phone on the same network. Every
request the client makes is a same-origin relative URL, so nothing needs reconfiguring to
use it from another device.

### Ports

| Service | Port | |
|---|---|---|
| Client | 5173 | proxies `/api` to the server |
| API | 4000 | set with **`API_PORT`**, not `PORT` |
| Postgres | **5433** | container-side is still 5432; only the host mapping moved |

Postgres is on 5433 because a native PostgreSQL install commonly owns 5432, and host
connections land on it silently instead of the container.

The API reads **`API_PORT`**. `PORT` is a convention meaning "serve the app here", and
outer tooling sets it freely — a preview runner setting it for the whole `npm run dev`
made the API try to bind the client's port.

---

## Everyday commands

```bash
npm run dev          # both apps, colour-prefixed (server cyan, client magenta)
npm run build        # production build (the client bundle)
npm run lint         # eslint, whole repo
npm run typecheck    # tsc --noEmit in all three workspaces
npm test             # vitest in every workspace that has tests
npm run db:up        # Postgres in Docker
npm run db:migrate   # prisma migrate dev
npm run db:seed      # starter categories, accounts and rates (idempotent)
npm run db:studio    # Prisma Studio
```

`npm run check:contrast --workspace client` reads the real oklch values out of `index.css`
and reports WCAG ratios for all twelve preset × mode combinations. Run it after touching a
theme preset.

**Stop `npm run dev` before migrating.** On Windows `prisma generate` fails with `EPERM`
because `tsx` holds the query-engine DLL open.

Server tests need Postgres running. They use real Postgres on purpose — rate resolution is
an `ORDER BY`, and a fake repository would test a reimplementation of the rule rather than
the one that actually runs. Each test runs inside a transaction that is always rolled back,
so your own data is never touched.

Client tests need nothing at all — jsdom and Testing Library, no server, no database. Run
just those with `npm run test --workspace client`, or watch them with
`npm run test:watch --workspace client`.

---

## How it works

Three npm workspaces:

| Workspace | Role |
|---|---|
| `shared/` | Leaf. Expression parser, currency, formatting, the wire contract both sides validate against. Never imports Prisma, client or server. |
| `server/` | Express 5, Prisma, all business logic. |
| `client/` | Vite + React 18 SPA. |

`shared/` is consumed as TypeScript *source*, so there is no build step to forget and no
stale `dist` to debug.

### Money

The rules that matter, in short — `SPEC.md` §4 has them in full.

- **Never a JS `number`.** `Decimal(18,4)` in Postgres, `decimal.js` in code, and decimal
  **strings** as the only interchange format.
- **Amounts are stored signed.** Income positive, expense negative, transfer outflow
  negative and inflow positive — so a balance is a plain sum with no branching on type.
- **Rates are frozen at write time.** Each row stores `rateToEgp`, `amountEgp` and
  `rateAsOf` together. They are recomputed only when the amount, currency or date changes.
  Editing a note never changes what a transaction was worth.
- **Accounts hold one currency.** Cross-currency movement is a transfer, which is two rows
  written atomically.
- 4dp stored, 2dp displayed, round half-up.

### Exchange rates

Rates are fetched automatically and top themselves up when they go stale. Nothing ever
requires you to type one.

Resolution **never touches the network** — it reads only what is already stored, which is
what makes the app work offline and why a provider outage cannot break a write. The order
is: identity → stored direct → stored reverse (inverted) → triangulated through EGP →
a built-in emergency default. Anything that is not an exact stored match says so.

A figure whose rate post-dates it is marked as approximate rather than presented as exact.
That is the honest state of a backdated entry, because the free rates endpoint has no
history to look it up in.

You can override any rate by hand on the Currency page — for a parallel-market rate, or a
bank's rate including its spread. A typed rate wins ties against an automatic one.

Rates by [ExchangeRate-API](https://www.exchangerate-api.com).

---

## Your data

Everything lives in the Postgres container. Settings → Data has three things:

- **Export** — one JSON file with every row, each figure exactly as it was frozen rather
  than reconverted. Keep it somewhere that is not this machine.
- **Restore** — pick a file and you get a summary of what would change *before* anything is
  written. A restore replaces rather than merges, preserves ids, and writes the frozen
  figures back verbatim, so history is never restated at today's rate. A backup that
  references rows it does not contain is refused with the reason, and nothing is written.
- **Erase all data** — guarded by a typed confirmation. Optionally puts the starter
  categories and rates back so the app is usable immediately afterwards.

Import and reset both run in a single transaction: they either happen completely or not
at all.

---

## Keyboard

| | |
|---|---|
| `c` | Open the calculator, from anywhere |
| `Enter` in the calculator | Work it out and add it to the tape |
| `Esc` | Close the calculator or the open sheet |
| `Tab` from the top | Skip to content |

Amount fields accept arithmetic — type `1200*3+450` and press Enter. The same parser runs
on the client, in the calculator and on the server, so `10/3` cannot mean three different
things in three places.

---

## Reference

- `SPEC.md` — what this is meant to be. The source of truth.
- `DECISIONS.md` — the decisions D1–D12 that shaped it, and why.
- `CLAUDE.md` — how the repo is actually put together; conventions and traps.
- `requests.http` — every endpoint, ready to run.

## Not in this version

Auth, multi-user, receipt OCR, bank sync, recurring transactions, notifications, offline
sync, Arabic localisation, a mobile app, and deployment beyond localhost. Debt interest and
a configurable base currency were deliberately cut — see `SPEC.md` §14 for the reasoning.
