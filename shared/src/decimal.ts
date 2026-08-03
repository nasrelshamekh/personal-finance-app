import Decimal from 'decimal.js';

/**
 * The single configured Decimal for the whole app.
 *
 * decimal.js defaults to 20 significant digits, which is only just above what a
 * `Decimal(18,4)` column can hold — so a chained division could quietly exhaust its
 * headroom before the result was ever rounded for storage. 40 gives division and rate
 * inversion room to work in without ever being the reason a figure is wrong.
 *
 * This is deliberately a global `set` rather than `Decimal.clone()`: a clone is a
 * *different constructor*, so its instances fail `instanceof Decimal` and we would have
 * reintroduced exactly the two-Decimal-classes problem the wire-format rule exists to
 * kill (SPEC §2). One class, one configuration, configured once.
 *
 * Import Decimal from here — not from 'decimal.js' — so this runs first.
 */
Decimal.set({
  precision: 40,
  // Round half away from zero, in both directions. Already the library default; stated
  // explicitly because SPEC §4.5 depends on it.
  rounding: Decimal.ROUND_HALF_UP,
});

export { Decimal };
export default Decimal;
