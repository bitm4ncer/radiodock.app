// "Suggest an edit" form for an existing database station.
//
// Opens from the station info panel, pre-filled with the station's current
// values so the community can rewrite/fix them. The proposal goes to
// POST /api/station-edits, which diffs it against the live values and stores
// only the genuine changes. Nothing is applied until an admin approves it, and
// the change then shows up (with the chosen username) in the public History.

import { STATIONS_BASE } from '../data/stations-api.js';
import { toast } from './toast.js';
import { mountCapWidget } from './cap-widget.js';
import '../styles/station-edit.css';

const SOCIAL_KEYS = ['instagram', 'soundcloud', 'mixcloud', 'bandcamp', 'youtube', 'facebook', 'x', 'tiktok'];

const SOCIAL_LABELS = {
  instagram: 'Instagram',
  soundcloud: 'SoundCloud',
  mixcloud: 'Mixcloud',
  bandcamp: 'Bandcamp',
  youtube: 'YouTube',
  facebook: 'Facebook',
  x: 'X',
  tiktok: 'TikTok',
};

const TEXT_FIELDS = [
  ['name', 'Name'],
  ['url', 'Stream URL'],
  ['homepage', 'Homepage'],
  ['tags', 'Tags (comma separated)'],
  ['countrycode', 'Country code (e.g. PL)'],
  ['country', 'Country'],
  ['language', 'Language'],
  ['languagecodes', 'Language codes'],
  ['city', 'City'],
  ['info', 'Description', 'textarea'],
  ['contact_email', 'Contact email'],
  ['codec', 'Codec'],
  ['bitrate', 'Bitrate (kbps)'],
  ['geo_lat', 'Latitude'],
  ['geo_long', 'Longitude'],
];

function currentFields(full, fallback) {
  const src = { ...fallback, ...(full ?? {}) };
  const tags = Array.isArray(src.tags) ? src.tags.join(', ') : String(src.tags ?? '');
  const socials = {};
  for (const s of Array.isArray(src.socials) ? src.socials : []) {
    if (s?.platform) socials[s.platform] = s.url ?? '';
  }
  return {
    __socials: socials,
    name: src.name ?? '',
    url: src.url ?? '',
    homepage: src.homepage ?? '',
    tags,
    countrycode: src.countrycode ?? '',
    country: src.country ?? '',
    language: src.language ?? '',
    languagecodes: src.languagecodes ?? '',
    city: src.city ?? '',
    info: src.info ?? '',
    contact_email: src.contactEmail ?? src.contact_email ?? '',
    codec: src.codec ?? '',
    bitrate: src.bitrate ?? '',
    geo_lat: src.geo_lat ?? '',
    geo_long: src.geo_long ?? '',
    hls: src.hls ?? '',
  };
}

function field(label, input) {
  const wrap = document.createElement('label');
  wrap.className = 'add-field';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(span, input);
  return wrap;
}

function textInput(value, { type = 'text', placeholder = '' } = {}) {
  const input = document.createElement('input');
  input.type = type;
  input.className = 'form-input';
  input.value = value ?? '';
  if (placeholder) input.placeholder = placeholder;
  return input;
}

