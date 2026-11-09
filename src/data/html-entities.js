// Display-boundary HTML entity decoding. Station names and upstream metadata
// sometimes arrive entity-encoded (or double-encoded) from Radio Browser and
// ICY/ID3 feeds. Decoding here keeps `&amp;`, `&#39;`, `&quot;` etc. out of the
// lock screen and the station UI. Idempotent: plain `&` is untouched.
const NAMED = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  eacute: '\u00e9',
  egrave: '\u00e8',
  agrave: '\u00e0',
  ccedil: '\u00e7',
  uuml: '\u00fc',
  ouml: '\u00f6',
  auml: '\u00e4',
  szlig: '\u00df',
  oslash: '\u00f8',
  aring: '\u00e5',
  aelig: '\u00e6',
  ntilde: '\u00f1',
  oacute: '\u00f3',
  iacute: '\u00ed',
  aacute: '\u00e1',
};

export function decodeHtmlEntities(value) {
  if (value == null) return '';
  let text = String(value);
  // Two passes handle double-encoded feeds (`&amp;amp;` -> `&amp;` -> `&`).
  for (let pass = 0; pass < 2; pass++) {
    const before = text;
    text = text
      .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
        try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return match; }
      })
      .replace(/&#(\d+);/g, (match, dec) => {
        try { return String.fromCodePoint(parseInt(dec, 10)); } catch { return match; }
      })
      .replace(/&([a-z][a-z0-9]+);/gi, (match, name) => NAMED[name.toLowerCase()] ?? match);
    if (text === before) break;
  }
  return text;
}
