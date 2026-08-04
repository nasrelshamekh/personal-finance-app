/**
 * Display-only money helpers for the client.
 *
 * Deliberately a re-export: `shared/src/money.ts` is the single implementation, so a
 * figure is formatted identically wherever it appears. Arithmetic belongs on the server —
 * the client parses to Decimal only for the expression preview (SPEC §4.2).
 */
export {
  Decimal,
  formatAmount,
  formatMoneyParts,
  formatRate,
  format,
  formatEgp,
  evaluateExpression,
  isExpression,
  DISPLAY_DP,
  STORAGE_DP,
  type MoneyInput,
  type MoneyParts,
  type ExpressionResult,
  type ExpressionError,
} from '@ledger/shared';
