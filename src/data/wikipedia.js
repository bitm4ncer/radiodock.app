// Wikipedia summary client. Pulls a short description + thumbnail for a
// station name, falling back to null when no plausibly-matching radio
// article exists. CORS-friendly endpoints, no API key required.
//
// Match strategy (precision over recall):
//   1. opensearch returns up to 5 candidate article titles.
//   2. Pick the first candidate whose normalised title is a substring
//      of (or equal to) the station name — or vice versa. Wikipedia's
//      opensearch is happy to fuzzy-match across very different names
//      ("Radio 80000" → "Radio 2000", "LYL Radio" → "Lux Radio
//      Theatre", "Mutant Radio" → "Mutiny Radio") and those false
//      positives are worse than no info at all.
//   3. Fetch the summary for the picked title.
//   4. A second gate rejects extracts that don't even mention "radio",
//      catching the rare case where step 2 matched a non-station
//      page that happens to share the station's name.

const cache = new Map();

function normalise(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/\(.*?\)/g, '')                          // strip "(radio station)" etc.
    .replace(/[^a-z0-9 ]/g, ' ')                      // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(stationName, articleTitle) {
  const a = normalise(stationName);
  const b = normalise(articleTitle);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b)) return true; // "NTS Radio 1" contains "NTS Radio"
  if (b.includes(a)) return true; // "FIP (radio station)" → "fip" contains "fip"
  return false;
}

export async function fetchStationInfo(stationName) {
  if (!stationName) return null;
  if (cache.has(stationName)) return cache.get(stationName);

  let result = null;
  try {
    const searchUrl =
      'https://en.wikipedia.org/w/api.php?action=opensearch&format=json&origin=*&limit=5&search=' +
      encodeURIComponent(stationName);
    const sr = await fetch(searchUrl);
    if (!sr.ok) throw new Error('search failed');
    const [, titles, , urls] = await sr.json();
    if (!Array.isArray(titles) || titles.length === 0) throw new Error('no candidates');

    let title = null;
    let urlFallback = null;
    for (let i = 0; i < titles.length; i++) {
      if (namesMatch(stationName, titles[i])) {
        title = titles[i];
        urlFallback = urls?.[i];
        break;
      }
    }
    if (!title) throw new Error('no name match');

    const summaryUrl =
      'https://en.wikipedia.org/api/rest_v1/page/summary/' +
      encodeURIComponent(title.replace(/ /g, '_'));
    const sm = await fetch(summaryUrl);
    if (!sm.ok) throw new Error('summary failed');
    const data = await sm.json();

    if (data.type === 'disambiguation') throw new Error('disambiguation');
    if (!data.extract) throw new Error('no extract');
    if (!/\bradio\b/i.test(data.extract)) throw new Error('not a radio topic');

    result = {
      title: data.title,
      extract: data.extract,
      thumbnail: data.thumbnail?.source ?? null,
      url: data.content_urls?.desktop?.page ?? urlFallback ?? null,
    };
  } catch {
    result = null;
  }

  cache.set(stationName, result);
  return result;
}
