// Nudge system: dezente, engagement-gated cards (Share, Donate). One module
// owns usage tracking, eligibility, and rendering. Only one card is visible at
// a time; the donate card may replace an open share card once its own trigger
// matures, so a 5-minute share ask never buries the 30-minute donate ask.
//
// Persistence goes through the prefs store (IDB-safe; degrades silently when
// IDB is blocked). No localStorage.

import * as storage from '../data/storage.js';
import { track } from '../analytics/umami.js';

const DAY_MS = 86400_000;

// --- Tunables (all thresholds + URLs in one place) ---
const SHARE_LISTEN_MINUTES = 5;
const DONATE_FIRST_MINUTES = 30;
const DONATE_REPEAT_DAYS = 7;
const DONATE_REPEAT_ACTIVE_DAYS = 3;
const DONATE_REPEAT_ACTIVE_DAYS_MOBILE = 2;
const DONATE_MAX_PER_30_DAYS = 4;
const DONATE_AUTOHIDE_MS = 20_000;
const DONATE_SNOOZE_CLICK_DAYS = 30;
const DONATE_SNOOZE_DISMISS_DAYS = 60;
const DONATE_DISMISSALS_BEFORE_SNOOZE = 3;
const DONATE_URL = 'https://ko-fi.com/radiodock';
const APP_SHARE_URL = 'https://radiodock.app';

// --- Icons ---
const SHARE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0-12-4 4m4-4 4 4M5 14v4a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
const HEART_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 3C19.5376 3 22 5.5 22 9C22 16 14.5 20 12 21.5C9.5 20 2 16 2 9C2 5.5 4.5 3 7.5 3C9.35997 3 11 4 12 5C13 4 14.64 3 16.5 3Z" fill="currentColor"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

// Whatsapp / X / mail glyphs for the share fallback.
const WHATSAPP_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.02c-.25.7-1.44 1.33-1.98 1.38-.53.05-1.02.24-3.45-.72-2.9-1.14-4.73-4.1-4.88-4.29-.14-.19-1.16-1.54-1.16-2.94s.73-2.08 1-2.37c.26-.29.56-.36.75-.36l.54.01c.17 0 .4-.06.63.48.25.6.83 2.06.9 2.2.07.15.12.32.02.51-.1.19-.15.32-.29.49-.14.17-.3.39-.43.52-.14.14-.29.3-.12.58.17.29.75 1.24 1.62 2.01 1.11.99 2.05 1.3 2.34 1.44.29.15.46.12.63-.07.17-.19.72-.84.91-1.13.19-.29.39-.24.63-.15.24.1 1.55.73 1.81.87.26.14.44.21.5.32.07.11.07.63-.18 1.33Z" fill="currentColor"/></svg>`;
const REDDIT_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.719zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" fill="currentColor"/></svg>`;
const MAIL_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 3.2V18h16V8.2l-8 5-8-5Zm14.4-1.2H5.6L12 11l6.4-4Z" fill="currentColor"/></svg>`;

// Local calendar day as YYYY-MM-DD (not UTC — a listener at 11pm shouldn't
// have "today" roll based on the server's timezone).
function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// Bump the unique-usage-day counter once per calendar day.
async function trackUsageDay() {
  const today = todayStr();
  const last = await storage.getPref('usageLastDay', null);
  if (last === today) return;
  const count = await storage.getPref('usageDayCount', 0);
  await storage.setPref('usageDayCount', count + 1);
  await storage.setPref('usageLastDay', today);
}

async function getNudgeState() {
  const now = Date.now();
  const shownAt = await storage.getPref('donateCardShownAt', []);
  return {
    shareListenMin: Number(await storage.getPref('nudgeShareListenMin', 0)) || 0,
    dayCount: Number(await storage.getPref('usageDayCount', 0)) || 0,
    shareSeen: await storage.getPref('nudgeShareSeen', false),
    donateShowCount: Number(await storage.getPref('donateCardShowCount', 0)) || 0,
    donateLastAt: Number(await storage.getPref('donateCardLastAt', 0)) || 0,
    donateDaysAtLast: Number(await storage.getPref('donateCardDaysAtLast', 0)) || 0,
    // Kept short: the 30-day cap is a rolling window, not a lifetime count.
    donateRecentShows: (Array.isArray(shownAt) ? shownAt : [])
      .map(Number)
      .filter((t) => Number.isFinite(t) && now - t < 30 * DAY_MS),
    donateSnoozeUntil: Number(await storage.getPref('donateCardSnoozeUntil', 0)) || 0,
    donateDismissCount: Number(await storage.getPref('donateCardDismissCount', 0)) || 0,
  };
}

