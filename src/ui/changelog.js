// "What's New" changelog. Renders a release-by-release feature tour into the
// #changelogModal body. Copy is user-level — what a feature does and how to use
// it — never technical. To announce a new feature: add a release at the TOP of
// CHANGELOG and bump CHANGELOG_REVISION so the "new" dot returns for everyone.

import { openModal } from './modals.js';

const ISSUES_URL = 'https://github.com/bitm4ncer/radiodock.app/issues';

// Monotonic "have you seen the newest release?" counter. Releases are named, not
// numbered — the app's real version comes from the git commit count, so any label
// here would only ever be a second, wrong one.
// main.js compares this to the on-device `changelogSeenRevision` pref.
export const CHANGELOG_REVISION = 9;

// Stroke line icons, no emoji. Inner markup only; wrapped by iconTile() so they
// share one viewBox + stroke treatment and inherit `currentColor`.
const ICONS = {
  sync: '<path d="M21 3v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 9"/><path d="M3 21v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 15"/>',
  tape: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2.3"/><circle cx="16" cy="12" r="2.3"/><path d="M6.5 19l1.7-3M17.5 19l-1.7-3"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
  note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M8 8h5M8 12h4"/><path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L14 13l-4 1 1-4z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  devices: '<rect x="2" y="4" width="13" height="9" rx="1"/><path d="M6 17h6M8.5 13v4"/><rect x="16.5" y="8" width="5.5" height="11" rx="1.2"/><path d="M18.6 17h1.3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  heart: '<path d="M20.8 6.6a5 5 0 0 0-8.8-2.2A5 5 0 0 0 3.2 6.6c0 3.8 4.2 6.9 8.8 11 4.6-4.1 8.8-7.2 8.8-11z"/>',
  music: '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
  lock: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1.2"/>',
  install: '<path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  detect: '<path d="M12 3v18M8 6v12M16 6v12M4 10v4M20 10v4"/>',
};

// Newest release first. Each feature: { icon, title, body }.
export const CHANGELOG = [
  {
    name: 'Identify the track',
    features: [
      { icon: 'detect', title: 'What song is this?', body: 'Tap the Identify button in the player to recognise the currently playing track if it is available on Spotify or YouTube.' },
    ],
  },
  {
    name: 'Faster & more private',
    features: [
      { icon: 'search', title: 'A cleaner station library', body: 'Search now runs on RadioDock’s own curated directory — fewer duplicates and better logos — and quietly falls back to the community source if ours is ever unreachable, so it keeps working.' },
      { icon: 'lock', title: 'Logos load privately', body: 'Station artwork now comes only from RadioDock’s own servers. Opening the app no longer reaches out to dozens of other websites before you press play.' },
      { icon: 'music', title: 'Peek at what’s on', body: 'On desktop, hover a station in your lists or search results to preview what’s playing right now — without pressing play first.' },
    ],
  },
  {
    name: 'Cross-device sync',
    features: [
      { icon: 'sync', title: 'Sync across your devices', body: 'Scan a QR code (or paste a link) to connect your phone and computer. Your lists then stay in sync automatically — no account, and only your own devices can read them.' },
    ],
  },
  {
    name: 'Tape recording',
    features: [
      { icon: 'tape', title: 'Record straight to a note', body: 'Hit record on the player and RadioDock captures what you’re hearing into a note, like a tape deck. Replay it inline or download it whenever you like.' },
    ],
  },
  {
    name: 'Faster controls',
    features: [
      { icon: 'keyboard', title: 'Quicker controls', body: 'Keyboard shortcuts for play, volume, search and mute; one-click mute; and scroll over the volume strip to fine-tune it. (Desktop.)' },
    ],
  },
  {
    name: 'Notes & Diary',
    features: [
      { icon: 'note', title: 'Keep a radio diary', body: 'Tap capture and the station plus the track playing right now are saved into a timestamped note. Sort notes into pages, search them, and export anytime.' },
    ],
  },
  {
    name: 'Share a list',
    features: [
      { icon: 'share', title: 'Share a list by link', body: 'Send anyone a private link and they add your whole list of stations in one tap. No account, and the link’s contents never touch a server.' },
    ],
  },
  {
    name: 'Rebuilt for every screen',
    features: [
      { icon: 'devices', title: 'At home on phone and desktop', body: 'Layouts tuned for each device — a focused mobile view and a roomy desktop one — so it feels native wherever you open it.' },
    ],
  },
  {
    name: 'The essentials',
    features: [
      { icon: 'globe', title: '50,000+ stations', body: 'Browse a community-curated directory of internet radio from all over the world.' },
      { icon: 'search', title: 'Search', body: 'Find stations by name, genre, or country.' },
      { icon: 'heart', title: 'Favorites & lists', body: 'Save stations into your own lists, reorder them by dragging — all stored on your device.' },
      { icon: 'music', title: 'Now playing', body: 'See the current artist and track for stations that broadcast it.' },
      { icon: 'lock', title: 'Background & lock-screen', body: 'Keeps playing when you switch apps or lock your phone — control it from the lock screen or your Bluetooth headphones.' },
      { icon: 'install', title: 'Install & offline', body: 'Install RadioDock as an app on any device; the shell works offline after the first load.' },
    ],
  },
];

function iconTile(name) {
  return `<span class="cl-card__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg></span>`;
}

function cardHtml(feature, isNewest) {
  const badge = isNewest ? '<span class="cl-badge">New</span>' : '';
  return `<article class="cl-card">
    ${iconTile(feature.icon)}
    <div class="cl-card__text">
      <h5 class="cl-card__title">${feature.title}${badge}</h5>
      <p class="cl-card__body">${feature.body}</p>
    </div>
  </article>`;
}

function releaseHtml(release, isNewest) {
  const cards = release.features.map((f) => cardHtml(f, isNewest)).join('');
  return `<section class="cl-release">
    <header class="cl-release__head">
      <span class="cl-release__name">${release.name}</span>
    </header>
    <div class="cl-cards">${cards}</div>
  </section>`;
}

function bannerHtml() {
  return `<div class="cl-banner">
    <h4 class="cl-banner__title">Built in the open</h4>
    <p class="cl-banner__body">Every new feature lands here as a beta — I ship early and test it live, in production, rather than behind closed doors. Expect the odd rough edge. Found a bug or have an idea? I’d love your help shaping where this goes.</p>
    <a class="cl-banner__cta" href="${ISSUES_URL}" target="_blank" rel="noopener">Open an issue on GitHub →</a>
  </div>`;
}

function footerHtml() {
  return `<p class="cl-foot">Open source · no accounts · no tracking beyond anonymous, opt-out counts.</p>`;
}

export function mountChangelog() {
  const body = document.getElementById('changelogBody');
  let rendered = false;

  function render() {
    if (!body || rendered) return;
    body.innerHTML =
      CHANGELOG.map((rel, i) => releaseHtml(rel, i === 0)).join('') +
      bannerHtml() +
      footerHtml();
    rendered = true;
  }

  render();

  return {
    open() {
      // Only one full-page surface open at a time — main.js closes the others.
      window.dispatchEvent(new CustomEvent('rd:page-open', { detail: { id: 'changelogModal' } }));
      render();
      openModal('changelogModal');
    },
  };
}
