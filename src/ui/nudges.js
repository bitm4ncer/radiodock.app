// Nudge system: dezente, engagement-gated cards (Share, Support). One module
// owns usage tracking, eligibility, and rendering. Nudges appear at most once
// per session and only after the user has shown they like the app.
//
// Persistence goes through the prefs store (IDB-safe; degrades silently when
// IDB is blocked). No localStorage.

import * as storage from '../data/storage.js';
import { track } from '../analytics/umami.js';

// --- Tunables (all thresholds + URLs in one place) ---
const SHARE_LISTEN_MINUTES = 5;
const SUPPORT_DAY_COUNT = 3;
const SUPPORT_URL = 'https://ko-fi.com/radiodock';
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
  return {
    shareListenMin: await storage.getPref('nudgeShareListenMin', 0),
    dayCount: await storage.getPref('usageDayCount', 0),
    listenedEver: await storage.getPref('usageListenedEver', false),
    shareSeen: await storage.getPref('nudgeShareSeen', false),
    supportSeen: await storage.getPref('nudgeSupportSeen', false),
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
  support: {
    id: 'support',
    content: {
      icon: HEART_ICON,
      headline: "You're a power user!",
      body: 'RadioDock is free & ad-free. Help keep the server alive and support the project.',
    },
    mountActions(el) {
      el.innerHTML = `<a class="nudge__btn nudge__btn--primary" href="${SUPPORT_URL}" target="_blank" rel="noopener" data-support>Support</a>`;
      el.querySelector('[data-support]').addEventListener('click', () => track('nudge-support-click'));
    },
  },
};

function selectNudge(state) {
  // Priority: share (softer ask) before support. One per session upstream.
  if (state.shareListenMin >= SHARE_LISTEN_MINUTES && !state.shareSeen) return 'share';
  if (state.dayCount >= SUPPORT_DAY_COUNT && state.listenedEver && !state.supportSeen) return 'support';
  return null;
}

async function markSeen(id) {
  if (id === 'share') await storage.setPref('nudgeShareSeen', true);
  else if (id === 'support') await storage.setPref('nudgeSupportSeen', true);
}

let shownThisSession = false;

async function evaluateNudges() {
  if (shownThisSession) return;
  // The tiny pill is the whole window — a nudge would paint around it instead
  // of anywhere sensible. Defer rather than drop: returning before markSeen
  // keeps the once-ever flag unspent, so the card is still owed and shows on
  // the next evaluation (every audible minute, and immediately on expand).
  if (document.body.classList.contains('is-tiny-player')) return;
  const state = await getNudgeState();
  const id = selectNudge(state);
  if (!id) return;
  shownThisSession = true;
  await markSeen(id); // seen once = never again, even if the user ignores it
  track('nudge-shown', { id });
  showNudgeCard(REGISTRY[id]);
}

// A nudge shows in one of two regimes. Banner regime (mobile + Electron
// standalone) inserts a slim bar above the station-list nav; float regime
// (desktop browser) drops a card bottom-left, opposite the install badge.
function isBannerRegime() {
  return document.documentElement.classList.contains('is-standalone')
    || window.matchMedia('(max-width: 699px)').matches;
}

function showNudgeCard(def) {
  document.getElementById('nudgeCard')?.remove();
  const banner = isBannerRegime();

  const el = document.createElement('section');
  el.className = `nudge ${banner ? 'nudge--banner' : 'nudge--float'} is-entering`;
  el.id = 'nudgeCard';
  el.setAttribute('role', 'complementary');
  el.innerHTML = `
    <button type="button" class="nudge__close" aria-label="Dismiss">${CLOSE_ICON}</button>
    <span class="nudge__icon" aria-hidden="true">${def.content.icon}</span>
    <div class="nudge__text">
      <span class="nudge__headline">${def.content.headline}</span>
      <span class="nudge__body">${def.content.body}</span>
    </div>
    <div class="nudge__actions"></div>
  `;

  if (banner) {
    const anchor = document.querySelector('.mobile-lists');
    anchor?.parentNode.insertBefore(el, anchor);
  } else {
    document.body.append(el);
  }

  def.mountActions(el.querySelector('.nudge__actions'));

  const dismiss = () => {
    el.classList.add('is-dismissed');
    track('nudge-dismissed', { id: def.id });
    setTimeout(() => el.remove(), 300);
  };
  el.querySelector('.nudge__close').addEventListener('click', dismiss);

  // Commit the entering state, then flip it off next frame so the CSS
  // transition runs. setTimeout (not RAF) so it still fires in a hidden tab.
  void el.offsetHeight;
  setTimeout(() => el.classList.remove('is-entering'), 20);

  return { dismiss };
}

// Manual test affordance. `__nudgeDebug.reset()` clears all nudge prefs;
// forceShare/forceSupport seed just enough state to make that card eligible,
// then re-run selection (clearing the session guard so it can show again).
function installDebugHooks() {
  window.__nudgeDebug = {
    async state() { return getNudgeState(); },
    async evaluate() { return evaluateNudges(); },
    resetSession() { shownThisSession = false; },
    async reset() {
      for (const k of ['nudgeShareListenMin', 'nudgeShareSeen', 'nudgeSupportSeen',
        'usageListenedEver', 'usageDayCount', 'usageLastDay']) {
        await storage.removePref(k);
      }
      shownThisSession = false;
      document.getElementById('nudgeCard')?.remove();
    },
    async forceShare() {
      await storage.setPref('nudgeShareListenMin', SHARE_LISTEN_MINUTES);
      await storage.setPref('nudgeShareSeen', false);
      shownThisSession = false;
      await evaluateNudges();
    },
    async forceSupport() {
      await storage.setPref('usageDayCount', SUPPORT_DAY_COUNT);
      await storage.setPref('usageListenedEver', true);
      await storage.setPref('nudgeSupportSeen', false);
      shownThisSession = false;
      await evaluateNudges();
    },
  };
}

export function mountNudges({ player }) {
  trackUsageDay().then(evaluateNudges);
  attachAudibleAccumulator(player, () => { evaluateNudges(); });
  // Expanding out of the pill is the first moment a deferred nudge has room, so
  // show it there rather than making the user wait for the next audible minute.
  window.addEventListener('rd:tiny-changed', (e) => { if (!e.detail?.on) evaluateNudges(); });
  installDebugHooks();
}
