import { describe, expect, it } from 'vitest';
import {
  Decimal,
  ZERO,
  abs,
  add,
  compare,
  convert,
  div,
  format,
  formatAmount,
  formatEgp,
  formatMoneyParts,
  formatRate,
  invertRate,
  isZero,
  mul,
  negate,
  roundRate,
  roundStorage,
  sub,
  sum,
  toDecimal,
  toRateString,
  toStorageString,
} from './money';

describe('toDecimal', () => {
  it('accepts strings, numbers and Decimals', () => {
    expect(toDecimal('1250.0000').toFixed(2)).toBe('1250.00');
    expect(toDecimal(1250).toFixed(2)).toBe('1250.00');
    expect(toDecimal(new Decimal('1250')).toFixed(2)).toBe('1250.00');
  });

  it('preserves precision a float would destroy', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. This is the whole reason for Decimal.
    expect(add('0.1', '0.2').toFixed(4)).toBe('0.3000');
    expect(toDecimal('9007199254740993.0001').toFixed(4)).toBe('9007199254740993.0001');
  });

  it('rejects values that are not finite numbers', () => {
    expect(() => toDecimal('not-money')).toThrow();
    expect(() => toDecimal(Number.NaN)).toThrow(TypeError);
    expect(() => toDecimal(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe('arithmetic', () => {
  it('adds, subtracts and multiplies exactly', () => {
    expect(add('1200.5000', '450.2500').toFixed(4)).toBe('1650.7500');
    expect(sub('1000.0000', '1250.5000').toFixed(4)).toBe('-250.5000');
    expect(mul('1200', '3').toFixed(4)).toBe('3600.0000');
  });

  it('divides with real precision, not float precision', () => {
    expect(div('10', '3').toFixed(10)).toBe('3.3333333333');
    expect(mul(div('10', '3'), '3').toFixed(4)).toBe('10.0000');
  });

  it('throws rather than returning Infinity on divide by zero', () => {
    expect(() => div('10', '0')).toThrow(RangeError);
  });

  it('sums an empty list to zero', () => {
    expect(sum([]).equals(ZERO)).toBe(true);
    expect(sum(['1.1', '2.2', '3.3']).toFixed(4)).toBe('6.6000');
  });

  it('sums signed amounts, which is how balances are computed', () => {
    // SPEC §4.7: income positive, expense negative, so a balance is a plain sum.
    expect(sum(['5000.0000', '-1250.5000', '-300.2500']).toFixed(4)).toBe('3449.2500');
  });

  it('negates, absolutes and compares', () => {
    expect(negate('250.50').toFixed(2)).toBe('-250.50');
    expect(abs('-250.50').toFixed(2)).toBe('250.50');
    expect(isZero('0.0000')).toBe(true);
    expect(compare('1', '2')).toBe(-1);
    expect(compare('2', '2')).toBe(0);
    expect(compare('3', '2')).toBe(1);
  });
});

describe('rounding', () => {
  it('rounds half away from zero at storage precision', () => {
    expect(roundStorage('1.00005').toFixed(4)).toBe('1.0001');
    expect(roundStorage('-1.00005').toFixed(4)).toBe('-1.0001');
    expect(roundStorage('1.00004').toFixed(4)).toBe('1.0000');
  });

  it('does not round anything already within precision', () => {
    expect(toStorageString('1250')).toBe('1250.0000');
    expect(toStorageString('1250.12345')).toBe('1250.1235');
  });

  it('rounds rates at 8dp', () => {
    expect(roundRate('51.123456789').toFixed(8)).toBe('51.12345679');
    expect(toRateString('51.1232')).toBe('51.12320000');
  });
});

describe('convert', () => {
  it('multiplies and freezes at storage precision', () => {
    // $500 at 51.1232 -> 25,561.60 EGP
    expect(convert('500', '51.1232').toFixed(4)).toBe('25561.6000');
  });

  it('keeps the sign of the original amount', () => {
    expect(convert('-500', '51.1232').toFixed(4)).toBe('-25561.6000');
  });

  it('is exact for an EGP amount, where the rate is 1', () => {
    expect(convert('1250.5000', '1').toFixed(4)).toBe('1250.5000');
  });

  it('rounds the product rather than the operands', () => {
    // 33.333333 * 3.3333 = 111.1099988889 -> 111.1100.
    // Pre-rounding the amount to 4dp first would give 111.1099 — a different figure.
    expect(convert('33.333333', '3.3333').toFixed(4)).toBe('111.1100');
    expect(convert('33.3333', '3.3333').toFixed(4)).toBe('111.1099');
  });
});

describe('invertRate', () => {
  it('derives the reverse pair by division', () => {
    expect(invertRate('51.1232').toFixed(8)).toBe('0.01956059');
  });

  it('round-trips back to roughly the original rate', () => {
    const back = invertRate(invertRate('51.1232'));
    expect(back.minus('51.1232').abs().lessThan('0.0001')).toBe(true);
  });

  it('refuses to invert zero', () => {
    expect(() => invertRate('0')).toThrow(RangeError);
  });
});

describe('formatting', () => {
  it('groups thousands and shows 2dp by default', () => {
    expect(formatAmount('12480')).toBe('12,480.00');
    expect(formatAmount('12480.005')).toBe('12,480.01');
  });

  it('formats without a float round-trip for large figures', () => {
    expect(formatAmount('9007199254740993.45')).toBe('9,007,199,254,740,993.45');
  });

  it('honours signDisplay', () => {
    expect(formatAmount('-3205.5')).toBe('-3,205.50');
    expect(formatAmount('-3205.5', { signDisplay: 'never' })).toBe('3,205.50');
    expect(formatAmount('3205.5', { signDisplay: 'always' })).toBe('+3,205.50');
  });

  it('appends the currency code for plain-text contexts', () => {
    expect(format('12480', 'USD')).toBe('12,480.00 USD');
    expect(formatEgp('12480')).toBe('12,480.00 EGP');
  });

  it('splits parts so the UI can style figure and code separately', () => {
    expect(formatMoneyParts('-3205.5', 'EGP', { signDisplay: 'never' })).toEqual({
      amount: '3,205.50',
      currency: 'EGP',
      direction: -1,
      isNegative: true,
    });
    expect(formatMoneyParts('0', 'EGP').direction).toBe(0);
  });

  it('trims trailing noise from rates but keeps at least 2dp', () => {
    expect(formatRate('51.1232')).toBe('51.1232');
    expect(formatRate('51')).toBe('51.00');
  });
});
