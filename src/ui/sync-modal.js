import { openModal, closeModal } from './modals.js';
import { confirmDialog } from './modal-helpers.js';
import { toast } from './toast.js';
import * as storage from '../data/storage.js';
import {
  generateToken, pushToServer, pullFromServer, deleteFromServer,
  getSyncToken, buildExportPayload, applyImportPayload, extractTokenFromInput, SyncError,
} from '../data/sync.js';

const SYNC_URL_PREFIX = `${window.location.origin}/#sync=`;

function show(el) { if (el) el.hidden = false; }
function hide(el) { if (el) el.hidden = true; }

export function mountSyncModal({ onListsChanged, track }) {
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
      const metaRes = await fetch(`https://stations.radiodock.app/api/sync/${token}?meta=1`, {
        referrerPolicy: 'no-referrer',
      });
      if (!metaRes.ok) {
        showState('unlinked');
        return;
      }
      const meta = await metaRes.json();

      const url = `${SYNC_URL_PREFIX}${token}`;
      const countText = `Syncing ${meta.list_count} list${meta.list_count !== 1 ? 's' : ''} (${meta.station_count} stations)`;

      const input = document.getElementById('syncLinkInput');
      if (input) input.value = url;

      const count = document.getElementById('syncCount');
      if (count) count.textContent = countText;

      showState('linked');
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
      track?.('sync-link', {
        stationCount: result?.station_count ?? 0,
        listCount: result?.list_count ?? 0,
      });
    } catch (err) {
      showError(err.message || 'Failed to generate sync link');
    }
  });

  document.getElementById('syncConnectBtn')?.addEventListener('click', async () => {
    const input = document.getElementById('syncTokenInput');
    const token = extractTokenFromInput(input?.value ?? '');
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
      closeModal('syncModal');
      onListsChanged?.();
      track?.('sync-pull', { stationCount, listCount: imported, source: 'manual-connect' });
      toast(`Synced ${imported} list${imported !== 1 ? 's' : ''} (${stationCount} stations)`);
    } catch (err) {
      if (err instanceof SyncError && err.type === 'server' && err.message.includes('not found')) {
        showError('Sync token not found or expired.');
      } else {
        showError(err.message || 'Failed to connect.');
      }
    }
  });

  document.getElementById('syncCopyBtn')?.addEventListener('click', async () => {
    const input = document.getElementById('syncLinkInput');
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.focus();
      input.select();
      try { document.execCommand('copy'); } catch {}
    }
    const btn = document.getElementById('syncCopyBtn');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });

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
      closeModal('syncModal');
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
      await refreshState();
      openModal('syncModal');
    },
    refresh: refreshState,
  };
}
