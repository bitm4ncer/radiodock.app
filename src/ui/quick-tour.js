// Three short, one-time tours for first-time desktop visitors. They point at
// real controls instead of darkening the whole app, so every target stays
// usable while the tour is open.
import { computeTipPosition } from './tour-position.js';

const SEEN_PREFIX = 'radiodock-tour-';
const FOOTER_PIN_CLASS = 'tour-footer-open';

const TOURS = {
  welcome: {
    label: 'Welcome tour',
    steps: [
      {
        targets: ['#playerCard'],
        title: 'Welcome to RadioDock',
        body: 'The place for radio lovers. 50,000+ stations, curated collections, and all your lists in one place.',
      },
      {
        targets: ['.favorites-section', '.favorites-list', '#listDropdownBtn'],
        title: 'Your station list',
        body: 'Community Radios is the default: independent stations from around the world.',
        preferBelow: true,
      },
      {
        targets: ['.list-dropdown'],
        title: 'Make it yours',
        body: 'Create your own lists and switch between them here.',
      },
      {
        targets: ['#playerActionBar', '#addToFavoritesBtn', '#playerCard'],
        title: 'Save what you love',
        body: 'Tap the heart for Favorites, or the plus to move a station into one of your lists.',
      },
      {
        targets: ['.notes-flag'],
        advanceOnClick: '.notes-flag',
        advanceDelay: 360,
        title: 'Keep a radio diary',
        body: 'Notes keep the station, the track and your thoughts together. Open the tab on the right.',
      },
      {
        targets: ['.notes-panel__header'],
        outside: true,
        advanceDelay: 260,
        onEnter: () => {
          const panel = document.querySelector('.notes-panel');
          if (!panel?.classList.contains('is-open')) {
            notesOpenedByTour = true;
            document.querySelector('.notes-flag')?.click();
          }
        },
        onAdvance: () => {
          document.querySelector('.notes-panel [data-action="close"]')?.click();
          notesOpenedByTour = false;
        },
        title: 'Your radio diary',
        body: 'Save moments, record the stream, and sort everything into pages.',
      },
      {
        targets: ['.pab-detect-btn', '#playerActionBar'],
        title: 'Identify the track',
        body: 'Hear something you like? Identify the track and keep it in your notes.',
      },
      {
        targets: ['.pab-record-btn', '#playerActionBar'],
        title: 'Record the stream',
        body: 'Record up to an hour of the current station. The file lands in Notes.',
      },
      {
        targets: ['#captureNoteBtn', '#playerActionBar'],
        title: 'Save the moment',
        body: 'Tap the bookmark to save the station and the current track as a note.',
      },
      {
        targets: ['#stationsOpenBtn', '#stationsTriggerBtn'],
        title: 'Explore the database',
        body: 'Search 50,000+ stations or dig into curated collections.',
        action: {
          label: 'Open Stations',
          run: () => document.getElementById('stationsOpenBtn')?.click(),
        },
      },
    ],
  },
  stations: {
    label: 'Stations tour',
    steps: [
      {
        targets: ['#stationsPanel'],
        noPulse: true,
        outside: true,
        title: 'The Stations window',
        body: 'Browse the database without stopping the music.',
      },
      {
        targets: ['#stationsSearch', '.stations-search-input'],
        title: 'Search or browse',
        body: 'Find stations by name, genre or country, or switch between Popular, A–Z and Community.',
      },
      {
        targets: ['#stationsFeatured', '.stations-featured', '.stations-main'],
        title: 'Curated collections',
        body: 'Open one to explore it, or save the whole collection as your own list with the plus.',
      },
    ],
  },
  footer: {
    label: 'Footer tour',
    steps: [
      {
        targets: ['#sleepTimerFooter', '.sleep-timer-slot'],
        title: 'Sleep timer',
        body: 'Set a timer and RadioDock fades out when it’s time.',
      },
      {
        targets: ['.snap-toggle--pill', '.surface-toggle--pill', '.theme-toggle--pill'],
        group: true,
        extraPulse: '.bg-controls',
        title: 'Make it yours',
        body: 'Adjust the wallpaper, surface, theme and window snapping.',
      },
      {
        targets: ['#footerAddBtn'],
        title: 'Grow the database',
        body: 'Submit missing stations and streams.',
      },
      {
        targets: ['#footerChangelogBtn'],
        title: 'See what’s new',
        body: 'Features has the latest additions and improvements.',
      },
      {
        targets: ['#footerReinstallBtn'],
        title: 'Take it with you',
        body: 'RadioDock runs on iOS, Android, Windows, macOS and Linux.',
        action: {
          label: 'See install options',
          run: () => document.getElementById('footerReinstallBtn')?.click(),
        },
      },
    ],
  },
};

