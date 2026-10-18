// Stations page shell. The full browse, search and Discover views are
// mounted here; this module owns the panel lifecycle so main.js only wires
// data and actions.

export function mountStationsPanel({ elements = {}, actions = {} } = {}) {
  const panel = elements.panel ?? document.getElementById('stationsPanel');
  const backdrop = elements.backdrop ?? document.getElementById('stationsBackdrop');
  const body = elements.body ?? document.getElementById('stationsBody');
  let isOpen = false;

  if (!panel || !body) {
    return {
      open() {},
      close() {},
      isOpen: () => false,
      focusSearch() {},
      setNowPlaying() {},
      refreshAddedFlags() {},
    };
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove('stations-overlay-open');
    actions.onClose?.();
  }

  function open({ query = '' } = {}) {
    if (!isOpen) {
      isOpen = true;
      panel.classList.add('is-open');
      panel.setAttribute('aria-hidden', 'false');
      if (backdrop) backdrop.hidden = false;
      document.body.classList.add('stations-overlay-open');
      window.dispatchEvent(new CustomEvent('rd:page-open', { detail: { id: 'stations' } }));
    }
    if (query) actions.onQuery?.(query);
  }

  backdrop?.addEventListener('click', close);
  panel.addEventListener('click', (evt) => {
    if (evt.target.closest('[data-action="close"]')) close();
  });
  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape' && isOpen) close();
  });

  return {
    open,
    close,
    isOpen: () => isOpen,
    focusSearch() {},
    setNowPlaying() {},
    refreshAddedFlags() {},
  };
}
