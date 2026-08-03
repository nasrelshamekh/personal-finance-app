import { Decimal, evaluateExpression } from '@ledger/shared';
import { AppError } from './errors';

/**
 * Turns a user-typed amount into a Decimal.
 *
 * Every money field accepts arithmetic (SPEC §8), so this runs the shared shunting-yard
 * parser — the same one the client previews with — and converts a parse failure into a
 * field-level 400 the form can attach to the input rather than a toast.
 */
export function parseAmount(input: string, field: string): Decimal {
  const parsed = evaluateExpression(input);

  if (!parsed.ok) {
    throw AppError.badRequest(parsed.error.message, {
      field,
      code: parsed.error.code,
      position: parsed.error.position,
    });
  }

  return parsed.value;
}

/**
 * The same, for fields that describe a magnitude. Income and expense are entered as "how
 * much", and the sign comes from the type (SPEC §4.7) — accepting a negative expense
 * would quietly mean income.
 */
export function parsePositiveAmount(input: string, field: string): Decimal {
  const value = parseAmount(input, field);

  if (value.isZero()) {
    throw AppError.badRequest('An amount of zero would not change anything.', { field });
  }
  if (value.isNegative()) {
    throw AppError.badRequest(
      'Enter the amount as a positive number — income or expense is set by the type.',
      { field },
    );
  }

  return value;
}
