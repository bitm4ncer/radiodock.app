// Install section. Two distinct presentations:
//   - Mobile (≤699 px): inline block inside the main column, collapsible
//     via the chevron toggle, takes space in the scroll flow.
//   - Desktop (≥700 px): a floating info badge in the bottom-right corner
//     of the viewport with a × dismiss button. The badge is sticky and
//     stays visible until the user dismisses it (persisted in IndexedDB)
//     or the app is in standalone mode.
// In both regimes, clicking one of the platform buttons opens the
// matching install-info modal (or the Web Store link).

import * as storage from '../data/storage.js';
import { detectPlatform } from '../platform.js';

// Which buttons to highlight as the user's relevant install path(s). Returns
// an array so multiple buttons can be highlighted at once (Chromium desktop
// users have both the extension AND PWA-install paths available, so both
// get highlighted).
function highlightTargetsFor(platform) {
  if (platform.startsWith('ios')) return ['ios'];
  if (platform === 'android') return ['android'];
  if (platform === 'chromium-desktop') return ['chrome-ext', 'browser-app'];
  return ['browser-app'];
}

// Which buttons to actually show on this platform. Mobile users have no use
// for the browser-extension or desktop-PWA paths — they can't act on either
// from their phone — so we hide them to keep the section focused on what's
// installable here. Desktop users see everything (extension + PWA + a
// "how to install on your phone" link for cross-device discovery).
function visibleTargetsFor(platform) {
  if (platform.startsWith('ios')) return ['ios'];
  if (platform === 'android') return ['android'];
  return ['chrome-ext', 'browser-app', 'android', 'ios'];
}

