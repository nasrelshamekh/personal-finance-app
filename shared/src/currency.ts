import { z } from 'zod';

/**
 * The canonical currency list for the whole app.
 *
 * This enum necessarily exists twice: here, and as a Prisma enum in `schema.prisma`.
 * `shared/` is leaf-level and must never import Prisma (SPEC §3), so the two cannot be
 * derived from one another. `server/src/types/prisma-parity.ts` asserts at compile time
 * that the member lists match — if you add a currency, both must change.
 */
export const CURRENCIES = ['EGP', 'USD', 'EUR', 'GBP'] as const;

export const currencySchema = z.enum(CURRENCIES);

export type Currency = (typeof CURRENCIES)[number];

/** The base currency everything normalises to. Locked in v1 (SPEC §11, D6). */
export const BASE_CURRENCY: Currency = 'EGP';

/** The three foreign currencies, i.e. every currency that actually needs a rate. */
export const FOREIGN_CURRENCIES = CURRENCIES.filter(
  (c): c is Exclude<Currency, 'EGP'> => c !== BASE_CURRENCY,
);

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

/** Symbols are display sugar only; the currency *code* is always shown alongside. */
export const CURRENCY_SYMBOL: Record<Currency, string> = {
  EGP: 'E£',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export const CURRENCY_LABEL: Record<Currency, string> = {
  EGP: 'Egyptian pound',
  USD: 'US dollar',
  EUR: 'Euro',
  GBP: 'Pound sterling',
};
