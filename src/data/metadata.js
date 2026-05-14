// Metadata proxy client. Ports metadataProxy.js from the extension.
// Calls https://radiodock-metadata-proxy-1.onrender.com/v1/metadata for
// non-HLS streams. HLS streams are handled locally via hls.js ID3 events
// in src/player/audio.js, so we early-return for those here.

const PROXY_BASE_URL = 'https://radiodock-metadata-proxy-1.onrender.com';
const REQUEST_TIMEOUT_MS = 15000;
const RETRY_BACKOFF_MS = 2000;
const MAX_RETRIES = 1;

export function isHlsUrl(url) {
  return /\.m3u8(\?|$)/i.test(String(url ?? ''));
}

/**
 * Fetch the now-playing metadata for a station.
 * @param {{streamUrl, stationId?, homepage?, country?}} params
 * @param {{signal?: AbortSignal}} [transport]
 * @returns {Promise<null | {nowPlaying, artist?, title?, source?, cacheTtl?}>}
 */
export async function fetchNowPlaying(params, { signal } = {}) {
  const { streamUrl, stationId, homepage, country } = params ?? {};
  if (!streamUrl || typeof streamUrl !== 'string') return null;
  if (isHlsUrl(streamUrl)) return { source: 'hls-local', shouldUseLocal: true };

  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
    const onUserAbort = () => ctl.abort();
    signal?.addEventListener('abort', onUserAbort);

    try {
      const p = new URLSearchParams({ url: streamUrl });
      if (stationId) p.append('stationId', stationId);
      if (homepage) p.append('homepage', homepage);
      if (country) p.append('country', country);

      // No custom headers beyond Accept — anything else would trigger a CORS
      // preflight that the proxy's allowedHeaders list doesn't permit. The
      // proxy controls its own cache lifetime via the `cacheTtl` response field.
      const res = await fetch(`${PROXY_BASE_URL}/v1/metadata?${p}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: ctl.signal,
      });
      clearTimeout(timer);
      signal?.removeEventListener('abort', onUserAbort);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data?.ok) {
        return {
          nowPlaying: data.display || '',
          artist: data.artist ?? null,
          title: data.title ?? null,
          source: data.source ?? 'proxy',
          cacheTtl: data.cacheTtl || 15,
        };
      }
      // Graceful failure shapes from the proxy
      if (data?.reason === 'hls-client') return { source: 'hls-local', shouldUseLocal: true };
      if (['invalid-url', 'no-metadata', 'blocked'].includes(data?.reason)) return null;
      lastError = new Error(data?.message ?? 'proxy returned ok=false');
    } catch (err) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onUserAbort);
      if (signal?.aborted) throw err;
      lastError = err;
    }

    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * (attempt + 1)));
    }
  }
  console.warn('Metadata proxy unavailable:', lastError?.message);
  return null;
}
