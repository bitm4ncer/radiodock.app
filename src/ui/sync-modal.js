import { confirmDialog } from './modal-helpers.js';
import { toast } from './toast.js';
import * as storage from '../data/storage.js';
import {
  generateToken, pushToServer, pullFromServer, deleteFromServer,
  getSyncToken, buildExportPayload, applyImportPayload, extractTokenFromInput,
  getRemoteMeta, onSyncStatus, SyncError,
} from '../data/sync.js';

// Human-readable "synced N ago" from a ms timestamp.
function relativeTime(at) {
  if (!at) return '';
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
}

const STATUS_TEXT = {
  syncing: () => '↻ Syncing…',
  synced: (at) => `✓ Up to date${at ? ` · synced ${relativeTime(at)}` : ''}`,
  offline: () => '⚠ Offline — will sync when back online',
  error: () => '⚠ Sync error — retrying…',
  unlinked: () => '',
};

const SYNC_URL_PREFIX = `${window.location.origin}/#sync=`;

function show(el) { if (el) el.hidden = false; }
function hide(el) { if (el) el.hidden = true; }

// Render the sync URL as a scannable QR. qrcode is dynamically imported so it
// stays out of the main bundle (same pattern as hls.js). Dark-on-white always,
// independent of theme, so any phone camera reads it.
let qrLib = null;
let lastQrUrl = null;
async function renderSyncQr(url) {
  const container = document.getElementById('syncQr');
  if (!container || !url) return;
  if (url === lastQrUrl && container.childElementCount > 0) return; // already drawn
  try {
    qrLib = qrLib || (await import('qrcode')).default;
    const dataUrl = await qrLib.toDataURL(url, {
      margin: 1,
      width: 320,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });
    container.innerHTML = `<img src="${dataUrl}" alt="Sync QR code" width="160" height="160" />`;
    lastQrUrl = url;
  } catch (err) {
    console.warn('QR render failed:', err);
    container.innerHTML = '';
  }
}

