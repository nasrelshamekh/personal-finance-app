import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import { dismissFailure, getFailures, reportFailure, reportProblem } from '@/lib/action-feedback';
import { ActionFeedback } from './ActionFeedback';

afterEach(() => {
  for (const failure of getFailures()) dismissFailure(failure.id);
});

/** The store is outside React, so a push has to be wrapped for the re-render to flush. */
function report(headline: string, error?: unknown): void {
  act(() => {
    if (error === undefined) reportProblem(headline);
    else reportFailure(headline)(error);
  });
}

describe('the failure region', () => {
  it('is in the DOM before anything is reported', () => {
    const { container } = render(<ActionFeedback />);

    // A live region inserted at the same moment as its content is one most screen readers
    // never announce — it has to be there first for the insertion to count as a change.
    expect(container.querySelector('[aria-live="assertive"]')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the headline and the server detail on two lines', () => {
    render(<ActionFeedback />);

    report(
      'Cash (EGP) could not be archived.',
      new ApiError(409, 'CONFLICT', 'That account still has transactions.'),
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Cash (EGP) could not be archived.');
    expect(alert).toHaveTextContent('That account still has transactions.');
  });

  it('renders one alert per distinct failure', () => {
    render(<ActionFeedback />);

    report('Cash (EGP) could not be archived.');
    report('Bank (USD) could not be archived.');

    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });

  it('removes the message its close button belongs to', () => {
    render(<ActionFeedback />);

    report('First failure.');
    report('Second failure.');

    const buttons = screen.getAllByRole('button', { name: 'Dismiss this message' });
    expect(buttons).toHaveLength(2);

    act(() => buttons[0]?.click());

    const remaining = screen.getAllByRole('alert');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toHaveTextContent('Second failure.');
  });

  it('subscribes, so a failure reported after mount still appears', () => {
    render(<ActionFeedback />);

    expect(screen.queryByRole('alert')).toBeNull();
    report('Reported later.');

    expect(screen.getByRole('alert')).toHaveTextContent('Reported later.');
  });
});