let active = null;
let pendingFooter = false;
let stationsWatch = null;
let notesOpenedByTour = false;

function readSeen(name) {
  try {
    return globalThis.localStorage?.getItem(`${SEEN_PREFIX}${name}`) === '1';
  } catch {
    return false;
  }
}

function markSeen(name) {
  try {
    globalThis.localStorage?.setItem(`${SEEN_PREFIX}${name}`, '1');
  } catch {
    /* private mode: the tour is one-time per page load */
  }
}

function isVisible(el) {
  if (!el) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isDesktopBrowser() {
  return window.matchMedia('(min-width: 700px)').matches
    && !window.matchMedia('(pointer: coarse)').matches
    && !document.body.classList.contains('is-electron')
    && !document.body.classList.contains('is-tiny-player')
    && !document.documentElement.classList.contains('is-standalone');
}

function findTarget(selectors) {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (isVisible(el)) return el;
  }
  return null;
}

function findTargets(selectors) {
  const found = [];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (isVisible(el) && !found.includes(el)) found.push(el);
  }
  return found;
}

function unionRect(elements) {
  const rects = elements.map((el) => el.getBoundingClientRect());
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
    width: Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left)),
    height: Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top)),
  };
}

function pinFooter(on) {
  document.body.classList.toggle(FOOTER_PIN_CLASS, !!on);
}

function targetRect(el) {
  const rect = el.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function dotMarkup(count, current) {
  return Array.from({ length: count }, (_, index) => (
    `<span class="quick-tour__dot${index === current ? ' is-current' : ''}"></span>`
  )).join('');
}

export function startTour(name, { force = false } = {}) {
  if (!TOURS[name] || active || !isDesktopBrowser()) return false;
  if (!force && readSeen(name)) return false;

  markSeen(name);
  if (name === 'welcome') notesOpenedByTour = false;
  if (name === 'footer') pinFooter(true);

  const layer = document.createElement('div');
  layer.className = 'quick-tour-layer';
  layer.setAttribute('aria-hidden', 'false');
  const pulse = document.createElement('span');
  pulse.className = 'quick-tour__pulse';
  const pulse2 = document.createElement('span');
  pulse2.className = 'quick-tour__pulse';
  pulse2.hidden = true;
  const bubble = document.createElement('div');
  bubble.className = 'quick-tour__bubble';
  bubble.tabIndex = -1;
  bubble.setAttribute('role', 'dialog');
  bubble.setAttribute('aria-modal', 'false');
  layer.append(pulse, pulse2, bubble);
  document.body.appendChild(layer);

  active = { name, index: 0, layer, pulse, pulse2, bubble };
  bubble.addEventListener('click', onBubbleClick);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeydown, true);
  window.addEventListener('resize', position, { passive: true });
  window.addEventListener('scroll', position, { passive: true, capture: true });

  if (name === 'stations') {
    const panel = document.getElementById('stationsPanel');
    stationsWatch = setInterval(() => {
      if (!panel?.classList.contains('is-open')) finishTour();
    }, 500);
  }

  renderStep();
  return true;
}

export function finishTour() {
  if (!active) return;
  const name = active.name;
  const { layer, bubble } = active;
  if (stationsWatch) clearInterval(stationsWatch);
  stationsWatch = null;
  bubble.removeEventListener('click', onBubbleClick);
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onKeydown, true);
  window.removeEventListener('resize', position);
  window.removeEventListener('scroll', position, true);
  layer.remove();
  active = null;
  document.body.classList.remove('tour-show-actions');
  document.body.classList.remove('tour-force-notes-flag');
  if (name === 'welcome' && notesOpenedByTour) {
    document.querySelector('.notes-panel [data-action="close"]')?.click();
    notesOpenedByTour = false;
  }
  pinFooter(false);
  window.dispatchEvent(new CustomEvent('rd:tour-end', { detail: { tour: name } }));
  if (pendingFooter) {
    pendingFooter = false;
    setTimeout(maybeStartFooter, 450);
  }
}

export function isTourActive() {
  return !!active;
}

function syncTourChrome() {
  // The action bar is hidden until a station plays. For the tour we keep it
  // visible from the favorites step onward so the identify, record and capture
  // controls can be introduced even on a fresh install.
  document.body.classList.toggle(
    'tour-show-actions',
    active?.name === 'welcome' && active.index >= 3,
  );
  document.body.classList.toggle(
    'tour-force-notes-flag',
    active?.name === 'welcome' && (active.index === 4 || active.index === 5),
  );
}

