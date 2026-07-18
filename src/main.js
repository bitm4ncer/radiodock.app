import './styles/index.css';
import { player } from './player/audio.js';
import { attachRecovery } from './player/recovery.js';
import { attachMetadataPoller } from './player/metadata-poller.js';
import { attachMediaSession } from './player/media-session.js';
import { mountInstallInfo } from './ui/install-info.js';
import { mountInstallSection } from './ui/install-section.js';
import { mountOffCanvas } from './ui/off-canvas.js';
import { mountSearchOverlay } from './ui/search-overlay.js';
import { mountPlayerCard } from './ui/player-card.js';
import { mountStationList } from './ui/station-list.js';
import { mountListDropdown } from './ui/list-dropdown.js';
import { mountListTabs } from './ui/list-tabs.js';
import { mountListsCarousel } from './ui/lists-carousel.js';
import { mountSearch } from './ui/search.js';
import { mountKeyboardShortcuts } from './ui/keyboard.js';
import { mountStationInfo } from './ui/station-info.js';
import { initModals, openModal, closeModal } from './ui/modals.js';
import { toast } from './ui/toast.js';
import { promptDialog, confirmDialog, choiceDialog } from './ui/modal-helpers.js';
import * as listsApi from './data/lists.js';
import * as storage from './data/storage.js';
import { downloadList, parseExport, applyImport } from './data/import-export.js';
import { buildShareUrl, tryDecodeShareHash } from './data/share.js';
import { searchStations, setBackendOverride } from './data/stations-source.js';
import { cleanupOrphanedLogoPrefs } from './data/logo-resolver.js';
import { mountVisualizer } from './visualizer/bootstrap.js';
import { mountPlayerCardDragMinimize } from './ui/player-card-drag.js';
import { mountElectronBridge, isElectron } from './ui/electron-bridge.js';
import { mountElectronWindowControls } from './ui/electron-window-controls.js';
import { mountIdbBlockedBanner } from './ui/idb-blocked-banner.js';
import { mountAppPageBounds } from './ui/app-page-bounds.js';
import { mountBackground } from './ui/background.js';
import { mountFooterReveal } from './ui/footer-reveal.js';
import { mountNotesPanel } from './ui/notes-panel.js';
import { mountNotesCaptureButton } from './ui/notes-capture-button.js';
import { mountRecorder, isRecordingSupported } from './player/recorder.js';
import { mountMobileRecorder } from './player/mobile-recorder.js';
import { mountRecordButton } from './ui/record-button.js';
import { mountDetect } from './features/detect.js';
import { mountDetectButton } from './ui/detect-button.js';
import { mountSyncModal } from './ui/sync-modal.js';
import { mountAddPanel } from './ui/add-panel.js';
import { mountChangelog, CHANGELOG_REVISION } from './ui/changelog.js';
import { startLiveSync, stopLiveSync, pushWithStatus as syncPushWithStatus, getSyncToken, extractTokenFromInput, pullFromServer, applyImportPayload, markSyncDirty } from './data/sync.js';
import { track } from './analytics/umami.js';
import { attachListenHeartbeat } from './analytics/listen-heartbeat.js';
import { mountThemeToggle, subscribeOSChange as subscribeThemeOSChange } from './ui/theme.js';
import { detectPlatform, detectStandalone, canPromptInstall, promptInstall } from './platform.js';
import { attachStreamProber } from './player/stream-prober.js';

const COMMUNITY_LIST_ID = listsApi.COMMUNITY_LIST_ID;

// --- App state ---
const state = {
  community: { id: COMMUNITY_LIST_ID, name: 'Community Radios', stations: [], readOnly: true, reorderable: true },
  userLists: [],            // [{id, name, stations, order, ...}]
  currentListId: null,      // active list (community or a user list)
  currentStation: null,
};

// --- Boot UI modules ---
// IDB-blocked help banner: mounted first so it can react to the storage
// health observable the moment storage.js detects a failure during any
// downstream call (no eager IDB open here — the banner only appears if
// some other module triggers a failed open).
mountIdbBlockedBanner();
attachRecovery(player);
attachMetadataPoller(player);
attachMediaSession(player);
attachListenHeartbeat(player);

// --- Stream offline prober ---
// Detects off-air stations in the active list and shows an OFF badge. The
// prober covers only the NON-playing rows (audio-element probe); the station
// the user is actually playing gets its status from the real audio pipeline
// (recovery events below), merged in recomputeOffline().
//
// Temporarily disabled: the OFF detection still produces false verdicts in
// the field. Flag gates both the network probing (prober never starts) and
// the DOM badge (recomputeOffline is a no-op), so no data-offline is ever
// applied. Flip back to true once the detection is trustworthy.
const OFF_INDICATOR_ENABLED = false;

let proberStatuses = {};        // non-playing rows, from the prober
let playingStationOffline = false;  // active station, hard audio failure (recovery events)
let playingDeadAir = false;         // active station, off-air but still streaming silence (metadata sentinel)

function recomputeOffline() {
  if (!OFF_INDICATOR_ENABLED) return;
  const merged = { ...proberStatuses };
  const playing = player.getCurrentStation();
  if (playing?.id) {
    // Either a hard pipeline failure or a dead-air metadata sentinel marks
    // the active station OFF. Dead air keeps audio flowing (silence), so the
    // pipeline stays happy — only the metadata gives it away.
    merged[playing.id] = (playingStationOffline || playingDeadAir) ? 'offline' : 'online';
  }
  applyOfflineStatus(merged);
}

// Libretime's canonical off-air placeholder. A station hosted on Airtime keeps
// the stream connected and broadcasts silence when nothing is scheduled, so no
// MediaError ever fires — the recovery layer can't see it. This now-playing
// sentinel (artist "Airtime", title "offline") is the only off-air signal.
// Same-platform live stations (e.g. Kiosk Radio) report a real show title, so
// the sentinel is specific to off-air, not to the platform.
function isOffAirMetadata(artist, title) {
  return (
    String(artist ?? '').trim().toLowerCase() === 'airtime' &&
    String(title ?? '').trim().toLowerCase() === 'offline'
  );
}

const streamProber = attachStreamProber({
  getStations: () => {
    const list = findList(state.currentListId);
    return list?.stations ?? [];
  },
  getPlayingId: () => player.getCurrentStation()?.id ?? null,
  onStatusChange: (statuses) => {
    proberStatuses = statuses;
    recomputeOffline();
  },
});

initModals();

// The SEO hero (h1 + lead) stays in the DOM — it's visually hidden via the
// sr-only pattern in seo-hero.css, so JS-rendering crawlers still index it and
// screen readers still announce it, without a flash or layout shift. (It used
// to be .remove()-d here, which deleted it before Googlebot's render snapshot.)

// User-facing version label, computed at build time from git commit
// count (see vite.config.js#appVersion). Populated into every
// .app-version element on first paint — the inline HTML default is
// just a fallback shown when this script hasn't run yet.
for (const el of document.querySelectorAll('.app-version')) {
  el.textContent = `v${__APP_VERSION__}`;
}
document.getElementById('playerCard').classList.add('loaded');

// Theme toggle. Inline <head> script already applied the right .theme-light
// class on <html> before first paint; here we just wire the buttons up so
// they reflect + flip the state, and subscribe to OS-pref changes while the
// user has no manual override.
mountThemeToggle({ root: document.getElementById('mobileMenu') });
mountThemeToggle({ root: document.querySelector('.site-footer-desktop') });
subscribeThemeOSChange();

