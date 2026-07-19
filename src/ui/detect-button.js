// The Detect ("Identify track") button that lives in the player action bar,
// alongside record / info / favorite / prev / next. Mirrors record-button.js
// for DOM insertion — a permanent, always-enabled member of the action bar
// (see the no-disabled-state note below).
//
// Detect's own lifecycle (request, quota, save-as-note) is fully owned by
// features/detect.js (mountDetect) — this module only renders the button,
// forwards clicks, and exposes setBusy() so the caller can toggle the
// in-button spinner while a detect request is in flight.

export function mountDetectButton({ onDetect }) {
  const bar = document.getElementById('playerActionBar');
  if (!bar) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pab-btn pab-detect-btn';
  btn.dataset.action = 'detect';
  btn.title = 'Identify track';
  btn.setAttribute('aria-label', 'Identify track');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v18M8 6v12M16 6v12M4 10v4M20 10v4"/></svg>';

  // Slot the detect button just before "next", next to record:
  // prev · ⓘ · ❤️ · 📌 · ● · 〜 · next.
  const nextBtn = bar.querySelector('#stationNextBtn');
  if (nextBtn) bar.insertBefore(btn, nextBtn);
  else bar.appendChild(btn);

  btn.addEventListener('click', () => onDetect());

  // Deliberately no `disabled` state — same action-bar convention as
  // record-button.js: a restored-but-not-yet-played station reads as "no
  // station" via player.getCurrentStation, so a disabled button would stay
  // dead after every app relaunch until first play. mountDetect().run()
  // already toasts "Play a station first" when nothing is playing.

  function setBusy(busy) {
    btn.classList.toggle('is-detecting', !!busy);
  }

  return { el: btn, setBusy };
}
