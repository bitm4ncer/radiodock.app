const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

export function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightMatches(text, query) {
  const raw = String(text ?? '');
  const q = String(query ?? '').trim();
  if (!q) return escapeHtml(raw);
  const parts = raw.split(new RegExp(`(${escapeRegExp(q)})`, 'ig'));
  return parts
    .map((part, index) => (index % 2 === 1 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
    .join('');
}

let regionNames = null;

export function countryLabel(code, fallback = '') {
  const value = String(code ?? '').trim().toUpperCase();
  if (!value) return fallback;
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(value) || fallback;
  } catch {
    return fallback;
  }
}

export function letterForName(name) {
  const first = String(name ?? '').trim().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : '#';
}

const numberFormat = new Intl.NumberFormat('en-US');

export function formatCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? numberFormat.format(number) : '0';
}