// Block pinch-zoom on iOS Safari. The viewport meta `user-scalable=no` and
// `maximum-scale=1` are unreliable on iOS 10+ (Safari ignores them for
// accessibility reasons). We additionally swallow the legacy `gesture*`
// events (Safari-specific) and `touchmove` events that involve more than
// one finger. Single-finger touches still pass through, so scrolling
// works normally.
(() => {
  const block = (evt) => evt.preventDefault();
  document.addEventListener('gesturestart', block, { passive: false });
  document.addEventListener('gesturechange', block, { passive: false });
  document.addEventListener('gestureend', block, { passive: false });
  document.addEventListener(
    'touchmove',
    (evt) => {
      if (evt.touches.length > 1) evt.preventDefault();
    },
    { passive: false },
  );
  // Block double-tap-to-zoom too (iOS / Android both ship this).
  let lastTouchEnd = 0;
  document.addEventListener(
    'touchend',
    (evt) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 320) evt.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false },
  );
})();

// Single-origin cold load: no warm-up ping to the Render metadata proxy on
// boot. The proxy is only the fallback (primary is stations.radiodock.app), so
// opening the app contacts no third-party host before the user presses play. If
// the fallback is ever needed while Render's free tier is cold, we accept the
// one-off cold-start delay in exchange for a leak-free launch.

const playerCard = mountPlayerCard({ player });
// Publishes --app-page-top / --app-page-bottom so About / Notes / Sync / Log open
// between the top bar and the player instead of covering them.
mountAppPageBounds();
const stationInfo = mountStationInfo();
playerCard.onInfoClick((station) => {
  stationInfo.open(station);
  track('station-info-open', {
    station: station.name ?? '',
    country: station.countrycode ?? '',
  });
});
const stationList = mountStationList({ container: 'favoritesList' });
const listDropdown = mountListDropdown();

// Mobile-only: horizontal tab strip + scroll-snap carousel of all
// lists. Both unconditionally mounted — CSS hides the mobile path on
// desktop and the desktop dropdown chrome on mobile. State pushed to
// all three surfaces (listDropdown, listTabs, listsCarousel) on every
// list state change; whichever is visible reads it.
const listTabs = mountListTabs({ root: document.querySelector('.list-tabs') });
const listsCarousel = mountListsCarousel({ root: document.getElementById('listsCarousel') });
// Search tracking is debounced separately from the API-fire debounce: the
// 300ms input-debounce in search.js is tuned for snappy results, but with
// slow typing (>300ms between chars) it fires one API call — and therefore
// one track event — per character. Wait for the user to actually settle
// on a query (1500ms idle) before emitting the analytics event.
let searchTrackTimer = null;
function scheduleSearchTrack(payload) {
  if (searchTrackTimer) clearTimeout(searchTrackTimer);
  searchTrackTimer = setTimeout(() => {
    track('search', payload);
    searchTrackTimer = null;
  }, 1500);
}

const search = mountSearch({
  onSearch: async ({ query, filter }, transport) => {
    let backend = null;
    const results = await searchStations(
      { query, filter },
      { ...transport, onBackend: (b) => { backend = b; } },
    );
    scheduleSearchTrack({ filter, resultCount: results?.length ?? 0, backend });
    return results;
  },
  onPlay: (station) => {
    track('station-play', {
      station: station.name ?? '',
      uuid: station.id ?? '',
      country: station.countrycode ?? '',
      source: 'search',
    });
    player.playStation(station);
  },
  onAdd: async (station) => {
    const targetList = getActiveEditableList();
    if (!targetList) return;
    try {
      await listsApi.addStationToList(targetList.id, station);
      targetList.stations = [...targetList.stations, station];
      if (state.currentListId === targetList.id) renderActiveList();
      else listDropdown.setLists(allListsForDropdown());
      search.refreshAddedFlags();
      track('station-add', { country: station.countrycode ?? '' });
      scheduleSyncPush();
      toast(`Added to "${targetList.name}"`);
    } catch (err) {
      toast(err.message);
    }
  },
  isAlreadyInActiveList: (stationId) => {
    const list = getActiveEditableList();
    return !!list?.stations.some((s) => s.id === stationId);
  },
  canAddToActiveList: () => true,
});

mountKeyboardShortcuts({
  player,
  playerCard,
  onFocusSearch: () => {
    // Mobile/standalone regime hides the inline search input; the visible
    // trigger button opens the fullscreen overlay instead.
    const trigger = document.getElementById('searchTriggerBtn');
    if (trigger && trigger.offsetParent !== null) {
      trigger.click();
      setTimeout(() => search.focus(), 50);
    } else {
      search.focus();
    }
  },
});

// About modal. Wrapper that resets the tech-details toggle to collapsed
// each time the modal opens — readers always land on the plain-language
// overview first, even if they expanded the tech section last visit.
function openAboutModal() {
  const body = document.getElementById('aboutModalBody');
  body?.classList.remove('show-tech');
  document.getElementById('aboutMoreBtn')?.setAttribute('aria-expanded', 'false');
  window.dispatchEvent(new CustomEvent('rd:page-open', { detail: { id: 'infoModal' } }));
  openModal('infoModal');
}
document.getElementById('dockLogoBtn')?.addEventListener('click', openAboutModal);
document.getElementById('footerAboutBtn')?.addEventListener('click', openAboutModal);

// The mobile topbar logo is a real <a href="/">, which is right in a browser tab
// (a link home, good for crawlers). In the installed app / Electron shell that
// same link hard-reloads the whole app — white flash, lost state — so there it
// means "go home" instead: close whatever page or modal is open.
document.querySelector('.mobile-topbar__logo')?.addEventListener('click', (evt) => {
  if (!detectStandalone() && !isElectron()) return;
  evt.preventDefault();
  notesApi?.close();
  for (const el of document.querySelectorAll('.modal.show')) closeModal(el.id);
});
document.getElementById('aboutMoreBtn')?.addEventListener('click', () => {
  const body = document.getElementById('aboutModalBody');
  const btn = document.getElementById('aboutMoreBtn');
  const expanded = body?.classList.toggle('show-tech');
  btn?.setAttribute('aria-expanded', String(!!expanded));
});

// Hidden beta toggle (About → technical details): force the search/info backend.
// A debug tool, deliberately not surfaced prominently. Persisted so a forced
// mode survives reload; restored on load below.
const BACKEND_PREF = 'backendOverride';
function wireBackendToggle() {
  const group = document.getElementById('aboutBackendToggle');
  if (!group) return;
  const mark = (mode) => {
    for (const b of group.querySelectorAll('.about__backend-opt')) {
      b.classList.toggle('is-active', b.dataset.backend === mode);
    }
  };
  group.addEventListener('click', (evt) => {
    const btn = evt.target.closest('.about__backend-opt');
    if (!btn) return;
    const mode = btn.dataset.backend; // 'auto' | 'radiodock' | 'radio-browser'
    setBackendOverride(mode);
    storage.setPref(BACKEND_PREF, mode);
    mark(mode);
  });
  storage.getPref(BACKEND_PREF, 'auto').then((mode) => {
    setBackendOverride(mode);
    mark(mode);
  });
}
wireBackendToggle();
// Legal Notice now lives on its own /legal.html page (noindex'd) — see footer.

// Add-to-Home-Screen onboarding. The modal is opened from the Install
// Section — no more auto-show or floating button.
const installInfo = mountInstallInfo();
mountInstallSection({
  // Mount on <body>, not inside #app — the install section is a floating
  // overlay (position: fixed bottom-right on desktop, hidden on mobile);
  // it shouldn't inherit container minimize / animate rules.
  container: document.body,
  installInfo,
});

