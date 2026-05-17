// Wikipedia summary client. Pulls a short description + thumbnail for a
// station name, falling back to null when no plausibly-matching radio
// article exists. CORS-friendly endpoints, no API key required.
//
// Two-step lookup so we tolerate naming drift between Radio Browser
// titles and Wikipedia titles ("NTS Radio 1" → article "NTS Radio"):
//   1. opensearch finds the best-matching article title
//   2. summary endpoint returns the extract / image / canonical URL
//   3. a tiny sanity gate rejects results whose extract doesn't even
//      mention "radio" — this kills almost all the false positives
//      (e.g. station "Mutant" → article "Mutant (biology)").

const cache = new Map();

export async function fetchStationInfo(stationName) {
  if (!stationName) return null;
  if (cache.has(stationName)) return cache.get(stationName);

  let result = null;
  try {
    const searchUrl =
      'https://en.wikipedia.org/w/api.php?action=opensearch&format=json&origin=*&limit=1&search=' +
      encodeURIComponent(stationName);
    const sr = await fetch(searchUrl);
    if (!sr.ok) throw new Error('search failed');
    const [, titles, , urls] = await sr.json();
    const title = titles?.[0];
    if (!title) throw new Error('no match');

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
      url: data.content_urls?.desktop?.page ?? urls?.[0] ?? null,
    };
  } catch {
    result = null;
  }

  cache.set(stationName, result);
  return result;
}
