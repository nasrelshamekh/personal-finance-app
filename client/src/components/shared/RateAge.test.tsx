import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { resolvedRate } from '@/test/fixtures';
import { RateAge } from './RateAge';

/**
 * The amber dot (SPEC §4.6). Two rules, and both are about not overstating what is known:
 * staleness is never signalled by colour alone, and a rate that was *derived* is never
 * passed off as one that was recorded.
 *
 * `FxStrip.test.tsx` covers this through the strip; here it is driven directly, which is
 * the only way to reach the fresh-and-direct case where the tooltip is deliberately absent.
 */

function show(node: ReactNode) {
  return render(<TooltipProvider delayDuration={0}>{node}</TooltipProvider>);
}

describe('a fresh, directly recorded rate', () => {
  it('says how old it is, in words', () => {
    show(<RateAge rate={resolvedRate({ ageMs: 24 * 60 * 60 * 1000 })} />);

    expect(screen.getByText('1 day ago')).toBeInTheDocument();
  });

  /**
   * Nothing to explain, so nothing to focus. A tooltip trigger on every rate in the app
   * would put a stop in the tab order for each one and say "this is fine" when tabbed to.
   */
  it('is not focusable, because there is nothing to explain', () => {
    const { container } = show(<RateAge rate={resolvedRate()} />);

    expect(container.querySelector('[tabindex="0"]')).toBeNull();
  });

  it('shows no dot', () => {
    const { container } = show(<RateAge rate={resolvedRate()} />);

    expect(container.querySelector('.bg-money-stale')).toBeNull();
  });
});

describe('a stale rate', () => {
  const stale = resolvedRate({
    stale: true,
    staleReason: 'OLDER_THAN_30H',
    ageMs: 40 * 60 * 60 * 1000,
    asOf: new Date(Date.now() - 40 * 60 * 60 * 1000).toISOString(),
  });

  /** Never colour alone: the dot is always paired with the age in readable text. */
  it('pairs the dot with text rather than standing on the colour', () => {
    const { container } = show(<RateAge rate={stale} />);

    expect(container.querySelector('.bg-money-stale')).not.toBeNull();
    expect(screen.getByText(/ago$/)).toBeInTheDocument();
  });

  it('explains why it is stale, not merely that it is', async () => {
    const user = userEvent.setup();
    show(<RateAge rate={stale} />);

    await user.tab();

    expect(await screen.findByText('This rate may be out of date')).toBeInTheDocument();
    expect(
      screen.getByText('No newer rate has been recorded in over 30 hours.'),
    ).toBeInTheDocument();
  });

  it('gives each reason its own explanation', async () => {
    const user = userEvent.setup();
    show(<RateAge rate={resolvedRate({ stale: true, staleReason: 'NO_RATE_AT_ALL' })} />);

    await user.tab();

    expect(
      await screen.findByText('No rate has ever been recorded for this pair.'),
    ).toBeInTheDocument();
  });
});

describe('a derived rate', () => {
  /**
   * Fresh, but not recorded. Resolution falls back through inversion and triangulation
   * (SPEC §4.6), and a figure arrived at by arithmetic must say so — otherwise the app
   * claims a precision it does not have.
   */
  it('opens itself to a tooltip even though it is not stale', async () => {
    const user = userEvent.setup();
    show(<RateAge rate={resolvedRate({ derivation: 'TRIANGULATED' })} />);

    await user.tab();

    expect(await screen.findByText('Derived rate')).toBeInTheDocument();
    expect(screen.getByText('Calculated through EGP from two rates.')).toBeInTheDocument();
  });

  it('names the emergency default as a fallback rather than a rate', async () => {
    const user = userEvent.setup();
    show(<RateAge rate={resolvedRate({ derivation: 'EMERGENCY_DEFAULT' })} />);

    await user.tab();

    expect(
      await screen.findByText('A built-in fallback, not a recorded rate.'),
    ).toBeInTheDocument();
  });
});

describe('a backdated lookup', () => {
  /**
   * `ageMs` goes negative when the only rate available post-dates the transaction (D12).
   * "In 6 months ago" is nonsense, so the date the rate is actually from is named instead.
   */
  it('names the date instead of counting forwards', () => {
    show(
      <RateAge
        rate={resolvedRate({
          ageMs: -1000 * 60 * 60 * 24 * 30,
          asOf: '2026-08-03T00:00:00.000Z',
          stale: true,
          staleReason: 'NO_RATE_AT_OR_BEFORE_DATE',
        })}
      />,
    );

    expect(screen.getByText(/^from /)).toBeInTheDocument();
    expect(screen.queryByText(/ago/)).toBeNull();
  });
});

describe('compact', () => {
  /** For a table cell that has no room for words — the dot survives, the age does not. */
  it('keeps the dot and drops the text', () => {
    const { container } = show(
      <RateAge rate={resolvedRate({ stale: true, staleReason: 'PAST_NEXT_UPDATE' })} compact />,
    );

    expect(container.querySelector('.bg-money-stale')).not.toBeNull();
    expect(screen.queryByText(/ago/)).toBeNull();
  });

  /** The age is gone from the row, so the tooltip is the only place left to read it. */
  it('still explains itself on focus', async () => {
    const user = userEvent.setup();
    show(<RateAge rate={resolvedRate({ stale: true, staleReason: 'PAST_NEXT_UPDATE' })} compact />);

    await user.tab();

    expect(
      await screen.findByText('The provider said it would have updated by now.'),
    ).toBeInTheDocument();
  });
});
