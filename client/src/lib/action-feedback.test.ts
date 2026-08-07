import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import {
  dismissFailure,
  getFailures,
  reportFailure,
  reportFailureNow,
  reportProblem,
  subscribe,
} from './action-feedback';

/**
 * The store is a module-level singleton, which is the right shape for it — one region,
 * one queue — but it means a test leaks into the next one unless it clears up after
 * itself. Emptying it through the public API rather than adding a reset export keeps the
 * production surface honest.
 */
afterEach(() => {
  for (const failure of getFailures()) dismissFailure(failure.id);
});

describe('what a failure reads as', () => {
  it('keeps the headline and takes the detail from the server', () => {
    reportFailure('Cash (EGP) could not be archived.')(
      new ApiError(409, 'CONFLICT', 'That account still has transactions.'),
    );

    expect(getFailures()).toHaveLength(1);
    expect(getFailures()[0]).toMatchObject({
      headline: 'Cash (EGP) could not be archived.',
      detail: 'That account still has transactions.',
    });
  });

  it('says the server was unreachable when the failure never got that far', () => {
    // A TypeError is what fetch throws when the request never left the machine.
    reportFailure('The rates could not be refreshed.')(new TypeError('Failed to fetch'));

    expect(getFailures()[0]?.detail).toBe('The server could not be reached.');
  });

  it('never shows an empty second line', () => {
    reportFailure('Something failed.')(new ApiError(500, 'UNKNOWN', '   '));

    expect(getFailures()[0]?.detail).toBeNull();
  });

  it('takes a fully worded problem with no error behind it', () => {
    reportProblem('That file is not a Ledger EG backup.');

    expect(getFailures()[0]).toMatchObject({
      headline: 'That file is not a Ledger EG backup.',
      detail: null,
    });
  });
});

describe('the queue', () => {
  it('does not say the same thing twice', () => {
    const report = reportFailure('Cash (EGP) could not be archived.');
    const error = new ApiError(409, 'CONFLICT', 'That account still has transactions.');

    report(error);
    report(error);
    report(error);

    expect(getFailures()).toHaveLength(1);
  });

  it('moves a repeat to the end, so a second click is still visible as a change', () => {
    reportProblem('First');
    reportProblem('Second');
    reportProblem('First');

    expect(getFailures().map((failure) => failure.headline)).toEqual(['Second', 'First']);
  });

  it('stacks failures that name different things', () => {
    reportFailure('Cash (EGP) could not be archived.')(new ApiError(409, 'CONFLICT', 'Nope.'));
    reportFailure('Bank (USD) could not be archived.')(new ApiError(409, 'CONFLICT', 'Nope.'));

    expect(getFailures()).toHaveLength(2);
  });

  it('drops the oldest beyond three, because more than that is noise', () => {
    reportProblem('One');
    reportProblem('Two');
    reportProblem('Three');
    reportProblem('Four');

    expect(getFailures().map((failure) => failure.headline)).toEqual(['Two', 'Three', 'Four']);
  });

  it('removes only the one dismissed', () => {
    reportProblem('One');
    reportProblem('Two');

    const first = getFailures()[0];
    expect(first).toBeDefined();
    dismissFailure(first?.id ?? -1);

    expect(getFailures().map((failure) => failure.headline)).toEqual(['Two']);
  });

  it('ignores a dismissal for something already gone', () => {
    reportProblem('One');
    const id = getFailures()[0]?.id ?? -1;

    dismissFailure(id);
    dismissFailure(id);

    expect(getFailures()).toHaveLength(0);
  });

  /**
   * A failure stays until it is dismissed — see the note in the module. This pins that
   * down, because a timer is exactly the kind of thing a later change adds back for
   * tidiness without noticing it reintroduces the silence.
   */
  it('does not expire on its own', () => {
    vi.useFakeTimers();
    try {
      reportProblem('Still here');
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(getFailures()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('subscribers', () => {
  it('is told on report and on dismissal', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    reportProblem('One');
    expect(listener).toHaveBeenCalledTimes(1);

    dismissFailure(getFailures()[0]?.id ?? -1);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    reportProblem('Two');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  /** `useSyncExternalStore` re-renders forever if the snapshot is a fresh array each call. */
  it('returns the same snapshot reference while nothing has changed', () => {
    reportProblem('One');

    expect(getFailures()).toBe(getFailures());
  });

  it('returns a new reference once something has changed', () => {
    reportProblem('One');
    const before = getFailures();

    reportProblem('Two');

    expect(getFailures()).not.toBe(before);
  });

  it('reports an error already in hand', () => {
    reportFailureNow(
      '2 transactions kept their categories.',
      new ApiError(422, 'X', 'Wrong kind.'),
    );

    expect(getFailures()[0]).toMatchObject({
      headline: '2 transactions kept their categories.',
      detail: 'Wrong kind.',
    });
  });
});
