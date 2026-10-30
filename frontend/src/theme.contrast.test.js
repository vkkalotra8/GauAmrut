import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { contrastRatio, parseTokens, resolveToken, AA_TEXT, AA_NON_TEXT } from './contrast';

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'styles.css'), 'utf8');

const THEMES = [
  { name: 'light', selector: ':root' },
  { name: 'dark', selector: "[data-theme='dark']" }
];

const tokensFor = name => parseTokens(CSS, THEMES.find(t => t.name === name).selector);

const round = n => Number(n.toFixed(2));

/**
 * Strips comments and returns every `{ selector, body }` pair, recursing into
 * @media wrappers. Asserting against the real stylesheet (rather than a
 * duplicated palette) is what makes these tests a regression guard: someone
 * repainting a component breaks the test even if the tokens stay compliant.
 */
function collectRules(css, into = []) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf('{', i);
    if (open === -1) break;
    const selector = source.slice(i, open).split(/[;\n]/).pop().trim();
    let depth = 1;
    let j = open + 1;
    while (j < source.length && depth > 0) {
      if (source[j] === '{') depth += 1;
      else if (source[j] === '}') depth -= 1;
      j += 1;
    }
    const body = source.slice(open + 1, j - 1);
    if (body.includes('{')) collectRules(body, into);
    else into.push({ selector, body });
    i = j;
  }
  return into;
}

const RULES = collectRules(CSS);

function ruleFor(selector) {
  const found = RULES.find(rule =>
    rule.selector.split(',').map(s => s.trim()).includes(selector)
  );
  if (!found) throw new Error(`No CSS rule found for: ${selector}`);
  return found.body;
}

/**
 * A component's real painted pair, plus the token names the rule must actually
 * reference. `bgInRule: false` means the element inherits a background (a
 * transparent tab, a table cell on a card) and the surface is named explicitly.
 */
const COMPONENTS = [
  { label: 'body copy', selector: 'body', fg: '--foreground', bg: '--background' },
  { label: 'primary button', selector: '.button.primary', fg: '--primary-foreground', bg: '--primary' },
  { label: 'primary button (hover)', selector: '.button.primary:hover', fg: '--primary-foreground', bg: '--primary-hover' },
  { label: 'secondary button', selector: '.button', fg: '--secondary-foreground', bg: '--card' },
  { label: 'secondary button (hover row)', selector: '.button:hover', fg: '--foreground', bg: '--hover-background' },
  { label: 'danger button', selector: '.button.danger', fg: '--destructive-foreground', bg: '--destructive' },
  { label: 'danger button (hover)', selector: '.button.danger:hover', fg: '--destructive-foreground', bg: '--destructive-hover' },
  { label: 'selected tab', selector: '.tab-nav .button.primary', fg: '--selected-foreground', bg: '--selected-background' },
  { label: 'resting tab', selector: '.tab-nav .button', fg: '--muted-foreground', bg: '--card', bgInRule: false },
  { label: 'resting tab (hover)', selector: '.tab-nav .button:hover', fg: '--foreground', bg: '--hover-background' },
  { label: 'sidebar link', selector: '.sidebar nav a', fg: '--sidebar-foreground', bg: '--sidebar-background', bgInRule: false },
  { label: 'sidebar link (hover)', selector: '.sidebar nav a:hover', fg: '--foreground', bg: '--hover-background' },
  { label: 'active sidebar link', selector: '.sidebar nav a.active', fg: '--selected-foreground', bg: '--selected-background' },
  { label: 'text button', selector: '.text-button', fg: '--link', bg: '--card', bgInRule: false },
  { label: 'text button (hover)', selector: '.text-button:hover', fg: '--link-hover', bg: '--card', bgInRule: false },
  { label: 'form input', selector: '.field input', fg: '--input-foreground', bg: '--input' },
  { label: 'form textarea', selector: '.field textarea', fg: '--input-foreground', bg: '--input' },
  { label: 'quantity stepper', selector: '.quantity input', fg: '--input-foreground', bg: '--input', bgInRule: false },
  { label: 'dialog', selector: 'dialog', fg: '--popover-foreground', bg: '--popover' },
  { label: 'dialog command input', selector: '.cmdk-input input', fg: '--foreground', bg: '--popover', bgInRule: false },
  { label: 'table header', selector: 'th', fg: '--table-header-foreground', bg: '--table-header-background' },
  { label: 'table cell', selector: 'td', fg: '--table-cell-foreground', bg: '--card', bgInRule: false },
  { label: 'page header', selector: '.topbar b', fg: '--header-foreground', bg: '--header-background', bgInRule: false },
  { label: 'bottom navigation', selector: '.bottom-nav a', fg: '--bottom-nav-foreground', bg: '--bottom-nav-background', bgInRule: false },
  { label: 'notice', selector: '.notice', fg: '--notice-foreground', bg: '--notice-background' },
  { label: 'notice (error)', selector: '.notice.error', fg: '--error-foreground', bg: '--error-soft' },
  { label: 'notice (warning)', selector: '.notice.warn', fg: '--warning-foreground', bg: '--warning-soft' },
  { label: 'status badge (success)', selector: '.status.success', fg: '--success-foreground', bg: '--success-soft' },
  { label: 'status badge (warning)', selector: '.status.warning', fg: '--warning-foreground', bg: '--warning-soft' },
  { label: 'status badge (error)', selector: '.status.danger', fg: '--error-foreground', bg: '--error-soft' },
  { label: 'status badge (info)', selector: '.status.info', fg: '--info-foreground', bg: '--info-soft' },
  { label: 'status badge (pending)', selector: '.status.pending', fg: '--pending-foreground', bg: '--pending-soft' },
  { label: 'status badge (neutral)', selector: '.status.neutral', fg: '--neutral-foreground', bg: '--neutral-soft' },
  { label: 'role chip', selector: '.role-chip', fg: '--primary-soft-foreground', bg: '--primary-soft' },
  { label: 'welcome banner copy', selector: '.welcome-banner p', fg: '--muted-foreground', bg: '--well-background', bgInRule: false },
  { label: 'stat card label', selector: '.stat-card small', fg: '--subtle-foreground', bg: '--card', bgInRule: false }
];