function renderStep() {
  if (!active) return;
  const def = TOURS[active.name];
  const step = def.steps[active.index];
  const last = active.index === def.steps.length - 1;
  const nextLabel = last ? (step.action?.label ?? 'Done') : (step.nextLabel ?? 'Next');
  syncTourChrome();
  active.bubble.setAttribute('aria-label', `${step.title} — ${active.index + 1} of ${def.steps.length}`);
  active.bubble.innerHTML = `
    <div class="quick-tour__meta">
      <span>${def.label}</span>
      <span>${active.index + 1} / ${def.steps.length}</span>
    </div>
    <h3 class="quick-tour__title">${step.title}</h3>
    <p class="quick-tour__body">${step.body}</p>
    <div class="quick-tour__dots" aria-hidden="true">${dotMarkup(def.steps.length, active.index)}</div>
    <div class="quick-tour__actions">
      <button type="button" class="quick-tour__skip" data-tour="skip">Skip</button>
      <div class="quick-tour__nav">
        ${active.index > 0 ? '<button type="button" class="quick-tour__back" data-tour="back">Back</button>' : ''}
        <button type="button" class="quick-tour__next" data-tour="next">${nextLabel}</button>
      </div>
    </div>`;
  active.bubble.classList.toggle('is-outside', !!step.outside);
  active.bubble.classList.remove('is-stepping');
  void active.bubble.offsetWidth;
  active.bubble.classList.add('is-stepping');
  requestAnimationFrame(() => {
    position();
    active?.bubble.focus({ preventScroll: true });
  });
}

function placeOutside(target, bubble) {
  const rect = targetRect(target);
  const gap = 14;
  const edge = 12;
  const width = bubble.offsetWidth;
  const height = bubble.offsetHeight;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const spaceRight = viewportWidth - rect.right - gap - edge;
  const spaceLeft = rect.left - gap - edge;
  const spaceAbove = rect.top - gap - edge;
  const spaceBelow = viewportHeight - rect.bottom - gap - edge;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const centerY = rect.top + rect.height / 2;
  const centerX = rect.left + rect.width / 2;

  if (spaceRight >= width) {
    const top = clamp(centerY - height / 2, edge, viewportHeight - height - edge);
    bubble.dataset.side = 'right';
    bubble.style.left = `${rect.right + gap}px`;
    bubble.style.top = `${top}px`;
    bubble.style.setProperty('--tour-arrow-y', `${clamp(centerY - top, 16, height - 24)}px`);
    return true;
  }
  if (spaceLeft >= width) {
    const top = clamp(centerY - height / 2, edge, viewportHeight - height - edge);
    bubble.dataset.side = 'left';
    bubble.style.left = `${rect.left - width - gap}px`;
    bubble.style.top = `${top}px`;
    bubble.style.setProperty('--tour-arrow-y', `${clamp(centerY - top, 16, height - 24)}px`);
    return true;
  }
  if (spaceAbove >= height) {
    const left = clamp(centerX - width / 2, edge, viewportWidth - width - edge);
    bubble.dataset.side = 'above';
    bubble.style.left = `${left}px`;
    bubble.style.top = `${rect.top - height - gap}px`;
    bubble.style.setProperty('--tour-arrow-x', `${clamp(centerX - left, 16, width - 24)}px`);
    return true;
  }
  if (spaceBelow >= height) {
    const left = clamp(centerX - width / 2, edge, viewportWidth - width - edge);
    bubble.dataset.side = 'below';
    bubble.style.left = `${left}px`;
    bubble.style.top = `${rect.bottom + gap}px`;
    bubble.style.setProperty('--tour-arrow-x', `${clamp(centerX - left, 16, width - 24)}px`);
    return true;
  }
  return false;
}

