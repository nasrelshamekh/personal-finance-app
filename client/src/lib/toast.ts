import { toast } from 'sonner';

/**
 * The confirming half of user feedback — "that worked" — kept separate from
 * `action-feedback.ts`, which is "that didn't" (see its own comment for why that one is a
 * non-dismissing module-level store rather than this).
 *
 * A success is disposable in a way a failure is not: nothing is lost if you miss it, so
 * sonner's own auto-dismiss is the right behaviour here rather than something to fight.
 *
 * `notifySuccess` must still name its subject — "Cash (EGP) archived", not "Saved" — for
 * the same reason `reportFailure` does: several of these can be in flight from a list.
 */
export function notifySuccess(message: string): void {
  toast.success(message);
}