// Audible-minute accumulator. Gated exactly like listen-heartbeat.js: count a
// minute only while playback is actually audible (buffering/paused never
// count). Mirrors that module rather than sharing state so analytics and
// nudges stay decoupled.
function attachAudibleAccumulator(player, onMinute) {
  let timer = null;
  let audible = false;

  const tick = async () => {
    if (!audible || !player.isPlaying()) return;
    const min = (await storage.getPref('nudgeShareListenMin', 0)) + 1;
    await storage.setPref('nudgeShareListenMin', min);
    if (!(await storage.getPref('usageListenedEver', false))) {
      await storage.setPref('usageListenedEver', true);
    }
    onMinute(min);
  };

  const start = () => {
    audible = true;
    if (!timer) timer = setInterval(tick, 60_000);
  };
  const stop = () => {
    audible = false;
    if (timer) clearInterval(timer);
    timer = null;
  };

  player.on('playing', start);
  player.on('loading', () => { audible = false; });
  player.on('paused', stop);
  player.on('stopped', stop);
  player.on('error', stop);
}

// --- Registry of nudge definitions ---
// Each entry: { id, content:{icon,headline,body}, mountActions(actionsEl) }.
// Adding a third card is this object + a CSS block.
const REGISTRY = {
  share: {
    id: 'share',
    content: { icon: SHARE_ICON, headline: 'Enjoying RadioDock?', body: 'Share it with someone.' },
    mountActions(el) {
      if (typeof navigator.share === 'function') {
        el.innerHTML = `<button type="button" class="nudge__btn nudge__btn--primary" data-share>Share</button>`;
        el.querySelector('[data-share]').addEventListener('click', async () => {
          try {
            await navigator.share({ title: 'RadioDock', url: APP_SHARE_URL });
            track('nudge-share', { method: 'native' });
          } catch (_) { /* user cancelled the sheet — no-op */ }
        });
        return;
      }
      // Fallback (desktop Firefox etc.): copy + direct targets.
      const msg = encodeURIComponent(`RadioDock — free internet radio on every device: ${APP_SHARE_URL}`);
      el.innerHTML = `
        <button type="button" class="nudge__btn" data-copy>Copy link</button>
        <a class="nudge__btn nudge__btn--icon" data-m="whatsapp" href="https://wa.me/?text=${msg}" target="_blank" rel="noopener" aria-label="Share on WhatsApp">${WHATSAPP_ICON}</a>
        <a class="nudge__btn nudge__btn--icon" data-m="reddit" href="https://www.reddit.com/submit?url=${encodeURIComponent(APP_SHARE_URL)}&title=${encodeURIComponent('RadioDock — free internet radio on every device')}" target="_blank" rel="noopener" aria-label="Share on Reddit">${REDDIT_ICON}</a>
        <a class="nudge__btn nudge__btn--icon" data-m="mail" href="mailto:?subject=${encodeURIComponent('RadioDock')}&body=${msg}" aria-label="Share by email">${MAIL_ICON}</a>
      `;
      const copyBtn = el.querySelector('[data-copy]');
      copyBtn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(APP_SHARE_URL); } catch (_) {}
        copyBtn.textContent = 'Link copied!';
        track('nudge-share', { method: 'copy' });
      });
      el.querySelectorAll('a[data-m]').forEach((a) => {
        a.addEventListener('click', () => track('nudge-share', { method: a.dataset.m }));
      });
    },
  },
};

// Sequential rotation, not random: each card should feel like the next step,
// not a slot machine. Variant 4 therefore lands on the most engaged users, so
// read it as a tone shift rather than a clean A/B bucket.
const DONATE_VARIANTS = [
  {
    headline: 'RadioDock is free and ad-free.',
    body: 'Support the Project.',
  },
  {
    headline: 'Welcome back!',
    body: 'If you enjoy RadioDock, consider donating, it stays free and ad-free.',
  },
  {
    headline: 'You seem to enjoy the app!',
    body: 'If RadioDock is part of your day, a few euros help keep it free.',
  },
  {
    headline: "You're a power user!",
    body: "Have an idea to improve RadioDock? I'd love to hear it. "
      + 'If you want to support a solo developer, a small donation means a lot.',
    email: 'kontakt@jannesbecherer.de',
  },
];

