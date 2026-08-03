# DECISIONS.md — answers to the Phase 0 read-back

**This file overrides SPEC.md wherever they conflict.** At the end of Phase 0, fold every decision here back into SPEC.md so there is exactly one source of truth, then leave this file in place as a changelog of what changed and why.

Good catches. Items D2, D5 and the ExchangeRate constraint in D1 were errors in the spec, not ambiguities in it. D10 and D11 are two further gaps I found afterwards while verifying the rate provider — neither was in your list because neither was visible from the spec text alone.

---

## Assumptions — all approved, with three notes

Approved as stated: Docker/Postgres on localhost, build-time network, `tw-animate-css`, `git init`, 4dp storage rounding, LAN mobile access via `vite --host`, rate direction (`1 base = rate quote`, inverses derived by division), one-level nesting enforced in validation, import replaces-all in one transaction preserving IDs with a dry-run diff.

Three amendments:

**`decimal.js` on the client — approved, and it's now a shared-workspace dependency** (see D7). §2's split was wrong; §4 and §8 always implied it.

**Decimal unification — take it further than you proposed.** Don't convert "at the Prisma boundary," convert at *every* boundary: **strings are the only interchange format.** Prisma returns `Prisma.Decimal` → immediately `.toString()` → `decimal.js` inside the service → `.toFixed(4)` string on the way out to JSON. No `Decimal` instance of either class ever crosses a module boundary or gets serialised. That kills the `instanceof` problem outright rather than managing it, and it means the wire format and the DB format are already the same thing.

**`q` filter — approved as note-only**, case-insensitive contains. Don't widen it to category/account names; those are already dedicated filters and mixing them makes results unexplainable.

**`supertest` — approved, add it.** Service-level tests plus a `.http` file isn't enough verification for Phase 3. I want real route tests covering: transfer atomicity, the 409/404 Prisma error mappings, and validation rejections.

---

## Blocking answers

### D1. ExchangeRate constraint — your proposal, plus a rename

Unique on `(base, quote, source, asOf)`. `MANUAL` wins ties.

Rename `fetchedAt` → **`asOf`**, meaning "the moment this rate takes effect." For `ApiRateProvider` that's the provider's own timestamp; for `ManualRateProvider` it's when I typed it. `fetchedAt` was a lie for manual rates and nothing exists yet, so the rename is free.

`getRate(base, quote, atDate)` resolution order:
1. `WHERE base, quote, asOf <= atDate` → `ORDER BY asOf DESC, (source = 'MANUAL') DESC` → take first.
2. Nothing at-or-before → newest row overall, `stale: true`.
3. No rows at all → hardcoded emergency default, `stale: true`.

Index on `(base, quote, asOf DESC)`.

### D2. Transfers — two linked rows, and drop `transferAccountId`

You're right that the model contradicted §7. Replace `transferAccountId` with **`transferGroupId String? @db.Uuid`**, indexed. A transfer writes two `TXType.TRANSFER` rows in one Prisma transaction, sharing a `transferGroupId`:

- **Outflow** on the source account, in the source account's currency, negative-signed.
- **Inflow** on the destination account, in the destination account's currency, positive-signed.

Each row carries its own `amount`, `currency`, `rateToEgp`, `amountEgp` — frozen independently, exactly like any other row.

For a cross-currency transfer, **I enter both sides.** The form pre-fills the destination amount from the current rate, and I can overwrite it. That is not a convenience, it's the point: when $500 lands in my EGP account, the amount that actually arrives reflects the bank's spread, not the mid-market rate. Forcing the app's rate onto the destination would make the balance wrong.

**Aggregation rule:** `TRANSFER` rows are excluded from all income/expense/category/budget aggregates. They affect account balances and nothing else.

**Add this, it's cheap and it matters for my situation:** where a transfer group's two rows have different currencies, the difference between outflow `amountEgp` and inflow `amountEgp` is the real conversion cost. Expose it as a derived `conversionCostEgp` per group, and surface the monthly total on the dashboard as "Cost of converting." I want to see what the spread is taking from me.

### D3. Accounts are single-currency — take your simplest honest option

**A transaction's currency must equal its account's currency.** Enforce it in the zod schema and at the service layer. An EGP account holds EGP transactions; if I spend USD cash, that's a separate USD cash account.

This removes the recomputation problem entirely: native balance is exact arithmetic on same-currency rows, and `balanceEgp` is the sum of frozen `amountEgp` values, which is historically honest by construction. For EGP accounts `rateToEgp` is always exactly `1`.

Cross-currency movement has exactly one representation: a transfer (D2).

### D4. Debt currency — your approach. Interest — cut it

**Remaining balance lives in the debt's native currency.** `remainingEgp` is a display-only conversion at the current rate, and it carries the same stale flag as any other live conversion. Never subtract historical-rate payments from a current-rate principal; you correctly called that incoherent.

**Payments may be in a different currency than the debt.** `DebtPayment` stores: `amount`, `currency`, `rateToDebtCurrency`, `amountInDebtCurrency`, `rateToEgp`, `amountEgp` — all frozen at the payment date. Remaining = `principal − Σ amountInDebtCurrency`, all in debt currency. Verbose, but every figure is defensible.

