// Notes / Diary panel.
//
// Desktop: a flag-tab docks at the right edge. Clicking the tab opens a
// draggable card (~360x520) that the user can drop anywhere; double-click
// the tab (or the close button) snaps the panel back into the dock.
// Position + open-state are persisted to IndexedDB so the panel feels
// like a real workspace surface.
//
// Mobile (`pointer: coarse`): no flag, no drag — the panel renders as a
// full-screen overlay that slides in from the right when triggered from
// the hamburger drawer. Same content, same callbacks.
//
// All persistence lives in `data/notes.js` (which goes through
// `data/storage.js`). This module only owns DOM + interaction state.

import * as notes from '../data/notes.js';
import { getPref, setPref, sumRecordingBytes } from '../data/storage.js';
import { toast } from './toast.js';
import { promptDialog, confirmDialog } from './modal-helpers.js';
import { exportNotesPayload } from '../data/notes-export.js';
import { track } from '../analytics/umami.js';
import { hasEmbedConsent, setEmbedConsent, embedsHtml, consentGateHtml, revokeLinkHtml } from './embeds.js';

const PREF_POS = 'notesPanelPos';
const PREF_OPEN = 'notesPanelOpen';
const PREF_CURRENT_PAGE = 'notesCurrentPageId';
const MAX_RECORDING_BYTES = 500 * 1024 * 1024; // 500 MB total budget

// Internal flag — replaced by player.getCurrentStation() / latestMetadata
// at capture time. Captured here only so the module-internal capture
// helper has both data sources without each caller needing to thread them
// through every entry point.
let getStation = () => null;
let getMetadata = () => null;

