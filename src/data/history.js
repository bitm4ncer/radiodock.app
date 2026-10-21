// Play history: a system list that records every station the user plays.
// It behaves like Community Radios (default, not deletable, not a save
// target) but, unlike Community, individual entries can be removed and the
// whole list can be cleared. The order is always most-recently-played first
// and cannot be rearranged by hand.
//
// Persisted as a single `history` pref (an array of station snapshots) so it
// stays device-local and never enters the user-list / sync / share paths.

export const HISTORY_LIST_ID = '__history__';
export const HISTORY_LIMIT = 100;

/** A plain snapshot of a station, detached from any live player object. */
export function historyEntry(station) {
  if (!station?.id) return null;
  return { ...station };
}

/**
 * Adds a station to the front of the history, de-duplicating by id and
 * capping the result. Pure: returns a new array, never mutates the input.
 */
export function addToHistory(stations, station, limit = HISTORY_LIMIT) {
  const entry = historyEntry(station);
  const previous = Array.isArray(stations) ? stations : [];
  if (!entry) return previous.slice();
  const rest = previous.filter((s) => s?.id !== entry.id);
  return [entry, ...rest].slice(0, Math.max(1, limit));
}
