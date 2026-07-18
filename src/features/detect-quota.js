// Client-side daily counter for Detect ID — UX only (shows "X left", avoids a
// request the server would 429). NOT a security boundary; the real cap is
// server-side (hashed IP). Mirror of the server DETECT_DEVICE_DAILY_MAX default.
export const DETECT_DAILY_LIMIT = 10;

export function remaining(rec, todayStr, limit = DETECT_DAILY_LIMIT) {
  if (!rec || rec.date !== todayStr) return limit;
  return Math.max(0, limit - rec.count);
}

export function nextCount(rec, todayStr) {
  if (!rec || rec.date !== todayStr) return { date: todayStr, count: 1 };
  return { date: todayStr, count: rec.count + 1 };
}
