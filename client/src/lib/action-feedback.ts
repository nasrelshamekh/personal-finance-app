import { ApiError } from './api';

/**
 * One place for "that didn't work".
 *
 * A mutation fired from a list row — archive an account, mark a debt settled — has nowhere
 * of its own to put an error. It used to have nothing at all: `mutate()` with no handler
 * swallowed the failure, the row snapped back on the next refetch, and the app looked like
 * it had simply ignored the click. Nothing was lost, but you were not told.
 *
 * Deliberately a module-level store rather than a context: the region subscribes, and
 * nothing else in the tree re-renders when a message arrives. `reportFailure` is a plain
 * function so a call site is one argument longer, not one hook heavier:
 *
 *     remove.mutate(id, { onError: reportFailure(`${name} could not be archived.`) })
 */

export interface ActionFailure {
  id: number;
  /** What was being attempted, in the user's terms. Always present. */
  headline: string;
  /** The server's own words, when they add something the headline doesn't say. */
  detail: string | null;
}

/**
 * Beyond this the stack is noise rather than information. The oldest goes.
 *
 * There is no timer: a failure stays until it is dismissed. An error that removes itself
 * after a few seconds is the same silence this module exists to fix — you look away, the
 * action fails, and by the time you look back nothing ever happened. The cap and the close
 * button are what stop that costing anything.
 */
const MAX_VISIBLE = 3;

let failures: readonly ActionFailure[] = [];
let nextId = 1;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Must return a stable reference while nothing has changed — `useSyncExternalStore` loops otherwise. */
export function getFailures(): readonly ActionFailure[] {
  return failures;
}

export function dismissFailure(id: number): void {
  const next = failures.filter((failure) => failure.id !== id);
  if (next.length === failures.length) return;

  failures = next;
  emit();
}

/**
 * The message a failure should read as.
 *
 * The server's message is the specific half — "That account still has transactions" — and
 * the headline is the context it lacks. Anything that isn't an `ApiError` never reached the
 * server, so it says so rather than inventing a reason.
 */
function detailFor(error: unknown): string | null {
  if (error instanceof ApiError) {
    return error.message.trim() === '' ? null : error.message;
  }
  return 'The server could not be reached.';
}

function push(headline: string, detail: string | null): void {
  // Clicking a failing button twice should not say the same thing twice; it moves the
  // existing message to the end instead, so the repeat is still visible as a change.
  const withoutDuplicate = failures.filter(
    (failure) => failure.headline !== headline || failure.detail !== detail,
  );

  const failure: ActionFailure = { id: nextId++, headline, detail };
  failures = [...withoutDuplicate, failure].slice(-MAX_VISIBLE);
  emit();
}

/**
 * Builds an `onError` handler for a mutation.
 *
 * `headline` says what was being attempted and must name the thing — "Cash (EGP) could not
 * be archived", not "That could not be saved". A message that doesn't identify its subject
 * is barely better than silence when three rows are on screen.
 */
export function reportFailure(headline: string): (error: unknown) => void {
  return (error: unknown) => push(headline, detailFor(error));
}

/** For a failure that is already in hand rather than arriving through a mutation. */
export function reportFailureNow(headline: string, error: unknown): void {
  push(headline, detailFor(error));
}

/** A failure the caller has already worded completely, with no error object behind it. */
export function reportProblem(headline: string): void {
  push(headline, null);
}
