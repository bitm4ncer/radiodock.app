// The record button that lives in the player action bar, alongside the
// info / favorite / note / prev / next controls. Shown wherever the action
// bar is (desktop card + mobile dock), so it replaces the old mobile top-bar
// entry point. The desktop notes-panel keeps its own record button.
//
// The recording lifecycle stays centralized in notes-panel (via
// notesApi.toggleRecord) — this module only renders the button and mirrors state.
// Idle it's a centered red record dot sized like the other segment icons;
// while recording the segment grows to show "MM:SS ●" with a pulsing dot.

export function mountRecordButton({ recorder, player, getNotesApi }) {
  const bar = document.getElementById('playerActionBar');
  if (!bar) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pab-btn pab-record-btn';
  btn.dataset.action = 'record';
  btn.setAttribute('aria-label', 'Record stream');
  btn.title = 'Record';
  // Time first (left), record circle second (right). The circle shares the
  // info icon's exact geometry so it renders at the same size; CSS makes it a
  // muted outline idle, red outline on hover, filled red while recording. When
  // recording the segment grows into a pill showing "MM:SS ⭕".
  btn.innerHTML = '<span class="record-adjacent-btn__time" data-role="rec-time" hidden></span><svg class="pab-record-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/></svg>';

  // Slot the record button just before "next" so the bar reads
  // prev · ⓘ · ❤️ · 📌 · ● · next.
  const nextBtn = bar.querySelector('#stationNextBtn');
  if (nextBtn) bar.insertBefore(btn, nextBtn);
  else bar.appendChild(btn);

  btn.addEventListener('click', () => { getNotesApi()?.toggleRecord?.(); });

  function refresh() {
    const rec = recorder?.isRecording?.() ?? false;
    const station = player?.getCurrentStation?.() ?? null;
    btn.classList.toggle('is-recording', rec);
    // Keep the button a permanent, full-strength member of the always-complete
    // action bar — never dim it for "no station" (a restored-but-not-yet-played
    // station reads as no station via getCurrentStation until the first play).
    // A tap with nothing playing just toasts via toggleRecord.
    btn.disabled = !recorder;
    btn.title = rec ? 'Stop recording' : (station ? `Record ${station.name}` : 'Record');
  }

  const timeEl = btn.querySelector('[data-role="rec-time"]');
  recorder?.on('progress', (e) => {
    const s = e.detail?.seconds ?? 0;
    timeEl.hidden = false;
    timeEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  });
  const clearTransient = () => { btn.classList.remove('is-fetching'); timeEl.hidden = true; timeEl.textContent = ''; };
  recorder?.on('fetching', () => { btn.classList.add('is-fetching'); });
  recorder?.on('resumed', () => { refresh(); });

  recorder?.on('started', refresh);
  recorder?.on('stopped', () => { clearTransient(); refresh(); });
  recorder?.on('error', () => { clearTransient(); refresh(); });
  recorder?.on('streamdrop', refresh);
  player?.on('stationchange', refresh);
  player?.on('stopped', refresh);
  refresh();

  return { refresh };
}