export function mountSyncModal({ onListsChanged, onLinked, onUnlinked, track }) {
  // ---- Panel, not a modal: a freely-draggable card on desktop (like the notes
  // panel + player), a fullscreen page on mobile. No blur backdrop. ----
  const panel = document.getElementById('syncPanel');
  const PREF_POS = 'syncPanelPos';
  let panelOpen = false;

  // Match the app's mobile layout regime (viewport ≤699px or standalone) — the
  // same condition under which the off-canvas "Sync devices" entry appears — so
  // the desktop footer opens the draggable card and the mobile drawer opens the
  // fullscreen page. Re-evaluated at open so a resize across the breakpoint is
  // respected.
  function isMobileNow() {
    return matchMedia('(max-width: 699px)').matches
      || document.documentElement.classList.contains('is-standalone');
  }

  function openPanel() {
    if (!panel) return;
    // Only one full-page surface open at a time — main.js closes the others.
    window.dispatchEvent(new CustomEvent('rd:page-open', { detail: { id: 'sync' } }));
    const mob = isMobileNow();
    panel.classList.toggle('sync-panel--mobile', mob);
    panel.classList.toggle('sync-panel--desktop', !mob);
    panelOpen = true;
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    document.body.classList.toggle('sync-overlay-open', mob);
  }
  function closePanel() {
    if (!panel) return;
    panelOpen = false;
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('sync-overlay-open');
  }
  panel?.querySelector('[data-action="close"]')?.addEventListener('click', closePanel);
  document.addEventListener('keydown', (evt) => { if (evt.key === 'Escape' && panelOpen) closePanel(); });

  // Desktop drag + position persistence — mirrors the notes panel.
  function applyPosition(x, y) {
    const rect = panel.getBoundingClientRect();
    const w = rect.width || 320, h = rect.height || 480;
    const cx = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    const cy = Math.max(8, Math.min(window.innerHeight - h - 8, y));
    panel.style.setProperty('--sync-x', cx + 'px');
    panel.style.setProperty('--sync-y', cy + 'px');
    panel.classList.add('is-positioned');
  }
  function getCurrentPosition() {
    if (!panel.classList.contains('is-positioned')) return null;
    const x = parseFloat(panel.style.getPropertyValue('--sync-x'));
    const y = parseFloat(panel.style.getPropertyValue('--sync-y'));
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  function wireDrag() {
    const handle = panel?.querySelector('[data-role="drag"]');
    if (!handle) return;
    let dragging = false, pointerId = null, offsetX = 0, offsetY = 0;
    handle.addEventListener('pointerdown', (evt) => {
      if (evt.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      dragging = true; pointerId = evt.pointerId;
      handle.setPointerCapture(pointerId);
      offsetX = evt.clientX - rect.left; offsetY = evt.clientY - rect.top;
      panel.classList.add('is-dragging'); evt.preventDefault();
    });
    handle.addEventListener('pointermove', (evt) => {
      if (!dragging || evt.pointerId !== pointerId) return;
      applyPosition(evt.clientX - offsetX, evt.clientY - offsetY);
    });
    const end = (evt) => {
      if (!dragging || (evt && evt.pointerId !== pointerId)) return;
      dragging = false; panel.classList.remove('is-dragging');
      try { handle.releasePointerCapture(pointerId); } catch {}
      pointerId = null;
      const pos = getCurrentPosition();
      if (pos) storage.setPref(PREF_POS, pos).catch(() => {});
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('dblclick', () => {
      panel.style.removeProperty('--sync-x');
      panel.style.removeProperty('--sync-y');
      panel.classList.remove('is-positioned');
      storage.setPref(PREF_POS, null).catch(() => {});
    });
  }
  // Drag is wired unconditionally; the handle is hidden by CSS on the mobile
  // fullscreen variant, so it can only be grabbed on the desktop card.
  if (panel) {
    wireDrag();
    storage.getPref(PREF_POS, null).then((pos) => {
      if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) applyPosition(pos.x, pos.y);
    }).catch(() => {});
  }

  // Live status line — subscribed once; a slow timer keeps the relative time
  // fresh while the panel is open.
  const statusEl = () => document.getElementById('syncLiveStatus');
  let lastStatus = { state: 'unlinked', at: null };
  function renderStatus(status) {
    lastStatus = status;
    const el = statusEl();
    if (!el) return;
    const text = (STATUS_TEXT[status.state] ?? (() => ''))(status.at);
    el.textContent = text;
    el.dataset.state = status.state;
    el.hidden = !text;
  }
  onSyncStatus(renderStatus);
  setInterval(() => {
    if (lastStatus.state === 'synced' && !panelOpen) return;
    renderStatus(lastStatus);
  }, 10000);

  const states = {
    unlinked: document.getElementById('syncStateUnlinked'),
    generating: document.getElementById('syncStateGenerating'),
    linked: document.getElementById('syncStateLinked'),
    connected: document.getElementById('syncStateConnected'),
    error: document.getElementById('syncStateError'),
  };

  function hideAll() {
    for (const s of Object.values(states)) hide(s);
  }

  function showState(name) {
    hideAll();
    show(states[name]);
  }

  function showError(msg) {
    hideAll();
    const el = document.getElementById('syncErrorMsg');
    if (el) el.textContent = msg;
    show(states.error);
  }

  async function refreshState() {
    const token = await getSyncToken();
    hideAll();
    if (!token) {
      showState('unlinked');
      return;
    }

    show(states.generating);
    try {
      // token is the secret; getRemoteMeta derives the record id server-side.
      const meta = await getRemoteMeta(token);
      if (!meta) {
        showState('unlinked');
        return;
      }

      const url = `${SYNC_URL_PREFIX}${token}`;
      const countText = `Syncing ${meta.list_count} list${meta.list_count !== 1 ? 's' : ''} (${meta.station_count} stations)`;

      const input = document.getElementById('syncLinkInput');
      if (input) input.value = url;

      const count = document.getElementById('syncCount');
      if (count) count.textContent = countText;

      showState('linked');
      renderSyncQr(url);
    } catch {
      showState('unlinked');
    }
  }

  document.getElementById('syncGenerateBtn')?.addEventListener('click', async () => {
    try {
      showState('generating');
      const token = generateToken();
      const result = await pushToServer(token);
      await storage.setPref('syncToken', token);

      const url = `${SYNC_URL_PREFIX}${token}`;
      document.getElementById('syncLinkInput').value = url;
      document.getElementById('syncCount').textContent =
        result ? `Syncing ${result.list_count} list${result.list_count !== 1 ? 's' : ''} (${result.station_count} stations)` : '';

      showState('linked');
      renderSyncQr(url);
      onLinked?.();
      track?.('sync-link', {
        stationCount: result?.station_count ?? 0,
        listCount: result?.list_count ?? 0,
      });
    } catch (err) {
      showError(err.message || 'Failed to generate sync link');
    }
  });

  // Shared by the paste-Connect flow and the QR scanner: pull the other
  // device's lists and reconcile them into this device's own storage.
  async function connectWithToken(token, source) {
    if (!token) {
      showError('Please enter a valid sync token or URL.');
      return;
    }
    try {
      showState('generating');
      const pulled = await pullFromServer(token);
      if (!pulled) {
        showError('No data found for this token. It may have expired.');
        return;
      }
      const { imported, stationCount } = await applyImportPayload(
        pulled.exportJson, pulled.hash, pulled.updated_at,
      );
      await storage.setPref('syncToken', token);
      onLinked?.();
      closePanel();
      onListsChanged?.();
      track?.('sync-pull', { stationCount, listCount: imported, source });
      toast(`Synced ${imported} list${imported !== 1 ? 's' : ''} (${stationCount} stations)`);
    } catch (err) {
      if (err instanceof SyncError && err.type === 'server' && err.message.includes('not found')) {
        showError('Sync token not found or expired.');
      } else {
        showError(err.message || 'Failed to connect.');
      }
    }
  }

  document.getElementById('syncConnectBtn')?.addEventListener('click', () => {
    const token = extractTokenFromInput(document.getElementById('syncTokenInput')?.value ?? '');
    connectWithToken(token, 'manual-connect');
  });

  // --- In-app QR scanner (mobile): open the rear camera, decode with jsQR
  // (dynamically imported), and run the same connect flow on the first valid
  // token. This writes into the installed PWA's OWN storage — the point of
  // scanning in-app rather than opening the link, which on iOS lands in Safari's
  // separate storage. ---
  async function openScanner() {
    const overlay = document.createElement('div');
    overlay.className = 'qr-scanner';
    overlay.innerHTML = `
      <div class="qr-scanner__stage">
        <video class="qr-scanner__video" playsinline muted autoplay></video>
        <div class="qr-scanner__reticle" aria-hidden="true"></div>
      </div>
      <p class="qr-scanner__hint">Point your camera at the QR code shown on your other device.</p>
      <button type="button" class="btn-secondary qr-scanner__cancel">Cancel</button>
    `;
    document.body.appendChild(overlay);
    const video = overlay.querySelector('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let stream = null;
    let raf = null;
    let cancelled = false;

    const cleanup = () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      overlay.remove();
    };
    overlay.querySelector('.qr-scanner__cancel').addEventListener('click', cleanup);

    try {
      const jsQR = (await import('jsqr')).default;
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play();

      const tick = () => {
        if (cancelled) return;
        if (video.readyState >= 2 && video.videoWidth) {
          const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code) {
            const token = extractTokenFromInput(code.data);
            if (token) { cleanup(); connectWithToken(token, 'qr-scan'); return; }
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch (err) {
      cleanup();
      const msg = err?.name === 'NotAllowedError'
        ? 'Camera permission denied — allow it to scan.'
        : err?.name === 'NotFoundError'
          ? 'No camera found on this device.'
          : 'Could not open the camera.';
      showError(msg);
    }
  }

  // Only offer scanning where a camera is reachable.
  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
    document.getElementById('syncScanBtn')?.removeAttribute('hidden');
  }
  document.getElementById('syncScanBtn')?.addEventListener('click', openScanner);

  async function copyText(text, btn, label) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for browsers without the async clipboard API.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
    }
    if (btn) {
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = label; }, 1500);
    }
  }

  document.getElementById('syncCopyLinkBtn')?.addEventListener('click', (evt) => {
    copyText(document.getElementById('syncLinkInput')?.value ?? '', evt.currentTarget, 'Copy link');
  });

  document.getElementById('syncCopyTokenBtn')?.addEventListener('click', (evt) => {
    const token = extractTokenFromInput(document.getElementById('syncLinkInput')?.value ?? '');
    copyText(token ?? '', evt.currentTarget, 'Copy token');
  });

  // The system share sheet only exists on mobile — reveal the button there.
  if (typeof navigator !== 'undefined' && navigator.share) {
    document.getElementById('syncShareBtn')?.removeAttribute('hidden');
  }

  // Native share button (mobile: opens system share sheet with PWA as target)
  document.getElementById('syncShareBtn')?.addEventListener('click', async () => {
    const input = document.getElementById('syncLinkInput');
    const url = input?.value;
    if (!url || !navigator.share) return;
    try {
      await navigator.share({
        title: 'RadioDock Sync Link',
        text: 'Sync your RadioDock station lists with this link.',
        url: url,
      });
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('Share failed:', err);
    }
  });

  async function handleUnlink() {
    const ok = await confirmDialog({
      title: 'Stop Syncing?',
      message: 'Your lists stay on this device and the server. Other devices will no longer sync.',
      confirmLabel: 'Unlink',
    });
    if (!ok) return;
    try {
      await deleteFromServer(await getSyncToken());
      onUnlinked?.();
      closePanel();
      track?.('sync-unlink');
      toast('Sync removed');
    } catch (err) {
      showError(err.message || 'Failed to unlink');
    }
  }

  document.getElementById('syncUnlinkBtn')?.addEventListener('click', handleUnlink);
  document.getElementById('syncUnlinkBtn2')?.addEventListener('click', handleUnlink);
  document.getElementById('syncRetryBtn')?.addEventListener('click', refreshState);

  return {
    open: async () => {
      openPanel();
      await refreshState();
    },
    close: closePanel,
    refresh: refreshState,
  };
}
