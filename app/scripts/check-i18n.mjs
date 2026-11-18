// Lists English strings used with t('...') that have no Arabic translation yet,
// and Arabic entries whose {placeholders} don't match their English key.
// Usage: npm run check:i18n
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f) && !f.startsWith('i18n.ar')) files.push(p);
  }
})('src');

const keys = new Set();
for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'"));

const dict = new Map();
const ar = readFileSync('src/i18n.ar.ts', 'utf8');
for (const m of ar.matchAll(/^\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1:\s*(['"])((?:(?!\3)[^\\]|\\.)*)\3,?\s*$/gm)) dict.set(m[2].replace(/\\(['"])/g, '$1'), m[4]);

const ignore = /^(ABCD2345|VITE_\w+|npm run dev|app\/\.env|Hello \{name\})$/;
const missing = [...keys].filter(k => !dict.has(k) && !ignore.test(k)).sort();
const ph = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
const bad = [...dict].filter(([k, v]) => ph(k) !== ph(v)).map(([k]) => k);

console.log(`${keys.size} strings in the app, ${dict.size} Arabic entries.`);
if (missing.length) console.log(`Missing Arabic (${missing.length}):\n  ` + missing.join('\n  '));
if (bad.length) console.log(`Placeholder mismatch (${bad.length}):\n  ` + bad.join('\n  '));
if (!missing.length && !bad.length) console.log('All strings translated.');
process.exit(missing.length || bad.length ? 1 : 0);
