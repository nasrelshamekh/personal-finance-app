/**
 * When is a converted figure an approximation? (D12)
 *
 * The free rates endpoint has no history, so a transaction dated in the past can only be
 * converted with a rate from later than it. Those rows are flagged so a backfilled
 * net-worth chart is visibly estimated rather than quietly fictional.
 *
 * The comparison is at **day** granularity, deliberately. Rates move once a day, so a
 * rate recorded at 11:00 is the right rate for a transaction dated 09:00 that same day —
 * comparing timestamps would flag every expense entered a few hours after it happened,
 * which is most of them, and an indicator that fires constantly says nothing.
 */
function utcDayIndex(value: Date): number {
  return Math.floor(value.getTime() / 86_400_000);
}

export function isRateApproximate(rateAsOf: Date, transactionDate: Date): boolean {
  return utcDayIndex(rateAsOf) > utcDayIndex(transactionDate);
}