**Remove `interestRatePct` from v1.** Simple interest with no accrual basis, no payment allocation between principal and interest, and no compounding schedule is a half-feature that produces numbers I can't defend. My debts are person-to-person and interest-free. Move it to §14 out-of-scope; if I want it later it gets its own spec with an explicit day-count convention.

### D5. Opening balances — store the rate, exactly as you proposed

Add to `Account`: **`openingDate DateTime`** and **`openingRateToEgp Decimal @db.Decimal(18,8)`**, both frozen at account creation. `openingBalanceEgp` is derived once and stored.

Net worth at any past date then falls out for free:

```
netWorthEgp(at) = Σ accounts [ openingBalanceEgp + Σ amountEgp WHERE date <= at ]
```

Every term is a frozen historical figure, so "delta vs last month" is a real comparison rather than two snapshots of today's rate wearing different hats. No recomputation, no §4.4 violation.

---

## Disagreements — you win all four

### D6. `baseCurrency` — EGP-locked in v1

You're right that shipping a switcher that changes nothing violates the spec's own rule. Keep the column (schema stability), hard-lock the value to `EGP`, and render it in Settings as a **disabled field labelled "EGP — fixed in this version."** Visible so I know where it will live, honest about doing nothing.

Do **not** rename `amountEgp` → `amountBase`. That's churn for a feature that isn't shipping.

### D7. Shared workspace — approved

Add a third workspace, **`shared/`**. It contains:

- `expression.ts` and its tests (single implementation, no drift)
- currency enum and money formatting helpers
- the API DTO types and the zod schemas both sides validate against

Hard rule: **`shared/` never imports Prisma** and never imports from `client/` or `server/`. It is leaf-level. This gets me end-to-end types across the wire as a bonus, which is worth more than the layout deviation costs.

Update §3's tree accordingly when you fold this into SPEC.md.

### D8. `concurrently` — approved

Root `dev` script runs both workspaces through it. Colour-prefix the two streams.

### D9. `@fontsource` — approved

Self-host Inter Tight and JetBrains Mono via `@fontsource-variable`. A CDN font link would contradict the offline requirement and add a render-blocking request for no benefit.

---

## Minor

- **`PUT /budgets?month=` is a bulk upsert of the whole month.** Confirmed. Add **`POST /budgets/copy`** taking `{ fromMonth, toMonth, overwrite: boolean }`.
- **Budgets are EGP-only, deliberately.** Budgets control spending, and I spend in EGP. Multi-currency budgets would need a rate policy that adds nothing.
- **Staleness threshold:** use the provider's `time_next_update_unix` when present; otherwise **30h**. You're right that 24h sits on the boundary and would flicker amber every day.
- **`decimal.js` client bundle weight:** accepted. The expression parser needs it and correctness beats ~13KB gzipped.

---

## FX provider — verified 2026-08-03

`GET https://open.er-api.com/v6/latest/USD` was called and confirmed live: no key, no signup, CORS enabled, `result: "success"`, `time_eol_unix: 0`. EGP is present. Sanity values for the seed, as of the check:

| Pair | Rate |
|---|---|
| USD → EGP | 51.1232 |
| EUR → EGP | ~58.86 |
| GBP → EGP | ~68.81 |

Seed with these so the app is never empty on first run, marked `source: MANUAL`, `asOf: 2026-08-03`. They are a starting point, not a claim of accuracy.

Free-tier constraints that shape the design: **once-daily updates**, **no historical rates**, attribution required, redistribution forbidden.

### D10. Attribution is a licence condition, not a nicety

Render a small "Rates by Exchange Rate API" link (to `https://www.exchangerate-api.com`) in the footer of `/currency` and in Settings, shown whenever `ratesApiEnabled` is true. Not optional — it's the terms of the endpoint.

Read `time_eol_unix` on every refresh and persist it. If it ever returns non-zero, surface a persistent warning in Settings with the deprecation date so I can switch providers before it dies rather than after.

### D11. No historical rates — backdated entries must prompt, not guess

The free endpoint returns today's rates only. So when I add a transaction with a past date and no stored rate exists at-or-before it, `getRate` falls back to a newer rate under D1's rule 2. That fallback is correct for a *live* conversion and silently wrong for a *historical* one.

Do not let it pass quietly. In the transaction, debt-payment and contribution forms: if the selected date is **more than 48h in the past** and no rate exists at-or-before it, show an inline notice stating which date the suggested rate is actually from, and focus the rate field so I can overwrite it. Same treatment on the import path — flag backdated rows resolved by fallback in the dry-run diff rather than importing them silently.

Rationale, so it isn't optimised away later: backfilling several months of history at today's rate produces a net-worth chart that looks smooth and is entirely fiction. The manual override is the fix, but only if the app tells me I need it.

---

## Go

Apply D1–D11 to SPEC.md, then implement **Phase 0 and Phase 1 only**. Run each phase's acceptance checks, commit conventionally at each boundary, and stop and report before Phase 2.

If anything here creates a new contradiction you can see and I can't, say so before you start rather than working around it.
