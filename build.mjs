// Builds dist/dienstplaner.html: one self-contained file (HTML + CSS + JS, no external requests).
// The ES modules in src/js are concatenated in dependency order inside one function scope:
// `import` lines are removed and `export` keywords stripped. Therefore top-level names must be
// unique across the files (checked below).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ORDER = ['util', 'model', 'scheduler', 'report', 'search', 'xlsx', 'exporters', 'store', 'ui-core', 'view-plan', 'view-avail', 'view-people', 'view-setup', 'view-data', 'view-appts', 'view-report', 'view-rules', 'app', 'main'];
const seen = new Map();
let js = '';
for (const name of ORDER) {
  let src = readFileSync(new URL(`./src/js/${name}.js`, import.meta.url), 'utf8');
  src = src.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '');
  src = src.replace(/^export\s+(async\s+function|function|const|let|class)/gm, '$1');
  for (const m of src.matchAll(/^(?:async\s+function|function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    if (seen.has(m[1])) throw new Error(`Duplicate top-level name "${m[1]}" in ${name}.js and ${seen.get(m[1])}.js`);
    seen.set(m[1], name);
  }
  js += `\n// ---- ${name}.js ----\n${src}`;
}
const css = readFileSync(new URL('./src/styles.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('./src/index.html', import.meta.url), 'utf8')
  .replace('/*INLINE_CSS*/', () => css)
  .replace('/*INLINE_JS*/', () => `(function () {\n'use strict';${js}\n})();`.replace(/<\/script/gi, '<\\/script'));
mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('./dist/dienstplaner.html', import.meta.url), html);
console.log(`dist/dienstplaner.html  ${(html.length / 1024).toFixed(0)} KB`);