// First show is earned by listening; repeats are earned by coming back. The
// active-day counter staggers naturally: daily users see roughly one card a
// week, 3x/week users about every ten days, weekly users about every three.
function donateEligible(state, banner) {
  const now = Date.now();
  if (now < state.donateSnoozeUntil) return false;
  if (state.donateRecentShows.length >= DONATE_MAX_PER_30_DAYS) return false;
  if (!state.donateShowCount) {
    if (state.shareListenMin < DONATE_FIRST_MINUTES) return false;
    // The mobile banner is more intrusive than the desktop float: never put it
    // in someone's very first session.
    return !banner || state.dayCount >= 2;
  }
  if (now - state.donateLastAt < DONATE_REPEAT_DAYS * DAY_MS) return false;
  const activeDays = state.dayCount - state.donateDaysAtLast;
  return activeDays >= (banner ? DONATE_REPEAT_ACTIVE_DAYS_MOBILE : DONATE_REPEAT_ACTIVE_DAYS);
}

function selectNudge(state, banner) {
  // Share is the softer ask and stays first; once it has been shown, the donate
  // card takes over as soon as its own trigger matures.
  if (state.shareListenMin >= SHARE_LISTEN_MINUTES && !state.shareSeen) return 'share';
  if (donateEligible(state, banner)) return 'donate';
  return null;
}

async function markSeen(id) {
  if (id === 'share') await storage.setPref('nudgeShareSeen', true);
}

async function recordDonateShow(state, banner, variantIndex) {
  const now = Date.now();
  const recent = [...state.donateRecentShows, now].filter((t) => now - t < 30 * DAY_MS);
  await storage.setPref('donateCardShownAt', recent);
  await storage.setPref('donateCardShowCount', state.donateShowCount + 1);
  await storage.setPref('donateCardLastAt', now);
  await storage.setPref('donateCardDaysAtLast', state.dayCount);
  track('donate-card-shown', {
    variant: String(variantIndex + 1),
    surface: banner ? 'mobile' : 'desktop',
    trigger: state.donateShowCount === 0 ? 'first' : 'repeat',
  });
}

const shownThisSession = new Set();
let evaluating = false;

async function evaluateNudges() {
  // The tiny pill is the whole window — a nudge would paint around it instead
  // of anywhere sensible. Defer rather than drop: no seen flag is spent, so the
  // card is still owed and shows on the next evaluation (every audible minute,
  // and immediately on expand).
  if (document.body.classList.contains('is-tiny-player')) return;
  if (evaluating) return;
  evaluating = true;
  try {
    // A tab left open across midnight must still count the new day, otherwise
    // the repeat cadence only advances when the app is reloaded.
    await trackUsageDay();
    const banner = isBannerRegime();
    const state = await getNudgeState();
    const id = selectNudge(state, banner);
    if (!id || shownThisSession.has(id)) return;

    const existing = document.getElementById('nudgeCard');
    if (existing) {
      const current = existing.dataset.nudgeId;
      if (current === id) return;
      // The share card may yield to the donate card once the longer trigger
      // matures. Anything else waits its turn.
      if (!(current === 'share' && id === 'donate')) return;
      existing.__nudgeDestroy?.();
      existing.remove();
    }
    shownThisSession.add(id);

    if (id === 'share') {
      await markSeen('share');
      track('nudge-shown', { id });
      showNudgeCard(REGISTRY.share, { banner });
      return;
    }

    const variantIndex = state.donateShowCount % DONATE_VARIANTS.length;
    await recordDonateShow(state, banner, variantIndex);
    showDonateCard(DONATE_VARIANTS[variantIndex], banner, variantIndex, state);
  } finally {
    evaluating = false;
  }
}

// A nudge shows in one of two regimes. Banner regime (mobile + Electron
// standalone) inserts a slim bar above the station-list nav; float regime
// (desktop browser) drops a card bottom-left, opposite the install badge.
function isBannerRegime() {
  return document.documentElement.classList.contains('is-standalone')
    || window.matchMedia('(max-width: 699px)').matches;
}

