/**
 * Verifies that every preset × mode combination is actually legible.
 *
 * SPEC §11 asks for contrast on --primary-foreground over --primary to be checked in
 * both modes. Checking it by eye across twelve combinations is exactly the kind of thing
 * that gets done once and then quietly rots, so it is a script.
 *
 * Reads the real oklch values out of index.css, converts them to linear sRGB and reports
 * the WCAG 2.1 contrast ratio. Run: npm run check:contrast --workspace client
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS_PATH = fileURLToPath(new URL('../src/index.css', import.meta.url));

/** WCAG AA for large/bold text, which is what --primary is used for (buttons, labels). */
const MIN_RATIO = 4.5;

/** oklch(L C H) → linear sRGB, via oklab. Values outside [0,1] are clamped. */
function oklchToLinearRgb(l, c, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;

  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ].map((v) => Math.min(1, Math.max(0, v)));
}

function relativeLuminance([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const la = relativeLuminance(oklchToLinearRgb(...a));
  const lb = relativeLuminance(oklchToLinearRgb(...b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** `oklch(0.48 0.13 245)` → [0.48, 0.13, 245]. Percentages and `none` are not used here. */
function parseOklch(value) {
  const match = value.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

const css = readFileSync(CSS_PATH, 'utf8');

/** Pulls the declarations out of one selector block. */
function blockFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : null;
}

function readPair(selector, fallbackSelector) {
  const body = blockFor(selector) ?? '';
  const fallback = fallbackSelector ? (blockFor(fallbackSelector) ?? '') : '';

  const pick = (name) => {
    const own = body.match(new RegExp(`--${name}:\\s*([^;]+);`));
    if (own) return parseOklch(own[1]);
    const inherited = fallback.match(new RegExp(`--${name}:\\s*([^;]+);`));
    return inherited ? parseOklch(inherited[1]) : null;
  };

  return { primary: pick('primary'), foreground: pick('primary-foreground') };
}

const PRESETS = ['graphite', 'harbour', 'papyrus', 'meridian', 'cinnabar', 'basalt'];

const rows = [];
for (const preset of PRESETS) {
  for (const mode of ['light', 'dark']) {
    const selector =
      mode === 'light' ? `[data-theme='${preset}']` : `[data-theme='${preset}'].dark`;
    const { primary, foreground } = readPair(selector, mode === 'light' ? ':root' : '.dark');

    if (!primary || !foreground) {
      rows.push({ preset, mode, ratio: null });
      continue;
    }
    rows.push({ preset, mode, ratio: contrastRatio(foreground, primary) });
  }
}

let failed = 0;
console.log('\n  primary-foreground on primary\n');
console.log('  preset      mode    ratio   ');
console.log('  ─────────── ─────── ─────── ');

for (const { preset, mode, ratio } of rows) {
  if (ratio === null) {
    failed += 1;
    console.log(`  ${preset.padEnd(11)} ${mode.padEnd(7)} MISSING  ✗`);
    continue;
  }
  const ok = ratio >= MIN_RATIO;
  if (!ok) failed += 1;
  console.log(
    `  ${preset.padEnd(11)} ${mode.padEnd(7)} ${ratio.toFixed(2).padStart(6)}  ${ok ? '✓' : '✗'}`,
  );
}

console.log(`\n  ${rows.length - failed}/${rows.length} combinations meet ${MIN_RATIO}:1\n`);

if (failed > 0) {
  console.error(`  ${failed} combination(s) below ${MIN_RATIO}:1 — adjust the preset.\n`);
  process.exit(1);
}
