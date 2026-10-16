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

const ACTION_LABELS = {
  'station.added': 'added a station',
  'station.updated': 'edited a station',
  'station.field_changed': 'changed a station',
  'station.field_reset': 'reset a station field',
  'station.logo_changed': 'changed a station logo',
  'wallpaper.added': 'submitted a wallpaper',
  'wallpaper.activated': 'activated a wallpaper',
  'wallpaper.hidden': 'hid a wallpaper',
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

function describeAction(item) {
  const base = ACTION_LABELS[item.action] || item.action || 'changed something';
  const station = item.stationName || item.diff?.name?.to || '';
  return station ? `${base} \u00b7 ${station}` : base;
}

function diffRows(diff) {
  if (!diff || typeof diff !== 'object') return [];
  return Object.entries(diff).map(([field, change]) => ({
    label: FIELD_LABELS[field] || field,
    from: change?.from ?? '\u2014',
    to: change?.to ?? '\u2014',
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

      const who = document.createElement('span');
      who.className = 'db-history__user';
      who.textContent = item.username || 'Someone';

      const what = document.createElement('span');
      what.className = 'db-history__what';
      what.textContent = describeAction(item);

      const when = document.createElement('span');
      when.className = 'db-history__when';
      when.textContent = relativeTime(item.createdAt);

      entry.append(who, what, when);

      const rows = diffRows(item.diff);
      if (!rows.length) {
        li.append(entry);
      } else {
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
          value.textContent = `${row.from} \u2192 ${row.to}`;
          line.append(label, value);
          detail.append(line);
        }
        entry.addEventListener('click', () => { detail.hidden = !detail.hidden; });
        li.append(entry, detail);
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
