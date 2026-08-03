import { z } from 'zod';

/**
 * Building blocks every DTO shares. Money crosses the wire as a *string* (SPEC §4.2),
 * so these schemas validate the string form rather than coercing to a number — coercing
 * here would undo the entire point of Decimal.
 */

/** A signed decimal string, e.g. `-1250.0000`. Never a float. */
export const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'Must be a decimal number, e.g. 1250.00');

/** A strictly positive decimal string — exchange rates and target amounts. */
export const positiveDecimalString = decimalString.refine(
  (value) => Number.parseFloat(value) > 0,
  'Must be greater than zero.',
);

/**
 * Accepts `YYYY-MM-DD` or a full ISO timestamp and yields a Date. A bare date is read as
 * UTC midnight so a rate looked up "on the 3rd" doesn't shift with the server's timezone.
 */
export const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Must be a valid date.')
  .transform(
    (value) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value),
  );

/** `YYYY-MM` — the month selector used by budgets and the dashboard. */
export const monthString = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Must be a month, e.g. 2026-08');

/** Every list endpoint takes these (SPEC §7). Query values arrive as strings. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(25),
});

export const idParamSchema = z.object({
  id: z.string().uuid('That is not a valid id.'),
});

/** Hex colour, as stored on accounts, categories and goals. */
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex colour, e.g. #2f8f5b');

/** A lucide icon name. Not validated against the icon set — that would date badly. */
export const iconName = z.string().min(1).max(40);

/**
 * An amount the user typed. Accepted as a string because it may be arithmetic —
 * `1200*3+450` — which the service evaluates with the shared parser (SPEC §8). Validating
 * the arithmetic here would duplicate the parser inside a schema.
 */
export const amountInput = z.string().min(1, 'Enter an amount.').max(200);

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
