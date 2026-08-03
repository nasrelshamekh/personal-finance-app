import { fxConvertQuerySchema, fxManualRateSchema } from '@ledger/shared';

/**
 * The wire contract lives in `shared/src/dto/fx.ts` so the client validates against the
 * same schemas (D7). This file re-exports it and is where server-only concerns — query
 * coercion, params, pagination — would be layered on. FX has none yet.
 */
export { fxConvertQuerySchema, fxManualRateSchema };

export type { FxConvertQuery, FxManualRateInput } from '@ledger/shared';
