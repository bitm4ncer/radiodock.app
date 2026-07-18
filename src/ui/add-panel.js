import { toast } from './toast.js';
import * as storage from '../data/storage.js';
import { resizeToDataUrl } from '../data/image-resize.js';
import { submitStation, SubmitError } from '../data/submit.js';

const SOCIAL_KEYS = ['instagram', 'soundcloud', 'mixcloud', 'bandcamp', 'youtube', 'facebook', 'x', 'tiktok'];
const PREF_POS = 'addPanelPos';

function randId() {
  return 'custom-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Wire a logo picker block (.add-logo): file → resized data-URL, preview, clear.
function wireLogoPicker(root, maxPx) {
  const input = root.querySelector('.add-logo__input');
  const pick = root.querySelector('.add-logo__pick');
  const clear = root.querySelector('.add-logo__clear');
  const preview = root.querySelector('.add-logo__preview');
  let dataUrl = null;
  pick.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      dataUrl = await resizeToDataUrl(file, maxPx);
      preview.src = dataUrl; preview.hidden = false; clear.hidden = false;
    } catch (err) {
      toast(err.message || 'Could not read that image.');
    } finally {
      input.value = '';
    }
  });
  clear.addEventListener('click', () => {
    dataUrl = null; preview.src = ''; preview.hidden = true; clear.hidden = true;
  });
  return {
    get: () => dataUrl,
    reset: () => { dataUrl = null; preview.src = ''; preview.hidden = true; clear.hidden = true; },
  };
}

