const KEYS = ['umami.disabled', 'rd_analytics_opt_out'];

export function getAnalyticsOptOut(storage = globalThis.localStorage) {
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
