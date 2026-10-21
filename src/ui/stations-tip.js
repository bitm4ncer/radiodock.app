// A quiet, one-time pointer to the Stations button. It waits a little while
// after the first visit, pulses once around the button, and fades out on its
// own so it never gets in the way of someone who already knows the way.
const STORAGE_KEY = 'radiodock-stations-tip-seen';
const SHOW_DELAY = 30000;
const VISIBLE_TIME = 8000;
const GAP = 12;
const EDGE = 12;

export function computeTipPosition({ target, tipWidth, tipHeight, viewportWidth, viewportHeight }) {
  const centerX = target.left + target.width / 2;
  const fitsAbove = target.top >= tipHeight + GAP + EDGE;
  const rawTop = fitsAbove ? target.top - tipHeight - GAP : target.bottom + GAP;
  const top = Math.max(EDGE, Math.min(viewportHeight - tipHeight - EDGE, rawTop));
  const left = Math.max(EDGE, Math.min(viewportWidth - tipWidth - EDGE, centerX - tipWidth / 2));
  const arrowX = Math.max(12, Math.min(tipWidth - 20, centerX - left - 5));
  return { top, left, arrowX, below: !fitsAbove };
}

function readSeen() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, '1');
  } catch {
    /* private mode: the hint simply stays one-time per page load */
  }
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

export function mountStationsTip() {
  const targets = [
    document.getElementById('stationsOpenBtn'),
    document.getElementById('stationsTriggerBtn'),
  ].filter(Boolean);
  const panel = document.getElementById('stationsPanel');
  if (!targets.length || readSeen()) return { show() {}, hide() {} };

  let showTimer = null;
  let hideTimer = null;
  let removeTimer = null;
  let layer = null;
  let bubble = null;
  let pulse = null;
  let shown = false;

  const pickTarget = () => {
    for (const el of targets) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
        return el;
      }
    }
    return null;
  };

  const position = () => {
    if (!shown || !layer || !bubble || !pulse) return;
    const target = pickTarget();
    if (!target) return;
    const rect = targetRect(target);
    const size = Math.max(rect.width, rect.height) + 10;
    pulse.style.width = `${size}px`;
    pulse.style.height = `${size}px`;
    pulse.style.left = `${rect.left + rect.width / 2 - size / 2}px`;
    pulse.style.top = `${rect.top + rect.height / 2 - size / 2}px`;

    const spot = computeTipPosition({
      target: rect,
      tipWidth: bubble.offsetWidth,
      tipHeight: bubble.offsetHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    bubble.style.left = `${spot.left}px`;
    bubble.style.top = `${spot.top}px`;
    bubble.style.setProperty('--tip-arrow-x', `${spot.arrowX}px`);
    bubble.classList.toggle('is-below', spot.below);
  };

  const remove = () => {
    if (removeTimer) clearTimeout(removeTimer);
    removeTimer = null;
    layer?.remove();
    layer = null;
    bubble = null;
    pulse = null;
    shown = false;
  };

  const hide = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    if (!layer) return;
    layer.classList.add('is-leaving');
    removeTimer = setTimeout(remove, 220);
  };

  const dismiss = () => {
    markSeen();
    if (showTimer) clearTimeout(showTimer);
    showTimer = null;
    hide();
  };

  const show = () => {
    if (shown || readSeen()) return;
    if (document.visibilityState === 'hidden') {
      document.addEventListener('visibilitychange', onVisibility, { once: true });
      return;
    }
    // If the panel is already open the user has found it; don't nag later.
    if (panel?.classList.contains('is-open')) {
      markSeen();
      return;
    }
    const target = pickTarget();
    if (!target) return;

    markSeen();
    shown = true;
    layer = document.createElement('div');
    layer.className = 'stations-tip-layer';
    layer.setAttribute('aria-hidden', 'false');
    pulse = document.createElement('span');
    pulse.className = 'stations-tip__pulse';
    bubble = document.createElement('div');
    bubble.className = 'stations-tip__bubble';
    bubble.setAttribute('role', 'status');
    bubble.textContent = 'Find Stations and Explore Collections';
    layer.append(pulse, bubble);
    document.body.appendChild(layer);
    position();
    requestAnimationFrame(() => {
      layer?.classList.add('is-visible');
      pulse?.classList.add('is-pulsing');
    });
    hideTimer = setTimeout(hide, VISIBLE_TIME);
  };

  function onVisibility() {
    if (document.visibilityState === 'visible') show();
  }

  showTimer = setTimeout(show, SHOW_DELAY);
  for (const el of targets) el.addEventListener('click', dismiss);
  window.addEventListener('resize', position);

  return { show, hide };
}
