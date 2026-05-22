let toastEl = null;
let hideTimer = null;
let currentActionBtn = null;

function getEl() {
  if (toastEl) return toastEl;
  toastEl = document.getElementById('toast');
  return toastEl;
}

// toast(message)
// toast(message, ms)
// toast(message, { ms?, action?: { label, callback } })
export function toast(message, options) {
  const el = getEl();
  if (!el) return;

  let ms = 2400;
  let action = null;
  if (typeof options === 'number') {
    ms = options;
  } else if (options && typeof options === 'object') {
    if (typeof options.ms === 'number') ms = options.ms;
    if (options.action) {
      action = options.action;
      // Undo-able toasts stay around longer so the user has time to react.
      if (typeof options.ms !== 'number') ms = 5000;
    }
  }

  if (currentActionBtn) {
    currentActionBtn.remove();
    currentActionBtn = null;
  }

  el.textContent = message;
  if (action && typeof action.callback === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast__action';
    btn.textContent = action.label ?? 'Undo';
    btn.addEventListener('click', () => {
      try { action.callback(); } catch (err) { console.warn('Toast action failed:', err); }
      el.classList.remove('is-visible');
      clearTimeout(hideTimer);
    });
    el.appendChild(btn);
    currentActionBtn = btn;
  }

  el.classList.add('is-visible');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    el.classList.remove('is-visible');
    if (currentActionBtn) {
      currentActionBtn.remove();
      currentActionBtn = null;
    }
  }, ms);
}