const CHEVRON_SVG = `<svg class="install-section__chevron" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

const CLOSE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

const ICONS = {
  sync: `<svg class="install-section__btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/></svg>`,
  'chrome-ext': `<svg class="install-section__btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.7 2.7 0 0 1 0 5.4H2V20a2 2 0 0 0 2 2h3.8v-1.5a2.7 2.7 0 0 1 5.4 0V22H17a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z" fill="currentColor"/></svg>`,
  'browser-app': `<svg class="install-section__btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm7.94 9h-3.02a15.8 15.8 0 0 0-1.2-5.32A8.03 8.03 0 0 1 19.94 11ZM12 4.04c.78 1.13 1.66 3.2 1.88 6.96h-3.76C10.34 7.25 11.22 5.17 12 4.04ZM4.06 13h3.02a15.8 15.8 0 0 0 1.2 5.32A8.03 8.03 0 0 1 4.06 13Zm4.06-2H5.1a8.03 8.03 0 0 1 4.2-4.28A15.8 15.8 0 0 0 8.12 11Zm3.88 8.96c-.78-1.13-1.66-3.2-1.88-6.96h3.76c-.22 3.76-1.1 5.83-1.88 6.96ZM14.7 18.32A15.8 15.8 0 0 0 15.9 13h3.02a8.03 8.03 0 0 1-4.22 5.32Z" fill="currentColor"/></svg>`,
  android: `<svg class="install-section__btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.4395 5.5586c-.675 1.1664-1.352 2.3318-2.0274 3.498-.0366-.0155-.0742-.0286-.1113-.043-1.8249-.6957-3.484-.8-4.42-.787-1.8551.0185-3.3544.4643-4.2597.8203-.084-.1494-1.7526-3.021-2.0215-3.4864a1.1451 1.1451 0 0 0-.1406-.1914c-.3312-.364-.9054-.4859-1.379-.203-.475.282-.7136.9361-.3886 1.5019 1.9466 3.3696-.0966-.2158 1.9473 3.3593.0172.031-.4946.2642-1.3926 1.0177C2.8987 12.176.452 14.772 0 18.9902h24c-.119-1.1108-.3686-2.099-.7461-3.0683-.7438-1.9118-1.8435-3.2928-2.7402-4.1836a12.1048 12.1048 0 0 0-2.1309-1.6875c.6594-1.122 1.312-2.2559 1.9649-3.3848.2077-.3615.1886-.7956-.0079-1.1191a1.1001 1.1001 0 0 0-.8515-.5332c-.5225-.0536-.9392.3128-1.0488.5449zm-.0391 8.461c.3944.5926.324 1.3306-.1563 1.6503-.4799.3197-1.188.0985-1.582-.4941-.3944-.5927-.324-1.3307.1563-1.6504.4727-.315 1.1812-.1086 1.582.4941zM7.207 13.5273c.4803.3197.5506 1.0577.1563 1.6504-.394.5926-1.1038.8138-1.584.4941-.48-.3197-.5503-1.0577-.1563-1.6504.4008-.6021 1.1087-.8106 1.584-.4941z" fill="currentColor"/></svg>`,
  ios: `<svg class="install-section__btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" fill="currentColor"/></svg>`,
  // Desktop app download icons — shown only on desktop (≥700px). Official
  // brand marks (simple-icons, CC0); currentColor tints them to the theme.
  windows: `<svg class="install-section__btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-13.051-1.351" fill="currentColor"/></svg>`,
  macos: `<svg class="install-section__btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" fill="currentColor"/></svg>`,
  linux: `<svg class="install-section__btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 01-.004-.021l-.004-.024a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 01-.018-.2v-.02a1.772 1.772 0 01.15-.768c.082-.22.232-.406.43-.533a.985.985 0 01.594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 00-.166-.267.248.248 0 00-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 00-.12.27.944.944 0 00-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 01-.131.068 2.62 2.62 0 01-.275-.402 1.772 1.772 0 01-.155-.667 1.759 1.759 0 01.08-.668 1.43 1.43 0 01.283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 01.016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 01-.448-.067 3.566 3.566 0 01-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537v-.043c-.06-.003-.12 0-.18 0h-.016c.151-.467-.182-.825-1.065-1.224-.915-.4-1.646-.336-1.77.465-.008.043-.013.066-.018.135-.068.023-.139.053-.209.064-.43.268-.662.669-.793 1.187-.13.533-.17 1.156-.205 1.869v.003c-.02.334-.17.838-.319 1.35-1.5 1.072-3.58 1.538-5.348.334a2.645 2.645 0 00-.402-.533 1.45 1.45 0 00-.275-.333c.182 0 .338-.03.465-.067a.615.615 0 00.314-.334c.108-.267 0-.697-.345-1.163-.345-.467-.931-.995-1.788-1.521-.63-.4-.986-.87-1.15-1.396-.165-.534-.143-1.085-.015-1.645.245-1.07.873-2.11 1.274-2.763.107-.065.037.135-.408.974-.396.751-1.14 2.497-.122 3.854a8.123 8.123 0 01.647-2.876c.564-1.278 1.743-3.504 1.836-5.268.048.036.217.135.289.202.218.133.38.333.59.465.21.201.477.335.876.335.039.003.075.006.11.006.412 0 .73-.134.997-.268.29-.134.52-.334.74-.4h.005c.467-.135.835-.402 1.044-.7zm2.185 8.958c.037.6.343 1.245.882 1.377.588.134 1.434-.333 1.791-.765l.211-.01c.315-.007.577.01.847.268l.003.003c.208.199.305.53.391.876.085.4.154.78.409 1.066.486.527.645.906.636 1.14l.003-.007v.018l-.003-.012c-.015.262-.185.396-.498.595-.63.401-1.746.712-2.457 1.57-.618.737-1.37 1.14-2.036 1.191-.664.053-1.237-.2-1.574-.898l-.005-.003c-.21-.4-.12-1.025.056-1.69.176-.668.428-1.344.463-1.897.037-.714.076-1.335.195-1.814.12-.465.308-.797.641-.984l.045-.022zm-10.814.049h.01c.053 0 .105.005.157.014.376.055.706.333 1.023.752l.91 1.664.003.003c.243.533.754 1.064 1.189 1.637.434.598.77 1.131.729 1.57v.006c-.057.744-.48 1.148-1.125 1.294-.645.135-1.52.002-2.395-.464-.968-.536-2.118-.469-2.857-.602-.369-.066-.61-.2-.723-.4-.11-.2-.113-.602.123-1.23v-.004l.002-.003c.117-.334.03-.752-.027-1.118-.055-.401-.083-.71.043-.94.16-.334.396-.4.69-.533.294-.135.64-.202.915-.47h.002v-.002c.256-.268.445-.601.668-.838.19-.201.38-.336.663-.336zm7.159-9.074c-.435.201-.945.535-1.488.535-.542 0-.97-.267-1.28-.466-.154-.134-.28-.268-.373-.335-.164-.134-.144-.333-.074-.333.109.016.129.134.199.2.096.066.215.2.36.333.292.2.68.467 1.167.467.485 0 1.053-.267 1.398-.466.195-.135.445-.334.648-.467.156-.136.149-.267.279-.267.128.016.034.134-.147.332a8.097 8.097 0 01-.69.468zm-1.082-1.583V5.64c-.006-.02.013-.042.029-.05.074-.043.18-.027.26.004.063 0 .16.067.15.135-.006.049-.085.066-.135.066-.055 0-.092-.043-.141-.068-.052-.018-.146-.008-.163-.065zm-.551 0c-.02.058-.113.049-.166.066-.047.025-.086.068-.14.068-.05 0-.13-.02-.136-.068-.01-.066.088-.133.15-.133.08-.031.184-.047.259-.005.019.009.036.03.03.05v.02h.003z" fill="currentColor"/></svg>`,
  // Filled red heart for the Buy-Me-a-Coffee support link — the same heart
  // path as the favorite/save button (#addToFavoritesBtn in index.html).
  support: `<svg class="install-section__btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 3C19.5376 3 22 5.5 22 9C22 16 14.5 20 12 21.5C9.5 20 2 16 2 9C2 5.5 4.5 3 7.5 3C9.35997 3 11 4 12 5C13 4 14.64 3 16.5 3Z" fill="currentColor"/></svg>`,
  // Flathub — the store the GNOME/KDE software centres pull from. A simple
  // package cube reads as "app store" without risking a wrong brand path.
  flathub: `<svg class="install-section__btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 3 6.5v11L12 22l9-4.5v-11L12 2Zm0 2.24 6.4 3.2L12 10.66 5.6 7.44 12 4.24ZM5 9.24l6 3.02v7.2l-6-3V9.24Zm14 0v7.22l-6 3v-7.2l6-3.02Z" fill="currentColor"/></svg>`,
};

