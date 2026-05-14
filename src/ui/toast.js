let toastEl = null;
let hideTimer = null;

function getEl() {
  if (toastEl) return toastEl;
  toastEl = document.getElementById('toast');
  return toastEl;
}

export function toast(message, ms = 2400) {
  const el = getEl();
  if (!el) return;
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => el.classList.remove('is-visible'), ms);
}
