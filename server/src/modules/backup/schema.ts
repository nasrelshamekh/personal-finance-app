/**
 * The backup wire contract lives in `shared/` (D7) — both sides validate the same
 * schemas, which is what makes a dump written by this app readable by it. There are no
 * server-only concerns to layer on: an import has no pagination, no params and no query
 * coercion, so this module re-exports and adds nothing.
 */
export {
  backupSchema,
  importRequestSchema,
  resetRequestSchema,
  RESET_CONFIRMATION,
} from '@ledger/shared';