const SUPPORT_URL = 'https://buymeacoffee.com/bitmancer';

// OS download URLs. The Electron wrapper is a thin client (loads the live
// PWA), so builds are rare — only when Electron itself or preload.js changes.
// Assets are published to GitHub Releases with stable, versionless names.
// `flathub` currently points at the raw .flatpak bundle on the same release —
// once the app is published on Flathub, swap this to the store page
// (https://flathub.org/apps/app.radiodock.RadioDock), relabel the tile
// "Flathub", and give it the external-link glyph instead of the download one.
const DOWNLOAD_URLS = {
  windows: 'https://github.com/bitm4ncer/radiodock.app/releases/latest/download/RadioDock-win.exe',
  macos:   'https://github.com/bitm4ncer/radiodock.app/releases/latest/download/RadioDock-mac.dmg',
  linux:   'https://github.com/bitm4ncer/radiodock.app/releases/latest/download/RadioDock-linux.AppImage',
  flathub: 'https://github.com/bitm4ncer/radiodock.app/releases/latest/download/RadioDock-linux.flatpak',
};

function tile(target, label, sub, currentClass) {
  return `<button type="button" class="install-section__btn${currentClass}" data-target="${target}">
    ${ICONS[target]}
    <span class="install-section__btn-text">
      <span class="install-section__btn-label">${label}</span>
      <span class="install-section__btn-sub">${sub}</span>
    </span>
  </button>`;
}

function downloadTile(target, label, sub) {
  const url = DOWNLOAD_URLS[target];
  return `<a class="install-section__btn install-section__btn--download" href="${url}" target="_blank" rel="noopener" data-download="${target}">
    ${ICONS[target]}
    <span class="install-section__btn-text">
      <span class="install-section__btn-label">${label}</span>
      <span class="install-section__btn-sub">${sub}</span>
    </span>
    <svg class="install-section__btn-dl-icon" viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>
  </a>`;
}

// A low-key outbound ask, tracked as a bmc-click by the delegated handler in
// main.js (href match), so no per-element wiring here.
function supportTile() {
  return `<a class="install-section__btn install-section__btn--support" href="${SUPPORT_URL}" target="_blank" rel="noopener" data-support>
    ${ICONS.support}
    <span class="install-section__btn-text">
      <span class="install-section__btn-label">Support</span>
      <span class="install-section__btn-sub">this project</span>
    </span>
    <svg class="install-section__btn-dl-icon" viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
      <path d="M14 5h5m0 0v5m0-5-7 7M17 14v3a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>
  </a>`;
}