async function bumpDonateDismissals(state) {
  const count = state.donateDismissCount + 1;
  if (count >= DONATE_DISMISSALS_BEFORE_SNOOZE) {
    await storage.setPref('donateCardSnoozeUntil', Date.now() + DONATE_SNOOZE_DISMISS_DAYS * DAY_MS);
    await storage.setPref('donateCardDismissCount', 0);
  } else {
    await storage.setPref('donateCardDismissCount', count);
  }
}

function showDonateCard(content, banner, variantIndex, state) {
  return showNudgeCard({
    id: 'donate',
    className: 'nudge--donate',
    stacked: true,
    content: { icon: HEART_ICON, ...content },
    autoHideMs: DONATE_AUTOHIDE_MS,
    mountActions(el, dismiss) {
      const email = content.email
        ? `<a class="nudge__btn nudge__btn--ghost" href="mailto:${content.email}">Email me</a>`
        : '';
      el.innerHTML = `${email}<a class="nudge__btn nudge__btn--primary" href="${DONATE_URL}" `
        + `target="_blank" rel="noopener" data-donate data-donate-variant="${variantIndex + 1}">Donate</a>`;
      el.querySelector('[data-donate]').addEventListener('click', () => {
        // The click itself is tracked by the delegated handler in main.js. Here
        // we only buy the donor some quiet, since Ko-fi cannot tell us who paid.
        void storage.setPref('donateCardSnoozeUntil', Date.now() + DONATE_SNOOZE_CLICK_DAYS * DAY_MS);
        void storage.setPref('donateCardDismissCount', 0);
        dismiss('donate');
      });
    },
    onDismiss(reason) {
      if (reason === 'close') void bumpDonateDismissals(state);
    },
  }, { banner, variant: variantIndex + 1 });
}

function showNudgeCard(def, { banner = isBannerRegime(), variant = null } = {}) {
  const previous = document.getElementById('nudgeCard');
  previous?.__nudgeDestroy?.();
  previous?.remove();

  const el = document.createElement('section');
  el.className = `nudge ${banner ? 'nudge--banner' : 'nudge--float'} is-entering${def.className ? ` ${def.className}` : ''}`;
  el.id = 'nudgeCard';
  el.dataset.nudgeId = def.id;
  el.setAttribute('role', 'complementary');
  const head = `<span class="nudge__headline">${def.content.headline}</span>`;
  const body = `<span class="nudge__body">${def.content.body}</span>`;
  // Donate is a stacked note: heart + headline, full-width body, actions below.
  // Keeping the button out of the text column lets the copy use the full card
  // width; share still uses the compact icon/text/actions row.
  el.innerHTML = def.stacked
    ? `
      <button type="button" class="nudge__close" aria-label="Dismiss">${CLOSE_ICON}</button>
      <div class="nudge__head">
        <span class="nudge__icon" aria-hidden="true">${def.content.icon}</span>
        ${head}
      </div>
      ${body}
      <div class="nudge__actions"></div>
    `
    : `
      <button type="button" class="nudge__close" aria-label="Dismiss">${CLOSE_ICON}</button>
      <span class="nudge__icon" aria-hidden="true">${def.content.icon}</span>
      <div class="nudge__text">
        ${head}
        ${body}
      </div>
      <div class="nudge__actions"></div>
    `;

  if (banner) {
    const anchor = document.querySelector('.mobile-lists');
    if (anchor) anchor.parentNode.insertBefore(el, anchor);
    else document.body.append(el);
  } else {
    document.body.append(el);
  }

  let hideTimer = null;
  const clearHideTimer = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
  };
  let dismissed = false;

  const destroy = () => {
    clearHideTimer();
    document.removeEventListener('visibilitychange', onVisibility);
  };

  const dismiss = (reason = 'close') => {
    if (dismissed) return;
    dismissed = true;
    destroy();
    if (def.id === 'donate') {
      // A click is not a rejection; only close/timeout are dismissals.
      if (reason !== 'donate') track('donate-card-dismissed', { variant: String(variant), reason });
    } else {
      track('nudge-dismissed', { id: def.id });
    }
    def.onDismiss?.(reason);
    el.classList.add('is-dismissed');
    setTimeout(() => el.remove(), 300);
  };

  def.mountActions(el.querySelector('.nudge__actions'), dismiss);

  const startHideTimer = () => {
    if (!def.autoHideMs || dismissed) return;
    clearHideTimer();
    hideTimer = setTimeout(() => dismiss('timeout'), def.autoHideMs);
  };
  const pauseHideTimer = clearHideTimer;
  const resumeHideTimer = () => {
    if (document.visibilityState === 'visible') startHideTimer();
  };
  el.addEventListener('mouseenter', pauseHideTimer);
  el.addEventListener('mouseleave', resumeHideTimer);
  el.addEventListener('focusin', pauseHideTimer);
  el.addEventListener('focusout', (e) => {
    if (!el.contains(e.relatedTarget)) resumeHideTimer();
  });
  function onVisibility() {
    if (document.visibilityState === 'visible') resumeHideTimer();
    else pauseHideTimer();
  }
  document.addEventListener('visibilitychange', onVisibility);
  if (document.visibilityState === 'visible') startHideTimer();

  el.querySelector('.nudge__close').addEventListener('click', () => dismiss('close'));

  // Commit the entering state, then flip it off next frame so the CSS
  // transition runs. setTimeout (not RAF) so it still fires in a hidden tab.
  void el.offsetHeight;
  setTimeout(() => el.classList.remove('is-entering'), 20);

  el.__nudgeDestroy = destroy;
  return { dismiss, destroy };
}