// Mount entrypoint. Returns API: { open, close, captureNow, captureDetected }.
export async function mountNotesPanel({ player, getLatestMetadata, recorder = null, showPanelRecordButton = true, fullPage }) {
  getStation = () => player.getCurrentStation?.() ?? null;
  getMetadata = () => getLatestMetadata?.() ?? null;

  // Full-page (mobile-style) treatment on touch devices AND in the Electron
  // desktop shell — a floating draggable panel doesn't fit the app-window feel.
  const isMobile = fullPage ?? matchMedia('(pointer: coarse)').matches;

  const state = {
    pages: [],
    currentPageId: notes.JOURNAL_PAGE_ID,
    notesByPage: new Map(),
    searchQuery: '',
    searchVisible: false,
    open: false,
    editingNoteId: null,
  };

  // ---- DOM ----
  const flag = isMobile ? null : buildFlag();
  const panel = buildPanel({ isMobile, showRecord: showPanelRecordButton });
  if (flag) document.body.appendChild(flag);
  document.body.appendChild(panel);
  let pageMenu = null;
  let noteMenu = null;
  let moveSubmenu = null;
  let pagePicker = null;

  // ---- Persistence restore ----
  if (!isMobile) {
    const pos = await getPref(PREF_POS, null);
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) applyPosition(pos.x, pos.y);
  }
  state.currentPageId = await getPref(PREF_CURRENT_PAGE, notes.JOURNAL_PAGE_ID);
  await reloadPages();
  if (!state.pages.some((p) => p.id === state.currentPageId)) {
    state.currentPageId = notes.JOURNAL_PAGE_ID;
  }
  await reloadNotesForCurrentPage();

  if (!isMobile && (await getPref(PREF_OPEN, false))) {
    openPanel({ animate: false });
  }

  render();

  // ---- Event listeners ----
  flag?.addEventListener('click', () => (state.open ? closePanel() : openPanel()));
  flag?.addEventListener('dblclick', closePanel);

  panel.addEventListener('click', onPanelClick);
  panel.addEventListener('input', onPanelInput);
  panel.addEventListener('keydown', onPanelKeyDown);

  // Outside-click closes per-card / page menus.
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('keydown', (evt) => {
    if (evt.key !== 'Escape') return;
    if (noteMenu) { closeNoteMenu(); evt.stopPropagation(); return; }
    if (moveSubmenu) { closeMoveSubmenu(); evt.stopPropagation(); return; }
    if (pageMenu) { closePageMenu(); evt.stopPropagation(); return; }
    if (pagePicker) { closePagePicker(); evt.stopPropagation(); return; }
    if (state.searchVisible) { toggleSearch(false); evt.stopPropagation(); return; }
    if (state.open && isMobile) { closePanel(); evt.stopPropagation(); }
  });

  if (!isMobile) wireDrag();

  // Keep the panel's Capture button in sync with the player. Without
  // these subscriptions the button stays disabled until the next render
  // (which only happens on note CRUD or page switch) — so picking a
  // station after the panel was opened would leave the button stuck.
  player.on('stationchange', refreshCaptureBtnState);
  player.on('stopped', refreshCaptureBtnState);

  if (recorder) {
    recorder.on('started', () => refreshRecordBtnState());
    recorder.on('progress', (e) => updateRecordTime(e.detail));
    recorder.on('streamdrop', () => toast('Stream dropped — saved what was recorded.'));
    recorder.on('fetching', () => toast('Saving recording…'));
    recorder.on('error', (e) => { toast(e.detail?.message ?? 'Recording failed.'); refreshRecordBtnState(); });
    recorder.on('stopped', (e) => onRecordingStopped(e.detail));
    player.on('stationchange', refreshRecordBtnState);
    player.on('stopped', refreshRecordBtnState);
  }

  window.addEventListener('resize', () => {
    if (isMobile) return;
    const pos = getCurrentPosition();
    if (pos) applyPosition(pos.x, pos.y); // re-clamp
  });

  // Snapshot of the now-playing show taken when recording STARTS — that is the
  // show being taped (the track may change before the user stops). Declared
  // here (before `return`) so the initializer actually runs; the recording
  // handlers below are hoisted and close over it.
  let recordingStartTrack = null;

  return {
    open: openPanel,
    close: closePanel,
    captureNow,
    captureDetected,
    toggleRecord,
    isOpen: () => state.open,
  };

  // ============================================================== Build DOM

  function buildFlag() {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'notes-flag';
    el.title = 'Open notes';
    el.setAttribute('aria-label', 'Open notes');
    el.innerHTML = `
      <span class="notes-flag__inner">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 4h14a2 2 0 0 1 2 2v12l-4-3-4 3-4-3-4 3V6a2 2 0 0 1 2-2z"/>
        </svg>
        <span class="notes-flag__label">Notes</span>
      </span>
    `;
    return el;
  }

  function buildPanel({ isMobile, showRecord = true }) {
    const el = document.createElement('aside');
    el.className = 'notes-panel' + (isMobile ? ' notes-panel--mobile' : ' notes-panel--desktop');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Notes');
    el.innerHTML = `
      <header class="notes-panel__header">
        ${isMobile ? '' : '<span class="notes-panel__drag" data-role="drag" title="Drag" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg></span>'}
        <button type="button" class="notes-panel__page-picker" data-action="page-picker" data-role="page-picker" title="Switch page">
          <span class="notes-panel__page-picker-label" data-role="page-picker-label">Journal</span>
          <span class="notes-panel__page-picker-chev" aria-hidden="true">▾</span>
        </button>
        <span class="notes-panel__spacer"></span>
        <button type="button" class="notes-panel__icon-btn" data-action="toggle-search" title="Search" aria-label="Search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        </button>
        <button type="button" class="notes-panel__icon-btn" data-action="page-menu" title="Page options" aria-label="Page options">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="18" r="1.7" fill="currentColor"/></svg>
        </button>
        <button type="button" class="notes-panel__icon-btn notes-panel__close" data-action="close" title="Close" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </header>
      <div class="notes-panel__search" data-role="search-wrap" hidden>
        <input type="text" class="notes-panel__search-input" data-role="search-input" placeholder="Search notes…" />
      </div>
      <div class="notes-panel__capture-row${showRecord ? '' : ' notes-panel__capture-row--norec'}">
        ${showRecord ? `<button type="button" class="notes-panel__record-btn" data-action="record" aria-label="Record stream" title="Record">
          <span class="notes-panel__record-dot" aria-hidden="true"></span>
          <span class="notes-panel__record-time" data-role="record-time" hidden></span>
        </button>` : ''}
        <button type="button" class="notes-panel__capture-btn" data-action="capture" aria-label="Save moment">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 4h14a2 2 0 0 1 2 2v12l-4-3-4 3-4-3-4 3V6a2 2 0 0 1 2-2z"/>
          </svg>
          <span class="notes-panel__capture-label">Save Moment</span>
        </button>
      </div>
      <div class="notes-panel__list" data-role="list"></div>
      <footer class="notes-panel__footer">
        <button type="button" class="notes-panel__new-note" data-action="new-note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          <span>New note</span>
        </button>
      </footer>
    `;
    return el;
  }

  // ============================================================== Open / Close

  function openPanel({ animate = true } = {}) {
    if (state.open) return;
    // Only one full-page surface open at a time — main.js closes the others.
    window.dispatchEvent(new CustomEvent('rd:page-open', { detail: { id: 'notes' } }));
    state.open = true;
    panel.classList.add('is-open');
    if (animate) panel.classList.add('is-animating');
    panel.setAttribute('aria-hidden', 'false');
    flag?.classList.add('is-tucked');
    if (!isMobile) setPref(PREF_OPEN, true).catch(() => {});
    if (isMobile) document.body.classList.add('notes-overlay-open');
    if (animate) {
      requestAnimationFrame(() => panel.classList.remove('is-animating'));
    }
    refreshCaptureBtnState();
  }

  function closePanel() {
    if (!state.open) return;
    state.open = false;
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    flag?.classList.remove('is-tucked');
    if (!isMobile) setPref(PREF_OPEN, false).catch(() => {});
    if (isMobile) document.body.classList.remove('notes-overlay-open');
    if (state.searchVisible) toggleSearch(false);
  }

  // ============================================================== Drag

  function wireDrag() {
    const handle = panel.querySelector('[data-role="drag"]');
    if (!handle) return;
    let dragging = false;
    let pointerId = null;
    let offsetX = 0, offsetY = 0;
    handle.addEventListener('pointerdown', (evt) => {
      if (evt.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      dragging = true;
      pointerId = evt.pointerId;
      handle.setPointerCapture(pointerId);
      offsetX = evt.clientX - rect.left;
      offsetY = evt.clientY - rect.top;
      panel.classList.add('is-dragging');
      evt.preventDefault();
    });
    handle.addEventListener('pointermove', (evt) => {
      if (!dragging || evt.pointerId !== pointerId) return;
      applyPosition(evt.clientX - offsetX, evt.clientY - offsetY);
    });
    const end = (evt) => {
      if (!dragging || (evt && evt.pointerId !== pointerId)) return;
      dragging = false;
      panel.classList.remove('is-dragging');
      try { handle.releasePointerCapture(pointerId); } catch {}
      pointerId = null;
      const pos = getCurrentPosition();
      if (pos) setPref(PREF_POS, pos).catch(() => {});
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('dblclick', () => {
      panel.style.removeProperty('--notes-x');
      panel.style.removeProperty('--notes-y');
      panel.classList.remove('is-positioned');
      setPref(PREF_POS, null).catch(() => {});
    });
  }

  function applyPosition(x, y) {
    const rect = panel.getBoundingClientRect();
    const w = rect.width || 360;
    const h = rect.height || 520;
    const cx = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    const cy = Math.max(8, Math.min(window.innerHeight - h - 8, y));
    panel.style.setProperty('--notes-x', cx + 'px');
    panel.style.setProperty('--notes-y', cy + 'px');
    panel.classList.add('is-positioned');
  }

  function getCurrentPosition() {
    if (!panel.classList.contains('is-positioned')) return null;
    const x = parseFloat(panel.style.getPropertyValue('--notes-x'));
    const y = parseFloat(panel.style.getPropertyValue('--notes-y'));
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  // ============================================================== Data load

  async function reloadPages() {
    state.pages = await notes.getAllPages();
  }

  async function reloadNotesForCurrentPage() {
    const list = await notes.getNotesForPage(state.currentPageId);
    state.notesByPage.set(state.currentPageId, list);
  }

  // ============================================================== Render

  function render() {
    renderPagePicker();
    renderList();
    refreshCaptureBtnState();
    refreshRecordBtnState();
  }

  function renderPagePicker() {
    const label = panel.querySelector('[data-role="page-picker-label"]');
    const current = state.pages.find((p) => p.id === state.currentPageId);
    label.textContent = current?.name ?? 'Journal';
  }

  function renderList() {
    const listEl = panel.querySelector('[data-role="list"]');
    const allNotes = state.notesByPage.get(state.currentPageId) ?? [];
    const filtered = filterNotes(allNotes, state.searchQuery);

    listEl.querySelectorAll('[data-role="tape-audio"]').forEach((a) => {
      if (a.src) { try { URL.revokeObjectURL(a.src); } catch {} a.pause(); }
    });
    listEl.innerHTML = '';
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'notes-panel__empty';
      empty.textContent = state.searchQuery
        ? 'No notes match your search.'
        : 'No notes yet. Capture a moment or write one.';
      listEl.appendChild(empty);
      return;
    }

    let currentGroup = null;
    for (const n of filtered) {
      const group = dayLabel(n.createdAt);
      if (group !== currentGroup) {
        const h = document.createElement('div');
        h.className = 'notes-panel__day';
        h.textContent = group;
        listEl.appendChild(h);
        currentGroup = group;
      }
      listEl.appendChild(renderCard(n));
    }
  }

  function renderCard(note) {
    const card = document.createElement('article');
    card.className = 'notes-card notes-card--' + note.type;
    card.dataset.noteId = note.id;

    const isEditing = state.editingNoteId === note.id;

    const time = new Date(note.createdAt);
    const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (note.type === 'recording') {
      return renderTapeCard(note, timeStr);
    }

    let meta = '';
    if (note.type === 'capture' && note.station) {
      meta = `
        <div class="notes-card__meta">
          <span class="notes-card__time">${timeStr}</span>
          <span class="notes-card__sep">·</span>
          <span class="notes-card__station">${escapeHtml(note.station.name || 'Unknown station')}</span>
        </div>
      `;
    } else {
      meta = `<div class="notes-card__meta"><span class="notes-card__time">${timeStr}</span></div>`;
    }

    let track = '';
    let embedRegion = '';
    if (note.type === 'capture' && note.track) {
      const t = note.track;
      const hasArtistTitle = !!(t.artist && t.title);
      const display = hasArtistTitle
        ? `${escapeHtml(t.artist)} — ${escapeHtml(t.title)}`
        : (t.nowPlaying ? escapeHtml(t.nowPlaying) : '—');
      const hasEmbed = !!(t.spotify || t.youtube);
      if (hasEmbed) {
        track = `<div class="notes-card__track notes-card__track--toggle" data-action="toggle-embed" role="button" tabindex="0" aria-expanded="false">♫ ${display}<span class="notes-card__chevron" aria-hidden="true">▾</span></div>`;
        embedRegion = `<div class="notes-card__embeds" data-embed-region hidden></div>`;
      } else {
        track = `<div class="notes-card__track">♫ ${display}</div>`;
      }
      if (hasArtistTitle && t.nowPlaying
        && t.nowPlaying.trim().toLowerCase() !== `${t.artist} — ${t.title}`.trim().toLowerCase()) {
        track += `<div class="notes-card__show">On air: ${escapeHtml(t.nowPlaying)}</div>`;
      }
    }

    const bodyHtml = isEditing
      ? `<textarea class="notes-card__edit" data-role="edit" placeholder="Add a note…">${escapeHtml(note.body)}</textarea>`
      : (note.body
          ? `<div class="notes-card__body" data-action="edit">${renderBody(note.body)}</div>`
          : `<div class="notes-card__body notes-card__body--empty" data-action="edit">Tap to add a note…</div>`);

    card.innerHTML = `
      <div class="notes-card__head">
        ${meta}
        <button type="button" class="notes-card__menu-btn" data-action="card-menu" aria-label="Note options">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="18" r="1.5" fill="currentColor"/></svg>
        </button>
      </div>
      ${track}
      ${embedRegion}
      ${bodyHtml}
    `;
    if (isEditing) {
      // Focus + select-all after a tick so the layout has applied.
      requestAnimationFrame(() => {
        const ta = card.querySelector('[data-role="edit"]');
        if (ta) {
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
          autosize(ta);
        }
      });
    }
    return card;
  }

  function refreshCaptureBtnState() {
    const btn = panel.querySelector('[data-action="capture"]');
    const station = getStation();
    btn.disabled = !station;
    btn.classList.toggle('is-disabled', !station);
    btn.title = station ? `Save moment from ${station.name}` : 'No station playing';
  }

  // ============================================================== Recording

  async function refreshRecordBtnState() {
    const btn = panel.querySelector('[data-action="record"]');
    if (!btn) return;
    const station = getStation();
    const rec = recorder?.isRecording?.() ?? false;
    const overBudget = (await sumRecordingBytes()) >= MAX_RECORDING_BYTES;
    btn.classList.toggle('is-recording', rec);
    btn.disabled = !recorder || (!rec && (!station || overBudget));
    btn.title = rec ? 'Stop recording'
      : !recorder ? 'Recording not supported'
      : overBudget ? 'Recording storage full (500 MB)'
      : !station ? 'No station playing'
      : `Record ${station.name}`;
    if (!rec) {
      const el = panel.querySelector('[data-role="record-time"]');
      if (el) { el.hidden = true; el.textContent = ''; }
    }
  }

  function updateRecordTime({ seconds, bytes }) {
    const el = panel.querySelector('[data-role="record-time"]');
    if (!el) return;
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    el.hidden = false;
    el.textContent = `${mm}:${ss} · ${mb} MB`;
  }

  function snapshotTrack() {
    const meta = getMetadata();
    if (meta && (meta.artist || meta.title || meta.nowPlaying)) {
      return { artist: meta.artist ?? null, title: meta.title ?? null, nowPlaying: meta.nowPlaying ?? null };
    }
    return null;
  }

  async function toggleRecord() {
    if (!recorder) { toast('Recording is not supported in this browser.'); return; }
    if (recorder.isRecording()) { recorder.stop(); return; }
    const station = getStation();
    if (!station) { toast('No station playing.'); return; }
    if ((await sumRecordingBytes()) >= MAX_RECORDING_BYTES) {
      toast('Recording storage is full (500 MB). Delete some recordings first.');
      return;
    }
    recordingStartTrack = snapshotTrack();
    recorder.start(station);
    track('recording-started', {
      country: station.countrycode ?? '',
      hasShow: !!(recordingStartTrack?.artist || recordingStartTrack?.title || recordingStartTrack?.nowPlaying),
    });
  }

  async function onRecordingStopped({ blob, mime, durationMs, bytes, station }) {
    refreshRecordBtnState();
    if (!blob || !bytes) { toast('Recording was empty.'); return; }
    // Prefer the show captured when recording started; fall back to now.
    const trackData = recordingStartTrack ?? snapshotTrack();
    recordingStartTrack = null;
    const created = await notes.createRecording({
      pageId: state.currentPageId, station, track: trackData, blob, mime, durationMs, bytes,
    });
    state.notesByPage.set(state.currentPageId, [created, ...(state.notesByPage.get(state.currentPageId) ?? [])]);
    track('recording-stopped', {
      seconds: Math.round(durationMs / 1000),
      mb: +(bytes / 1048576).toFixed(1),
      hasShow: !!(trackData?.artist || trackData?.title || trackData?.nowPlaying),
    });
    if (!state.open) openPanel();
    render();
    const listEl = panel.querySelector('[data-role="list"]');
    if (listEl) listEl.scrollTop = 0;
    toast('Recording saved');
  }

  function renderTapeCard(note, timeStr) {
    const card = document.createElement('article');
    card.className = 'notes-card notes-card--recording';
    card.dataset.noteId = note.id;
    const stationName = escapeHtml(note.station?.name || 'Recording');
    const dur = formatDuration(note.durationMs);
    const mb = ((note.bytes ?? 0) / 1048576).toFixed(1);
    const t = note.track;
    const showDisplay = t
      ? ((t.artist && t.title) ? `${escapeHtml(t.artist)} — ${escapeHtml(t.title)}` : (t.nowPlaying ? escapeHtml(t.nowPlaying) : ''))
      : '';
    const showLine = showDisplay ? `<div class="notes-card__track">♫ ${showDisplay}</div>` : '';
    card.innerHTML = `
      <div class="notes-card__head">
        <div class="notes-card__meta">
          <span class="notes-card__time">${timeStr}</span>
          <span class="notes-card__sep">·</span>
          <span class="notes-card__station">${stationName}</span>
        </div>
        <button type="button" class="notes-card__menu-btn" data-action="card-menu" aria-label="Recording options">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="18" r="1.5" fill="currentColor"/></svg>
        </button>
      </div>
      ${showLine}
      <div class="tape">
        <button type="button" class="tape__play" data-action="tape-play" aria-label="Play recording">
          <svg class="tape__icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
          <svg class="tape__icon-pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>
        </button>
        <div class="tape__reels" aria-hidden="true">
          <svg viewBox="0 0 120 44" class="tape__svg">
            <rect x="2" y="2" width="116" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>
            <g class="tape__reel"><circle cx="36" cy="22" r="12" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="36" cy="22" r="3" fill="currentColor"/><line x1="36" y1="10" x2="36" y2="34" stroke="currentColor" stroke-width="1"/><line x1="24" y1="22" x2="48" y2="22" stroke="currentColor" stroke-width="1"/></g>
            <g class="tape__reel"><circle cx="84" cy="22" r="12" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="84" cy="22" r="3" fill="currentColor"/><line x1="84" y1="10" x2="84" y2="34" stroke="currentColor" stroke-width="1"/><line x1="72" y1="22" x2="96" y2="22" stroke="currentColor" stroke-width="1"/></g>
          </svg>
        </div>
        <div class="tape__info">
          <span class="tape__dur" data-role="tape-dur">${dur}</span>
          <span class="tape__size">${mb} MB</span>
        </div>
        <button type="button" class="tape__dl" data-action="tape-download" aria-label="Download recording" title="Download">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>
        </button>
        <audio class="tape__audio" data-role="tape-audio" preload="none"></audio>
      </div>
    `;
    return card;
  }

  async function toggleTapePlay(card, noteId) {
    const audio = card?.querySelector('[data-role="tape-audio"]');
    const playBtn = card?.querySelector('[data-action="tape-play"]');
    if (!audio || !playBtn) return;
    if (!audio.src) {
      const blob = await notes.getRecordingBlob(noteId);
      if (!blob) { toast('Recording data missing.'); return; }
      audio.src = URL.createObjectURL(blob);
      audio.addEventListener('ended', () => {
        card.classList.remove('is-playing');
        playBtn.setAttribute('aria-label', 'Play recording');
      });
    }
    // The .is-playing class swaps the play/pause SVG via CSS (notes.css).
    if (audio.paused) {
      await audio.play();
      card.classList.add('is-playing');
      playBtn.setAttribute('aria-label', 'Pause recording');
    } else {
      audio.pause();
      card.classList.remove('is-playing');
      playBtn.setAttribute('aria-label', 'Play recording');
    }
  }

  async function downloadRecording(noteId) {
    const list = state.notesByPage.get(state.currentPageId) ?? [];
    const note = list.find((n) => n.id === noteId);
    if (!note) return;
    const blob = await notes.getRecordingBlob(noteId);
    if (!blob) { toast('Recording data missing.'); return; }
    const ext = (note.mime || '').includes('mp4') ? 'm4a' : (note.mime || '').includes('ogg') ? 'ogg' : 'webm';
    const stamp = new Date(note.createdAt).toISOString().slice(0, 16).replace(/[:T]/g, '');
    const name = `${(note.station?.name || 'radiodock').replace(/[^\w-]+/g, '_')}-${stamp}.${ext}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    track('recording-downloaded');
    const del = await confirmDialog({
      title: 'Downloaded',
      message: 'Remove this recording from your notes?',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
    });
    if (del) deleteNoteWithUndo(noteId);
  }

  // ============================================================== Filtering helpers

  function filterNotes(list, q) {
    if (!q) return list;
    const lc = q.toLowerCase();
    return list.filter((n) => {
      if (n.body && n.body.toLowerCase().includes(lc)) return true;
      if (n.station?.name && n.station.name.toLowerCase().includes(lc)) return true;
      if (n.track?.artist && n.track.artist.toLowerCase().includes(lc)) return true;
      if (n.track?.title && n.track.title.toLowerCase().includes(lc)) return true;
      if (n.track?.nowPlaying && n.track.nowPlaying.toLowerCase().includes(lc)) return true;
      return false;
    });
  }

  // ============================================================== Capture

  async function captureNow({ source = 'panel' } = {}) {
    const station = getStation();
    if (!station) {
      toast('No station playing.');
      return null;
    }
    const meta = getMetadata();
    let track = null;
    if (meta && (meta.artist || meta.title || meta.nowPlaying)) {
      track = {
        artist: meta.artist ?? null,
        title: meta.title ?? null,
        nowPlaying: meta.nowPlaying ?? null,
      };
    }
    const created = await notes.createCapture({
      pageId: state.currentPageId,
      station,
      track,
    });
    addCreatedNote(created);
    trackCaptureEvent(source, station, created.track);
    // A capture from the player-card opens the panel (mobile: fullscreen
    // overlay) so the result is visible and immediately editable — a
    // silent capture behind a closed panel reads as "nothing happened".
    if (source === 'player-card' && !state.open) openPanel();
    focusCreatedNote(created, state.open ? 'Captured · Undo' : 'Captured · Tap to edit · Undo');
    return created;
  }

  // Detect ID hit (features/detect.js) — station + track come from the
  // detect response, not from the player's live metadata, so this bypasses
  // getMetadata() entirely. Always opens the panel (unlike captureNow,
  // which only does so for the player-card source) because a tap-triggered
  // detect has no other visible result surface now that the modal is gone.
  async function captureDetected({ station, track }) {
    if (!station) {
      toast('No station playing.');
      return null;
    }
    const created = await notes.createCapture({
      pageId: state.currentPageId,
      station,
      track,
    });
    addCreatedNote(created);
    trackCaptureEvent('detect', station, created.track);
    if (!state.open) openPanel();
    focusCreatedNote(created, 'Identified · Undo');
    return created;
  }

  function addCreatedNote(created) {
    state.notesByPage.set(state.currentPageId, [created, ...(state.notesByPage.get(state.currentPageId) ?? [])]);
  }

  // Shared tail for captureNow/captureDetected: focus the new card for
  // inline edit when the panel is open, scroll it into view, and toast
  // with an Undo action.
  function focusCreatedNote(created, toastText) {
    if (state.open) {
      state.editingNoteId = created.id;
      render();
      const listEl = panel.querySelector('[data-role="list"]');
      listEl.scrollTop = 0;
    } else {
      render();
    }
    toast(toastText, {
      action: { label: 'Undo', callback: () => undoCreate(created.id) },
    });
  }

  function trackCaptureEvent(source, station, trackData) {
    track('note-capture', {
      source,
      country: station?.countrycode ?? '',
      hasTrack: !!(trackData?.artist || trackData?.title || trackData?.nowPlaying),
    });
  }

  async function undoCreate(noteId) {
    await notes.deleteNote(noteId);
    state.notesByPage.set(
      state.currentPageId,
      (state.notesByPage.get(state.currentPageId) ?? []).filter((n) => n.id !== noteId),
    );
    if (state.editingNoteId === noteId) state.editingNoteId = null;
    render();
  }

  // ============================================================== Panel events

  async function onPanelClick(evt) {
    const actionEl = evt.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const card = evt.target.closest('[data-note-id]');
    const noteId = card?.dataset.noteId;

    switch (action) {
      case 'close':           return closePanel();
      case 'capture':         return captureNow({ source: 'panel' });
      case 'record':          return toggleRecord();
      case 'tape-play':       return toggleTapePlay(card, noteId);
      case 'tape-download':   return downloadRecording(noteId);
      case 'new-note':        return createBlankNote();
      case 'page-picker':     return openPagePicker(actionEl);
      case 'page-menu':       return openPageMenu(actionEl);
      case 'toggle-search':   return toggleSearch();
      case 'card-menu':       return openNoteMenu(actionEl, noteId);
      case 'edit':            return startEditing(noteId);
      case 'toggle-embed':    return toggleEmbedRegion(card, noteId);
      case 'load-embeds':     return loadEmbedsForCard(card, noteId);
      case 'revoke-embeds':   return revokeEmbedsForCard(card);
    }
  }

  // ============================================================== Embed previews (Spotify/YouTube)

  function findNoteById(noteId) {
    const list = state.notesByPage.get(state.currentPageId) ?? [];
    return list.find((n) => n.id === noteId);
  }

  function toggleEmbedRegion(card, noteId) {
    const region = card?.querySelector('[data-embed-region]');
    const toggle = card?.querySelector('[data-action="toggle-embed"]');
    if (!region) return;
    const willOpen = region.hidden;
    region.hidden = !willOpen;
    card.classList.toggle('is-open', willOpen);
    toggle?.setAttribute('aria-expanded', String(willOpen));
    if (willOpen && !region.innerHTML.trim()) {
      populateEmbedRegion(region, noteId);
    }
  }

  async function populateEmbedRegion(region, noteId) {
    const note = findNoteById(noteId);
    const t = note?.track;
    if (!t) return;
    const consent = await hasEmbedConsent();
    region.innerHTML = consent
      ? embedsHtml({ spotify: t.spotify, youtube: t.youtube }) + revokeLinkHtml()
      : consentGateHtml();
  }

  async function loadEmbedsForCard(card, noteId) {
    const region = card?.querySelector('[data-embed-region]');
    if (!region) return;
    const note = findNoteById(noteId);
    const t = note?.track;
    if (!t) return;
    const remember = region.querySelector('[data-role="embed-remember"]');
    if (remember?.checked) await setEmbedConsent(true);
    region.innerHTML = embedsHtml({ spotify: t.spotify, youtube: t.youtube }) + revokeLinkHtml();
  }

  async function revokeEmbedsForCard(card) {
    const region = card?.querySelector('[data-embed-region]');
    if (!region) return;
    await setEmbedConsent(false);
    region.innerHTML = consentGateHtml();
    toast('External previews disabled');
  }

  function openPagePicker(anchor) {
    closePageMenu();
    closeNoteMenu();
    closeMoveSubmenu();
    if (pagePicker) { closePagePicker(); return; }
    const items = state.pages.map((p) => ({
      label: p.name,
      active: p.id === state.currentPageId,
      action: () => selectPage(p.id),
    }));
    items.push({ separator: true });
    items.push({
      label: '+ Add page',
      action: () => promptCreatePage(),
    });
    pagePicker = makePopupMenu(items);
    pagePicker.classList.add('notes-popup-menu--picker');
    positionMenuTo(pagePicker, anchor, { align: 'left', menuWidth: Math.max(220, anchor.offsetWidth) });
  }

  function closePagePicker() {
    pagePicker?.remove();
    pagePicker = null;
  }

  async function onPanelInput(evt) {
    if (evt.target.matches('[data-role="search-input"]')) {
      state.searchQuery = evt.target.value;
      renderList();
      return;
    }
    if (evt.target.matches('[data-role="edit"]')) {
      autosize(evt.target);
      return;
    }
  }

  async function onPanelKeyDown(evt) {
    if (evt.target.matches('[data-role="edit"]')) {
      if (evt.key === 'Escape') { evt.preventDefault(); commitEdit({ cancel: true }); }
      else if (evt.key === 'Enter' && (evt.metaKey || evt.ctrlKey)) { evt.preventDefault(); commitEdit(); }
      return;
    }
    if (evt.target.matches('[data-role="search-input"]') && evt.key === 'Escape') {
      toggleSearch(false);
    }
    if (evt.target.matches('[data-action="toggle-embed"]') && (evt.key === 'Enter' || evt.key === ' ')) {
      evt.preventDefault();
      evt.target.click();
    }
  }

  async function createBlankNote() {
    const created = await notes.createNote({ pageId: state.currentPageId, body: '' });
    state.notesByPage.set(state.currentPageId, [created, ...(state.notesByPage.get(state.currentPageId) ?? [])]);
    state.editingNoteId = created.id;
    track('note-create');
    render();
    const listEl = panel.querySelector('[data-role="list"]');
    listEl.scrollTop = 0;
  }

  function startEditing(noteId) {
    if (!noteId) return;
    state.editingNoteId = noteId;
    render();
  }

  async function commitEdit({ cancel = false } = {}) {
    const editing = state.editingNoteId;
    if (!editing) return;
    const ta = panel.querySelector('[data-role="edit"]');
    if (cancel) {
      state.editingNoteId = null;
      render();
      return;
    }
    const val = ta ? ta.value : '';
    try {
      await notes.updateNoteBody(editing, val);
      const list = state.notesByPage.get(state.currentPageId) ?? [];
      const updated = list.map((n) => (n.id === editing ? { ...n, body: val } : n));
      state.notesByPage.set(state.currentPageId, updated);
    } catch (err) {
      console.warn('Note save failed:', err);
    }
    state.editingNoteId = null;
    render();
  }

  // Commit edits when focus leaves the textarea (covers clicks elsewhere).
  panel.addEventListener('focusout', (evt) => {
    if (!evt.target.matches('[data-role="edit"]')) return;
    // Defer; relatedTarget may still be inside the same textarea after
    // re-renders. Bail if the user just resumed typing.
    setTimeout(() => {
      if (state.editingNoteId && !panel.querySelector('[data-role="edit"]:focus')) {
        commitEdit();
      }
    }, 0);
  });

  // ============================================================== Search

  function toggleSearch(force) {
    const next = force !== undefined ? force : !state.searchVisible;
    state.searchVisible = next;
    const wrap = panel.querySelector('[data-role="search-wrap"]');
    wrap.hidden = !next;
    if (next) {
      const input = wrap.querySelector('input');
      input.value = state.searchQuery;
      requestAnimationFrame(() => input.focus());
    } else {
      state.searchQuery = '';
      renderList();
    }
  }

  // ============================================================== Pages

  async function selectPage(id) {
    if (!id || id === state.currentPageId) return;
    state.currentPageId = id;
    state.editingNoteId = null;
    await setPref(PREF_CURRENT_PAGE, id);
    await reloadNotesForCurrentPage();
    render();
  }

  async function promptCreatePage() {
    const name = await promptDialog({
      title: 'New page',
      label: 'Page name:',
      placeholder: 'Enter page name…',
      confirmLabel: 'Create page',
      validate: (v) => {
        const trimmed = String(v ?? '').trim();
        if (!trimmed) return 'Page name is required.';
        if (trimmed.length > 50) return 'Too long (max 50 characters).';
        return null;
      },
    });
    if (!name) return;
    try {
      const created = await notes.createPage(name);
      state.currentPageId = created.id;
      await setPref(PREF_CURRENT_PAGE, created.id);
      await reloadPages();
      await reloadNotesForCurrentPage();
      track('note-page-create');
      render();
    } catch (err) {
      toast(err.message);
    }
  }

  async function promptRenameCurrentPage() {
    const page = state.pages.find((p) => p.id === state.currentPageId);
    if (!page) return;
    const name = await promptDialog({
      title: 'Rename page',
      label: 'New name:',
      defaultValue: page.name,
      confirmLabel: 'Rename',
    });
    if (!name || name === page.name) return;
    try {
      await notes.renamePage(page.id, name);
      await reloadPages();
      render();
    } catch (err) {
      toast(err.message);
    }
  }

  async function deleteCurrentPage() {
    const page = state.pages.find((p) => p.id === state.currentPageId);
    if (!page) return;
    if (page.id === notes.JOURNAL_PAGE_ID) {
      toast('The Journal page cannot be deleted.');
      return;
    }
    const count = (state.notesByPage.get(page.id) ?? []).length;
    const ok = await confirmDialog({
      title: 'Delete page',
      message: `Delete "${page.name}" and ${count} ${count === 1 ? 'note' : 'notes'}? This cannot be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await notes.deletePage(page.id);
      state.notesByPage.delete(page.id);
      state.currentPageId = notes.JOURNAL_PAGE_ID;
      await setPref(PREF_CURRENT_PAGE, state.currentPageId);
      await reloadPages();
      await reloadNotesForCurrentPage();
      render();
    } catch (err) {
      toast(err.message);
    }
  }

  async function exportAllNotes() {
    try {
      await exportNotesPayload();
      track('note-export');
    } catch (err) {
      console.error('Notes export failed:', err);
      toast('Export failed.');
    }
  }

  // ============================================================== Popup menus

  function openPageMenu(anchor) {
    closeNoteMenu();
    closeMoveSubmenu();
    if (pageMenu) { closePageMenu(); return; }
    const page = state.pages.find((p) => p.id === state.currentPageId);
    const isJournal = page?.id === notes.JOURNAL_PAGE_ID;
    pageMenu = makePopupMenu([
      { label: 'Rename page', action: () => promptRenameCurrentPage() },
      { label: 'Export all notes (JSON)', action: () => exportAllNotes() },
      isJournal
        ? null
        : { label: 'Delete page', action: () => deleteCurrentPage(), danger: true },
    ].filter(Boolean));
    positionMenuTo(pageMenu, anchor);
  }

  function closePageMenu() {
    pageMenu?.remove();
    pageMenu = null;
  }

  function openNoteMenu(anchor, noteId) {
    closeMoveSubmenu();
    closePageMenu();
    if (noteMenu) { closeNoteMenu(); return; }
    if (!noteId) return;
    const list = state.notesByPage.get(state.currentPageId) ?? [];
    const note = list.find((n) => n.id === noteId);
    if (!note) return;
    const items = [
      { label: 'Edit', action: () => startEditing(noteId) },
      { label: 'Copy as text', action: () => copyAsText(note) },
    ];
    if (note.type === 'capture' && note.station?.url) {
      items.push({ label: 'Play this station', action: () => playStationFromCapture(note) });
    }
    if (state.pages.length > 1) {
      items.push({ label: 'Move to page…', action: (anchorBtn) => openMoveSubmenu(anchorBtn, noteId) });
    }
    items.push({ label: 'Delete', action: () => deleteNoteWithUndo(noteId), danger: true });

    noteMenu = makePopupMenu(items);
    positionMenuTo(noteMenu, anchor);
  }

  function closeNoteMenu() {
    noteMenu?.remove();
    noteMenu = null;
  }

  function openMoveSubmenu(anchor, noteId) {
    closeMoveSubmenu();
    closeNoteMenu();
    const items = state.pages
      .filter((p) => p.id !== state.currentPageId)
      .map((p) => ({
        label: p.name,
        action: () => moveNoteToPage(noteId, p.id),
      }));
    if (!items.length) return;
    moveSubmenu = makePopupMenu(items);
    positionMenuTo(moveSubmenu, anchor);
  }

  function closeMoveSubmenu() {
    moveSubmenu?.remove();
    moveSubmenu = null;
  }

  function makePopupMenu(items) {
    const wrap = document.createElement('div');
    wrap.className = 'notes-popup-menu';
    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'notes-popup-menu__separator';
        wrap.appendChild(sep);
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'notes-popup-menu__item'
        + (item.danger ? ' is-danger' : '')
        + (item.active ? ' is-active' : '');
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        item.action(btn);
        // Most items close immediately; submenu opener handles its own close.
        if (item.label !== 'Move to page…') {
          closePageMenu();
          closeNoteMenu();
          closeMoveSubmenu();
          closePagePicker();
        }
      });
      wrap.appendChild(btn);
    }
    document.body.appendChild(wrap);
    return wrap;
  }

  function positionMenuTo(menu, anchor, { align = 'right', menuWidth = 200 } = {}) {
    const r = anchor.getBoundingClientRect();
    let left;
    if (align === 'left') {
      left = r.left;
    } else {
      left = r.right - menuWidth;
    }
    left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, left));
    menu.style.left = left + 'px';
    menu.style.top = (r.bottom + 4) + 'px';
    menu.style.minWidth = menuWidth + 'px';
  }

  function onDocumentPointerDown(evt) {
    if (pageMenu && !pageMenu.contains(evt.target) && !evt.target.closest('[data-action="page-menu"]')) {
      closePageMenu();
    }
    if (noteMenu && !noteMenu.contains(evt.target) && !evt.target.closest('[data-action="card-menu"]')) {
      closeNoteMenu();
    }
    if (moveSubmenu && !moveSubmenu.contains(evt.target)) {
      closeMoveSubmenu();
    }
    if (pagePicker && !pagePicker.contains(evt.target) && !evt.target.closest('[data-action="page-picker"]')) {
      closePagePicker();
    }
  }

  // ============================================================== Card actions

  async function deleteNoteWithUndo(noteId) {
    const list = state.notesByPage.get(state.currentPageId) ?? [];
    const note = list.find((n) => n.id === noteId);
    if (!note) return;
    await notes.deleteNote(noteId);
    state.notesByPage.set(
      state.currentPageId,
      list.filter((n) => n.id !== noteId),
    );
    if (state.editingNoteId === noteId) state.editingNoteId = null;
    track('note-delete');
    if (note.type === 'recording') track('recording-deleted');
    render();
    toast('Note deleted · Undo', {
      action: {
        label: 'Undo',
        callback: async () => {
          try {
            await notes.restoreNote(note);
            const updated = state.notesByPage.get(state.currentPageId) ?? [];
            state.notesByPage.set(state.currentPageId, [note, ...updated].sort((a, b) => b.createdAt - a.createdAt));
            render();
          } catch (err) {
            toast(err.message);
          }
        },
      },
    });
  }

  async function copyAsText(note) {
    const lines = [];
    const t = new Date(note.createdAt);
    lines.push(t.toLocaleString());
    if (note.type === 'capture' && note.station) {
      lines.push(`Station: ${note.station.name}`);
    }
    if (note.type === 'capture' && note.track) {
      const display = (note.track.artist && note.track.title)
        ? `${note.track.artist} — ${note.track.title}`
        : (note.track.nowPlaying || '');
      if (display) lines.push(`Track: ${display}`);
    }
    if (note.body) {
      lines.push('');
      lines.push(note.body);
    }
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    } catch {
      toast('Clipboard not available');
    }
  }

  function playStationFromCapture(note) {
    if (!note.station?.url) return;
    try {
      // Try the player module directly — `player` was passed at mount.
      player.playStation(note.station);
      toast(`Playing ${note.station.name}`);
    } catch (err) {
      toast(err.message);
    }
  }

  async function moveNoteToPage(noteId, targetPageId) {
    try {
      await notes.moveNote(noteId, targetPageId);
      const list = state.notesByPage.get(state.currentPageId) ?? [];
      state.notesByPage.set(state.currentPageId, list.filter((n) => n.id !== noteId));
      // Drop cached target list so it gets refetched next time we visit.
      state.notesByPage.delete(targetPageId);
      if (state.editingNoteId === noteId) state.editingNoteId = null;
      render();
      const target = state.pages.find((p) => p.id === targetPageId);
      toast(`Moved to "${target?.name ?? 'page'}"`);
    } catch (err) {
      toast(err.message);
    }
  }
}

// ============================================================== Helpers (top-level)

function formatDuration(ms) {
  const s = Math.round((ms ?? 0) / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function dayLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86400 * 1000);
  if (d >= startOfToday) return 'Today';
  if (d >= startOfYesterday) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Plain text → HTML with auto-linkified URLs and preserved newlines.
function renderBody(body) {
  const escaped = escapeHtml(body);
  const urlRe = /(https?:\/\/[^\s<]+)/g;
  const linked = escaped.replace(urlRe, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  return linked.replace(/\n/g, '<br>');
}

function countryFlagEmoji(cc) {
  if (!cc || cc.length !== 2) return '';
  const codePoints = [...cc.toUpperCase()].map((c) => 0x1f1e6 - 65 + c.charCodeAt(0));
  try { return String.fromCodePoint(...codePoints); } catch { return ''; }
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(220, ta.scrollHeight) + 'px';
}
