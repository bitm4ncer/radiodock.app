// Tiny capture button injected into the player-card's station-country
// row, alongside ❤️ and ⓘ. Visible only when a station is selected. A
// single click triggers `onCapture()` and gives a brief pulse for
// feedback. The actual capture + toast flow lives in `notes-panel`.

export function mountNotesCaptureButton({ player, onCapture }) {
  const row = document.getElementById('playerActionBar');
  if (!row) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'captureNoteBtn';
  btn.className = 'pab-btn btn-capture-note';
  btn.title = 'Capture this moment';
  btn.setAttribute('aria-label', 'Capture this moment');
  btn.style.display = 'none';
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 4h14a2 2 0 0 1 2 2v12l-4-3-4 3-4-3-4 3V6a2 2 0 0 1 2-2z"/>
      <circle cx="12" cy="10" r="0" fill="currentColor"/>
    </svg>
  `;

  // Slot the button just before the "next" control so the bar reads
  // prev · ⓘ · ❤️ · 📌 · next.
  const nextBtn = row.querySelector('#stationNextBtn');
  if (nextBtn) row.insertBefore(btn, nextBtn);
  else row.appendChild(btn);

  btn.addEventListener('click', () => {
    btn.classList.remove('is-pulsing');
    void btn.offsetWidth; // restart animation
    btn.classList.add('is-pulsing');
    onCapture?.({ source: 'player-card' });
  });

  function refresh() {
    const station = player.getCurrentStation?.();
    btn.style.display = station ? '' : 'none';
  }

  player.on('stationchange', refresh);
  player.on('stopped', refresh);
  refresh();

  return { refresh };
}
