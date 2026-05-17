// Horizontal tab strip for mobile. One tab per list; an icon button at
// the end opens the existing dropdown menu for create/import/manage.
// State is driven by setLists() + setCurrent(); user interactions emit
// via onSelect / onLongPress / onMenuClick.
//
// Long-press detection is intentionally lo-fi (300 ms timer cancelled
// on >10 px movement) — matches the station-list long-press timing so
// the gesture feels consistent across the app.

const LONG_PRESS_MS = 380;
const MOVE_THRESHOLD_PX = 10;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

const ICON_MENU = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="5" cy="12" r="1.8" fill="currentColor"/>
  <circle cx="12" cy="12" r="1.8" fill="currentColor"/>
  <circle cx="19" cy="12" r="1.8" fill="currentColor"/>
</svg>`;

export function mountListTabs({ root }) {
  if (!root) return { setLists() {}, setCurrent() {}, onSelect() {}, onLongPress() {}, onMenuClick() {} };

  const tabsEl = root.querySelector('.list-tabs__scroller');
  const menuBtn = root.querySelector('.list-tabs__menu-btn');

  let lists = [];
  let currentId = null;
  let selectCb = null;
  let longPressCb = null;
  let menuClickCb = null;

  // Long-press state, keyed to the tab the user pressed.
  let pressTimer = null;
  let pressedTab = null;
  let pressStartX = 0;
  let pressStartY = 0;
  let longPressFired = false;

  function render() {
    tabsEl.innerHTML = lists
      .map(
        (l) => `
        <button type="button"
                class="list-tab${l.id === currentId ? ' is-active' : ''}"
                data-id="${escapeHtml(l.id)}">
          <span class="list-tab__name">${escapeHtml(l.name)}</span>
        </button>`,
      )
      .join('');
    // Scroll the active tab into view so it's not clipped off-screen
    // after a list switch via swipe.
    const active = tabsEl.querySelector('.list-tab.is-active');
    if (active) {
      active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
  }

  function cancelPress() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    pressedTab = null;
    longPressFired = false;
  }

  tabsEl.addEventListener('pointerdown', (evt) => {
    const tab = evt.target.closest('.list-tab');
    if (!tab) return;
    pressedTab = tab;
    pressStartX = evt.clientX;
    pressStartY = evt.clientY;
    longPressFired = false;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      if (pressedTab !== tab) return;
      longPressFired = true;
      const list = lists.find((l) => l.id === tab.dataset.id);
      if (list && !list.readOnly) {
        try { navigator.vibrate?.(15); } catch {}
        longPressCb?.(list);
      }
    }, LONG_PRESS_MS);
  });

  tabsEl.addEventListener('pointermove', (evt) => {
    if (!pressedTab || !pressTimer) return;
    const dx = Math.abs(evt.clientX - pressStartX);
    const dy = Math.abs(evt.clientY - pressStartY);
    if (dx > MOVE_THRESHOLD_PX || dy > MOVE_THRESHOLD_PX) {
      cancelPress();
    }
  });

  const onPressEnd = (evt) => {
    if (!pressedTab) return;
    const tab = pressedTab;
    const wasLongPress = longPressFired;
    cancelPress();
    if (wasLongPress) return;
    if (evt.type === 'pointercancel') return;
    // Plain tap → select. Use closest match in case pointerup lands on
    // a child element of the button.
    const hit = evt.target.closest?.('.list-tab') ?? tab;
    if (hit !== tab) return;
    const list = lists.find((l) => l.id === tab.dataset.id);
    if (list) selectCb?.(list);
  };
  tabsEl.addEventListener('pointerup', onPressEnd);
  tabsEl.addEventListener('pointercancel', onPressEnd);
  tabsEl.addEventListener('pointerleave', () => cancelPress());

  menuBtn?.addEventListener('click', (evt) => {
    // Stop the document-level click handler in list-dropdown.js from
    // seeing this event — it would otherwise treat the click as
    // "outside the dropdown" and immediately close the menu we just
    // opened.
    evt.stopPropagation();
    menuClickCb?.();
  });

  return {
    setLists(next) {
      lists = next ?? [];
      render();
    },
    setCurrent(id) {
      if (currentId === id) return;
      currentId = id ?? null;
      render();
    },
    onSelect(cb) { selectCb = cb; },
    onLongPress(cb) { longPressCb = cb; },
    onMenuClick(cb) { menuClickCb = cb; },
  };
}
