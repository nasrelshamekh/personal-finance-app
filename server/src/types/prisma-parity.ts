import type { $Enums } from '@prisma/client';
import type {
  AccountType,
  CategoryKind,
  DebtDirection,
  DebtStatus,
  RateSource,
  TxType,
} from '@ledger/shared';
import type { Currency } from '@ledger/shared';

/**
 * `shared/` is leaf-level and cannot import Prisma (SPEC §3), so every enum necessarily
 * exists twice — as a zod enum in shared, and as a Prisma enum in schema.prisma.
 *
 * These assertions fail to compile if the two lists ever diverge. There is no runtime
 * cost; the point is that adding a member to one place breaks the build until it is added
 * to the other.
 */

type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// If any line errors, a member was added or renamed in only one of the two enums.
const _currencyParity: AssertEqual<Currency, $Enums.Currency> = true;
const _accountTypeParity: AssertEqual<AccountType, $Enums.AccountType> = true;
const _categoryKindParity: AssertEqual<CategoryKind, $Enums.CategoryKind> = true;
const _txTypeParity: AssertEqual<TxType, $Enums.TxType> = true;
const _debtDirectionParity: AssertEqual<DebtDirection, $Enums.DebtDirection> = true;
const _debtStatusParity: AssertEqual<DebtStatus, $Enums.DebtStatus> = true;
const _rateSourceParity: AssertEqual<RateSource, $Enums.RateSource> = true;

export type { Currency };
export const ENUM_PARITY_CHECKED = [
  _currencyParity,
  _accountTypeParity,
  _categoryKindParity,
  _txTypeParity,
  _debtDirectionParity,
  _debtStatusParity,
  _rateSourceParity,
] as const;
