// Desktop keyboard shortcuts. Space = play/pause, arrows = volume,
// "/" = search, M = mute. Deliberately inert while the user is typing,
// while any modal is open, or when another handler already claimed the
// event (notes panel, modal-helpers).

const VOLUME_STEP = 0.1;

function isTypingTarget(el) {
  return !!el?.closest?.('input, textarea, select, [contenteditable]');
}

export function mountKeyboardShortcuts({ player, playerCard, onFocusSearch }) {
  document.addEventListener('keydown', (evt) => {
    if (evt.defaultPrevented) return;
    if (evt.ctrlKey || evt.metaKey || evt.altKey) return;
    if (isTypingTarget(evt.target)) return;
    if (document.querySelector('.modal.show')) return;

    switch (evt.key) {
      case ' ': {
        if (evt.repeat) return;
        // Focused buttons/links activate on Space natively — don't double-fire.
        if (evt.target?.closest?.('button, a, [role="button"]')) return;
        evt.preventDefault();
        playerCard.togglePlayPause();
        break;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        evt.preventDefault();
        const dir = evt.key === 'ArrowUp' ? 1 : -1;
        const next = Math.max(0, Math.min(1, player.getVolume() + dir * VOLUME_STEP));
        player.setVolume(Math.round(next * 10) / 10);
        break;
      }
      case '/': {
        evt.preventDefault();
        onFocusSearch?.();
        break;
      }
      case 'm':
      case 'M': {
        if (evt.repeat) return;
        player.toggleMute();
        break;
      }
    }
  });
}
