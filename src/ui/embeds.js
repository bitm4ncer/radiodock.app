// Shared Spotify/YouTube preview embeds + a privacy-first 2-click consent gate.
//
// GDPR pattern: loading a Spotify/YouTube iframe connects the user's browser
// directly to a third party before they've asked for it. So embeds are never
// rendered automatically — the consumer shows `consentGateHtml()` first, and
// only renders `embedsHtml(...)` after the user's explicit "Load preview"
// click (2-click: one click reveals the gate's context, a second click
// actually loads the third-party iframe). Consent defaults OFF, is
// remembered locally via an IndexedDB pref (`EMBED_CONSENT_PREF`, never
// synced anywhere), and is revocable at any time via `revokeLinkHtml()`.
//
// This module only builds HTML strings and reads/writes the pref — it has no
// side effects at import and does not touch the DOM. The consumer (a notes
// panel, etc.) decides when to call `hasEmbedConsent()`, which HTML to
// render, and wires up the `data-action="load-embeds"` / `data-action="revoke-embeds"`
// clicks.

import { getPref, setPref } from '../data/storage.js';

export const EMBED_CONSENT_PREF = 'embedConsent';

export async function hasEmbedConsent() {
  return getPref(EMBED_CONSENT_PREF, false);
}

export async function setEmbedConsent(value) {
  return setPref(EMBED_CONSENT_PREF, !!value);
}

// Third-party ids/urls land in innerHTML — escape everything, and only allow
// http(s) URLs into attributes.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeUrl = (u) => (/^https?:\/\//i.test(String(u ?? '')) ? esc(u) : '');
// Embed ids get a strict charset filter before landing in an iframe src.
export const safeId = (s) => String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '');

function spotifyEmbed(id) {
  const v = safeId(id);
  return v ? `<iframe class="embed-frame" style="border-radius:12px" src="https://open.spotify.com/embed/track/${v}" width="100%" height="152" frameborder="0" allow="encrypted-media" loading="lazy"></iframe>` : '';
}

function youtubeEmbed(vid, query) {
  const v = safeId(vid);
  if (v) return `<iframe class="embed-frame" width="100%" height="180" src="https://www.youtube.com/embed/${v}" frameborder="0" allow="encrypted-media" loading="lazy"></iframe>`;
  if (!query) return '';
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  return `<a class="btn embed-yt-link" href="${url}" target="_blank" rel="noopener">Search on YouTube</a>`;
}

export function embedsHtml({ spotify, youtube, query } = {}) {
  const spotifyHtml = spotifyEmbed(spotify);
  const youtubeHtml = youtubeEmbed(youtube, query);
  return `${spotifyHtml}${youtubeHtml}`;
}

export function consentGateHtml() {
  return '<div class="embed-consent"><p class="embed-consent__text">Load a preview from Spotify / YouTube? This connects your browser to Spotify and YouTube.</p><label class="embed-consent__remember"><input type="checkbox" data-role="embed-remember"> Remember my choice</label><button class="btn embed-consent__load" type="button" data-action="load-embeds">Load preview</button></div>';
}

export function revokeLinkHtml() {
  return '<button class="btn-text embed-revoke" type="button" data-action="revoke-embeds">Disable external previews</button>';
}
