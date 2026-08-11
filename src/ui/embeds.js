// Shared track-preview embeds + a privacy-first 2-click consent gate.
//
// GDPR pattern: loading a provider's iframe connects the user's browser
// directly to a third party before they've asked for it. So embeds are never
// rendered automatically — the consumer shows `consentGateHtml()` first, and
// only renders `embedsHtml(...)` after the user's explicit "Load preview"
// click (2-click: one click reveals the gate's context, a second click
// actually loads the third-party iframe). Consent defaults OFF, is
// remembered locally via an IndexedDB pref (`EMBED_CONSENT_PREF`, never
// synced anywhere), and is revocable at any time via `revokeLinkHtml()`.
//
// EXACTLY ONE provider renders — the one the user picked in the notes panel
// (`PREVIEW_PROVIDER_PREF`). A subscriber hears the full track in their own
// service; everyone else gets that provider's 30-second preview. When the
// preferred provider has no id for this track we silently fall back to the
// next one that does, and say so in a caption — never an empty player.
//
// This module only builds HTML strings and reads/writes prefs — it has no
// side effects at import and does not touch the DOM. The consumer (a notes
// panel, etc.) decides when to call `hasEmbedConsent()`, which HTML to
// render, and wires up the `data-action="load-embeds"` / `data-action="revoke-embeds"`
// clicks.

import { getPref, setPref } from '../data/storage.js';

export const EMBED_CONSENT_PREF = 'embedConsent';
export const PREVIEW_PROVIDER_PREF = 'previewProvider';
export const DEFAULT_PROVIDER = 'spotify';

export async function hasEmbedConsent() {
  return getPref(EMBED_CONSENT_PREF, false);
}

export async function setEmbedConsent(value) {
  return setPref(EMBED_CONSENT_PREF, !!value);
}

export async function getPreviewProvider() {
  const v = await getPref(PREVIEW_PROVIDER_PREF, DEFAULT_PROVIDER);
  return PROVIDERS.some((p) => p.id === v) ? v : DEFAULT_PROVIDER;
}

export async function setPreviewProvider(id) {
  return setPref(PREVIEW_PROVIDER_PREF, PROVIDERS.some((p) => p.id === id) ? id : DEFAULT_PROVIDER);
}

// Third-party ids/urls land in innerHTML — escape everything, and only allow
// http(s) URLs into attributes.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeUrl = (u) => (/^https?:\/\//i.test(String(u ?? '')) ? esc(u) : '');
// Embed ids get a strict charset filter before landing in an iframe src.
export const safeId = (s) => String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '');
// Validated, not trimmed: squeezing "../evil" down to "ev" would silently embed
// the wrong storefront. Anything that is not a plain 2-letter code is no code.
const safeCountry = (s) => (/^[A-Za-z]{2}$/.test(String(s ?? '')) ? String(s).toLowerCase() : '');

const frame = (src, height, extra = '') =>
  `<iframe class="embed-frame" ${extra} width="100%" height="${height}" src="${src}" frameborder="0" allow="encrypted-media" loading="lazy"></iframe>`;

// Registry order doubles as the fallback order.
export const PROVIDERS = [
  {
    id: 'spotify',
    label: 'Spotify',
    short: 'Spotify',
    // Only the third-party host is named — the gate's claim has to match what
    // actually connects.
    host: 'Spotify',
    idOf: (ids) => safeId(ids?.spotify),
    frame: (ids) => frame(`https://open.spotify.com/embed/track/${safeId(ids.spotify)}`, 152, 'style="border-radius:12px"'),
  },
  {
    id: 'apple',
    label: 'Apple Music',
    short: 'Apple',
    host: 'Apple',
    // The storefront is part of the embed URL; without it Apple resolves the
    // song in the wrong country or not at all. So an id without a country is
    // not a usable Apple embed.
    idOf: (ids) => (safeCountry(ids?.apple?.country) ? safeId(ids?.apple?.id) : ''),
    frame: (ids) => frame(`https://embed.music.apple.com/${safeCountry(ids.apple.country)}/song/${safeId(ids.apple.id)}`, 175, 'style="border-radius:12px"'),
  },
  {
    id: 'tidal',
    label: 'Tidal',
    short: 'Tidal',
    host: 'Tidal',
    idOf: (ids) => safeId(ids?.tidal),
    frame: (ids) => frame(`https://embed.tidal.com/tracks/${safeId(ids.tidal)}?layout=gridify`, 120, 'style="border-radius:12px"'),
  },
  {
    id: 'youtube',
    label: 'YouTube',
    short: 'YouTube',
    host: 'YouTube',
    // Only ever an EXACT provider-supplied video id (the recogniser maps the
    // matched track to its official video). Never a name-based search — that
    // surfaces the wrong track / a similarly-named upload.
    idOf: (ids) => safeId(ids?.youtube),
    frame: (ids) => frame(`https://www.youtube.com/embed/${safeId(ids.youtube)}`, 180),
  },
];

export const providerById = (id) => PROVIDERS.find((p) => p.id === id) || null;
export const providerLabel = (id) => providerById(id)?.label || '';

// The preferred provider if it can play this track, else the first one in
// registry order that can. Null when nothing is playable.
export function pickProvider(preferred, ids) {
  const wanted = providerById(preferred);
  if (wanted && wanted.idOf(ids)) return wanted.id;
  return PROVIDERS.find((p) => p.idOf(ids))?.id || null;
}

export function hasAnyEmbed(ids) {
  return !!pickProvider(null, ids);
}

// Renders exactly one player. `preferred` is the user's pick; the caption only
// appears when we had to fall back, so the substitution is visible but quiet.
export function embedsHtml({ preferred = DEFAULT_PROVIDER, ids } = {}) {
  const chosen = pickProvider(preferred, ids);
  if (!chosen) return '';
  const provider = providerById(chosen);
  const caption = chosen !== preferred
    ? `<div class="embed-via">via ${esc(provider.label)}</div>`
    : '';
  return provider.frame(ids) + caption;
}

export function consentGateHtml(providerId = DEFAULT_PROVIDER) {
  const p = providerById(providerId) || providerById(DEFAULT_PROVIDER);
  return `<div class="embed-consent"><p class="embed-consent__text">Load a preview from ${esc(p.label)}? This connects your browser to ${esc(p.host)}.</p><label class="embed-consent__remember"><input type="checkbox" data-role="embed-remember"> Remember my choice</label><button class="btn embed-consent__load" type="button" data-action="load-embeds">Load preview</button></div>`;
}

export function revokeLinkHtml() {
  return '<button class="btn-text embed-revoke" type="button" data-action="revoke-embeds">Disable external previews</button>';
}

// The segmented control in the notes panel head.
export function providerSwitcherHtml(current) {
  const buttons = PROVIDERS.map((p) => {
    const active = p.id === current;
    return `<button type="button" class="notes-provider__opt${active ? ' is-active' : ''}" data-action="set-provider" data-provider="${p.id}" aria-pressed="${active}">${esc(p.short)}</button>`;
  }).join('');
  return `<div class="notes-provider" role="group" aria-label="Preview provider"><span class="notes-provider__label">Preview</span>${buttons}</div>`;
}
