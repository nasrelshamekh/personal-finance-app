import type { $Enums } from '@prisma/client';
import type { Currency } from '@ledger/shared';

/**
 * `shared/` is leaf-level and cannot import Prisma (SPEC §3), so `Currency` necessarily
 * exists twice — as a zod enum in shared, and as a Prisma enum in schema.prisma.
 *
 * These assertions fail to compile if the two lists ever diverge. There is no runtime
 * cost; the point is that adding a currency to one place breaks the build until it is
 * added to the other.
 */

type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// If either line errors, a currency was added or renamed in only one of the two enums.
const _currencyParity: AssertEqual<Currency, $Enums.Currency> = true;

export type { Currency };
export const CURRENCY_PARITY_CHECKED = _currencyParity;
