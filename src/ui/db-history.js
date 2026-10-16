// Database panel -> History tab.
//
// A public, account-less record of who changed what. The PWA reads the
// Stations API's append-only event log (GET /api/history) and renders it.
// Only the self-chosen username and the concrete change are exposed -- never
// an email, an IP or any other identifier.

import { STATIONS_BASE } from '../data/stations-api.js';
import '../styles/db-history.css';

const LIMIT = 50;
const TIMEOUT_MS = 12000;

// Short verbs so the secondary line reads "Added by mike78".
const VERBS = {
  'station.added': 'Added',
  'station.updated': 'Edited',
  'station.field_changed': 'Edited',
  'station.field_reset': 'Reset a field on',
  'station.logo_changed': 'Changed the logo of',
  'wallpaper.added': 'Wallpaper submitted by',
  'wallpaper.activated': 'Wallpaper activated by',
  'wallpaper.hidden': 'Wallpaper hidden by',
};

const FIELD_LABELS = {
  name: 'Name',
  url: 'Stream URL',
  homepage: 'Homepage',
  favicon: 'Image',
  logo_path: 'Logo',
  tags: 'Tags',
  countrycode: 'Country',
  country: 'Country',
  language: 'Language',
  languagecodes: 'Language codes',
  codec: 'Codec',
  bitrate: 'Bitrate',
  hls: 'HLS',
  geo_lat: 'Latitude',
  geo_long: 'Longitude',
  info: 'Description',
  city: 'City',
  contact_email: 'Contact email',
};

const ICON_CHEVRON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

function relativeTime(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(t).toLocaleDateString();
}

// Title = the thing that changed. Wallpaper events have no station, so they
// fall back to the object noun.
function titleFor(item) {
  const name = item.stationName || item.diff?.name?.to;
  if (name) return name;
  return String(item.action ?? '').startsWith('wallpaper.') ? 'Wallpaper' : 'Station';
}

// Secondary line = what happened, and who did it.
function metaFor(item) {
  const who = item.username || 'Someone';
  const verb = VERBS[item.action] || 'Changed';
  return verb.endsWith('by') ? `${verb} ${who}` : `${verb} by ${who}`;
}

function diffRows(diff) {
  if (!diff || typeof diff !== 'object') return [];
  return Object.entries(diff).map(([field, change]) => ({
    label: FIELD_LABELS[field] || field,
    from: change?.from ?? null,
    to: change?.to ?? null,
  }));
}

export function createDbHistory(root) {
  let inflight = null;

  function status(text) {
    root.replaceChildren();
    const p = document.createElement('p');
    p.className = 'add-form__intro db-history__status';
    p.textContent = text;
    root.append(p);
  }

  function render(items) {
    root.replaceChildren();
    if (!items.length) {
      status('No changes yet.');
      return;
    }
    const list = document.createElement('ul');
    list.className = 'db-history';

    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'db-history__item';

      const entry = document.createElement('button');
      entry.type = 'button';
      entry.className = 'db-history__entry';

      const main = document.createElement('span');
      main.className = 'db-history__main';
      const title = document.createElement('span');
      title.className = 'db-history__title';
      title.textContent = titleFor(item);
      const meta = document.createElement('span');
      meta.className = 'db-history__meta';
      meta.textContent = metaFor(item);
      main.append(title, meta);

      const when = document.createElement('span');
      when.className = 'db-history__when';
      when.textContent = relativeTime(item.createdAt);

      const rows = diffRows(item.diff);

      entry.append(main, when);
      li.append(entry);

      if (rows.length) {
        const chevron = document.createElement('span');
        chevron.className = 'db-history__chevron';
        chevron.innerHTML = ICON_CHEVRON;
        entry.append(chevron);
        entry.setAttribute('aria-expanded', 'false');

        const detail = document.createElement('div');
        detail.className = 'db-history__diff';
        detail.hidden = true;
        for (const row of rows) {
          const line = document.createElement('div');
          line.className = 'db-history__diff-row';

          const label = document.createElement('span');
          label.className = 'db-history__diff-field';
          label.textContent = row.label;

          const value = document.createElement('span');
          value.className = 'db-history__diff-value';
          if (row.from != null) {
            const from = document.createElement('span');
            from.className = 'db-history__from';
            from.textContent = String(row.from);
            value.append(from);
          }
          const arrow = document.createElement('span');
          arrow.className = 'db-history__arrow';
          arrow.textContent = '\u2192';
          const to = document.createElement('span');
          to.className = 'db-history__to';
          to.textContent = row.to == null ? 'cleared' : String(row.to);
          value.append(arrow, to);

          line.append(label, value);
          detail.append(line);
        }

        entry.addEventListener('click', () => {
          detail.hidden = !detail.hidden;
          li.classList.toggle('is-open', !detail.hidden);
          entry.setAttribute('aria-expanded', String(!detail.hidden));
        });
        li.append(detail);
      }

      list.append(li);
    }

    root.append(list);
  }

  async function refresh() {
    if (inflight) return inflight;
    status('Loading\u2026');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    inflight = (async () => {
      try {
        const res = await fetch(`${STATIONS_BASE}/api/history?limit=${LIMIT}`, { signal: ctl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        render(Array.isArray(data?.items) ? data.items : []);
      } catch {
        status('Could not load the history. Try again later.');
      } finally {
        clearTimeout(timer);
        inflight = null;
      }
    })();
    return inflight;
  }

  return { refresh };
}
