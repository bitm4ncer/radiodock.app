// Mobile fullscreen search overlay. Re-parents the existing .search-section
// element into a slide-in overlay; close re-parents it back. Same DOM nodes
// = same JS wiring, so the existing mountSearch() callbacks keep working.

const MOBILE_QUERY = '(max-width: 699px)';

export function mountSearchOverlay({ triggerBtn, overlay }) {
  if (!triggerBtn || !overlay) return { open() {}, close() {} };

  const body = overlay.querySelector('.search-overlay__body');
  const input = document.getElementById('searchInput');
  const searchSection = document.querySelector('.search-section');
  // Remember the original parent so we can move the section back on close.
  let originalParent = searchSection?.parentElement ?? null;

  function isMobile() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  function open() {
    if (!isMobile() || !searchSection) return;
    body.append(searchSection);
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('off-canvas-open');
    // Focus the input so the keyboard pops up immediately on iOS / Android.
    setTimeout(() => input?.focus(), 250);
  }

  function close() {
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('off-canvas-open');
    // Wait for the slide-out to finish, then move the search section back
    // so desktop / resize-to-desktop sees it in its expected place.
    setTimeout(() => {
      if (originalParent && searchSection && searchSection.parentElement !== originalParent) {
        originalParent.append(searchSection);
      }
    }, 240);
  }

  triggerBtn.addEventListener('click', open);

  overlay.addEventListener('click', (evt) => {
    if (evt.target.closest('[data-action="close"]')) close();
  });

  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape' && overlay.classList.contains('is-open')) close();
  });

  // If user resizes from mobile to desktop while the overlay is open,
  // collapse it gracefully so the section is back inline.
  window.matchMedia('(min-width: 700px)').addEventListener('change', (evt) => {
    if (evt.matches && overlay.classList.contains('is-open')) close();
  });

  return { open, close };
}
