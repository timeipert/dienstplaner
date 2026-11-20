// Tests for the Excel export (calendar layout) and the built-in ZIP writer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { newState, getPlan } from '../src/js/model.js';
import { generate, buildProblem } from '../src/js/scheduler.js';
import { planToXlsx } from '../src/js/exporters.js';
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
  const s = newState('team3');
  const r = generate(s, '2026-12', { budgetMs: 500 });
  getPlan(s, '2026-12').duties = r.duties;
  const files = unzip(planToXlsx(s, buildProblem(s, '2026-12', { keep: 'all' })));
  for (const f of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']) assert.ok(files[f], f);
  const sheet = files['xl/worksheets/sheet1.xml'];
  for (const t of ['Mo', 'So', 'KW 49', 'KW 53', '1. Dezember', 'J1', 'N', 'Std. Woche']) assert.ok(sheet.includes(`>${t}<`), t);
  assert.match(sheet, />14–\d\d(:30)? T</, 'Tuesday duty with appointment mark');
  assert.match(sheet, />\d+(,5)? \/ \d+(,5)?</, 'worked / target hours');
});
