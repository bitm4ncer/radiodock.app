// A record button placed next to the search icon in the mobile top bar.
// Mounted only in "app" contexts (mobile / installed PWA / Electron), where
// the top bar (and its search icon) is visible — `html.is-standalone` forces
// the mobile top bar on even on desktop. In a regular desktop browser this
// button is not mounted; the notes-panel record button is used instead, so the
// record entry point shows in exactly one place per app state.
//
// The recording lifecycle stays centralized in notes-panel (via
// notesApi.toggleRecord) — this module only renders the button and mirrors state.

export function mountRecordButton({ recorder, player, getNotesApi }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mobile-topbar__btn record-adjacent-btn';
  btn.dataset.action = 'record-adjacent';
  btn.setAttribute('aria-label', 'Record stream');
  btn.title = 'Record';
  btn.innerHTML = '<span class="record-adjacent-btn__dot" aria-hidden="true"></span><span class="record-adjacent-btn__time" data-role="rec-time" hidden></span>';

  // Group the record button with the search icon on the right of the top bar
  // so they sit adjacent (the bar uses justify-content: space-between, which
  // would otherwise scatter a 4th child evenly and separate them).
  const searchBtn = document.querySelector('#searchTriggerBtn');
  if (!searchBtn?.parentNode) return null;
  const group = document.createElement('div');
  group.className = 'mobile-topbar__right';
  searchBtn.parentNode.insertBefore(group, searchBtn);
  group.appendChild(btn);
  group.appendChild(searchBtn); // move the search icon into the group

  btn.addEventListener('click', () => { getNotesApi()?.toggleRecord?.(); });

  function refresh() {
    const rec = recorder?.isRecording?.() ?? false;
    const station = player?.getCurrentStation?.() ?? null;
    btn.classList.toggle('is-recording', rec);
    btn.disabled = !recorder || (!rec && !station);
    btn.title = rec ? 'Stop recording' : (station ? `Record ${station.name}` : 'No station playing');
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