// When already running as a PWA, hide the install entry points — the
// inline install-section already self-suppresses; these two don't.
// The CSS regime (display-mode: standalone-aware media queries) makes
// the whole app use the mobile layout in standalone, so the off-canvas
// drawer already exposes the rest of the nav.
const inStandalone = detectStandalone();
if (inStandalone) {
  document.documentElement.classList.add('is-standalone');
  document.getElementById('offCanvasInstall')?.remove();
  document.getElementById('footerReinstallBtn')?.remove();
}
// Some browsers (Vivaldi) start a PWA window in display-mode: browser even
// though the window has no URL bar; the user can also transition modes
// (e.g. fullscreen). Re-evaluate when the active display mode changes so
// the .is-standalone class stays accurate.
['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'].forEach((m) => {
  window.matchMedia(`(display-mode: ${m})`).addEventListener?.('change', () => {
    document.documentElement.classList.toggle('is-standalone', detectStandalone());
  });
});

// "Install on Devices" pill in the desktop footer re-summons the install
// badge with a slide-in transition. Clears the dismissed-pref so the badge
// stays the next time the user reloads.
document.getElementById('footerReinstallBtn')?.addEventListener('click', () => {
  mountInstallSection({
    // Must match the auto-mount call above — body, not #app — so the badge
    // anchors to the viewport and isn't collapsed by the container's
    // minimize selector.
    container: document.body,
    installInfo,
    animateIn: true,
  });
});

// Latest metadata cache. The metadata-poller emits the canonical event
// once per station change + every ~15s after; the notes panel needs the
// most-recent payload at capture time without having to ask the poller.
// Plain module-level state is enough — there's only ever one player.
let latestMetadata = null;
player.on('metadata', (evt) => {
  const { artist, title, nowPlaying } = evt.detail ?? {};
  latestMetadata = { artist, title, nowPlaying };
  // Dead-air detection for the active station: audio still flows (silence), so
  // only the metadata reveals it's off-air. Toggle both ways — a real title
  // arriving means the station is back on the air.
  const deadAir = isOffAirMetadata(artist, title);
  if (deadAir !== playingDeadAir) {
    playingDeadAir = deadAir;
    recomputeOffline();
  }
});
player.on('stationchange', () => {
  // Clear stale metadata so a capture taken between station change and
  // the first metadata response of the new station doesn't carry over
  // the previous track.
  latestMetadata = null;
});

// Notes panel — created async because mountNotesPanel touches IndexedDB
// (`getAllPages` lazy-creates Journal). The notes API is exposed via a
// closure variable so the hamburger entry below can lazily reach it
// (off-canvas mounts synchronously but notesApi resolves a tick later).
let notesApi = null;

// Recording. Mobile records server-side (iOS/WebKit can't capture audio
// client-side); desktop records client-side via Web Audio. Both expose the
// same event interface, so the notes UI is identical either way.
const isCoarsePointer = matchMedia('(pointer: coarse)').matches;
const recordDesktopApp = !isCoarsePointer && (detectStandalone() || isElectron());

const recorder = isCoarsePointer
  ? mountMobileRecorder()
  : (isRecordingSupported() ? mountRecorder({ maxDurationMs: 60 * 60 * 1000 }) : null);

// Record entry points:
//   - Player action bar → everywhere the bar shows (desktop card + mobile
//     dock). This is the primary control; replaces the old mobile top-bar
//     button next to search.
//   - Desktop browser → also in the notes panel (next to "Save Moment").
mountNotesPanel({ player, getLatestMetadata: () => latestMetadata, recorder, showPanelRecordButton: !isCoarsePointer && !recordDesktopApp, fullPage: isCoarsePointer || isElectron() })
  .then((api) => { notesApi = api; })
  .catch((err) => console.warn('Notes panel mount failed:', err));

if (recorder) {
  mountRecordButton({ recorder, player, getNotesApi: () => notesApi });
}

const detect = mountDetect({ player });
mountDetectButton({ onDetect: () => detect.run() });

// Mobile: if a background recording is still in flight after (re)launch, nudge
// the user that it's running and tappable to save.
if (isCoarsePointer && recorder?.hasPending) {
  const nudge = () => { if (recorder.hasPending()) toast('Recording still running — tap ● to save it.'); };
  recorder.on('resumed', nudge);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') nudge(); });
}

// Mini capture button on the player-card.
mountNotesCaptureButton({
  player,
  onCapture: () => notesApi?.captureNow({ source: 'player-card' }),
});

// Start the live-sync engine: an immediate sync + a poll loop so a change on
// another device shows up here while the app is open. Safe to call repeatedly
// (it restarts cleanly); called on boot when linked and after link/connect.
function startSyncEngine() {
  startLiveSync({
    getToken: getSyncToken,
    onRemoteChange: async () => {
      state.userLists = await listsApi.getUserLists();
      renderActiveList();
      track('sync-pull', { source: 'live-sync' });
    },
  });
}

// Sync modal
const syncModal = mountSyncModal({
  onListsChanged: async () => {
    state.userLists = await listsApi.getUserLists();
    renderActiveList();
  },
  onLinked: startSyncEngine,
  onUnlinked: stopLiveSync,
  track,
});

// Add panel: submit a station to the public DB, or add a private local stream.
// Reachable from the drawer item + desktop footer pill.
const addPanel = mountAddPanel({
  getUserLists: () => listsApi.getUserLists(),
  getActiveListId: () => getActiveEditableList()?.id ?? null,
  addStationToList: async (listId, station) => {
    await listsApi.addStationToList(listId, station);
    state.userLists = await listsApi.getUserLists();
    if (state.currentListId === listId) renderActiveList();
    else listDropdown.setLists(allListsForDropdown());
    scheduleSyncPush();
  },
  track,
});

// "What's New" changelog. The footer pill + drawer item open it; a "new" dot on
// both entry points shows until the reader has opened the newest release.
const changelog = mountChangelog();

function setChangelogDots(show) {
  for (const el of document.querySelectorAll('[data-changelog-dot]')) {
    el.classList.toggle('nav-dot--on', show);
  }
}
async function refreshChangelogDot() {
  const seen = await storage.getPref('changelogSeenRevision', 0);
  setChangelogDots((seen ?? 0) < CHANGELOG_REVISION);
}
async function openChangelog(source) {
  changelog.open();
  track('changelog-open', { source });
  setChangelogDots(false);
  await storage.setPref('changelogSeenRevision', CHANGELOG_REVISION);
}
refreshChangelogDot();

// Mobile off-canvas drawer
mountOffCanvas({
  triggerBtn: document.getElementById('menuBtn'),
  panel: document.getElementById('mobileMenu'),
  onInstallClick: async () => {
    const platform = detectPlatform();
    // Android with a captured beforeinstallprompt: skip the explainer
    // modal and fire the native install dialog straight away.
    if (platform === 'android' && canPromptInstall()) {
      track('install-click', { platform: 'android', source: 'drawer' });
      await promptInstall();
      return;
    }
    const branch =
      { android: 'android', 'ios-safari': 'ios-safari', 'ios-other': 'ios-other' }[platform] ??
      'desktop';
    track('install-click', { platform: branch, source: 'drawer' });
    installInfo.open(branch);
  },
  onAboutClick: openAboutModal,
  onNotesClick: () => notesApi?.open(),
  onSyncClick: () => { track('sync-open', { source: 'drawer' }); syncModal.open(); },
  onAddClick: () => { track('add-open', { source: 'drawer' }); addPanel.open(); },
  onChangelogClick: () => openChangelog('drawer'),
});

// Desktop footer sync pill.
document.getElementById('footerSyncBtn')?.addEventListener('click', () => {
  track('sync-open', { source: 'footer' });
  syncModal.open();
});

// Desktop footer Add pill.
document.getElementById('footerAddBtn')?.addEventListener('click', () => {
  track('add-open', { source: 'footer' });
  addPanel.open();
});

// Desktop footer "What's New" pill.
document.getElementById('footerChangelogBtn')?.addEventListener('click', () => openChangelog('footer'));

