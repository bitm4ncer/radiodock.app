const KEY = 'radiodock-surface';
const CLASS = 'surface-3d';

function detect() {
  try {
    return localStorage.getItem(KEY) === '3d' ? '3d' : 'flat';
  } catch {
    return 'flat';
  }
}

let current = detect();

export function getSurface() {
  return current;
}

function applySurface(surface) {
  current = surface === '3d' ? '3d' : 'flat';
  const is3d = current === '3d';
  document.documentElement.classList.toggle(CLASS, is3d);
  document.documentElement.dataset.surface = current;
  document.dispatchEvent(
    new CustomEvent('surfacechange', { detail: { surface: current } })
  );
}

export function setSurface(surface) {
  if (surface !== 'flat' && surface !== '3d') return;
  try {
    localStorage.setItem(KEY, surface);
  } catch {
    // Storage can be unavailable in private or embedded contexts.
  }
  applySurface(surface);
}

export function mountSurfaceToggle({ root }) {
  if (!root) return;
  const btn = root.querySelector('[data-action="surface-toggle"]');
  if (!btn) return;

  const sync = () => {
    const is3d = current === '3d';
    btn.setAttribute('aria-pressed', is3d ? 'true' : 'false');
    const label = is3d ? 'Switch to flat surface' : 'Switch to 3D surface';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  };

  btn.addEventListener('click', () => {
    setSurface(current === '3d' ? 'flat' : '3d');
  });

  document.addEventListener('surfacechange', sync);
  sync();
}
