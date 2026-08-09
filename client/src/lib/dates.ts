/**
 * Today, as the `YYYY-MM-DD` a `<input type="date">` wants.
 *
 * Local parts, not `toISOString().slice(0, 10)`. The two disagree for the hours either side
 * of midnight — in Cairo, from 22:00 onwards UTC is still on yesterday — and the app was
 * using both: four sheets read the local date while the account sheet read the UTC one, so
 * late in the evening a new account opened "yesterday" while a transaction entered a second
 * later was dated today. A ledger cannot hold two opinions about what day it is.
 *
 * Local wins because the date on a transaction is the date *you* had, not the date at
 * Greenwich. Months are the other way round (see `hooks/useMonth`) — those key server
 * ranges, which are UTC, and a month boundary is not something you type by hand.
 */
export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
