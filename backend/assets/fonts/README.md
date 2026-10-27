# Fonts embedded in GauAmrut PDFs

`src/pdf.js` embeds these faces so bill and report PDFs can draw text the
core-14 fonts (Helvetica/Times/Courier) cannot: the `₹` symbol, emoji, and the
two Indian scripts this product ships in (`hi` → Devanagari, `gu` → Gujarati).
Plain WinAnsi text never touches them and stays on the core-14 fonts, so ordinary
reports remain small and keep real, searchable text.

| File | Face used by `src/pdf.js` | Copyright | License |
| --- | --- | --- | --- |
| `NotoSans-Regular.ttf` | `GA-Latin` | Google Inc. | SIL OFL 1.1 |
| `NotoSans-Bold.ttf` | `GA-Latin-Bold` | Google Inc. | SIL OFL 1.1 |
| `NotoSansDevanagari-Regular.ttf` | `GA-Deva` | Google Inc. | SIL OFL 1.1 |
| `NotoSansDevanagari-Bold.ttf` | `GA-Deva-Bold` | Google Inc. | SIL OFL 1.1 |
| `NotoSansGujarati-Regular.ttf` | `GA-Guj` | Google Inc. | SIL OFL 1.1 |
| `NotoSansGujarati-Bold.ttf` | `GA-Guj-Bold` | Google Inc. | SIL OFL 1.1 |
| `NotoEmoji-Regular.ttf` | `GA-Emoji` | Google Inc. | Apache License 2.0 |

Full license texts: `LICENSE-OFL-1.1.txt` (the Noto Sans family) and
`LICENSE-APACHE-2.0.txt` (Noto Emoji).

## Sources

- Noto Sans, Noto Sans Devanagari, Noto Sans Gujarati: Google Fonts (published
  through the `@expo-google-fonts/noto-sans*` packages), static instances.
  <https://fonts.google.com/noto/specimen/Noto+Sans>
  <https://fonts.google.com/noto/specimen/Noto+Sans+Devanagari>
  <https://fonts.google.com/noto/specimen/Noto+Sans+Gujarati>
- Noto Emoji: <https://github.com/googlefonts/noto-emoji>,
  tag `v2020-09-16-unicode13_1`, file `fonts/NotoEmoji-Regular.ttf`.

## Why not the system fonts?

Earlier revisions used `Nirmala.ttf` / `NirmalaB.ttf` and the Segoe UI emoji
faces. Those are Microsoft fonts that ship inside Windows: they cover more
scripts, but they are **not redistributable**, so they cannot be committed to
this repository or shipped with the application. The Noto faces above cover
everything this app renders (Latin, `₹`, Devanagari, Gujarati, emoji) under
licenses that permit bundling — and the six Noto Sans files are smaller than the
two Nirmala files.

Text in a script with no face here (Tamil, Telugu, Arabic, CJK, ...) has no
glyph to draw, so `pdfText()` drops those codepoints rather than printing tofu
boxes. That matches what the WinAnsi-only path did before embedding was added.

## Replacing or adding a script

1. Drop a **static** (non-variable) TTF here. pdfkit/fontkit cannot handle
   variable fonts — they fail with
   `glyph._decode is not a function` or
   `Variations require a font with the fvar...`.
2. Register it in `registerFonts()`, add it to `EMBEDDED_FONTS`.
3. Route its codepoint range in `faceFor()` / `SCRIPT_FACES` and make sure
   `renderableCp()` allows it.
4. Confirm the license is OFL/Apache and note it in the table above.
