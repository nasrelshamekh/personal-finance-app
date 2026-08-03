# CLAUDE.md — working conventions for Ledger EG

`SPEC.md` is the single source of truth for *what* to build. This file records *how* this
repo is actually put together, so a future session doesn't drift. `DECISIONS.md` is the
changelog of decisions D1–D11 that were folded into SPEC.md.

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

## Client feature pattern

Every folder under `client/src/features/<name>/` owns its components, its `api.ts` (typed
fetch calls) and its `queries.ts` (TanStack Query hooks + a query-key factory).
**Components never call `fetch` directly.**

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
- `client/src/components/ui/` is shadcn-generated. Extend by wrapping, don't hand-edit. If
  you genuinely must, note it here.

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

## Testing

`vitest` per workspace; `npm test` at the root fans out. Route-level tests use `supertest`
against `createApp()` from `server/src/app.ts`, which is why app construction is separate
from `listen()`.

**Server tests need Postgres running** (`npm run db:up`). Rate resolution is an ORDER BY,
and a fake repository would test a reimplementation of the rule rather than the one that
runs. DB-backed tests use `withRollback()` from `server/src/test/db.ts` so they never
touch real data.

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
