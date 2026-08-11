import { detectTrack, DetectError } from '../data/detect-client.js';
import { remaining, nextCount, DETECT_DAILY_LIMIT } from './detect-quota.js';
import { getPref, setPref } from '../data/storage.js';
// Unused here now that the cover-image modal is gone; kept because the note
// card's logo fallback (a later task) will need it again.
import { STATIONS_BASE } from '../data/stations-api.js';
import { toast } from '../ui/toast.js';

const PREF = 'detectUsesToday';
const todayStr = () => new Date().toISOString().slice(0, 10);

// No modal, no embeds here — a hit is saved straight into the notes panel
// (ui/notes-panel.js's captureDetected) and the panel opens focused on the
// new card. Expandable Spotify/YouTube embeds render from the note card
// itself (ui/embeds.js), a later task. This module only owns the detect
// request lifecycle: quota, the in-button spinner, and routing the result.
export function mountDetect({ player, getLatestMetadata, notes, setBusy }) {
  let gen = 0;

  async function remainingToday() {
    const rec = await getPref(PREF, null);
    return remaining(rec, todayStr(), DETECT_DAILY_LIMIT);
  }
  async function bump() {
    const rec = await getPref(PREF, null);
    await setPref(PREF, nextCount(rec, todayStr()));
  }

  async function run() {
    const station = player.getCurrentStation?.();
    if (!station?.id) { toast('Play a station first'); return; }
    if ((await remainingToday()) <= 0) { toast('Daily limit reached'); return; }

    const myGen = ++gen;
    setBusy(true);
    try {
      const out = await detectTrack(station.id);
      if (myGen !== gen) return;
      if (out.ok) {
        await bump();
        const track = {
          artist: out.track.artists.join(', '),
          title: out.track.title,
          nowPlaying: getLatestMetadata?.()?.nowPlaying || '',
          album: out.track.album || '',
          spotify: out.track.external?.spotify || '',
          youtube: out.track.external?.youtube || '',
          // Carried for the preview switcher: apple needs its storefront to be
          // embeddable at all, deezer + isrc are resolution keys for the rest
          // (see data/track-links.js).
          apple: out.track.external?.apple || '',
          appleCountry: out.track.external?.appleCountry || '',
          deezer: out.track.external?.deezer || '',
          isrc: out.track.isrc || '',
        };
        // captureDetected saves the note, opens the panel, and focuses the
        // new card — it also toasts, so don't double-toast here.
        await notes.captureDetected({ station, track });
      } else if (out.reason === 'no-match') {
        await bump();
        // ONLY a real no-match renders as "No match" — anything else is an
        // operational failure and must not masquerade as one (honest-result rule).
        toast('No match');
      } else {
        toast('Detection failed');
      }
    } catch (e) {
      if (myGen !== gen) return;
      const msg = e instanceof DetectError && e.reason === 'device-limit' ? 'Daily limit reached'
        : e instanceof DetectError && (e.reason === 'disabled' || e.reason === 'budget' || e.reason === 'busy' || e.reason === 'not-configured') ? 'Detection unavailable right now'
        : 'Detection failed';
      toast(msg);
    } finally {
      if (myGen === gen) setBusy(false);
    }
  }

  return { run, remainingToday };
}