// Manual test affordance. `__nudgeDebug.reset()` clears all nudge prefs;
// forceShare/forceDonate seed just enough state to make that card eligible,
// then re-run selection (clearing the session guard so it can show again).
function installDebugHooks() {
  window.__nudgeDebug = {
    async state() { return getNudgeState(); },
    async evaluate() { return evaluateNudges(); },
    resetSession() { shownThisSession.clear(); },
    async reset() {
      for (const k of ['nudgeShareListenMin', 'nudgeShareSeen', 'nudgeSupportSeen',
        'donateCardShownAt', 'donateCardShowCount', 'donateCardLastAt',
        'donateCardDaysAtLast', 'donateCardSnoozeUntil', 'donateCardDismissCount',
        'usageListenedEver', 'usageDayCount', 'usageLastDay']) {
        await storage.removePref(k);
      }
      shownThisSession.clear();
      const card = document.getElementById('nudgeCard');
      card?.__nudgeDestroy?.();
      card?.remove();
    },
    async forceShare() {
      await storage.setPref('nudgeShareListenMin', SHARE_LISTEN_MINUTES);
      await storage.setPref('nudgeShareSeen', false);
      shownThisSession.clear();
      await evaluateNudges();
    },
    async forceDonate() {
      // Share must be out of the way, otherwise selectNudge() keeps offering
      // the softer card first.
      await this.forceDonateVariant(1);
    },
    async forceDonateVariant(n) {
      const variant = Math.min(DONATE_VARIANTS.length, Math.max(1, Number(n) || 1));
      await storage.setPref('nudgeShareSeen', true);
      await storage.setPref('nudgeShareListenMin', DONATE_FIRST_MINUTES);
      await storage.setPref('usageDayCount', Math.max(3, await storage.getPref('usageDayCount', 0)));
      await storage.setPref('donateCardShownAt', []);
      await storage.setPref('donateCardShowCount', variant - 1);
      await storage.setPref('donateCardLastAt', 0);
      await storage.setPref('donateCardDaysAtLast', 0);
      await storage.setPref('donateCardSnoozeUntil', 0);
      await storage.setPref('donateCardDismissCount', 0);
      const card = document.getElementById('nudgeCard');
      card?.__nudgeDestroy?.();
      card?.remove();
      shownThisSession.clear();
      await evaluateNudges();
    },
  };
}

export function mountNudges({ player }) {
  evaluateNudges();
  attachAudibleAccumulator(player, () => { evaluateNudges(); });
  // Expanding out of the pill is the first moment a deferred nudge has room, so
  // show it there rather than making the user wait for the next audible minute.
  window.addEventListener('rd:tiny-changed', (e) => { if (!e.detail?.on) evaluateNudges(); });
  installDebugHooks();
}
