// Sleep timer: a rubber-band slider that eases back to zero and pauses
// playback when it runs out. One controller drives two surfaces - the block
// in the off-canvas drawer (mobile + installed PWA) and the footer popover
// (desktop browser) - so the timer keeps running whichever one set it.

export const SLEEP_MAX_MINUTES = 90;
const TICK_MS = 250;

const MOON_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

export function clampMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return 0;
  return Math.min(SLEEP_MAX_MINUTES, Math.max(0, minutes));
}

export function minutesFromFraction(fraction) {
  const value = Number(fraction);
  if (!Number.isFinite(value)) return 0;
  return clampMinutes(Math.round(Math.min(1, Math.max(0, value)) * SLEEP_MAX_MINUTES));
}

export function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function createSleepTimerController({ now = () => Date.now(), onFinish } = {}) {
  let durationMs = 0;
  let remainingMs = 0;
  let endsAt = 0;
  let timer = null;
  const listeners = new Set();

  function state() {
    return { active: remainingMs > 0, durationMs, remainingMs };
  }

  function emit() {
    const snapshot = state();
    listeners.forEach((fn) => fn(snapshot));
  }

  function stopTicking() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function reset() {
    durationMs = 0;
    remainingMs = 0;
    endsAt = 0;
    stopTicking();
    emit();
  }

  function tick() {
    if (!remainingMs) return;
    const left = endsAt - now();
    if (left <= 0) {
      reset();
      onFinish?.();
      return;
    }
    remainingMs = left;
    emit();
  }

  function start(minutes) {
    const ms = Math.round(clampMinutes(minutes) * 60000);
    if (!ms) {
      reset();
      return;
    }
    durationMs = ms;
    remainingMs = ms;
    endsAt = now() + ms;
    stopTicking();
    timer = setInterval(tick, TICK_MS);
    emit();
  }

  function cancel() {
    reset();
  }

  function subscribe(fn) {
    listeners.add(fn);
    fn(state());
    return () => listeners.delete(fn);
  }

  return { start, cancel, subscribe, state, tick };
}

function blockMarkup() {
  return `
    <div class="sleep-timer__head">
      <span class="sleep-timer__label">${MOON_ICON}<span>Sleep timer</span></span>
      <span class="sleep-timer__value">Off</span>
      <button type="button" class="sleep-timer__cancel" aria-label="Cancel sleep timer" hidden>${CLOSE_ICON}</button>
    </div>
    <div class="sleep-timer__track" role="slider" tabindex="0" aria-label="Sleep timer" aria-valuemin="0" aria-valuemax="${SLEEP_MAX_MINUTES}" aria-valuenow="0" aria-valuetext="Off">
      <span class="sleep-timer__rail"></span>
      <span class="sleep-timer__fill"></span>
      <span class="sleep-timer__handle"></span>
    </div>
    <p class="sleep-timer__hint">Drag right to set · slides back</p>
  `;
}

