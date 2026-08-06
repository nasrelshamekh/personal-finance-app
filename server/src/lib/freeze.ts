import { BASE_CURRENCY, type Currency, type Decimal } from '@ledger/shared';
import { getRate, type Db } from './fx';
import { convert, toRateString, toStorageString } from './money';

/**
 * Freezing a money figure — the single most important rule in this app (SPEC §4.3–4.4).
 *
 * A figure is converted once, at write time, and the rate that did it is stored beside
 * the result. Nothing is ever recomputed on read, so history cannot be rewritten by a
 * rate moving afterwards.
 */

export interface FrozenToEgp {
  rateToEgp: string;
  amountEgp: string;
  rateAsOf: Date;
}

export async function freezeToEgp(
  db: Db,
  amount: Decimal,
  currency: Currency,
  date: Date,
): Promise<FrozenToEgp> {
  const rate = await getRate(db, currency, BASE_CURRENCY, date);

  return {
    rateToEgp: toRateString(rate.rate),
    // The sign rides through: amountEgp always matches the sign of amount (SPEC §4.7).
    amountEgp: toStorageString(convert(amount, rate.rate)),
    rateAsOf: rate.asOf,
  };
}

export interface FrozenInto extends FrozenToEgp {
  /** Exactly 1 when the amount was already in the target currency. */
  rateToTarget: string;
  amountInTarget: string;
}

/**
 * The two-rate version, for a payment against a debt or a contribution to a goal.
 *
 * Both carry a balance in their own currency (D4, D4b) *and* a display figure in pounds,
 * so both conversions are frozen together. `rateAsOf` reports the **older** of the two:
 * the answer is only as current as its staler half, and claiming otherwise would overstate
 * how fresh the figures are.
 */
export async function freezeInto(
  db: Db,
  amount: Decimal,
  currency: Currency,
  target: Currency,
  date: Date,
): Promise<FrozenInto> {
  const [toTarget, toEgp] = await Promise.all([
    getRate(db, currency, target, date),
    getRate(db, currency, BASE_CURRENCY, date),
  ]);

  return {
    rateToTarget: toRateString(toTarget.rate),
    amountInTarget: toStorageString(convert(amount, toTarget.rate)),
    rateToEgp: toRateString(toEgp.rate),
    amountEgp: toStorageString(convert(amount, toEgp.rate)),
    rateAsOf: toTarget.asOf <= toEgp.asOf ? toTarget.asOf : toEgp.asOf,
  };
}
