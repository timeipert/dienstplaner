// Short German texts for the wishes of one day, shown in the wishes view (view-avail.js).
// Pure functions, no DOM. A day string has one character per half hour (see model.js):
//   'x' cannot work, '-' rather not, '+' wants to work, 'o' can work (exception to the weekly
//   pattern), '.' no entry.
import { STEP, CELLS } from './model.js';
import { fmtMin } from './util.js';

const clockText = (m) => fmtMin(m).replace(/:00$/, ''); // 14:00 -> "14", 14:30 -> "14:30"

/** Runs of equal non-empty characters: [{ ch, from, to }] in minutes. */
export function runsOf(str) {
  const out = [];
  let i = 0;
  while (i < CELLS) {
    const ch = str[i];
    if (ch === '.' || ch == null) { i++; continue; }
    let j = i;
    while (j < CELLS && str[j] === ch) j++;
    out.push({ ch, from: i * STEP, to: j * STEP });
    i = j;
  }
  return out;
}

const WISH_LABEL = { x: 'nicht', '-': 'eher nicht', '+': 'möchte', o: 'frei' };
const WISH_WHOLE = { x: 'ganzer Tag nicht', '-': 'ganzer Tag eher nicht', '+': 'möchte ganztags', o: 'ganztags frei' };

/**
 * Texts for a day: eff = effective string (what applies, 'o' already resolved to '.'),
 * own = explicit entries of the day or pattern (to find the 'o' exceptions), range = visible
 * range [from, to] in minutes. A run that covers the whole range reads "ganzer Tag nicht",
 * a run that starts at the range start reads "nicht bis 12", one that ends at its end "nicht ab 18".
 * Returns [{ kind: 'x' | '-' | '+' | 'o', text }] ordered by time.
 */
export function describeDay(eff, own, range = [0, 24 * 60]) {
  const [r0, r1] = range;
  const runs = [...runsOf(eff), ...runsOf(own || '.'.repeat(CELLS)).filter((r) => r.ch === 'o')].sort((a, b) => a.from - b.from);
  return runs.map((r) => {
    const label = WISH_LABEL[r.ch];
    let text;
    if (r.from <= r0 && r.to >= r1) text = WISH_WHOLE[r.ch];
    else if (r.from <= r0) text = `${label} bis ${clockText(r.to)}`;
    else if (r.to >= r1) text = `${label} ab ${clockText(r.from)}`;
    else text = `${label} ${clockText(r.from)}–${clockText(r.to)}`;
    return { kind: r.ch, text };
  });
}
