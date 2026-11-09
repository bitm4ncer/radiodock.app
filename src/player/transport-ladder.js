// Pure transport-fallback decision for the player.
//
// RadioDock plays three shapes of source:
//   - native HTTP streams (MP3/AAC/OGG),
//   - HLS through hls.js / native HLS,
//   - HLS/audio hidden behind a PLS/M3U wrapper, or an HLS URL without a
//     `.m3u8` suffix.
//
// The direct source can fail without telling us which shape it really was, so
// the ladder is deliberately transport-aware: native sources may fall back to
// the native relay and then to the HLS manifest proxy; an HLS source may only
// fall back to the HLS proxy. Probing the native relay for an HLS station just
// wastes a round-trip and delays recovery.
//
// `directTried` is false only for a caller that has not attempted anything yet.
// The player always calls this after a failed attempt, so it passes true.
export function nextStreamTransport({
  isHls = false,
  directTried = true,
  nativeRelayTried = false,
  hlsRelayTried = false,
} = {}) {
  if (!directTried) return 'direct';
  if (isHls) return hlsRelayTried ? null : 'hls-relay';
  if (!nativeRelayTried) return 'native-relay';
  if (!hlsRelayTried) return 'hls-relay';
  return null;
}
