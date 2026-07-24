# Nudge System — Design Spec

**Date:** 2026-07-24
**Status:** Approved, ready for implementation plan

## Goal

RadioDock has constant, recurring traffic. Turn that goodwill into reach
(more users) and modest revenue (support the servers) with **dezente,
kontextabhängige Nudge-Karten** that appear only once the user has shown
they *like* the app — never on first contact, never nagging.

Two cards ship first:

1. **Share** — "Enjoying RadioDock? Share it with someone." → OS share sheet.
2. **Support** — "You're a power user!" → Ko-fi tip page.

Built as a small, extensible **system** (registry of nudge definitions), not
two hardcoded popups, so future cards (rating, install, newsletter) slot in
cheaply.

## Guiding principles (user chose "sehr dezent")

- **Trigger on engagement, not raw time.** Real audible listening + real
  return visits, measured via the existing listen signal — not "tab open for
  5 minutes."
- **Max. one nudge per session.** Hard rule. Nothing kills goodwill faster
  than a second popup in the same sitting.
- **Seen once = never again.** No re-appearance after dismiss.
- **Sympathy > reach.** Copy is short, warm, one sentence, no guilt trip.
  RadioDock's free/ad-free/one-person-project identity is the asset.

## Architecture

New module `src/ui/nudges.js` (+ `src/styles/nudges.css`). `main.js` mounts it
once at boot, passing `player` and `track`. The module owns a **registry** of
nudge definitions:

```
{ id, isEligible(state) -> bool, render() -> DOM, onAction() }
```

Today: `share`, `support`. Adding a third is ~10 lines + a CSS block.

`main.js` stays the only place that knows both UI and data (per project
convention). The nudge module reaches persistence through `data/storage.js`
prefs helpers only — never raw IndexedDB.

## Triggers & persistence

A tiny **usage tracker** runs at boot and maintains prefs (all via
`getPref`/`setPref` in the `prefs` store — IDB-safe, degrades silently when
IDB is blocked):

| Pref key | Purpose |
|---|---|
| `usageLastDay` | last usage day, `YYYY-MM-DD` |
| `usageDayCount` | count of unique usage days |
| `usageListenedEver` | ever had real audible playback |
| `nudgeShareListenMin` | cumulative audible minutes (for Share) |
| `nudgeShareSeen` | Share card already shown (one-shot) |
| `nudgeSupportSeen` | Support card already shown (one-shot) |

The "one nudge per session" guard is an **in-memory flag** (session = one page
load; resets on reload), so it needs no pref.

**Usage-day update (boot):** if `today !== usageLastDay`, increment
`usageDayCount` and set `usageLastDay = today`.

**Audible-minute accumulation:** the nudge module keeps its own audible timer,
gated exactly like `listen-heartbeat.js` — start on player `playing`, stop on
`paused` / `stopped` / `error` / `loading` (buffering/paused never counts). On
each whole audible minute it bumps `nudgeShareListenMin` (persisted) and sets
`usageListenedEver = true`.

**Eligibility:**

- **Share:** `nudgeShareListenMin >= 5` AND `!nudgeShareSeen`.
  (Minutes accumulate across sessions — need not be one sitting.)
- **Support:** `usageDayCount >= 3` AND `usageListenedEver` AND
  `!nudgeSupportSeen`.

## Frequency rules

- **One nudge per session, hard.** Evaluate at boot (and when a threshold is
  first crossed live). Once one card is shown this session, no other shows
  until next app start.
- **Priority on tie:** `share` before `support` (softer ask first; Support
  waits for the next qualified session).
- **One-shot:** showing a card sets its `…Seen` flag permanently → never
  reappears after dismiss.
- Nudges **do** appear in installed/standalone mode — an installed fan is the
  best sharer/supporter.

## Presentation & transition

One markup, two CSS regimes via the existing `.mobile-only` / standalone
breakpoints (mirrors the `install-section` pattern):

- **Desktop browser** (non-standalone): floating card **bottom-left**
  (`install-section` badge already owns bottom-right, so no collision).
  Enter: `translateY(8px) + opacity 0 → 0/1`, ~240 ms ease (same curve as
  `install-section`). Close **×** top-right.
- **Mobile + Electron** (standalone layout): slim **banner inserted directly
  above `.mobile-lists`** (the station-list navigation) — literally "between
  header and station-list navigation." Enter: smooth height + opacity reveal,
  no layout jump. Close **×** on the right.

## Copy (final)

**Share card** — share icon
> **Enjoying RadioDock?** · Share it with someone.

Action: `navigator.share({ title: 'RadioDock', url: 'https://radiodock.app' })`
where available (mobile, Electron, Safari, desktop Chrome). Fallback (desktop
Firefox, unsupported): a **"Link copied!"** button (writes the URL to
clipboard) plus 2–3 direct icons — WhatsApp · X · Mail.

**Support card** — heart icon
> **You're a power user!** · RadioDock is free & ad-free. Help keep the server
> alive and support the project.

Action: opens `SUPPORT_URL` in a new tab. **`SUPPORT_URL =
'https://ko-fi.com/radiodock'`.** Ko-fi chosen because supporters need **no
account** (guest checkout, card/PayPal) and there is **0 % platform fee**
(only payment-processor fees). No Ko-fi embed/iframe — that would load a
third-party script and break RadioDock's single-origin privacy stance; only
the final payment click hands off to Ko-fi.

## Analytics (reuse `track()`)

- `nudge-shown` `{ id }`
- `nudge-dismissed` `{ id }`
- `nudge-share` `{ method: 'native' | 'copy' | 'whatsapp' | 'x' | 'mail' }`
- `nudge-support-click`

Gives per-card conversion in Umami.

## Tunables (constant block, top of module)

- `SHARE_LISTEN_MINUTES = 5`
- `SUPPORT_DAY_COUNT = 3`
- `SUPPORT_URL = 'https://ko-fi.com/radiodock'`
- `APP_SHARE_URL = 'https://radiodock.app'`

All thresholds and URLs live together so tuning needs no code search.

## Out of scope

- No recurring/monthly ask, no A/B testing framework, no server component.
- No third-party support widget/iframe.
- No re-show-after-cooldown logic (explicitly rejected in favour of "seen once
  = never again").
