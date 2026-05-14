// Mobile off-canvas drawer. Backdrop click / Escape / swipe-left closes.
// Body gets `is-locked` while the drawer is open so background scroll is
// disabled.

export function mountOffCanvas({ triggerBtn, panel, onInstallClick } = {}) {
  if (!panel) return { open() {}, close() {} };

  function open() {
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('off-canvas-open');
  }

  function close() {
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('off-canvas-open');
  }

  triggerBtn?.addEventListener('click', open);

  panel.addEventListener('click', (evt) => {
    if (evt.target.closest('[data-action="close"]')) {
      close();
      return;
    }
    if (evt.target.closest('.off-canvas__item')) {
      // Closing on item click lets external links open via the same gesture
      // without leaving the drawer visible underneath.
      close();
    }
  });

  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape' && panel.classList.contains('is-open')) close();
  });

  // Swipe-left to close. Track touchstart → touchmove deltaX. If user drags
  // > 80 px left and ends with horizontal-dominant motion, close.
  let touchStartX = null;
  let touchStartY = null;
  panel.addEventListener('touchstart', (evt) => {
    if (!panel.classList.contains('is-open')) return;
    touchStartX = evt.touches[0].clientX;
    touchStartY = evt.touches[0].clientY;
  }, { passive: true });
  panel.addEventListener('touchend', (evt) => {
    if (touchStartX === null) return;
    const dx = (evt.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
    const dy = Math.abs((evt.changedTouches[0]?.clientY ?? touchStartY) - touchStartY);
    touchStartX = null;
    touchStartY = null;
    if (dx < -80 && dy < 60) close();
  }, { passive: true });

  const installBtn = panel.querySelector('#offCanvasInstall');
  installBtn?.addEventListener('click', (evt) => {
    evt.preventDefault();
    close();
    onInstallClick?.();
  });

  return { open, close };
}