export function mountAddPanel({ getUserLists, getActiveListId, addStationToList, track }) {
  const panel = document.getElementById('addPanel');
  if (!panel) return { open() {}, close() {} };
  let panelOpen = false;

  function isMobileNow() {
    return matchMedia('(max-width: 699px)').matches
      || document.documentElement.classList.contains('is-standalone');
  }
  function openPanel() {
    const mob = isMobileNow();
    panel.classList.toggle('add-panel--mobile', mob);
    panel.classList.toggle('add-panel--desktop', !mob);
    panelOpen = true;
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    document.body.classList.toggle('add-overlay-open', mob);
  }
  function closePanel() {
    panelOpen = false;
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('add-overlay-open');
  }
  panel.querySelector('[data-action="close"]')?.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelOpen) closePanel(); });

  // ---- desktop drag + persistence (mirrors sync panel) ----
  function applyPosition(x, y) {
    const r = panel.getBoundingClientRect();
    const w = r.width || 380, h = r.height || 520;
    const cx = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    const cy = Math.max(8, Math.min(window.innerHeight - h - 8, y));
    panel.style.setProperty('--add-x', cx + 'px');
    panel.style.setProperty('--add-y', cy + 'px');
    panel.classList.add('is-positioned');
  }
  (function wireDrag() {
    const handle = panel.querySelector('[data-role="drag"]');
    if (!handle) return;
    let dragging = false, pid = null, ox = 0, oy = 0;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = panel.getBoundingClientRect();
      dragging = true; pid = e.pointerId; handle.setPointerCapture(pid);
      ox = e.clientX - r.left; oy = e.clientY - r.top;
      panel.classList.add('is-dragging'); e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== pid) return;
      applyPosition(e.clientX - ox, e.clientY - oy);
    });
    const end = () => {
      if (!dragging) return;
      dragging = false; panel.classList.remove('is-dragging');
      const x = parseFloat(panel.style.getPropertyValue('--add-x'));
      const y = parseFloat(panel.style.getPropertyValue('--add-y'));
      if (Number.isFinite(x) && Number.isFinite(y)) storage.setPref(PREF_POS, { x, y }).catch(() => {});
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  })();
  storage.getPref(PREF_POS, null).then((p) => {
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) applyPosition(p.x, p.y);
  }).catch(() => {});

  // ---- tabs ----
  const tabs = [...panel.querySelectorAll('.add-panel__tab')];
  const panels = [...panel.querySelectorAll('[data-tabpanel]')];
  function selectTab(name) {
    tabs.forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
    panels.forEach((p) => { p.hidden = p.dataset.tabpanel !== name; });
  }
  tabs.forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));

  // ---- SUBMIT tab ----
  const submitForm = panel.querySelector('#addSubmitForm');
  const submitLogo = wireLogoPicker(panel.querySelector('#addSubmitLogo'), 512);
  const submitBtn = panel.querySelector('#addSubmitBtn');
  submitForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(submitForm);
    const name = String(fd.get('name') || '').trim();
    const streamUrl = String(fd.get('streamUrl') || '').trim();
    if (!name || !streamUrl) { toast('Name and stream URL are required.'); return; }

    const socials = {};
    for (const k of SOCIAL_KEYS) {
      const v = String(fd.get('s_' + k) || '').trim();
      if (v) socials[k] = v;
    }
    const strategy = String(fd.get('mdStrategy') || '').trim();
    const metadata = strategy ? {
      strategy,
      endpoint: String(fd.get('mdEndpoint') || '').trim(),
      artistPath: String(fd.get('mdArtist') || '').trim(),
      titlePath: String(fd.get('mdTitle') || '').trim(),
      showPath: String(fd.get('mdShow') || '').trim(),
      ttl: Number(fd.get('mdTtl')) || null,
      exclusive: fd.get('mdExclusive') === 'on',
    } : null;

    const payload = {
      name, streamUrl,
      homepage: String(fd.get('homepage') || '').trim(),
      genres: String(fd.get('genres') || '').trim(),
      info: String(fd.get('info') || '').trim(),
      city: String(fd.get('city') || '').trim(),
      contactEmail: String(fd.get('contactEmail') || '').trim(),
      socials: Object.keys(socials).length ? socials : undefined,
      metadata: metadata || undefined,
      logoData: submitLogo.get() || undefined,
      website: String(fd.get('website') || ''), // honeypot
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
    try {
      await submitStation(payload);
      toast('Thanks! Your station was submitted for review.');
      submitForm.reset();
      submitLogo.reset();
      track?.('submit-station');
    } catch (err) {
      const msg = err instanceof SubmitError && err.status === 409
        ? 'That station is already in the database.'
        : (err?.message || 'Submission failed.');
      toast(msg);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit to database';
    }
  });

  // ---- CUSTOM tab ----
  const customForm = panel.querySelector('#addCustomForm');
  const customLogo = wireLogoPicker(panel.querySelector('#addCustomLogo'), 256);
  const listSelect = panel.querySelector('#addCustomListSelect');
  const customBtn = panel.querySelector('#addCustomBtn');

  async function refreshLists() {
    const lists = await getUserLists();
    const active = getActiveListId?.();
    listSelect.innerHTML = '';
    for (const l of lists) {
      const opt = document.createElement('option');
      opt.value = l.id; opt.textContent = l.name;
      if (l.id === active) opt.selected = true;
      listSelect.appendChild(opt);
    }
  }

  customForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(customForm);
    const name = String(fd.get('name') || '').trim();
    const url = String(fd.get('url') || '').trim();
    const listId = String(fd.get('listId') || '');
    if (!name || !url) { toast('Name and stream URL are required.'); return; }
    if (!listId) { toast('Pick a list.'); return; }
    const station = { id: randId(), name, url, favicon: customLogo.get() || '', countrycode: '', homepage: '' };
    customBtn.disabled = true;
    try {
      await addStationToList(listId, station);
      toast(`Added “${name}” to your list.`);
      customForm.reset();
      customLogo.reset();
      track?.('add-custom-stream');
    } catch (err) {
      toast(err?.message || 'Could not add the stream.');
    } finally {
      customBtn.disabled = false;
    }
  });

  return {
    open: async () => { openPanel(); selectTab('submit'); await refreshLists(); },
    close: closePanel,
  };
}