export async function mountInstallSection({ container, installInfo, animateIn = false }) {
  const platform = detectPlatform();
  if (platform === 'installed') {
    // Already a PWA — no reason to nag.
    return { destroy() {} };
  }

  // Respect a previous user-dismissal of the badge — UNLESS the caller asked
  // for an explicit re-summon (e.g. the footer "Install on Devices" button).
  if (!animateIn && (await storage.getPref('installSectionDismissed', false))) {
    return { destroy() {} };
  }

  // A re-summon clears the dismissal pref so closing tab + reopening still
  // shows the badge.
  if (animateIn) {
    await storage.setPref('installSectionDismissed', false).catch(() => {});
  }

  // If a previous instance is still in the DOM (e.g. mid-dismiss-fade-out),
  // remove it immediately so we don't end up with two badges stacked.
  document.getElementById('installSection')?.remove();

  const highlights = highlightTargetsFor(platform);
  const visible = visibleTargetsFor(platform);
  const isCurrent = (target) => (highlights.includes(target) ? ' is-current' : '');
  const showsBtn = (target) => visible.includes(target);

  const section = document.createElement('section');
  section.className = 'install-section';
  if (animateIn) section.classList.add('is-entering');
  section.id = 'installSection';
  section.innerHTML = `
    <button type="button" class="install-section__close" data-action="dismiss" aria-label="Dismiss">
      ${CLOSE_SVG}
    </button>
    <button type="button" class="install-section__toggle" aria-expanded="true" aria-controls="installSectionBody">
      <span class="install-section__title">Install RadioDock</span>
      ${CHEVRON_SVG}
    </button>
    <div class="install-section__body" id="installSectionBody">
      <div class="install-section__head">
        <img class="install-section__logo" src="/icons/icon.svg" alt="" aria-hidden="true" />
        <p class="install-section__intro">Use RadioDock on any device</p>
      </div>
      <div class="install-section__buttons" role="group">
        ${showsBtn('ios') ? tile('ios', 'iOS', 'Add to home screen', isCurrent('ios')) : ''}
        ${showsBtn('browser-app') ? tile('browser-app', 'Browser App', 'Install in browser', isCurrent('browser-app')) : ''}
        ${showsBtn('android') ? tile('android', 'Android', 'Add to home screen', isCurrent('android')) : ''}
        ${showsBtn('chrome-ext') ? tile('chrome-ext', 'Extension', 'Chrome · Edge · Brave', isCurrent('chrome-ext')) : ''}
      </div>
      <div class="install-section__downloads">
        <p class="install-section__downloads-label">Or download the desktop app</p>
        <div class="install-section__buttons">
          ${downloadTile('windows', 'Windows', '.exe installer')}
          ${downloadTile('macos', 'macOS', '.dmg disk image')}
          ${downloadTile('linux', 'Linux', '.AppImage')}
          ${downloadTile('flathub', 'Flatpak', '.flatpak package')}
        </div>
      </div>
      <div class="install-section__foot">
        <button type="button" class="install-section__sync" data-action="sync">
          ${ICONS.sync}
          <span class="install-section__btn-text">
            <span class="install-section__btn-label">Sync devices</span>
            <span class="install-section__btn-sub">QR code — no account needed</span>
          </span>
          <svg class="install-section__btn-dl-icon" viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
            <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
        </button>
        ${supportTile()}
      </div>
    </div>
  `;
  container.append(section);

  // Commit the .is-entering initial layout, then flip the class off so the
  // CSS transition runs. We use setTimeout(20) rather than requestAnimationFrame
  // because hidden tabs pause RAF callbacks but still fire timeouts — the user
  // might Cmd-click the button while looking elsewhere.
  if (animateIn) {
    // Force a style read so the initial transform/opacity is committed.
    void section.offsetHeight;
    setTimeout(() => section.classList.remove('is-entering'), 20);
  }

  const toggleBtn = section.querySelector('.install-section__toggle');
  const closeBtn = section.querySelector('.install-section__close');
  const body = section.querySelector('.install-section__body');

  // Restore collapse state (mobile only — desktop badge ignores this).
  const collapsed = await storage.getPref('installSectionCollapsed', false);
  if (collapsed) setCollapsed(true, { skipAnimate: true });

  function setCollapsed(value, { skipAnimate = false } = {}) {
    section.classList.toggle('is-collapsed', value);
    toggleBtn.setAttribute('aria-expanded', String(!value));
    if (skipAnimate) body.style.transition = 'none';
    body.style.display = value ? 'none' : '';
    if (skipAnimate) {
      requestAnimationFrame(() => {
        body.style.transition = '';
      });
    }
    storage.setPref('installSectionCollapsed', value).catch(() => {});
  }

  function dismiss() {
    section.classList.add('is-dismissed');
    storage.setPref('installSectionDismissed', true).catch(() => {});
    // Remove from DOM after slide-out so it doesn't intercept clicks.
    setTimeout(() => section.remove(), 240);
  }

  toggleBtn.addEventListener('click', () => {
    const next = !section.classList.contains('is-collapsed');
    setCollapsed(next);
  });

  closeBtn.addEventListener('click', dismiss);

  // Cache the original overview HTML so we can restore it when the user
  // navigates back from a detail view.
  const overviewHtml = body.innerHTML;
  let inDetailView = false;

  // Cross-fade body content with a height tween on the badge so the
  // overview ↔ detail swap doesn't snap. The badge is anchored
  // bottom-right (position: fixed bottom: 20px), so growing the height
  // visually pushes the top edge up — matching what the user expects.
  const FADE_OUT_MS = 140;
  const HEIGHT_MS = 260;
  let inFlight = false;

  function transitionBodyTo(mutate) {
    if (inFlight) return; // de-bounce rapid clicks
    inFlight = true;

    const startH = section.getBoundingClientRect().height;

    // Fade body out.
    body.style.transition = `opacity ${FADE_OUT_MS}ms ease, transform ${FADE_OUT_MS}ms ease`;
    body.style.opacity = '0';
    body.style.transform = 'translateY(4px)';

    setTimeout(() => {
      // Swap content.
      mutate();
      // Measure target height once content is in.
      section.style.height = 'auto';
      const endH = section.getBoundingClientRect().height;
      // Lock to start height, then animate to end.
      section.style.height = startH + 'px';
      // Force layout so the next height change triggers a transition.
      // eslint-disable-next-line no-unused-expressions
      section.offsetHeight;
      section.style.transition = `height ${HEIGHT_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      section.style.height = endH + 'px';
      // Fade in shortly after height starts moving.
      body.style.transition = `opacity ${HEIGHT_MS - 20}ms ease 40ms, transform ${HEIGHT_MS - 20}ms ease 40ms`;
      body.style.opacity = '';
      body.style.transform = '';

      setTimeout(() => {
        section.style.transition = '';
        section.style.height = '';
        body.style.transition = '';
        inFlight = false;
      }, HEIGHT_MS + 40);
    }, FADE_OUT_MS);
  }

  function showDetail(branch) {
    transitionBodyTo(() => {
      inDetailView = true;
      section.classList.add('is-detail');
      body.innerHTML = `
        <button type="button" class="install-section__back" data-action="back" aria-label="Back">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
          Back
        </button>
        <div class="install-section__detail" id="installSectionDetail"></div>
      `;
      installInfo.renderInline({
        branch,
        container: body.querySelector('#installSectionDetail'),
        onClose: showOverview,
      });
    });
  }

  function showOverview() {
    transitionBodyTo(() => {
      inDetailView = false;
      section.classList.remove('is-detail');
      body.innerHTML = overviewHtml;
    });
  }

  // Single delegated click handler on the body so it covers both the
  // overview buttons and the back button in the detail view.
  body.addEventListener('click', (evt) => {
    const backBtn = evt.target.closest('[data-action="back"]');
    if (backBtn) {
      showOverview();
      return;
    }
    if (inDetailView) return; // detail-view actions are wired by renderInline()
    const targetBtn = evt.target.closest('[data-target]');
    if (!targetBtn) return;
    const target = targetBtn.dataset.target;
    const branchMap = {
      'chrome-ext': 'browser-ext',
      'browser-app': 'desktop',
      android: 'android',
      ios: 'ios-safari',
    };
    const branch = branchMap[target];
    if (!branch) return;

    // Desktop: render the detail inline inside the badge. Mobile: open the
    // existing fullscreen modal slide-in.
    const isDesktop = window.matchMedia('(min-width: 700px)').matches;
    if (isDesktop) {
      showDetail(branch);
    } else {
      installInfo.open(branch);
    }
  });

  return {
    destroy() {
      section.remove();
    },
  };
}