function position() {
  if (!active) return;
  const def = TOURS[active.name];
  const step = def.steps[active.index];
  const groupTargets = step.group ? findTargets(step.targets) : [];
  const target = step.group ? null : findTarget(step.targets);
  const { pulse, pulse2, bubble } = active;
  pulse2.hidden = true;

  if (!target && !groupTargets.length) {
    pulse.hidden = true;
    bubble.classList.add('is-centered');
    bubble.classList.remove('is-below');
    bubble.dataset.side = 'center';
    bubble.style.left = '50%';
    bubble.style.top = '50%';
    return;
  }

  pulse.hidden = !!step.noPulse;
  bubble.classList.remove('is-centered');
  const rect = step.group ? unionRect(groupTargets) : targetRect(target);
  if (!step.noPulse) {
    const pad = 6;
    pulse.style.left = `${rect.left - pad}px`;
    pulse.style.top = `${rect.top - pad}px`;
    pulse.style.width = `${rect.width + pad * 2}px`;
    pulse.style.height = `${rect.height + pad * 2}px`;
    pulse.style.borderRadius = `${Math.min(20, Math.max(8, rect.height / 2))}px`;
  }

  if (step.extraPulse) {
    const extra = findTarget([step.extraPulse]);
    if (extra) {
      const extraRect = targetRect(extra);
      const pad = 6;
      pulse2.style.left = `${extraRect.left - pad}px`;
      pulse2.style.top = `${extraRect.top - pad}px`;
      pulse2.style.width = `${extraRect.width + pad * 2}px`;
      pulse2.style.height = `${extraRect.height + pad * 2}px`;
      pulse2.style.borderRadius = `${Math.min(20, Math.max(8, extraRect.height / 2))}px`;
      pulse2.hidden = false;
    }
  }

  // The first Stations step hangs outside the window so it cannot cover the
  // panel it is introducing. On narrower screens fall back to the normal
  // anchored position; the highlight stays off either way.
  if (step.outside && placeOutside(target, bubble)) return;
  bubble.classList.remove('is-outside');

  const spot = computeTipPosition({
    target: rect,
    tipWidth: bubble.offsetWidth,
    tipHeight: bubble.offsetHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    preferBelow: !!step.preferBelow,
  });
  bubble.style.left = `${spot.left}px`;
  bubble.style.top = `${spot.top}px`;
  bubble.style.setProperty('--tour-arrow-x', `${spot.arrowX}px`);
  bubble.dataset.side = spot.below ? 'below' : 'above';
  bubble.classList.toggle('is-below', spot.below);
}

function advance() {
  if (!active) return;
  const def = TOURS[active.name];
  const step = def.steps[active.index];
  if (active.index < def.steps.length - 1) {
    const run = step.onAdvance;
    const delay = step.advanceDelay ?? 0;
    active.index += 1;
    try {
      run?.();
      TOURS[active.name].steps[active.index].onEnter?.();
    } finally {
      if (delay) setTimeout(() => { if (active) renderStep(); }, delay);
      else renderStep();
    }
    return;
  }
  const run = step.action?.run;
  finishTour();
  if (run) setTimeout(run, 80);
}

function goBack() {
  if (!active || active.index === 0) return;
  active.index -= 1;
  TOURS[active.name].steps[active.index].onEnter?.();
  renderStep();
}

function onDocumentClick(evt) {
  if (!active) return;
  const step = TOURS[active.name].steps[active.index];
  if (!step.advanceOnClick) return;
  if (evt.target.closest(step.advanceOnClick)) advance();
}

function onBubbleClick(evt) {
  const action = evt.target.closest('[data-tour]')?.dataset.tour;
  if (action === 'next') advance();
  else if (action === 'back') goBack();
  else if (action === 'skip') finishTour();
}

function onKeydown(evt) {
  if (!active) return;
  if (evt.key === 'Escape') {
    evt.preventDefault();
    finishTour();
    return;
  }
  if (evt.key === 'ArrowRight') {
    evt.preventDefault();
    advance();
    return;
  }
  if (evt.key === 'ArrowLeft') {
    evt.preventDefault();
    goBack();
    return;
  }
  if (evt.key !== 'Tab') return;
  const buttons = [...active.bubble.querySelectorAll('button:not([disabled])')];
  if (!buttons.length) return;
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (evt.shiftKey && document.activeElement === first) {
    evt.preventDefault();
    last.focus();
  } else if (!evt.shiftKey && document.activeElement === last) {
    evt.preventDefault();
    first.focus();
  }
}

function maybeStartFooter() {
  if (!isDesktopBrowser() || readSeen('footer')) return;
  if (!document.body.classList.contains('footer-revealed')) return;
  if (active) {
    pendingFooter = true;
    return;
  }
  startTour('footer');
}

function onPageOpen(evt) {
  if (evt.detail?.id !== 'stations' || readSeen('stations')) return;
  if (active) finishTour();
  const panel = document.getElementById('stationsPanel');
  setTimeout(() => {
    if (panel?.classList.contains('is-open')) startTour('stations');
  }, 420);
}

function scheduleWelcome() {
  if (!isDesktopBrowser() || readSeen('welcome')) return;
  const show = () => {
    if (document.visibilityState !== 'visible') {
      document.addEventListener('visibilitychange', show, { once: true });
      return;
    }
    setTimeout(() => startTour('welcome'), 1200);
  };
  setTimeout(show, 900);
}

export function mountQuickTour() {
  window.addEventListener('rd:page-open', onPageOpen);
  const observer = new MutationObserver(() => {
    if (document.body.classList.contains('footer-revealed')) maybeStartFooter();
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (document.body.classList.contains('footer-revealed')) maybeStartFooter();
  scheduleWelcome();
  return { start: startTour, finish: finishTour, isActive: isTourActive };
}