export function mountSleepTimer({ player, onEnd } = {}) {
  if (typeof document === 'undefined' || document.body.classList.contains('is-electron')) return null;

  const controller = createSleepTimerController({
    onFinish: () => {
      let paused = false;
      try {
        if (player?.isPlaying?.()) {
          player.pause();
          paused = true;
        }
      } catch { /* the timer still resets */ }
      onEnd?.({ paused });
    },
  });

  function bindBlock(root) {
    const track = root.querySelector('.sleep-timer__track');
    const fill = root.querySelector('.sleep-timer__fill');
    const handle = root.querySelector('.sleep-timer__handle');
    const value = root.querySelector('.sleep-timer__value');
    const cancelBtn = root.querySelector('.sleep-timer__cancel');
    // While a pointer is down the view previews the prospective duration; the
    // controller only starts on release.
    let preview = null;

    function paint(snapshot) {
      const liveMinutes = snapshot.active ? snapshot.remainingMs / 60000 : 0;
      const minutes = preview ?? liveMinutes;
      const fraction = clampMinutes(minutes) / SLEEP_MAX_MINUTES;
      fill.style.width = `${fraction * 100}%`;
      handle.style.left = `calc((100% - 20px) * ${fraction})`;
      root.classList.toggle('is-active', snapshot.active);
      root.classList.toggle('is-ending', snapshot.active && snapshot.remainingMs <= 10000);
      value.textContent = preview != null
        ? `${clampMinutes(preview)} min`
        : snapshot.active ? formatRemaining(snapshot.remainingMs) : 'Off';
      track.setAttribute('aria-valuenow', String(preview ?? Math.round(liveMinutes)));
      track.setAttribute('aria-valuetext', preview != null
        ? `${clampMinutes(preview)} minutes`
        : snapshot.active ? `${formatRemaining(snapshot.remainingMs)} remaining` : 'Off');
      cancelBtn.hidden = !snapshot.active;
    }

    function minutesAt(clientX) {
      const rect = track.getBoundingClientRect();
      return minutesFromFraction((clientX - rect.left) / rect.width);
    }

    track.addEventListener('pointerdown', (evt) => {
      if (evt.button !== 0) return;
      controller.cancel();
      preview = minutesAt(evt.clientX);
      try { track.setPointerCapture(evt.pointerId); } catch { /* pointer may be gone */ }
      track.focus();
      paint(controller.state());
      evt.preventDefault();
    });

    track.addEventListener('pointermove', (evt) => {
      if (preview == null) return;
      preview = minutesAt(evt.clientX);
      paint(controller.state());
    });

    function endDrag(evt) {
      if (preview == null) return;
      const minutes = preview;
      preview = null;
      try { track.releasePointerCapture(evt.pointerId); } catch { /* already released */ }
      if (minutes > 0) controller.start(minutes);
      else controller.cancel();
      paint(controller.state());
    }

    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);

    track.addEventListener('keydown', (evt) => {
      const current = controller.state().active ? controller.state().remainingMs / 60000 : 0;
      let next = null;
      if (evt.key === 'ArrowRight' || evt.key === 'ArrowUp') next = current + 5;
      else if (evt.key === 'ArrowLeft' || evt.key === 'ArrowDown') next = current - 5;
      else if (evt.key === 'Home') next = 0;
      else if (evt.key === 'End') next = SLEEP_MAX_MINUTES;
      if (next == null) return;
      evt.preventDefault();
      if (next <= 0) controller.cancel();
      else controller.start(next);
    });

    cancelBtn.addEventListener('click', () => controller.cancel());
    controller.subscribe(paint);
  }

  function buildBlock(extraClass = '') {
    const block = document.createElement('div');
    block.className = `sleep-timer${extraClass ? ` ${extraClass}` : ''}`;
    block.innerHTML = blockMarkup();
    return block;
  }

  const drawerRoot = document.getElementById('sleepTimerDrawer');
  if (drawerRoot) {
    const block = buildBlock('sleep-timer--drawer');
    drawerRoot.appendChild(block);
    bindBlock(block);
  }

  const footerBtn = document.getElementById('footerSleepTimerBtn');
  const popover = document.getElementById('sleepTimerPopover');
  if (footerBtn && popover) {
    let open = false;
    let bound = false;

    const close = () => {
      if (!open) return;
      open = false;
      popover.hidden = true;
      footerBtn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
    };

    function onOutside(evt) {
      if (popover.contains(evt.target) || footerBtn.contains(evt.target)) return;
      close();
    }

    function onKey(evt) {
      if (evt.key === 'Escape') close();
    }

    const position = () => {
      const rect = footerBtn.getBoundingClientRect();
      const width = popover.offsetWidth || 286;
      const height = popover.offsetHeight || 120;
      popover.style.left = `${Math.max(8, Math.min(rect.left + rect.width - width, window.innerWidth - width - 8))}px`;
      popover.style.top = `${Math.max(8, Math.min(rect.top - height - 8, window.innerHeight - height - 8))}px`;
    };

    const show = () => {
      popover.hidden = false;
      if (!bound) {
        const block = buildBlock('sleep-timer--popover');
        popover.appendChild(block);
        bindBlock(block);
        bound = true;
      }
      open = true;
      footerBtn.setAttribute('aria-expanded', 'true');
      position();
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
      popover.querySelector('.sleep-timer__track')?.focus();
    };

    footerBtn.addEventListener('click', () => (open ? close() : show()));

    controller.subscribe((snapshot) => {
      footerBtn.textContent = snapshot.active ? `Sleep ${formatRemaining(snapshot.remainingMs)}` : 'Sleep timer';
    });
  }

  return { controller };
}
