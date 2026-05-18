// Theme state. Two themes (light + dark). On first visit, the OS
// preference wins. Once the user toggles, the choice is persisted
// in localStorage and survives reloads + future OS-pref changes.
//
// localStorage (not IndexedDB) is the store because the theme has
// to be read synchronously by the inline <head> script that runs
// before the first paint — IndexedDB is async-only.

const KEY = 'radiodock-theme';
const OS_LIGHT_QUERY = '(prefers-color-scheme: light)';
const THEME_COLOR_DARK = '#1A1A1A';
const THEME_COLOR_LIGHT = '#E1E1E1';

function osPrefersLight() {
  return window.matchMedia?.(OS_LIGHT_QUERY).matches === true;
}

/** Resolve which theme is currently in effect, and whether the user
 *  has manually picked it (vs. defaulting to OS). */
function detect() {
  const stored = localStorage.getItem(KEY);
  if (stored === 'light' || stored === 'dark') {
    return { theme: stored, stored: true };
  }
  return { theme: osPrefersLight() ? 'light' : 'dark', stored: false };
}

export function getTheme() {
  return detect().theme;
}

/** Apply the theme to the DOM. Toggle the .theme-light class on
 *  <html>, sync the theme-color meta tag (browser chrome tint on
 *  iOS Safari + Android), and notify any mounted toggles via a
 *  CustomEvent so they can re-render their visual state. */
function applyTheme(theme) {
  const isLight = theme === 'light';
  document.documentElement.classList.toggle('theme-light', isLight);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = isLight ? THEME_COLOR_LIGHT : THEME_COLOR_DARK;
  document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

/** User explicitly picked a theme. Persists it and re-renders. */
export function setTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  try { localStorage.setItem(KEY, theme); } catch {}
  applyTheme(theme);
}

/** Wire a toggle widget. Expects the root element to contain a
 *  clickable element marked with data-action="theme-toggle". The
 *  element's `aria-pressed` is set to "true" while in light mode
 *  (CSS uses that to swap sun ↔ moon icon). */
export function mountThemeToggle({ root }) {
  if (!root) return;
  const btn = root.querySelector('[data-action="theme-toggle"]');
  if (!btn) return;

  function sync() {
    const { theme } = detect();
    btn.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
    btn.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  }

  btn.addEventListener('click', () => {
    setTheme(detect().theme === 'light' ? 'dark' : 'light');
  });

  document.addEventListener('themechange', sync);
  sync();
}

/** Listen for OS theme changes. Active only while the user hasn't
 *  manually toggled — once they set a preference, their choice wins
 *  permanently until they clear browser data. Called once during
 *  app bootstrap. */
export function subscribeOSChange() {
  const mql = window.matchMedia?.(OS_LIGHT_QUERY);
  if (!mql) return;
  // addEventListener form (the older addListener is deprecated)
  mql.addEventListener('change', (evt) => {
    if (localStorage.getItem(KEY)) return; // user override wins
    applyTheme(evt.matches ? 'light' : 'dark');
  });
}