export function openStationEdit(station, full) {
  const uuid = station?.id ?? '';
  if (!uuid) return;
  const initial = currentFields(full, station);

  const overlay = document.createElement('div');
  overlay.className = 'se-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Suggest an edit');

  const card = document.createElement('div');
  card.className = 'se-card';

  const header = document.createElement('div');
  header.className = 'se-header';
  const title = document.createElement('h3');
  title.className = 'se-title';
  title.textContent = `Suggest an edit \u2014 ${initial.name || 'station'}`;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'se-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '\u00d7';
  header.append(title, closeBtn);

  const intro = document.createElement('p');
  intro.className = 'add-form__intro';
  intro.textContent = 'Fix or rewrite anything that is wrong. A moderator reviews every proposal before it goes live.';

  const form = document.createElement('form');
  form.className = 'add-form se-form';
  form.noValidate = true;

  const inputs = new Map();
  for (const [key, label, kind] of TEXT_FIELDS) {
    const input = kind === 'textarea' ? document.createElement('textarea') : textInput(initial[key]);
    if (kind === 'textarea') {
      input.className = 'form-input';
      input.rows = 4;
      input.value = initial[key] ?? '';
    }
    inputs.set(key, input);
    form.append(field(label, input));
  }

  const socialInputs = new Map();
  const socialWrap = document.createElement('div');
  socialWrap.className = 'se-socials';
  for (const key of SOCIAL_KEYS) {
    const input = textInput(initial.__socials?.[key] ?? '');
    input.placeholder = 'https://\u2026';
    socialInputs.set(key, input);
    socialWrap.append(field(SOCIAL_LABELS[key], input));
  }
  form.append(socialWrap);

  const noteInput = document.createElement('textarea');
  noteInput.className = 'form-input';
  noteInput.rows = 2;
  noteInput.placeholder = 'Anything the moderator should know (optional)';
  form.append(field('Note for the reviewer', noteInput));

  const usernameInput = textInput('', { placeholder: 'Your name' });
  form.append(field('Your name *', usernameInput));

  const emailInput = textInput('', { type: 'email', placeholder: 'Only if we may follow up (optional)' });
  form.append(field('Contact email', emailInput));

  const honeypot = document.createElement('input');
  honeypot.type = 'text';
  honeypot.name = 'website';
  honeypot.tabIndex = -1;
  honeypot.autocomplete = 'off';
  honeypot.className = 'se-honeypot';
  honeypot.setAttribute('aria-hidden', 'true');
  form.append(honeypot);

  const capContainer = document.createElement('div');
  capContainer.className = 'se-cap';
  form.append(capContainer);
  const cap = mountCapWidget(capContainer);

  const actions = document.createElement('div');
  actions.className = 'se-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'Cancel';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'btn-primary';
  saveBtn.textContent = 'Send for review';
  actions.append(cancelBtn, saveBtn);
  form.append(actions);

  card.append(header, intro, form);
  overlay.append(card);
  document.body.append(overlay);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    if (!username) { toast('Please add a name so we can credit your edit.'); return; }

    const fields = {};
    for (const [key, input] of inputs) {
      const value = String(input.value ?? '').trim();
      const before = String(initial[key] ?? '').trim();
      if (value !== before) fields[key] = value;
    }
    const socials = {};
    for (const [key, input] of socialInputs) {
      const value = String(input.value ?? '').trim();
      if (!value) continue;
      if (value !== String(initial.__socials?.[key] ?? '').trim()) socials[key] = value;
    }

    if (!Object.keys(fields).length && !Object.keys(socials).length) {
      toast('Nothing changed yet.');
      return;
    }

    const capToken = String(new FormData(form).get('cap-token') || '').trim();
    if (!capToken) { toast('Please complete the captcha first.'); return; }

    // The API reads the proposed values off the TOP level of the body (it
    // iterates its own EDITABLE_FIELDS list), so the changed fields go flat
    // into the payload — nesting them under `fields` makes the server see no
    // change at all.
    const payload = {
      ...fields,
      stationuuid: uuid,
      username,
      email: emailInput.value.trim() || undefined,
      note: noteInput.value.trim() || undefined,
      website: honeypot.value,
      'cap-token': capToken,
    };
    if (Object.keys(socials).length) payload.socials = socials;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Sending\u2026';
    try {
      const res = await fetch(`${STATIONS_BASE}/api/station-edits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Could not send the edit (HTTP ${res.status}).`);
      toast('Thanks! Your edit was sent for review.');
      close();
    } catch (err) {
      toast(err?.message || 'Could not send the edit.');
      cap.reset();
      saveBtn.disabled = false;
      saveBtn.textContent = 'Send for review';
    }
  });
}