describe('component foreground/background pairs meet WCAG 2.2 AA', () => {
  for (const theme of THEMES) {
    const tokens = tokensFor(theme.name);

    describe(`${theme.name} theme`, () => {
      for (const component of COMPONENTS) {
        test(`${component.label} (${component.selector})`, () => {
          const body = ruleFor(component.selector);

          // The rule must be driven by these tokens, otherwise it is painting a
          // fixed colour that no theme can correct.
          expect(body).toContain(`var(${component.fg})`);
          if (component.bgInRule !== false) expect(body).toContain(`var(${component.bg})`);

          const fg = resolveToken(tokens, component.fg);
          const bg = resolveToken(tokens, component.bg);
          const ratio = contrastRatio(fg, bg);

          expect(
            round(ratio),
            `${component.label}: ${fg} on ${bg} in ${theme.name}`
          ).toBeGreaterThanOrEqual(AA_TEXT);
        });
      }
    });
  }
});

describe('non-text contrast (WCAG 1.4.11)', () => {
  for (const theme of THEMES) {
    const tokens = tokensFor(theme.name);
    const pairs = [
      { label: 'focus ring on page background', fg: '--ring', bg: '--background' },
      { label: 'focus ring on card', fg: '--ring', bg: '--card' },
      { label: 'focus ring on input', fg: '--ring', bg: '--input' },
      { label: 'input border against its field', fg: '--input-border', bg: '--input' },
      { label: 'secondary button border against card', fg: '--input-border', bg: '--card' },
      { label: 'primary fill against page background', fg: '--primary', bg: '--background' },
      // The selected state is carried by this accent bar (and a bolder weight),
      // not by the background tint alone — so this is the indicator 1.4.11
      // actually governs. Requiring the tint itself to clear 3:1 would force a
      // shouty selected state that the rule does not ask for.
      { label: 'selected navigation accent bar', fg: '--primary', bg: '--sidebar-background' }
    ];

    for (const pair of pairs) {
      test(`${pair.label} [${theme.name}]`, () => {
        const fg = resolveToken(tokens, pair.fg);
        const bg = resolveToken(tokens, pair.bg);
        expect(round(contrastRatio(fg, bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA_NON_TEXT);
      });
    }
  }
});

describe('token architecture', () => {
  test('every colour token light defines is redefined for dark, and vice versa', () => {
    const light = tokensFor('light');
    const dark = tokensFor('dark');
    // Layout tokens (--radius, --sidebar-w, font stacks) are deliberately shared
    // across themes, so only colour-bearing tokens need a dark counterpart.
    const colours = tokens => Object.entries(tokens)
      .filter(([, value]) => /#|rgba?\(/i.test(value))
      .map(([name]) => name);

    const missing = colours(light).filter(name => !(name in dark));
    expect(missing, `dark never defines: ${missing.join(', ')}`).toEqual([]);

    const extra = colours(dark).filter(name => !(name in light));
    expect(extra, `dark defines tokens light does not: ${extra.join(', ')}`).toEqual([]);
  });

  test('the dark theme is a pure token redefinition with no component overrides', () => {
    const open = CSS.indexOf("[data-theme='dark'] {") + "[data-theme='dark'] {".length;
    let depth = 1;
    let end = open;
    while (end < CSS.length && depth > 0) {
      if (CSS[end] === '{') depth += 1;
      else if (CSS[end] === '}') depth -= 1;
      end += 1;
    }
    // Any nested rule is a component that can drift out of sync with its theme.
    expect(CSS.slice(open, end).match(/{/g) || []).toHaveLength(0);
  });

  test('no colour literal survives outside the token blocks', () => {
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const tokenBodies = [];
    for (const theme of THEMES) {
      const pattern = new RegExp(`${theme.selector.replace(/[[\]']/g, '\\$&')}\\s*\\{`, 'g');
      let match;
      while ((match = pattern.exec(stripped))) {
        let depth = 1;
        let i = pattern.lastIndex;
        while (i < stripped.length && depth > 0) {
          if (stripped[i] === '{') depth += 1;
          else if (stripped[i] === '}') depth -= 1;
          i += 1;
        }
        tokenBodies.push(stripped.slice(match.index, i));
      }
    }
    let bodyless = stripped;
    for (const body of tokenBodies) bodyless = bodyless.replace(body, '');
    // Printing must be black on white in either theme by definition.
    bodyless = bodyless.replace(/@media print \{[\s\S]*$/, '');

    const strays = [];
    bodyless.split('\n').forEach((line, index) => {
      for (const hex of line.match(/#[0-9a-fA-F]{3,8}\b/g) || []) strays.push(`line ${index + 1}: ${hex}`);
    });
    expect(strays, `hard-coded colours outside the token layer — ${strays.join('; ')}`).toEqual([]);
  });

  test('no retired green-palette token is left anywhere in the source', () => {
    expect(CSS).not.toMatch(/var\(--(?:green[\w-]*|ink|canvas|surface|danger)\b/);
    expect(CSS).not.toMatch(/\[data-theme='dark'\]\s+\./);
  });

  test('the reported Delivery History tab cannot regress to dark-on-dark', () => {
    // Root cause was a specificity tie: [data-theme='dark'] .button.primary
    // painted #06281a over .tab-nav .button.primary's tinted fill, leaving the
    // selected label at 1.13:1. The tab now owns its own token pair.
    const body = ruleFor('.tab-nav .button.primary');
    expect(body).toContain('var(--selected-background)');
    expect(body).toContain('var(--selected-foreground)');
    expect(body).not.toContain('#06281a');

    for (const theme of THEMES) {
      const tokens = tokensFor(theme.name);
      const ratio = contrastRatio(
        resolveToken(tokens, '--selected-foreground'),
        resolveToken(tokens, '--selected-background')
      );
      expect(round(ratio), `${theme.name} selected tab`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  test('no single status reuses the primary blue', () => {
    const tokens = tokensFor('light');
    const hues = ['--success', '--warning', '--error', '--info', '--pending', '--neutral']
      .map(name => resolveToken(tokens, name));
    expect(new Set(hues).size).toBe(hues.length);
    expect(hues[2]).not.toBe(resolveToken(tokens, '--primary'));
    expect(hues[3]).not.toBe(resolveToken(tokens, '--primary'));
  });
});
