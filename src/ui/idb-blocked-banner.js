// Persistent, dismissible banner shown when IndexedDB is unreachable.
//
// IDB blocking is rare but real — Brave Shield's strict-fingerprint mode
// locks IDB on a per-site basis, Safari ITP wipes it between launches in
// some configurations, Firefox Strict Mode partitions it in subtle ways,
// and corporate browser policies can disable it outright. When that
// happens the app still functions (community stations, search, playback)
// but favourites, custom lists, prefs, and any future feature that needs
// persistence silently fail to save.
//
// Surfacing this is important — a returning user who finds their
// favourites missing every session needs to understand why and how to
// fix it. The banner is non-blocking (positioned, not modal), uses the
// muted-red accent so it reads as advisory rather than destructive, and
// has a "Got it" dismiss button. Dismissal is in-memory only since
// IndexedDB is the thing that's broken — there's no persistent place to
// remember the dismissal across sessions. That's fine: returning users
// who hit this state see it again, which is the correct UX.

import { getIdbHealth, onIdbHealthChange } from '../data/storage.js';

const HELP_URL = 'https://github.com/bitm4ncer/radiodock.app/issues/new?title=Storage+is+blocked';

export function mountIdbBlockedBanner() {
  let banner = null;
  let dismissed = false;

  function build() {
    if (banner) return;
    banner = document.createElement('div');
    banner.className = 'idb-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.innerHTML = `
      <span class="idb-banner__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </span>
      <span class="idb-banner__text">
        <strong>Storage is unavailable.</strong>
        Favourites + custom lists won't persist. This usually means a
        stale database from an older version or a strict privacy setting.
        Reset clears local data only — your account is unaffected.
        <a href="${HELP_URL}" target="_blank" rel="noopener" class="idb-banner__link">Report</a>
      </span>
      <button type="button" class="idb-banner__action idb-banner__action--primary" data-action="reset">Reset storage</button>
      <button type="button" class="idb-banner__action" data-action="dismiss" aria-label="Dismiss">Dismiss</button>
    `;
    banner.querySelector('[data-action="dismiss"]').addEventListener('click', () => {
      dismissed = true;
      banner.classList.remove('is-visible');
    });
    banner.querySelector('[data-action="reset"]').addEventListener('click', () => {
      // Programmatically delete the radiodock IndexedDB and reload. Covers
      // the common case of a returning user stuck on a schema from a
      // since-rolled-back deploy (the v5 → v2 downgrade error scenario).
      const req = indexedDB.deleteDatabase('radiodock');
      const reload = () => location.reload();
      req.onsuccess = reload;
      req.onerror = reload;
      req.onblocked = reload;
      // Watchdog in case onblocked never fires (other tabs holding it):
      // force a reload anyway after 1.5 s so the user isn't stuck.
      setTimeout(reload, 1500);
    });
    document.body.appendChild(banner);
    // Force reflow then add `is-visible` so the slide-in transition fires
    // on first show instead of snapping.
    void banner.offsetHeight;
    banner.classList.add('is-visible');
  }

  function react(state) {
    if (state === 'failed' && !dismissed) {
      build();
    } else if (state === 'ok' && banner) {
      // Recovered (rare — would require a different connection succeeding
      // after the first failed). Hide the banner.
      banner.classList.remove('is-visible');
    }
  }

  // Fire once for whatever the current state is (synchronous if already
  // resolved), then subscribe for future changes.
  react(getIdbHealth());
  onIdbHealthChange(react);
}
