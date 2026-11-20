// Tests for the Excel export (calendar layout) and the built-in ZIP writer.
import { testState } from './fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { newState, getPlan } from '../src/js/model.js';
import { generate, buildProblem } from '../src/js/scheduler.js';
import { planToXlsx, planToGrid, gridToTsv } from '../src/js/exporters.js';
import { zipStore } from '../src/js/xlsx.js';

/** Reads the entries of a ZIP archive (stored or deflated) into { name: text }. */
function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = {};
  let pos = 0;
  while (dv.getUint32(pos, true) === 0x04034b50) {
    const method = dv.getUint16(pos + 8, true);
    const size = dv.getUint32(pos + 18, true);
    const nameLen = dv.getUint16(pos + 26, true);
    const extra = dv.getUint16(pos + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(pos + 30, pos + 30 + nameLen));
    const data = bytes.subarray(pos + 30 + nameLen + extra, pos + 30 + nameLen + extra + size);
    out[name] = new TextDecoder().decode(method === 8 ? inflateRawSync(data) : data);
    pos += 30 + nameLen + extra + size;
  }
  return out;
}

test('zip writer: entries can be read back', () => {
  const z = unzip(zipStore([{ name: 'a.txt', data: 'Grüße' }, { name: 'b/c.xml', data: '<x/>' }]));
  assert.deepEqual(z, { 'a.txt': 'Grüße', 'b/c.xml': '<x/>' });
});

test('Excel export: calendar layout with weekday header, week blocks, duties and weekly hours', () => {
  const s = testState();
  const r = generate(s, '2026-12', { budgetMs: 500 });
  getPlan(s, '2026-12').duties = r.duties;
  const files = unzip(planToXlsx(s, buildProblem(s, '2026-12', { keep: 'all' })));
  for (const f of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']) assert.ok(files[f], f);
  const sheet = files['xl/worksheets/sheet1.xml'];
  for (const t of ['Mo', 'So', 'KW 49', 'KW 53', '1. Dezember', 'J1', 'N', 'Std. Woche']) assert.ok(sheet.includes(`>${t}<`), t);
  assert.match(sheet, />14–\d\d(:30)? W</, 'Tuesday duty with appointment mark');
  assert.match(sheet, />\d+(,5)? \/ \d+(,5)?</, 'worked / target hours');
});

test('Excel export: sheets "Zum Einfügen" and "Daten" after the calendar', () => {
  const s = testState();
  getPlan(s, '2026-12').duties = generate(s, '2026-12', { budgetMs: 300 }).duties;
  const files = unzip(planToXlsx(s, buildProblem(s, '2026-12', { keep: 'all' })));
  assert.match(files['xl/workbook.xml'], /name="Dezember 2026".*name="Zum Einfügen".*name="Daten"/);
  assert.ok(files['xl/worksheets/sheet2.xml'].includes('>01.12.2026<'));
  assert.ok(files['xl/worksheets/sheet3.xml'].includes('>Stunden<'));
});

test('table for a template: persons in rows, weekday and date headers, only times in cells', () => {
  const s = testState();
  const plan = getPlan(s, '2026-12');
  const j1 = s.people[0].id;
  plan.duties = { [`${j1}|2026-12-01`]: { from: '14:00', to: '19:00' }, [`${j1}|2026-12-02`]: { from: '14:30', to: '19:30' } };
  const P = buildProblem(s, '2026-12', { keep: 'all' });
  const two = planToGrid(s, P);
  assert.deepEqual(two[0].slice(0, 3), ['', 'Di', 'Mi']); // 1 Dec 2026 is a Tuesday
  assert.deepEqual(two[1].slice(0, 3), ['', '01.12.2026', '02.12.2026']);
  assert.deepEqual(two[2].slice(0, 3), ['J1', '14–19', '14:30–19:30']);
  assert.equal(two.length, 2 + 3);
  assert.equal(two[0].length, 1 + 31);
  const bare = planToGrid(s, P, { header: 'none', names: false, days: 'weekdays', time: 'long' });
  assert.equal(bare.length, 3);
  assert.equal(bare[0].length, 23); // weekdays of December 2026
  assert.deepEqual(bare[0].slice(0, 2), ['14:00–19:00', '14:30–19:30']);
  assert.deepEqual(planToGrid(s, P, { header: 'one' })[0].slice(1, 3), ['Di 01.12.', 'Mi 02.12.']);
  assert.equal(gridToTsv([['a', 'b'], ['', 'c']]), 'a\tb\r\n\tc\r\n');
});