// Delegated tracking for the install-section's platform buttons. The
// section is mounted twice (auto + footer re-summon) and re-rendered on
// detail/overview swaps, so a delegated listener on body is simpler than
// wiring an onPlatformClick callback through mountInstallSection.
document.body.addEventListener('click', (evt) => {
  const btn = evt.target.closest('.install-section__btn[data-target]');
  if (!btn) return;
  track('install-click', { platform: btn.dataset.target, source: 'badge' });
});

// Sync CTA in the install badge → open the sync modal (QR + link).
document.body.addEventListener('click', (evt) => {
  if (!evt.target.closest('.install-section__sync[data-action="sync"]')) return;
  track('sync-open', { source: 'install-badge' });
  syncModal.open();
});

// PWA install completion. Fires once per device when the user accepts
// the install prompt (Android Chrome / Desktop Chromium). iOS Safari
// does not fire this event — the Add-to-Home-Screen flow is entirely
// manual there, so iOS installs go uncounted at this layer.
window.addEventListener('appinstalled', () => track('pwa-installed'));

// Buy-Me-a-Coffee outbound link. Several link instances live in the DOM
// (mobile drawer + desktop footer + install badge); delegating from body
// covers them all without per-element wiring. The link's container
// disambiguates which surface the click came from.
document.body.addEventListener('click', (evt) => {
  const link = evt.target.closest('a[href*="buymeacoffee.com"]');
  if (!link) return;
  const source = link.closest('.off-canvas')
    ? 'drawer'
    : link.closest('.install-section')
      ? 'install'
      : 'footer';
  track('bmc-click', { source });
});

// Mobile fullscreen search overlay
const searchOverlay = mountSearchOverlay({
  triggerBtn: document.getElementById('searchTriggerBtn'),
  overlay: document.getElementById('searchOverlay'),
});

// Only one full-page surface (Notes / Sync / About / Log / Search) is open at a
// time: opening one closes the rest. Each page fires `rd:page-open` (detail.id)
// as it opens; this listener closes every other page. The transient dialog
// sheets (confirm / prompt / share / station info / list actions) are absent on
// purpose — those may still appear over a page.
const PAGE_CLOSERS = {
  notes: () => notesApi?.close(),
  sync: () => syncModal?.close?.(),
  add: () => addPanel?.close?.(),
  infoModal: () => closeModal('infoModal'),
  changelogModal: () => closeModal('changelogModal'),
  search: () => searchOverlay?.close(),
};
// Exclusivity applies only in the app regime — mobile, or an installed / Electron
// desktop app — where the pages open full-screen and the off-canvas menu is the
// navigation. In a regular desktop browser the panels are draggable workspace
// surfaces, so several may stay open at once (evaluated live, so resizing across
// the breakpoint flips it).
function pagesAreExclusive() {
  return matchMedia('(max-width: 699px)').matches || detectStandalone() || isElectron();
}
window.addEventListener('rd:page-open', (evt) => {
  if (!pagesAreExclusive()) return;
  const keep = evt.detail?.id;
  for (const [id, close] of Object.entries(PAGE_CLOSERS)) {
    if (id !== keep) { try { close(); } catch { /* closers are idempotent */ } }
  }
});

// Visualizer (desktop only; mounts trigger button into the player card).
// Experimental — kept off in the live frontend while it matures. Flip the
// flag to re-enable locally; the code below mounts the trigger button + the
// drawer machinery from src/visualizer/.
const VISUALIZER_ENABLED = false;
if (VISUALIZER_ENABLED) {
  mountVisualizer({ player })
    .then((viz) => {
      if (viz) window.__radiodock = Object.assign(window.__radiodock ?? {}, { visualizer: viz });
    })
    .catch((err) => console.warn('Visualizer mount failed:', err));
}

// Drag + minimize for the player card (desktop only).
mountPlayerCardDragMinimize().catch((err) => console.warn('Player card drag mount failed:', err));

// Fullscreen background images + cycle controls. Self-contained module:
// IDB failures inside it are absorbed by the storage helpers (return safe
// defaults), so the most that can happen on a hostile browser is "no
// uploads, no persisted index" — the built-in image set still cycles in
// memory. Coarse-pointer gate inside mountBackground keeps mobile clean.
// Intro reveal. mountBackground() settles once the chosen wallpaper is preloaded
// (desktop browser) or returns straight away (mobile / installed PWA, where
// there is no wallpaper), and `app-ready` then fades the intro overlay out and
// slides the panels in. `finally` rather than `then` so a rejected mount still
// reveals the app; the <head> timeout covers the case where this never settles.
mountBackground()
  .catch((err) => console.warn('Background mount failed:', err))
  .finally(() => document.documentElement.classList.add('app-ready'));

// Auto-reveal the desktop footer when the cursor approaches the bottom edge.
// Pure DOM/CSS — no IDB dependency, no boot risk.
mountFooterReveal();

// Electron desktop bridge — wires native features (tray, always-on-top,
// auto-start) when running inside the Electron wrapper. In the browser,
// isElectron() returns false and this is a no-op.
// Wrapped so an Electron-integration failure can NEVER block the core app.
// The desktop app is a thin client: the renderer loads the live site while
// preload.js is baked into the installed binary, so a version skew (old
// installer + newer web code, or vice versa) is inevitable. Without this a
// single missing preload method threw here and aborted the whole boot — an
// empty app. Native features degrade; radio does not.
let electronBridge = null;
try {
  electronBridge = mountElectronBridge({
    player,
    getActiveStation: () => state.currentStation,
  });
} catch (err) {
  console.warn('Electron bridge mount failed (native features disabled):', err);
}

// Electron tray "Next Station" → advance to next station in active list.
window.addEventListener('electron:trayNext', () => {
  const list = findList(state.currentListId);
  if (!list?.stations?.length) return;
  const idx = list.stations.findIndex((s) => s.id === state.currentStation?.id);
  const next = list.stations[(idx + 1) % list.stations.length];
  if (next) player.playStation(next);
});

// Electron tray "Previous Station" → go back one in active list.
window.addEventListener('electron:trayPrevious', () => {
  const list = findList(state.currentListId);
  if (!list?.stations?.length) return;
  const idx = list.stations.findIndex((s) => s.id === state.currentStation?.id);
  const prev = list.stations[(idx - 1 + list.stations.length) % list.stations.length];
  if (prev) player.playStation(prev);
});

// Tiny-player controls (Electron mini mode): prev / homepage / next. They
// reuse the tray prev/next logic and the player-card's homepage-open on the
// logo button. Wired unconditionally — the buttons are only visible in
// body.is-tiny-player, so this is a no-op elsewhere.
document.getElementById('tinyPrevBtn')?.addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('electron:trayPrevious'));
});
document.getElementById('tinyNextBtn')?.addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('electron:trayNext'));
});
document.getElementById('tinyHomeBtn')?.addEventListener('click', () => {
  document.getElementById('stationLogoBtn')?.click();
});
document.getElementById('tinyMaxBtn')?.addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('rd:set-tiny', { detail: { on: false } }));
});

// Player action bar prev / next — cycle the active list. Reuses the same
// tray prev/next logic as the Electron tray and tiny player, so it works
// identically in the browser.
document.getElementById('stationPrevBtn')?.addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('electron:trayPrevious'));
});
document.getElementById('stationNextBtn')?.addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('electron:trayNext'));
});

// Electron-only frameless title bar (drag + minimize/pin/close).
// In the browser, isElectron() returns false and this block is skipped.
if (isElectron()) {
  try {
    mountElectronWindowControls({ electronBridge });
  } catch (err) {
    console.warn('Electron window controls mount failed:', err);
  }
}

// --- Helpers ---
function allListsForDropdown() {
  return [state.community, ...state.userLists];
}

function findList(id) {
  if (id === COMMUNITY_LIST_ID) return state.community;
  return state.userLists.find((l) => l.id === id);
}

