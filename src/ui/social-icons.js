// Inline platform SVGs for the station-info panel's socials row. Mirrors the
// dashboard's socials-section icons so both surfaces read the same.
export const SOCIAL_ORDER = ['instagram', 'soundcloud', 'mixcloud', 'bandcamp', 'youtube', 'facebook', 'x', 'tiktok'];

export const SOCIAL_LABELS = {
  instagram: 'Instagram', soundcloud: 'SoundCloud', mixcloud: 'Mixcloud',
  bandcamp: 'Bandcamp', youtube: 'YouTube', facebook: 'Facebook', x: 'X', tiktok: 'TikTok',
};

export const SOCIAL_ICONS = {
  instagram: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
  soundcloud: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 16v-4M7 16v-6M10 16v-8M13 16V8"/><path d="M16 16V9a4 4 0 0 1 5 4v0a3 3 0 0 1-3 3h-2"/></svg>',
  mixcloud: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 15v-3M6.5 15V9M10 15v-6M13.5 15V9M17 15v-3"/><circle cx="20" cy="12" r="1.4"/></svg>',
  bandcamp: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M4 8h16l-4 8H0z" transform="translate(2 0)"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 8h-2a2 2 0 0 0-2 2v11M8 13h6"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4l16 16M20 4L4 20"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 4v10.5a3.5 3.5 0 1 1-3-3.46"/><path d="M14 7a4 4 0 0 0 4 3.5"/></svg>',
};
