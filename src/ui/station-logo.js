import { getLogoUrl, logoSizePx } from '../data/logo-resolver.js';

function getInitials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
}

const MOUNTED = new WeakSet();

export function renderLogoSlot(station, {
  imgClass = 'station-item-logo',
  initialsClass = 'station-item-initials',
  size = 'sm',
  priority = false,
  resolveById = false,
} = {}) {
  const initials = getInitials(station?.name);
  const hasFavicon = String(station?.favicon ?? '').trim().length > 0;
  const logoId = station?.id ?? station?.stationuuid;
  const wantsLogo = hasFavicon || (resolveById && String(logoId ?? '').trim().length > 0);
  const url = wantsLogo ? getLogoUrl(station, logoSizePx(size)) : '';
  const fallback = `<span class="${initialsClass} logo-fallback" data-logo-fallback="1">${initials}</span>`;
  const image = url
    ? `<img class="${imgClass} logo-img" alt="" loading="${priority ? 'eager' : 'lazy'}" decoding="async"${priority ? ' fetchpriority="high"' : ''} data-logo-img="1" src="${url}">`
    : '';
  return `<span class="logo-slot logo-slot--${size}" data-logo-slot="1" data-initials="${initials}" data-initials-class="${initialsClass}">${fallback}${image}</span>`;
}

export function mountLogoBehavior(rootEl, { initialsClass = 'station-item-initials' } = {}) {
  if (!rootEl || MOUNTED.has(rootEl)) return;
  MOUNTED.add(rootEl);

  function resolveSlot(slot) {
    if (slot.dataset.logoResolved === '1') return;
    slot.dataset.logoResolved = '1';
    const img = slot.querySelector('img[data-logo-img="1"]');
    if (!img) return;
    const fallback = slot.querySelector('[data-logo-fallback="1"]');

    const showFallback = () => {
      img.remove();
      fallback?.classList.remove('is-hidden');
      slot.classList.remove('is-loaded');
    };
    const showImage = () => {
      slot.classList.add('is-loaded');
      fallback?.classList.add('is-hidden');
    };

    if (img.complete) {
      if (img.naturalWidth > 0) showImage();
      else showFallback();
      return;
    }
    img.addEventListener('load', showImage, { once: true });
    img.addEventListener('error', showFallback, { once: true });
  }

  rootEl.querySelectorAll('[data-logo-slot="1"]').forEach(resolveSlot);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.('[data-logo-slot="1"]')) resolveSlot(node);
        node.querySelectorAll?.('[data-logo-slot="1"]').forEach(resolveSlot);
      }
    }
  });
  observer.observe(rootEl, { childList: true, subtree: true });
}
