import { detectTrack, DetectError } from '../data/detect-client.js';
import { remaining, nextCount, DETECT_DAILY_LIMIT } from './detect-quota.js';
import { getPref, setPref } from '../data/storage.js';
import { STATIONS_BASE } from '../data/stations-api.js';
import { toast } from '../ui/toast.js';

const PREF = 'detectUsesToday';
const todayStr = () => new Date().toISOString().slice(0, 10);

// Provider metadata (titles, artists, cover URLs) is THIRD-PARTY DATA landing in
// innerHTML — escape everything, and only allow http(s) URLs into attributes.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(String(u ?? '')) ? esc(u) : '');
// Embed ids get a strict charset filter before landing in an iframe src.
const safeId = (s) => String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '');

const RETRY_BTN = '<button class="btn detect-retry" type="button">Again</button>';

function spotifyEmbed(id) {
  const v = safeId(id);
  return v ? `<iframe class="detect-embed" style="border-radius:12px" src="https://open.spotify.com/embed/track/${v}" width="100%" height="152" frameborder="0" allow="encrypted-media" loading="lazy"></iframe>` : '';
}
function youtubeEmbed(vid, query) {
  const v = safeId(vid);
  if (v) return `<iframe class="detect-embed" width="100%" height="180" src="https://www.youtube.com/embed/${v}" frameborder="0" allow="encrypted-media" loading="lazy"></iframe>`;
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  return `<a class="btn detect-yt-link" href="${url}" target="_blank" rel="noopener">Auf YouTube suchen</a>`;
}

function resultHtml(track, logoUrl) {
  const artists = track.artists.join(', ');
  const q = `${artists} ${track.title}`;
  const cover = safeUrl(track.coverUrl) || safeUrl(logoUrl);
  return `
    <div class="detect-result">
      <div class="detect-head">
        ${cover ? `<img class="detect-cover" src="${cover}" alt="" onerror="this.style.visibility='hidden'">` : ''}
        <div><div class="detect-title">${esc(track.title)}</div><div class="detect-artist">${esc(artists)}</div>${track.album ? `<div class="detect-album">${esc(track.album)}</div>` : ''}</div>
      </div>
      ${spotifyEmbed(track.external?.spotify)}
      ${youtubeEmbed(track.external?.youtube, q)}
      ${RETRY_BTN}
    </div>`;
}

// Self-contained dynamic overlay (mirrors the DYNAMIC-OVERLAY pattern in
// ui/sync-modal.js's QR scanner) — no pre-existing markup in index.html.
// Reuses the global `.modal`/`.modal-content`/`.show` classes from
// styles/modals.css purely for visual consistency; wiring (backdrop click,
// close button, Escape) is all local since ui/modals.js only manages modals
// present in the DOM at init time.
export function mountDetect({ player }) {
  let overlay = null;
  let gen = 0;

  function onKeydown(evt) {
    if (evt.key === 'Escape') closeOverlay();
  }

  function closeOverlay() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    gen++;
    document.removeEventListener('keydown', onKeydown);
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'modal detect-modal show';
    overlay.setAttribute('aria-hidden', 'false');
    overlay.innerHTML = `
      <div class="modal-content detect-modal-content">
        <button class="modal-close-btn" type="button" aria-label="Schließen">&times;</button>
        <div class="detect-body"></div>
      </div>`;
    overlay.addEventListener('click', (evt) => {
      if (evt.target === overlay) closeOverlay();
    });
    overlay.querySelector('.modal-close-btn')?.addEventListener('click', closeOverlay);
    // Delegated: covers the retry button in both the result and no-match states.
    overlay.addEventListener('click', (evt) => {
      if (evt.target.closest?.('.detect-retry')) run();
    });
    document.addEventListener('keydown', onKeydown);
    document.body.appendChild(overlay);
    return overlay;
  }

  function render(html) {
    const el = ensureOverlay();
    const body = el.querySelector('.detect-body');
    if (body) body.innerHTML = html;
  }

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
    render('<div class="detect-loading"><span class="spinner"></span> Identifying…</div>');
    try {
      const out = await detectTrack(station.id);
      if (myGen !== gen) return;
      if (out.ok) {
        await bump();
        // Single-origin policy: cover fallback is our logo CDN, never the
        // station's third-party favicon URL.
        render(resultHtml(out.track, `${STATIONS_BASE}/logos/${station.id}`));
      } else if (out.reason === 'no-match') {
        await bump();
        // ONLY a real no-match renders as "No match" — anything else is an
        // operational failure and must not masquerade as one (honest-result rule).
        render(`<div class="empty-state">No match.<br><span class="muted">Common with DJ sets &amp; underground music.</span><br>${RETRY_BTN}</div>`);
      } else {
        closeOverlay();
        toast('Detection failed');
      }
    } catch (e) {
      if (myGen !== gen) return;
      const msg = e instanceof DetectError && e.reason === 'device-limit' ? 'Daily limit reached'
        : e instanceof DetectError && (e.reason === 'disabled' || e.reason === 'budget' || e.reason === 'busy' || e.reason === 'not-configured') ? 'Detection unavailable right now'
        : 'Detection failed';
      closeOverlay();
      toast(msg);
    }
  }

  return { run, remainingToday };
}
