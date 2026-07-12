// Metadata proxy client. Ports metadataProxy.js from the extension.
// Calls the proxy's /v1/metadata for every stream — including HLS —
// because the proxy ships station-specific schedule strategies (e.g.
// HKCR) that return useful metadata for HLS broadcasts. For HLS streams
// without a schedule strategy the proxy responds with `reason:
// 'hls-client'`, which this client maps to `shouldUseLocal: true` so
// the poller knows not to dispatch a stale event; hls.js continues to
// parse in-band ID3 tags in audio.js independently.
//
// Two deployments of the same proxy: the Hetzner VPS is primary, the
// Render instance is the fallback (kept warm by the existing cron).
// Failover happens on transport errors / HTTP errors only — graceful
// proxy responses like `no-metadata` are answers, not outages.

const PRIMARY_BASE_URL = 'https://stations.radiodock.app';
const FALLBACK_BASE_URL = 'https://radiodock-metadata-proxy-1.onrender.com';
const PRIMARY_RETRY_AFTER_MS = 60000;
const REQUEST_TIMEOUT_MS = 15000;
const RETRY_BACKOFF_MS = 2000;
const MAX_RETRIES = 1;

// After a primary failure, polls go straight to the fallback for a while
// instead of paying the primary's timeout on every poll cycle.
let primaryDownUntil = 0;

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

  const bases =
    Date.now() < primaryDownUntil
      ? [FALLBACK_BASE_URL]
      : [PRIMARY_BASE_URL, FALLBACK_BASE_URL];

  let lastError = null;
  for (const base of bases) {
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
        const res = await fetch(`${base}/v1/metadata?${p}`, {
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

    if (base === PRIMARY_BASE_URL) {
      primaryDownUntil = Date.now() + PRIMARY_RETRY_AFTER_MS;
      console.warn('Metadata primary unavailable, falling back to Render:', lastError?.message);
    }
  }
  console.warn('Metadata proxy unavailable:', lastError?.message);
  return null;
}
