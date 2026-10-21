export const EXPLORE_PAGE_SIZE = 60;

function tierForPosition(position) {
  if (position <= 4) return 1;
  if (position <= 9) return 2;
  return 3;
}

function normalisedRandom(random) {
  const value = Number(random());
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.999999999, Math.max(0, value));
}

function shuffle(items, random) {
  const result = items.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(normalisedRandom(random) * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function buildExploreFeed(lists, random = Math.random) {
  if (!Array.isArray(lists)) return [];

  const byUuid = new Map();

  for (const list of lists) {
    if (!list || typeof list !== 'object' || !Array.isArray(list.stations)) continue;

    const collectionSlug = typeof list.slug === 'string' ? list.slug : '';
    const collectionTitle = typeof list.title === 'string' ? list.title : collectionSlug;

    list.stations.forEach((station, position) => {
      if (!station || typeof station !== 'object') return;
      const stationuuid = typeof station.stationuuid === 'string' ? station.stationuuid.trim() : '';
      if (!stationuuid) return;

      const tier = tierForPosition(position);
      const existing = byUuid.get(stationuuid);
      if (existing && tier >= existing.tier) return;

      byUuid.set(stationuuid, {
        id: stationuuid,
        stationuuid,
        name: station.name ?? '',
        countrycode: station.countrycode ?? '',
        collectionSlug,
        collectionTitle,
        tier,
        position,
      });
    });
  }

  const tiers = [[], [], []];
  for (const entry of byUuid.values()) tiers[entry.tier - 1].push(entry);

  return [
    ...shuffle(tiers[0], random),
    ...shuffle(tiers[1], random),
    ...shuffle(tiers[2], random),
  ];
}

export function nextExploreLimit(limit, total, pageSize = EXPLORE_PAGE_SIZE) {
  const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
  const safeLimit = Number.isFinite(limit) ? Math.max(0, limit) : 0;
  const safePageSize = Number.isFinite(pageSize) ? Math.max(0, pageSize) : 0;
  return Math.min(safeTotal, safeLimit + safePageSize);
}

export function pickExploreStation(feed, random = Math.random) {
  if (!Array.isArray(feed) || feed.length === 0) return null;
  const index = Math.floor(normalisedRandom(random) * feed.length);
  return feed[Math.min(feed.length - 1, index)];
}
