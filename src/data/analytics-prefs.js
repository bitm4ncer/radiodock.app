const KEYS = ['umami.disabled', 'rd_analytics_opt_out'];

function cookieOptOut(doc = globalThis.document) {
  return String(doc?.cookie ?? '')
    .split(';')
    .some((part) => part.trim() === 'rd_stats_exclude=1');
}

export function getAnalyticsOptOut(storage = globalThis.localStorage, doc = globalThis.document) {
  if (cookieOptOut(doc)) return true;
  if (!storage) return false;
  return KEYS.some((key) => storage.getItem(key) === '1');
}

export function setAnalyticsOptOut(off, storage = globalThis.localStorage) {
  if (!storage) return;
  for (const key of KEYS) {
    if (off) storage.setItem(key, '1');
    else storage.removeItem(key);
  }
}
