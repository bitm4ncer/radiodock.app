// hls.js sorts its level list from lowest to highest bitrate, but relying on
// that ordering is fragile across versions. Audio playback never benefits from
// a video rendition, so pick the cheapest level explicitly: a 3 Mbps 1080p
// variant on a phone is pure battery and dropout risk.
export function lowestBitrateLevelIndex(levels) {
  if (!Array.isArray(levels) || levels.length === 0) return -1;
  let best = 0;
  let bestBitrate = Number(levels[0]?.bitrate);
  for (let i = 1; i < levels.length; i++) {
    const bitrate = Number(levels[i]?.bitrate);
    if (!Number.isFinite(bitrate)) continue;
    if (!Number.isFinite(bestBitrate) || bitrate < bestBitrate) {
      best = i;
      bestBitrate = bitrate;
    }
  }
  return best;
}
