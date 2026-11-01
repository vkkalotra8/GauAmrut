// WCAG 2.2 contrast maths for auditing the design tokens.
//
// These functions are the reason the palette is trustworthy: rather than
// eyeballing a colour and calling it readable, every foreground/background
// pair the UI actually paints is measured here and held to AA.

/** Accepts #rgb or #rrggbb; anything else is a bug in the token file. */
export function parseHex(hex) {
  const value = String(hex).trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(value) || (value.length !== 3 && value.length !== 6)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }
  const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  };
}

/** sRGB channel → linear, per the WCAG relative-luminance definition. */
function linear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex) {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** 1 = identical, 21 = black on white. AA needs 4.5 for text, 3 for UI. */
export function contrastRatio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

export const AA_TEXT = 4.5;
export const AA_LARGE_TEXT = 3;
export const AA_NON_TEXT = 3;

export function meetsAA(fg, bg, { large = false } = {}) {
  return contrastRatio(fg, bg) >= (large ? AA_LARGE_TEXT : AA_TEXT);
}

/**
 * Every custom property declared by a selector block, merged in source order
 * so a later `:root` wins exactly as the cascade would decide.
 */
export function parseTokens(css, selector) {
  // Comments live inside blocks; leaving them in would glue their text onto the
  // next declaration and hide the token from the parse.
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = {};
  const pattern = new RegExp(`(^|[}\\s;])${selector.replace(/[[\]']/g, '\\$&')}\\s*\\{`, 'g');
  let match;
  while ((match = pattern.exec(source))) {
    let depth = 1;
    let i = pattern.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') depth -= 1;
      i += 1;
    }
    const body = source.slice(pattern.lastIndex, i - 1);
    for (const decl of body.split(';')) {
      const [name, ...rest] = decl.split(':');
      if (!name || rest.length === 0) continue;
      const key = name.trim();
      if (!key.startsWith('--')) continue;
      tokens[key] = rest.join(':').trim();
    }
  }
  return tokens;
}

/** Follows a var() chain down to a literal colour. */
export function resolveToken(tokens, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`Circular token reference at ${name}`);
  seen.add(name);
  const value = tokens[name];
  if (value === undefined) throw new Error(`Unknown token: ${name}`);
  const ref = value.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/);
  if (ref) return resolveToken(tokens, ref[1], seen);
  return value;
}

/**
 * The foreground/background pairs the app really paints. Each entry names the
 * text role, the surface it sits on, and whether WCAG treats it as large text.
 */
export function auditPairs(tokens) {
  const t = name => resolveToken(tokens, name);
  const pairs = [
    // Body copy on the two main surfaces.
    { label: 'body text on background', fg: '--foreground', bg: '--background' },
    { label: 'body text on card', fg: '--foreground', bg: '--card' },
    { label: 'body text on elevated surface', fg: '--foreground', bg: '--surface-elevated' },
    { label: 'secondary text on background', fg: '--secondary-foreground', bg: '--background' },
    { label: 'secondary text on card', fg: '--secondary-foreground', bg: '--card' },
    { label: 'muted text on background', fg: '--muted-foreground', bg: '--background' },
    { label: 'muted text on card', fg: '--muted-foreground', bg: '--card' },
    { label: 'muted text on elevated surface', fg: '--muted-foreground', bg: '--surface-elevated' },
    { label: 'muted text on hover row', fg: '--muted-foreground', bg: '--hover-background' },
    // The two button fills.
    { label: 'primary button label', fg: '--primary-foreground', bg: '--primary' },
    { label: 'primary button label (hover)', fg: '--primary-foreground', bg: '--primary-hover' },
    { label: 'destructive button label', fg: '--destructive-foreground', bg: '--destructive' },
    { label: 'destructive button label (hover)', fg: '--destructive-foreground', bg: '--destructive-hover' },
    // Secondary button and its hover tint.
    { label: 'secondary button label', fg: '--secondary-foreground', bg: '--card' },
    { label: 'secondary button label (hover)', fg: '--secondary-foreground', bg: '--hover-background' },
    { label: 'link / text button', fg: '--link', bg: '--card' },
    { label: 'link / text button on background', fg: '--link', bg: '--background' },
    { label: 'link / text button (hover row)', fg: '--link', bg: '--hover-background' },
    { label: 'link / text button (tinted banner)', fg: '--link', bg: '--notice-background' },
    { label: 'link / text button (selected nav)', fg: '--link', bg: '--selected-background' },
    { label: 'link / text button on well', fg: '--link', bg: '--well-background' },
    { label: 'link / text button on elevated', fg: '--link', bg: '--surface-elevated' },
    { label: 'link / text button (hover state)', fg: '--link-hover', bg: '--card' },
    { label: 'danger text button', fg: '--destructive-soft-foreground', bg: '--card' },
    { label: 'success text button', fg: '--success-foreground', bg: '--card' },
    // Navigation: this is where the reported dark-mode failure lived.
    { label: 'sidebar label', fg: '--sidebar-foreground', bg: '--sidebar-background' },
    { label: 'sidebar label (hover)', fg: '--sidebar-accent-foreground', bg: '--sidebar-accent' },
    { label: 'selected navigation item', fg: '--selected-foreground', bg: '--selected-background' },
    // Focused and resting form controls.
    { label: 'input text', fg: '--input-foreground', bg: '--input' },
    { label: 'input placeholder', fg: '--placeholder', bg: '--input' },
    { label: 'field label', fg: '--foreground', bg: '--background' },
    // Tables.
    { label: 'table header', fg: '--table-header-foreground', bg: '--table-header-background' },
    { label: 'table cell', fg: '--table-cell-foreground', bg: '--card' },
    { label: 'table cell (hover row)', fg: '--table-cell-foreground', bg: '--hover-background' },
    // Chrome that floats over content.
    { label: 'header text', fg: '--header-foreground', bg: '--header-background' },
    { label: 'bottom navigation label', fg: '--bottom-nav-foreground', bg: '--bottom-nav-background' },
    { label: 'save bar text', fg: '--muted-foreground', bg: '--save-bar-background' },
    { label: 'skip link', fg: '--primary-foreground', bg: '--primary' }
  ];

  // Status vocabulary, both the resting chip and every semantic variant.
  for (const status of ['success', 'warning', 'error', 'info', 'pending', 'neutral']) {
    pairs.push({
      label: `${status} badge`,
      fg: `--${status}-foreground`,
      bg: `--${status}-soft`
    });
  }
  pairs.push(
    { label: 'notice text', fg: '--notice-foreground', bg: '--notice-background' },
    { label: 'notice text (error)', fg: '--error-foreground', bg: '--error-soft' },
    { label: 'notice text (warning)', fg: '--warning-foreground', bg: '--warning-soft' },
    // Chips and tinted icon surfaces that carry their own label.
    { label: 'primary chip label', fg: '--primary-soft-foreground', bg: '--primary-soft' },
    { label: 'count badge', fg: '--accent-foreground', bg: '--accent' },
    { label: 'brand icon on its chip', fg: '--brand-icon-foreground', bg: '--brand-icon-background' },
    { label: 'banner copy', fg: '--muted-foreground', bg: '--well-background' },
    { label: 'table cell on tinted well', fg: '--table-cell-foreground', bg: '--well-background' }
  );

  return pairs.map(pair => ({
    ...pair,
    fgValue: t(pair.fg),
    bgValue: t(pair.bg),
    ratio: contrastRatio(t(pair.fg), t(pair.bg))
  }));
}