function applyOfflineStatus(statuses) {
  const offlineIds = new Set(
    Object.entries(statuses)
      .filter(([, status]) => status === 'offline')
      .map(([id]) => id)
  );
  // Desktop station list
  const desktopRows = document.querySelectorAll('#favoritesList .station-item[data-id]');
  for (const row of desktopRows) {
    if (offlineIds.has(row.dataset.id)) {
      row.setAttribute('data-offline', '');
    } else {
      row.removeAttribute('data-offline');
    }
  }
  // Mobile carousel pages — each has its own station-list DOM
  const mobileRows = document.querySelectorAll('.list-page .station-item[data-id]');
  for (const row of mobileRows) {
    if (offlineIds.has(row.dataset.id)) {
      row.setAttribute('data-offline', '');
    } else {
      row.removeAttribute('data-offline');
    }
  }
}

function renderActiveList() {
  const list = findList(state.currentListId) ?? state.community;
  state.currentListId = list.id;
  const allLists = allListsForDropdown();
  // Desktop dropdown
  listDropdown.setLists(allLists);
  listDropdown.setCurrent(list.id);
  stationList.setStations(list.stations, {
    removable: !list.readOnly,
    reorderable: list.reorderable ?? !list.readOnly,
  });
  stationList.setActive(state.currentStation?.id ?? null);
  // Mobile tabs + carousel
  listTabs.setLists(allLists);
  listTabs.setCurrent(list.id);
  listsCarousel.setLists(allLists);
  listsCarousel.setCurrent(list.id, { animate: false });
  listsCarousel.setActiveStation(state.currentStation?.id ?? null);
  updateFavoriteHeart();
  updateShareRowVisibility(list);
  // Re-apply offline status after DOM rebuild, and kick off a fresh
  // probe cycle for the new active list.
  Promise.resolve().then(() => recomputeOffline());
  if (OFF_INDICATOR_ENABLED) streamProber.refresh();
}

function updateShareRowVisibility(list) {
  const row = document.getElementById('listShareRow');
  if (!row) return;
  row.style.display = (list?.stations?.length ?? 0) > 0 ? '' : 'none';
}

document.getElementById('shareCurrentListBtn')?.addEventListener('click', async () => {
  const list = findList(state.currentListId);
  if (!list || !list.stations?.length) return;
  try {
    const url = await buildShareUrl(list);
    openShareModal({ list, url });
    track('list-share', { stationCount: list.stations.length, source: 'list-share-btn' });
  } catch (err) {
    console.error('Share-link build failed:', err);
    toast('Could not build share link.');
  }
});

function favoritesList() {
  // Convention: the first user list is "Favorites" (created lazily by getUserLists).
  return state.userLists[0];
}

// The list a "save / favorite" action targets. Default to the currently
// active list so the heart on the player card and the + button on
// search results both add to whatever the user is currently looking at.
// Community is read-only, so fall back to Favorites when it's active —
// keeps the heart functional without requiring a list switch.
function getActiveEditableList() {
  const active = findList(state.currentListId);
  if (active && !active.readOnly) return active;
  return favoritesList();
}

function isStationInActiveList(station) {
  if (!station) return false;
  const target = getActiveEditableList();
  return !!target?.stations.some((s) => s.id === station.id);
}

function updateFavoriteHeart() {
  playerCard.setFavoriteState(isStationInActiveList(state.currentStation));
}

// --- Player events ---
player.on('stationchange', async (evt) => {
  state.currentStation = evt.detail.station;
  stationList.setActive(state.currentStation.id);
  updateFavoriteHeart();
  await storage.setPref('currentStationId', state.currentStation.id);
});

player.on('error', (evt) => {
  // AbortError is just fast station-zapping (the new play() interrupts the
  // previous load) — noise, not a stream problem.
  if (evt.detail?.name === 'AbortError') return;
  const station = player.getCurrentStation();
  track('stream-error', {
    station: station?.name ?? '',
    errorName: evt.detail?.name ?? '',
    message: evt.detail?.message ?? '',
    phase: 'start',
  });
});

// Element-level media errors carry the actual cause (network drop vs.
// unsupported source) — phase 'playback' distinguishes them from failed
// play() calls above. Whether it was serious shows in what follows:
// stream-recovered = brief drop, stream-dead = station actually broken.
player.on('mediaerror', (evt) => {
  track('stream-error', {
    station: player.getCurrentStation()?.name ?? '',
    errorName: evt.detail?.name ?? '',
    message: evt.detail?.message ?? '',
    phase: 'playback',
  });
});

// Tap-to-audio timing: stationchange marks the playStation() call, the
// first 'playing' after it marks audible sound. Switching stations while
// still loading re-arms the probe, so abandoned loads are never reported.
// Resume-after-pause fires 'playing' without a probe and is skipped.
let startupProbe = null;
player.on('stationchange', (evt) => {
  startupProbe = { station: evt.detail?.station ?? null, t0: performance.now() };
  // New station: assume live until the pipeline or metadata says otherwise.
  // Dead air must reset here (not in 'playing' — silence still fires 'playing').
  playingStationOffline = false;
  playingDeadAir = false;
  recomputeOffline();
});
// Gate the list's active-station pulse dot on real playback. The row keeps
// its .playing (active) styling when paused/stopped; only body.is-playing
// lets the dot blink (station-list.css).
player.on('playing', () => document.body.classList.add('is-playing'));
player.on('paused', () => document.body.classList.remove('is-playing'));
player.on('stopped', () => document.body.classList.remove('is-playing'));
player.on('error', () => document.body.classList.remove('is-playing'));

player.on('playing', () => {
  // Audio is flowing → the active station is definitively online.
  if (playingStationOffline) {
    playingStationOffline = false;
    recomputeOffline();
  }
  if (!startupProbe) return;
  const ms = Math.round(performance.now() - startupProbe.t0);
  const station = startupProbe.station;
  startupProbe = null;
  track('stream-start', {
    station: station?.name ?? '',
    startupMs: ms,
    bucket:
      ms < 1000 ? '00-01s'
      : ms < 2000 ? '01-02s'
      : ms < 5000 ? '02-05s'
      : ms < 10000 ? '05-10s'
      : ms < 20000 ? '10-20s'
      : '20s+',
    hls: player.isHlsUrl(station?.url ?? '') ? 'yes' : 'no',
    platform: matchMedia('(pointer: coarse)').matches ? 'touch' : 'desktop',
    network: navigator.connection?.effectiveType ?? 'unknown',
  });
});

player.on('recovered', (evt) => {
  playingStationOffline = false;
  recomputeOffline();
  track('stream-recovered', {
    station: player.getCurrentStation()?.name ?? '',
    attempts: evt.detail?.attempts ?? 0,
  });
});

player.on('recoveryfailed', () => {
  // Reconnect attempts exhausted → the station we're on is off-air right now.
  playingStationOffline = true;
  recomputeOffline();
  track('stream-dead', {
    station: player.getCurrentStation()?.name ?? '',
  });
});

// --- Volume restore ---
async function restoreVolume() {
  const v = await storage.getPref('volume', 0.8);
  player.setVolume(v);
  playerCard.setVolumePct(Math.round(v * 100));
}
player.on('volumechange', async (evt) => {
  playerCard.setVolumePct(Math.round(evt.detail.volume * 100));
  await storage.setPref('volume', evt.detail.volume);
});

// --- Station list interactions ---
stationList.onClick((station) => {
  track('station-play', {
    station: station.name ?? '',
    uuid: station.id ?? '',
    country: station.countrycode ?? '',
    source: state.currentListId === COMMUNITY_LIST_ID ? 'community' : 'user-list',
  });
  player.playStation(station);
});

stationList.onRemove(async (stationId) => {
  const list = findList(state.currentListId);
  if (!list || list.readOnly) return;
  try {
    await listsApi.removeStationFromList(list.id, stationId);
    list.stations = list.stations.filter((s) => s.id !== stationId);
    scheduleSyncPush();
    renderActiveList();
  } catch (err) {
    toast(err.message);
  }
});

