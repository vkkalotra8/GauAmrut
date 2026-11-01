// Contrast and palette audit for the GauAmrut design tokens.
//
//   node scripts/audit-contrast.mjs
//
// Reads the real token values out of src/styles.css — nothing is duplicated
// here — measures every foreground/background pair the UI paints, and fails
// the run if any of them falls short of WCAG 2.2 AA. It also flags any colour
// literal left outside the token layer, which is how the old dark-green theme
// kept creeping back into components.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { auditPairs, contrastRatio, parseTokens } from '../src/contrast.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const css = readFileSync(join(root, 'src/styles.css'), 'utf8');

const THEMES = [
  { name: 'light', selector: ':root' },
  { name: 'dark', selector: "[data-theme='dark']" }
];

let failures = 0;
const round = n => `${n.toFixed(2).padStart(6)}:1`;

for (const theme of THEMES) {
  const tokens = parseTokens(css, theme.selector);
  const pairs = auditPairs(tokens);
  const bad = pairs.filter(p => p.ratio < 4.5);

  console.log(`\n${theme.name.toUpperCase()} THEME — ${pairs.length} pairs, ${bad.length} below AA 4.5:1`);
  for (const pair of pairs.sort((a, b) => a.ratio - b.ratio)) {
    const ok = pair.ratio >= 4.5;
    if (!ok) failures += 1;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${round(pair.ratio)}  ${pair.label.padEnd(38)} ${pair.fgValue} on ${pair.bgValue}`);
  }
}

// Non-text UI: the focus ring and interactive borders must clear 3:1.
console.log('\nNON-TEXT (WCAG 1.4.11 — 3:1)');
const checks = THEMES.map(theme => {
  const t = parseTokens(css, theme.selector);
  const get = n => t[n];
  return [
    { theme: theme.name, label: 'focus ring on background', ratio: contrastRatio(get('--ring'), get('--background')), need: 3 },
    { theme: theme.name, label: 'focus ring on card', ratio: contrastRatio(get('--ring'), get('--card')), need: 3 },
    { theme: theme.name, label: 'input border on input', ratio: contrastRatio(get('--input-border'), get('--input')), need: 3 },
    { theme: theme.name, label: 'primary fill on background', ratio: contrastRatio(get('--primary'), get('--background')), need: 3 }
  ];
}).flat();

for (const check of checks) {
  const ok = check.ratio >= check.need;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${round(check.ratio)}  [${check.theme}] ${check.label}`);
}

// No colour literal may survive outside the token layer: that is precisely the
// mechanism by which a stale palette outlives the theme it came from.
console.log('\nCOLOUR LITERALS OUTSIDE THE TOKEN BLOCKS');
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
const tokenBodies = [];
for (const theme of THEMES) {
  const pattern = new RegExp(`${theme.selector.replace(/[[\]']/g, '\\$&')}\\s*\\{`, 'g');
  let m;
  while ((m = pattern.exec(stripped))) {
    let depth = 1;
    let i = pattern.lastIndex;
    while (i < stripped.length && depth > 0) {
      if (stripped[i] === '{') depth += 1;
      else if (stripped[i] === '}') depth -= 1;
      i += 1;
    }
    tokenBodies.push(stripped.slice(m.index, i));
  }
}
let bodyless = stripped;
for (const body of tokenBodies) bodyless = bodyless.replace(body, '');
// Printing must be black on white whichever theme is selected, so this one
// block is deliberately literal and is not part of the palette.
bodyless = bodyless.replace(/@media print \{[\s\S]*$/, '');

const strays = [];
for (const [index, line] of bodyless.split('\n').entries()) {
  for (const hex of line.match(/#[0-9a-fA-F]{3,8}\b/g) || []) {
    strays.push({ line: index + 1, hex, text: line.trim().slice(0, 90) });
  }
}
if (strays.length === 0) {
  console.log('  none — every colour comes from a semantic token');
} else {
  failures += strays.length;
  for (const stray of strays) console.log(`  FAIL line ${stray.line}: ${stray.hex}   ${stray.text}`);
}

// The dark theme must be a pure token redefinition — no component overrides.
// That single property is what makes "a colour pair forgot to go dark" a class
// of bug that can no longer exist: anything nested inside the block would show
// up as a second `{`.
const darkBlock = parseTokens(css, "[data-theme='dark']");
const open = css.indexOf("[data-theme='dark'] {") + "[data-theme='dark'] {".length;
let depth = 1;
let end = open;
while (end < css.length && depth > 0) {
  if (css[end] === '{') depth += 1;
  else if (css[end] === '}') depth -= 1;
  end += 1;
}
const nestedRules = (css.slice(open, end).match(/{/g) || []).length;
console.log(
  `\nDARK THEME: ${Object.keys(darkBlock).length} token redefinitions, `
  + `${nestedRules} component overrides`
);
if (nestedRules > 0) failures += nestedRules;

console.log(failures === 0 ? '\nAll contrast checks passed.\n' : `\n${failures} contrast/palette failure(s).\n`);
process.exit(failures === 0 ? 0 : 1);
