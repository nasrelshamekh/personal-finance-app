import { describe, expect, it } from 'vitest';
import { STALE_AFTER_MS } from '@ledger/shared';
import { assessStaleness, worstOf } from './staleness';

const NOW = new Date('2026-08-03T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

describe('assessStaleness — provider timetable', () => {
  it('is fresh before the provider says it will update', () => {
    const result = assessStaleness({
      asOf: hoursAgo(20),
      nextUpdateAt: new Date(NOW.getTime() + 60_000),
      now: NOW,
    });

    expect(result.stale).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('is stale once that moment has passed', () => {
    const result = assessStaleness({
      asOf: hoursAgo(20),
      nextUpdateAt: new Date(NOW.getTime() - 60_000),
      now: NOW,
    });

    expect(result.stale).toBe(true);
    expect(result.reason).toBe('PAST_NEXT_UPDATE');
  });

  it('trusts the timetable over the age window', () => {
    // 40h old, but the provider says it is still current. Believe the provider.
    const result = assessStaleness({
      asOf: hoursAgo(40),
      nextUpdateAt: new Date(NOW.getTime() + 3_600_000),
      now: NOW,
    });

    expect(result.stale).toBe(false);
  });
});

describe('assessStaleness — 30h window', () => {
  it('is fresh inside the window', () => {
    expect(assessStaleness({ asOf: hoursAgo(29), nextUpdateAt: null, now: NOW }).stale).toBe(false);
  });

  it('is stale past it', () => {
    const result = assessStaleness({ asOf: hoursAgo(31), nextUpdateAt: null, now: NOW });
    expect(result.stale).toBe(true);
    expect(result.reason).toBe('OLDER_THAN_30H');
  });

  it('does not flip at exactly 30h', () => {
    const exactly = new Date(NOW.getTime() - STALE_AFTER_MS);
    expect(assessStaleness({ asOf: exactly, nextUpdateAt: null, now: NOW }).stale).toBe(false);

    const oneMsPast = new Date(NOW.getTime() - STALE_AFTER_MS - 1);
    expect(assessStaleness({ asOf: oneMsPast, nextUpdateAt: null, now: NOW }).stale).toBe(true);
  });

  it('is fresh at 24h, which is why the window is not 24h', () => {
    // The free tier updates once daily; a 24h window would flicker amber every day.
    expect(assessStaleness({ asOf: hoursAgo(24), nextUpdateAt: null, now: NOW }).stale).toBe(false);
  });

  it('reports age regardless of freshness', () => {
    expect(assessStaleness({ asOf: hoursAgo(2), nextUpdateAt: null, now: NOW }).ageMs).toBe(
      2 * 60 * 60 * 1000,
    );
  });
});

describe('worstOf', () => {
  const fresh = { stale: false, reason: null, ageMs: 1000 };
  const staleOld = { stale: true, reason: 'OLDER_THAN_30H' as const, ageMs: 500_000 };
  const staleNewer = { stale: true, reason: 'PAST_NEXT_UPDATE' as const, ageMs: 2000 };

  it('lets staleness win over freshness', () => {
    expect(worstOf(fresh, staleNewer)).toBe(staleNewer);
    expect(worstOf(staleNewer, fresh)).toBe(staleNewer);
  });

  it('picks the older of two stale legs', () => {
    expect(worstOf(staleNewer, staleOld)).toBe(staleOld);
  });

  it('picks the older of two fresh legs', () => {
    const older = { stale: false, reason: null, ageMs: 9000 };
    expect(worstOf(fresh, older)).toBe(older);
  });
});