stationList.onReorder(async (orderedIds) => {
  const list = findList(state.currentListId);
  if (!list || !(list.reorderable ?? !list.readOnly)) return;
  try {
    const updated = await listsApi.reorderStationsInList(list.id, orderedIds, { baseline: list.stations });
    list.stations = updated.stations;
    scheduleSyncPush();
    renderActiveList();
  } catch (err) {
    toast(err.message);
  }
});

// --- Save-to-current-list heart on player card ---
playerCard.onFavoriteClick(async (station) => {
  if (!station) return;
  const target = getActiveEditableList();
  if (!target) return;
  const has = target.stations.some((s) => s.id === station.id);
  try {
    if (has) {
      await listsApi.removeStationFromList(target.id, station.id);
      target.stations = target.stations.filter((s) => s.id !== station.id);
      toast(`Removed from "${target.name}"`);
      scheduleSyncPush();
    } else {
      await listsApi.addStationToList(target.id, station);
      target.stations = [...target.stations, station];
      toast(`Added to "${target.name}"`);
      scheduleSyncPush();
    }
    updateFavoriteHeart();
    if (state.currentListId === target.id) renderActiveList();
    else listDropdown.setLists(allListsForDropdown());
  } catch (err) {
    toast(err.message);
  }
});

// --- List dropdown ---
listDropdown.onSelect(async (list) => {
  state.currentListId = list.id;
  renderActiveList();
  await storage.setPref('currentListId', list.id);
});

// --- Mobile tabs + carousel ---
// Tap a tab → switch list (re-uses the same flow as dropdown.onSelect
// so persistence + heart-sync + tab/carousel state all stay in sync).
listTabs.onSelect(async (list) => {
  state.currentListId = list.id;
  renderActiveList();
  await storage.setPref('currentListId', list.id);
});

// Long-press a tab → open the list-actions sheet for that list (Rename
// / Share / Export / Delete). Same modal the desktop ⋯ button opens —
// no duplicate sheet to maintain. Community is read-only so we skip it.
listTabs.onLongPress((list) => {
  if (list?.readOnly) return;
  listDropdown.openActionsSheet(list);
});

// Tap the ⋯ menu button on the tab strip → open the desktop dropdown
// menu (CSS restyles it as a bottom sheet on mobile). The body class
// drives the backdrop. listDropdown.onToggle below syncs the class on
// every open/close so any close path (outside-click, action, etc.)
// also pulls the backdrop down.
listTabs.onMenuClick(() => listDropdown.open());
listTabs.onNewListClick(promptCreateList);

listDropdown.onToggle((isOpen) => {
  document.body.classList.toggle('list-menu-open', isOpen);
});

// Swipe between carousel pages → user changed the active list. Take
// the lightweight path: state + tabs + dropdown label + heart, but
// skip listsCarousel.setCurrent (already scrolled by the user) and
// skip the full setLists rebuild (list shape didn't change).
listsCarousel.onCurrentChange(async (listId) => {
  if (state.currentListId === listId) return;
  state.currentListId = listId;
  listDropdown.setCurrent(listId);
  listTabs.setCurrent(listId);
  const list = findList(listId);
  if (list) stationList.setStations(list.stations, {
    removable: !list.readOnly,
    reorderable: list.reorderable ?? !list.readOnly,
  });
  stationList.setActive(state.currentStation?.id ?? null);
  updateFavoriteHeart();
  await storage.setPref('currentListId', listId);
  if (OFF_INDICATOR_ENABLED) streamProber.refresh();
});

// Carousel row interactions: each page's station-list passes the
// listId alongside the station so the handler can resolve the target
// list directly, no state.currentListId lookup needed (avoids races
// with the swipe-driven state update).
listsCarousel.onClick((station) => {
  track('station-play', {
    station: station.name ?? '',
    uuid: station.id ?? '',
    country: station.countrycode ?? '',
    source: state.currentListId === COMMUNITY_LIST_ID ? 'community' : 'user-list',
  });
  player.playStation(station);
});

listsCarousel.onRemove(async (stationId, listId) => {
  const list = findList(listId);
  if (!list || list.readOnly) return;
  try {
    await listsApi.removeStationFromList(list.id, stationId);
    list.stations = list.stations.filter((s) => s.id !== stationId);
    scheduleSyncPush();
    renderActiveList();
  } catch (err) {
    toast(err.message);
  }
});

listsCarousel.onReorder(async (orderedIds, listId) => {
  const list = findList(listId);
  if (!list || !(list.reorderable ?? !list.readOnly)) return;
  try {
    const updated = await listsApi.reorderStationsInList(list.id, orderedIds, { baseline: list.stations });
    list.stations = updated.stations;
    scheduleSyncPush();
    renderActiveList();
  } catch (err) {
    toast(err.message);
  }
});

async function promptCreateList() {
  const name = await promptDialog({
    title: 'Create New Station List',
    label: 'List Name:',
    placeholder: 'Enter list name…',
    confirmLabel: 'Create List',
    validate: (v) => {
      if (!v) return 'List name is required.';
      if (v.length > 50) return 'Too long (max 50 characters).';
      return null;
    },
  });
  if (!name) return;
  try {
    const created = await listsApi.createList(name);
    state.userLists.push(created);
    state.currentListId = created.id;
    renderActiveList();
    await storage.setPref('currentListId', created.id);
    track('list-create');
    scheduleSyncPush();
    toast(`Created "${created.name}"`);
  } catch (err) {
    toast(err.message);
  }
}

listDropdown.onAddList(promptCreateList);

listDropdown.onRename(async (list) => {
  const next = await promptDialog({
    title: 'Rename List',
    label: 'New name:',
    defaultValue: list.name,
    confirmLabel: 'Rename',
  });
  if (!next || next === list.name) return;
  try {
    const updated = await listsApi.renameList(list.id, next);
    list.name = updated.name;
    scheduleSyncPush();
    renderActiveList();
    toast(`Renamed to "${updated.name}"`);
  } catch (err) {
    toast(err.message);
  }
});

listDropdown.onExport((list) => {
  downloadList(list);
  track('list-export', { stationCount: list.stations?.length ?? 0 });
});

listDropdown.onShare(async (list) => {
  try {
    const url = await buildShareUrl(list);
    openShareModal({ list, url });
    track('list-share', { stationCount: list.stations?.length ?? 0 });
  } catch (err) {
    console.error('Share-link build failed:', err);
    toast('Could not build share link.');
  }
});

function openShareModal({ list, url }) {
  const titleEl = document.getElementById('shareTitle');
  const input = document.getElementById('shareLinkInput');
  const copyBtn = document.getElementById('copyShareLinkBtn');
  titleEl.textContent = `Share "${list.name}"`;
  input.value = url;

  const originalLabel = 'Copy link';
  copyBtn.textContent = originalLabel;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for browsers that haven't granted clipboard permission
      // — selecting the input + execCommand still works on iOS Safari
      // because we're in a user gesture.
      input.focus();
      input.select();
      try { document.execCommand('copy'); } catch {}
    }
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = originalLabel; }, 1500);
  };
  copyBtn.addEventListener('click', onCopy, { once: true });
  openModal('shareModal');
  // Pre-select the URL so a long-press → Copy on mobile picks it up cleanly.
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

listDropdown.onDelete(async (list) => {
  const ok = await confirmDialog({
    title: 'Delete List',
    message: `Delete "${list.name}"? This cannot be undone.`,
    confirmLabel: 'Delete',
  });
  if (!ok) return;
  try {
    await listsApi.deleteList(list.id);
    state.userLists = state.userLists.filter((l) => l.id !== list.id);
    if (state.currentListId === list.id) {
      state.currentListId = favoritesList()?.id ?? COMMUNITY_LIST_ID;
      await storage.setPref('currentListId', state.currentListId);
    }
    renderActiveList();
    track('list-delete');
    toast(`Deleted "${list.name}"`);
    scheduleSyncPush();
  } catch (err) {
    toast(err.message);
  }
});

