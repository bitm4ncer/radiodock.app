// Shared modal manager. Modals are part of index.html and toggled via the
// `is-open` class on the `.modal` element. Escape and backdrop click both close.

const open = new Set();

function getModal(id) {
  return typeof id === 'string' ? document.getElementById(id) : id;
}

export function openModal(id) {
  const el = getModal(id);
  if (!el) return;
  el.classList.add('show');
  el.setAttribute('aria-hidden', 'false');
  open.add(el);
  // Focus first focusable element so keyboard nav works.
  const focusable = el.querySelector('input, button, [tabindex]:not([tabindex="-1"])');
  focusable?.focus({ preventScroll: true });
}

export function closeModal(id) {
  const el = getModal(id);
  if (!el) return;
  el.classList.remove('show');
  el.setAttribute('aria-hidden', 'true');
  open.delete(el);
}

export function closeAllModals() {
  for (const el of open) {
    el.classList.remove('show');
    el.setAttribute('aria-hidden', 'true');
  }
  open.clear();
}

export function initModals() {
  // Backdrop click closes
  for (const modal of document.querySelectorAll('.modal')) {
    modal.addEventListener('click', (evt) => {
      if (evt.target === modal) closeModal(modal);
    });
    const closeBtn = modal.querySelector('.modal-close-btn');
    closeBtn?.addEventListener('click', () => closeModal(modal));
  }

  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape' && open.size > 0) {
      closeAllModals();
    }
  });
}