listDropdown.onSyncDevices(() => syncModal.open());

listDropdown.onImport(async (file) => {
  try {
    const text = await file.text();
    const parsed = parseExport(text);
    const created = await applyImport(parsed);
    state.userLists = await listsApi.getUserLists();
    if (created[0]) state.currentListId = created[0].id;
    renderActiveList();
    track('list-import', { count: created.length });
    toast(created.length === 1 ? `Imported "${created[0].name}"` : `Imported ${created.length} lists`);
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  }
});

// --- Bootstrap ---
//
// Two-phase to survive hostile browser environments (Brave Shield,
// Firefox Strict, Safari ITP) where IndexedDB is blocked or wiped:
//
//   Phase 1 — critical path. Fetches /community-radios.json (static
//             asset, always reachable) and renders the community list
//             immediately. The app is fully usable after this — stations,
//             search, playback, audio. IDB is NOT awaited.
//
//   Phase 2 — IDB-backed state restoration. User lists, prefs, the
//             previously-played station, volume. Every call goes through
//             storage.js's safe-helper wrappers — they return defaults on
//             IDB failure instead of throwing, so this whole phase is
//             effectively `try { … } catch (ignored)`. If IDB is dead,
//             the help banner picks it up via the health observable.
async function bootstrap() {
  // --- Phase 1: community list (critical) -------------------------------
  let communityRes = null;
  try {
    // no-store bypasses the browser HTTP cache (Pages sets max-age=600) so a
    // dashboard Publish shows up on the next load; the service worker also
    // serves this path network-first. The SW/browser cache remains the offline
    // fallback.
    const r = await fetch('/community-radios.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    communityRes = await r.json();
  } catch (err) {
    console.error('Community list fetch failed:', err);
    toast('Could not load station directory — please reload');
    // Even without the community list we want the IDB-backed phase to
    // still attempt restoration (user lists, prefs) so a previously-
    // favourited station can at least be displayed. Fall through.
  }

  if (communityRes) {
    state.community = {
      id: COMMUNITY_LIST_ID,
      name: communityRes.listName ?? 'Community Radios',
      stations: communityRes.stations ?? [],   // ordering applied below once prefs are in
      readOnly: true,
      reorderable: true,
    };
    renderActiveList();   // user sees stations now; IDB phase can take its time
  }

  // --- Phase 2: IDB-backed state (best-effort, never throws) ------------
  const prefs = await storage.getAllPrefs();   // {} if IDB unavailable
  const userLists = await listsApi.getUserLists();  // [] / synthetic Favorites

  if (communityRes && prefs.communityOrder) {
    state.community.stations = listsApi.applyCommunityOrder(
      communityRes.stations ?? [],
      prefs.communityOrder,
    );
  }

  state.userLists = userLists;
  state.currentListId = prefs.currentListId ?? COMMUNITY_LIST_ID;
  if (!findList(state.currentListId)) state.currentListId = COMMUNITY_LIST_ID;

  await restoreVolume();
  renderActiveList();   // re-render with restored ordering + active list
  if (OFF_INDICATOR_ENABLED) streamProber.start(); // begin probing station URLs every 60s

  // Restore current station view (without auto-playing — first play needs user gesture).
  if (prefs.currentStationId) {
    const all = [
      ...(state.community?.stations ?? []),
      ...state.userLists.flatMap((l) => l.stations),
    ];
    const station = all.find((s) => s.id === prefs.currentStationId);
    if (station) {
      state.currentStation = station;
      playerCard.setStation(station);
      stationList.setActive(station.id);
      updateFavoriteHeart();
      // Browsers require a user gesture for the first play(), so the
      // restored station sits silent with the play icon showing. Without
      // a hint, returning users assume the app is broken. The text
      // clears on the next stationchange (i.e. the moment they tap play).
      playerCard.setNowPlaying('Tap ▶ to resume');
    }
  }

  // hls.js is imported on demand at tap time — for HLS stations that
  // download sits squarely inside the tap-to-audio delay (iOS fetches it
  // too, only to find MSE unsupported). Warm the import in idle time
  // unconditionally: an HLS station found via search or a notes-panel
  // capture (not just saved-list stations) must not pay the cold-import
  // cost on first tap. The import is cheap and low-priority even if
  // unused. Keeps the dynamic-import rule: nothing lands in the eager
  // bundle.
  (window.requestIdleCallback ?? ((fn) => setTimeout(fn, 2000)))(() => player.prefetchHls());
}

bootstrap().then(async () => {
  await handleInboundShareHash();
  await handleInboundSyncHash();
  await handleSharedTokenFromQuery();
  const token = await getSyncToken();
  if (token) startSyncEngine();
  // Single-origin logos: the manual logo-pin prefs are dead now. Sweep them.
  cleanupOrphanedLogoPrefs();
});

// Also run the handler on hashchange, so pasting a share URL into an
// already-open tab triggers the import flow (otherwise the URL change
// is just a fragment shift and bootstrap wouldn't re-run).
window.addEventListener('hashchange', () => {
  handleInboundShareHash();
  handleInboundSyncHash();
});

// Inbound share-link handler. Runs after bootstrap so state.userLists is
// populated and the collision check has something to compare against.
// The hash never reached a server (browsers strip the fragment from
// outbound requests), so by reading it here we keep the privacy story
// intact: shared list data only ever exists in the recipient's browser.
async function handleInboundShareHash() {
  const hash = window.location.hash;
  let parsed;
  try {
    parsed = await tryDecodeShareHash(hash);
  } catch (err) {
    console.warn('Share-hash decode failed:', err);
    toast('Share link is invalid or corrupted.');
    clearShareHash();
    return;
  }
  if (!parsed) return;

  // Validate against the existing JSON-import parser — same rules apply
  // (multi-list vs single-list, station-shape filter).
  let validated;
  try {
    validated = parseExport(JSON.stringify(parsed));
  } catch (err) {
    toast(`Share link rejected: ${err.message}`);
    clearShareHash();
    return;
  }

  if (validated.kind === 'single') {
    await importSharedSingle(validated.list);
  } else {
    // Multi-list bundle — no collision UI yet, fall back to the existing
    // auto-rename pipeline. Unusual case in practice (share button only
    // ever produces single-list payloads).
    await confirmAndImportMulti(validated);
  }
  clearShareHash();
}

async function importSharedSingle({ name, stations }) {
  const existing = state.userLists.find(
    (l) => !l.readOnly && l.name.toLowerCase() === name.toLowerCase(),
  );

  if (!existing) {
    const ok = await confirmDialog({
      title: 'Import shared list',
      message: `Import "${name}" with ${stations.length} ${stations.length === 1 ? 'station' : 'stations'}?`,
      confirmLabel: 'Import',
      danger: false,
    });
    if (!ok) return;
    const [created] = await applyImport({ kind: 'single', list: { name, stations } });
    if (created) await switchToList(created.id);
    track('list-import-shared', { stationCount: stations.length, resolution: 'new' });
    toast(`Imported "${created?.name ?? name}"`);
    return;
  }

  const choice = await choiceDialog({
    title: 'List name already exists',
    message: `You already have a list called "${existing.name}". Replace its ${existing.stations.length} stations with the shared ${stations.length}, or keep both as separate lists?`,
    primaryLabel: 'Replace',
    secondaryLabel: 'Keep both',
    primaryDanger: true,
  });
  if (choice === null) return;

  try {
    if (choice === 'primary') {
      const updated = await listsApi.replaceListStations(existing.id, stations);
      existing.stations = updated.stations;
      scheduleSyncPush();
      await switchToList(existing.id);
      track('list-import-shared', { stationCount: stations.length, resolution: 'replace' });
      toast(`Updated "${existing.name}"`);
    } else {
      const [created] = await applyImport({ kind: 'single', list: { name, stations } });
      if (created) await switchToList(created.id);
      track('list-import-shared', { stationCount: stations.length, resolution: 'new' });
      toast(`Imported "${created?.name ?? name}"`);
    }
  } catch (err) {
    console.error('Shared-list import failed:', err);
    toast(`Import failed: ${err.message}`);
  }
}

async function confirmAndImportMulti(parsed) {
  const total = parsed.lists.reduce((sum, l) => sum + l.stations.length, 0);
  const ok = await confirmDialog({
    title: 'Import shared lists',
    message: `Import ${parsed.lists.length} lists (${total} stations total)?`,
    confirmLabel: 'Import',
    danger: false,
  });
  if (!ok) return;
  try {
    const created = await applyImport(parsed);
    state.userLists = await listsApi.getUserLists();
    if (created[0]) await switchToList(created[0].id);
    track('list-import-shared', { listCount: created.length, resolution: 'new' });
    toast(`Imported ${created.length} lists`);
  } catch (err) {
    console.error('Shared multi-import failed:', err);
    toast(`Import failed: ${err.message}`);
  }
}

async function switchToList(id) {
  state.userLists = await listsApi.getUserLists();
  state.currentListId = id;
  await storage.setPref('currentListId', id);
  renderActiveList();
}

// Inbound sync hash handler (#sync=...)
async function handleInboundSyncHash() {
  const hash = window.location.hash;
  if (!hash || !hash.startsWith('#sync=')) return;
  const raw = hash.slice('#sync='.length);
  if (!raw) return;
  const token = extractTokenFromInput(raw);
  if (!token) {
    toast('Invalid sync link.');
    clearSyncHash();
    return;
  }
  try {
    const pulled = await pullFromServer(token);
    if (!pulled) {
      // Same hash — already up to date. Just store the token for future auto-sync.
      await storage.setPref('syncToken', token);
      clearSyncHash();
      toast('Already linked — your lists are up to date.');
      return;
    }
    const ok = await confirmDialog({
      title: 'Import synced lists?',
      message: `This will import ${pulled.list_count} list${pulled.list_count !== 1 ? 's' : ''}.`,
      confirmLabel: 'Import',
    });
    if (!ok) {
      clearSyncHash();
      return;
    }
    const { imported, stationCount } = await applyImportPayload(pulled.exportJson, pulled.hash, pulled.updated_at);
    await storage.setPref('syncToken', token);
    state.userLists = await listsApi.getUserLists();
    state.currentListId = state.userLists[0]?.id ?? COMMUNITY_LIST_ID;
    renderActiveList();
    track('sync-pull', { stationCount, listCount: imported, source: 'inbound-link' });
    toast(`Synced ${imported} list${imported !== 1 ? 's' : ''} (${stationCount} stations)`);
  } catch (err) {
    console.warn('Sync hash handler failed:', err);
    toast(`Sync failed: ${err.message}`);
  }
  clearSyncHash();
}

function clearSyncHash() {
  if (window.location.hash?.startsWith('#sync=')) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

// Handle Web Share Target: when another app shares a URL or text to RadioDock,
// the PWA receives it as query params (registered via share_target in manifest).
// Check if the shared content contains a sync token and process it.
async function handleSharedTokenFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const candidates = [params.get('url'), params.get('text'), params.get('title')].filter(Boolean);

  let token = null;
  for (const raw of candidates) {
    const decoded = decodeURIComponent(raw);
    token = extractTokenFromInput(decoded);
    if (token) break;
  }

  if (!token) return;

  // Clean the URL so reloads don't re-process
  const cleanParams = new URLSearchParams(window.location.search);
  for (const key of ['url', 'text', 'title', 'name', 'description']) {
    cleanParams.delete(key);
  }
  const newSearch = cleanParams.toString();
  history.replaceState(null, '', window.location.pathname + (newSearch ? `?${newSearch}` : ''));

  try {
    const pulled = await pullFromServer(token);
    if (!pulled) {
      await storage.setPref('syncToken', token);
      toast('Already linked — your lists are up to date.');
      return;
    }
    const ok = await confirmDialog({
      title: 'Import synced lists?',
      message: `This will import ${pulled.list_count} list${pulled.list_count !== 1 ? 's' : ''}.`,
      confirmLabel: 'Import',
    });
    if (!ok) return;
    const { imported, stationCount } = await applyImportPayload(pulled.exportJson, pulled.hash, pulled.updated_at);
    await storage.setPref('syncToken', token);
    state.userLists = await listsApi.getUserLists();
    state.currentListId = state.userLists[0]?.id ?? COMMUNITY_LIST_ID;
    renderActiveList();
    track('sync-pull', { stationCount, listCount: imported, source: 'share-target' });
    toast(`Synced ${imported} list${imported !== 1 ? 's' : ''} (${stationCount} stations)`);
  } catch (err) {
    console.warn('Share-target sync failed:', err);
    toast(`Sync failed: ${err.message}`);
  }
}

function clearShareHash() {
  // history.replaceState avoids re-running the importer on reload while
  // keeping the page URL clean (no #s=… cruft in the address bar).
  if (window.location.hash) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

// Standalone (PWA) desktop launches: shrink the window once to match the
// Chrome-extension popup dimensions. Skipped on mobile (window manager
// ignores it anyway) and skipped after the user has manually resized
// (we only do it on first launch per session-stored pref).
async function fitWindowToExtensionSize() {
  if (!detectStandalone()) return;
  // Heuristic: only fire on desktop-class viewports; mobile installs are full-screen.
  if (matchMedia('(pointer: coarse)').matches) return;
  if (await storage.getPref('didFitWindow', false)) return;
  try {
    window.resizeTo(440, 760);
    await storage.setPref('didFitWindow', true);
  } catch {}
}
fitWindowToExtensionSize();

// Register the service worker in production. The dev server already serves
// fresh modules and a SW only gets in the way during development.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    // updateViaCache: 'none' — GitHub Pages serves sw.js with max-age=600, and
    // the default ('imports') lets the browser satisfy the SW update check from
    // that 10-min HTTP cache, delaying every deploy. 'none' forces a fresh sw.js
    // check on each navigation, so new builds (and cache-strategy fixes) roll
    // out promptly.
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((err) => {
      console.warn('SW registration failed:', err);
    });
    // Long-lived app windows (background radio) never relaunch, so they'd
    // run the build they were opened with forever. The SW uses skipWaiting
    // + clients.claim, so a controllerchange in a running window means a
    // newer deploy just took over — offer a one-tap reload instead of
    // silently staying stale.
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      toast('RadioDock was updated', {
        ms: 12000,
        action: { label: 'Reload', callback: () => window.location.reload() },
      });
    });
  });
}

// Debug handle
let __radiodockExports;

// Sync push-on-change debounce
let syncPushTimer = null;
export function scheduleSyncPush() {
  // Mark dirty synchronously so an unpushed edit survives if the app closes
  // within the debounce window — the next startup pushes instead of pulling
  // and clobbering it.
  getSyncToken().then((token) => { if (token) markSyncDirty(); });
  if (syncPushTimer) clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(async () => {
    const token = await getSyncToken();
    if (token) {
      const result = await syncPushWithStatus(token);
      if (result) {
        track('sync-push', {
          stationCount: result.station_count ?? 0,
          listCount: result.list_count ?? 0,
        });
      }
    }
  }, 2000);
}
window.__radiodock = { player, playerCard, stationList, listDropdown, state, listsApi, storage };
