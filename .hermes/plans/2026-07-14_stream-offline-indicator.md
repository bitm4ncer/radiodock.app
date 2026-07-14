# Stream OFF Indicator — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Ein smarter, ressourcenschonender Background-Prozess, der minütlich prüft, ob Streams der aktiven Liste erreichbar sind, und ein "OFF"-Badge an nicht erreichbaren Station-Items anzeigt.

**Architecture:** Ein dediziertes Modul `src/player/stream-prober.js` verwaltet einen `setInterval`-Zyklus (60s). Es probt die Station-URLs der aktiven Liste sequenziell per `fetch()` mit 5s-Timeout via `AbortController`. Ergebnisse werden als `{stationId: 'online'|'offline'}` Map vorgehalten. Bei Status-Änderung wird ein Callback `onStatusChange` gefeuert. `main.js` reagiert darauf und injected `data-offline` Attribute in die DOM-Rows. CSS styled `.station-item[data-offline]` mit reduzierter Opacity + "OFF"-Badge.

**Tech Stack:** Vanilla JS (keine neuen Dependencies), CSS custom properties aus `tokens.css`, Web Worker wird bewusst NICHT verwendet (Overkill für 5-10 Stationen alle 60s — der `fetch`-Overhead dominiert, nicht der Main-Thread).

**Design-Entscheidungen:**
- **Nur aktive Liste proben** — wenn der User die Liste wechselt, wird der Probe-Timer resettet und nur die neue Liste gecheckt.
- **Sequentiell, nicht parallel** — vermeidet Flooding des Netzwerk-Stacks (5 Stationen × Parallel = 5 simultane TCP-Connections zu Stream-Servern).
- **5s Timeout pro Station** — bei 10 Stationen maximal 50s Probe-Zeit, passt in das 60s-Fenster.
- **Nur Status-Änderungen triggern DOM-Updates** — kein unnötiges Re-Rendering.
- **Pausiert bei Tab-Hidden** — `visibilitychange` pausiert/resumed den Timer. Kein Grund, Streams zu proben wenn niemand hinschaut.
- **`fetch()` statt Web Audio API** — Stream-Silence (dead air) können wir ohne CORS-Headers nicht zuverlässig detektieren. Der Indikator zeigt an: "Server nicht erreichbar / Stream tot" — das deckt den häufigsten Fall ab (Station offline).

---

### Task 1: Erstelle `src/player/stream-prober.js` — Kernmodul

**Objective:** Das Prober-Modul mit Timer, sequentiellem URL-Check und Status-Callback.

**Files:**
- Create: `src/player/stream-prober.js`

**Step 1: Schreibe das Modul**

```js
// Stream prober: checks station URLs once per minute to detect offline streams.
// Sequential probing (one at a time, 5s timeout each) so we don't flood the
// network stack with parallel TCP connections to stream servers.
//
// Pauses when the tab is hidden (visibilitychange) — no point probing streams
// nobody is looking at. Resumes on visibility restore + immediately re-probes.

const PROBE_INTERVAL_MS = 60_000;
const PROBE_TIMEOUT_MS = 5_000;

export function attachStreamProber({ getStations, onStatusChange }) {
  let timer = null;
  let statuses = {};          // { stationId: 'online' | 'offline' }
  let probing = false;
  let aborted = false;

  async function probeOne(station) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
      // Fetch just enough to confirm the server is sending data.
      // We don't read the body — the response headers alone tell us
      // whether the stream endpoint is reachable.
      const resp = await fetch(station.url, {
        method: 'GET',
        signal: ctrl.signal,
        cache: 'no-store',
        // mode: 'no-cors' would hide the response, so we use 'cors'
        // and gracefully handle the inevitable CORS errors from
        // icecast/shoutcast servers that don't send CORS headers.
        // The fetch will throw, which we treat as inconclusive (not offline).
      });
      // If we get here, the server responded. It might be an error page
      // though — check the status.
      return resp.ok ? 'online' : 'offline';
    } catch (err) {
      if (err.name === 'AbortError') {
        // Our own timeout — server didn't respond in 5s → likely offline.
        return 'offline';
      }
      // Network error or CORS block. CORS errors on stream URLs are
      // expected and don't mean the stream is down.
      if (err.name === 'TypeError' && err.message.includes('NetworkError')) {
        return 'offline';
      }
      // CORS error, DNS failure, etc. → inconclusive, don't flip status.
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function runProbeCycle() {
    if (probing) return; // Previous cycle still running.
    probing = true;
    aborted = false;

    const stations = getStations();
    if (!stations || stations.length === 0) {
      probing = false;
      return;
    }

    const newStatuses = {};
    let changed = false;

    for (const station of stations) {
      if (aborted) break; // List changed mid-cycle — abort.
      if (!station?.url) continue;

      const result = await probeOne(station);
      if (result === null) {
        // Inconclusive — keep previous status, or default to 'online'.
        newStatuses[station.id] = statuses[station.id] ?? 'online';
      } else {
        newStatuses[station.id] = result;
      }

      if (newStatuses[station.id] !== (statuses[station.id] ?? 'online')) {
        changed = true;
      }
    }

    // Any stations that disappeared from the list — drop their status.
    if (!changed) {
      const oldKeys = Object.keys(statuses);
      const newKeys = Object.keys(newStatuses);
      if (oldKeys.length !== newKeys.length) changed = true;
      else if (oldKeys.some(k => !(k in newStatuses))) changed = true;
    }

    if (changed || Object.keys(statuses).length === 0) {
      statuses = newStatuses;
      onStatusChange?.(statuses);
    } else {
      statuses = newStatuses;
    }

    probing = false;
  }

  function startTimer() {
    stopTimer();
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        runProbeCycle();
      }
    }, PROBE_INTERVAL_MS);
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      // Tab just became visible — re-probe immediately so the user
      // sees fresh status, then resume the regular interval.
      if (!probing) runProbeCycle();
      startTimer();
    } else {
      stopTimer();
    }
  }

  // Public API
  function start() {
    statuses = {};
    aborted = true; // Abort any in-flight cycle from previous list.
    startTimer();
    // Probe immediately on first attach.
    if (!probing) runProbeCycle();
  }

  function stop() {
    aborted = true;
    stopTimer();
    probing = false;
    statuses = {};
    onStatusChange?.({});
  }

  function refresh() {
    // Force immediate re-probe (e.g. after list change).
    aborted = true;
    // Wait for any in-flight cycle to notice the abort flag.
    setTimeout(() => {
      aborted = false;
      if (!probing) runProbeCycle();
    }, 100);
  }

  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    start,
    stop,
    refresh,
    destroy() {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
```

**Step 2: Verifiziere Syntax**

Run: `npx eslint src/player/stream-prober.js` (falls eslint konfiguriert) oder prüfe manuell.

**Step 3: Commit**

```bash
git add src/player/stream-prober.js
git commit -m "feat: add stream-prober module for offline detection"
```

---

### Task 2: CSS — `.station-item` Offline-Styling + OFF-Badge

**Objective:** Optisch reduziertes Styling für offline Stations + rotes "OFF"-Badge.

**Files:**
- Modify: `src/styles/station-list.css`

**Step 1: Füge die Offline-Styles am Ende der Datei ein**

```css
/* --- Offline indicator (stream-prober) --- */

.station-item[data-offline] {
  opacity: 0.45;
  transition: opacity 0.3s ease;
}

/* Restore full opacity on hover so the row is still readable. */
.station-item[data-offline]:hover {
  opacity: 0.75;
}

/* The playing row keeps its emphasis. An offline station that's somehow
   also the active station (shouldn't happen — stream would error) gets
   the playing background but still faded to show something's wrong. */
.station-item[data-offline].playing {
  opacity: 0.6;
}

/* OFF badge — pill to the right of the station name. */
.station-item[data-offline] .station-item-info {
  position: relative;
}

.station-item[data-offline] .station-item-name::after {
  content: 'OFF';
  display: inline-block;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #fff;
  background: var(--red);
  border-radius: 3px;
  padding: 1px 5px;
  margin-left: 8px;
  vertical-align: middle;
  line-height: 1.4;
  /* Override the playing pulse dot when the item is also .playing. */
  animation: none;
  width: auto;
  height: auto;
}

/* When a station is offline AND playing, the ::after is shared between
   the playing pulse dot and the OFF badge. The OFF badge wins because
   [data-offline] has higher specificity on its properties. We just need
   to reset the pulse-specific size/color/animation. */
```

**Step 2: Prüfe das CSS (kein Syntax-Check nötig, aber visuell verifizieren)**

**Step 3: Commit**

```bash
git add src/styles/station-list.css
git commit -m "feat: add offline styling + OFF badge for station items"
```

---

### Task 3: Integriere Stream-Prober in `main.js`

**Objective:** Verdrahte den Prober mit der aktiven Liste, sodass bei Status-Änderungen DOM-Attribute gesetzt werden.

**Files:**
- Modify: `src/main.js`

**Step 1: Import hinzufügen** (nach den existierenden Imports, ca. Zeile 37)

```js
import { attachStreamProber } from './player/stream-prober.js';
```

**Step 2: Prober-Instanz im Boot-Bereich initialisieren** (nach `attachListenHeartbeat`, ca. Zeile 60)

```js
// --- Stream offline prober ---
const streamProber = attachStreamProber({
  getStations: () => {
    const list = findList(state.currentListId);
    return list?.stations ?? [];
  },
  onStatusChange: (statuses) => {
    applyOfflineStatus(statuses);
  },
});
```

**Step 3: `applyOfflineStatus`-Funktion** (vor `bootstrap()`, als Modul-Level-Funktion)

```js
function applyOfflineStatus(statuses) {
  const offlineIds = new Set(
    Object.entries(statuses)
      .filter(([, status]) => status === 'offline')
      .map(([id]) => id)
  );
  // Desktop station list
  const desktopRows = document.querySelectorAll('#favoritesList .station-item[data-id]');
  for (const row of desktopRows) {
    if (offlineIds.has(row.dataset.id)) {
      row.setAttribute('data-offline', '');
    } else {
      row.removeAttribute('data-offline');
    }
  }
  // Mobile carousel pages — each has its own station-list DOM
  const mobileRows = document.querySelectorAll('.list-page .station-item[data-id]');
  for (const row of mobileRows) {
    if (offlineIds.has(row.dataset.id)) {
      row.setAttribute('data-offline', '');
    } else {
      row.removeAttribute('data-offline');
    }
  }
}
```

**Step 4: Starte den Prober nach dem Bootstrap** (nach `renderActiveList()` im Bootstrap, ca. Zeile 932)

In `bootstrap()`, nach `renderActiveList()` (nach der zweiten im Phase-2-Block):

```js
streamProber.start();
```

**Step 5: Reagiere auf Listenwechsel** — in `renderActiveList()`, füge nach dem Rendering (ca. Zeile 448) hinzu:

```js
streamProber.refresh();
```

**Step 6: Reagiere auf Carousel-Swipe** — in `listsCarousel.onCurrentChange` (ca. Zeile 698), füge hinzu:

```js
streamProber.refresh();
```

**Step 7: Cleanup** nicht nötig — die App wird nie "beendet" im Browser-Kontext. Der `visibilitychange`-Handler im Prober pausiert automatisch.

**Step 8: Commit**

```bash
git add src/main.js
git commit -m "feat: integrate stream-prober with active list + DOM updates"
```

---

### Task 4: Stelle sicher, dass Carousel-Pages auch `data-offline` bei Re-Render behalten

**Objective:** Wenn der Carousel zwischen Listen swiped und `stationList.setStations()` das innere HTML neu aufbaut, gehen `data-offline` Attribute verloren. Der Prober muss nach einem `setStations`-Call die Offline-Attribute neu applizieren.

**Files:**
- Modify: `src/main.js`

**Step 1:** Die `applyOfflineStatus`-Funktion ist bereits idempotent (querySelectorAll findet alle Rows). Wir müssen sie nur an den richtigen Stellen aufrufen. Im Carousel-Code (`lists-carousel.js`) wird `stationList.setStations()` aufgerufen. Danach müssen wir `applyOfflineStatus` triggern.

**Ansatz:** Der Prober speichert den letzten `statuses`-State. `streamProber.getStatuses()` exposed ihn. Nach jedem `renderActiveList()` (das `stationList.setStations()` triggert), rufen wir `applyOfflineStatus` mit dem gecachten State auf.

**Step 2: Ergänze `attachStreamProber` return value** (in `stream-prober.js`):

```js
return {
  start,
  stop,
  refresh,
  getStatuses: () => ({ ...statuses }),
  destroy() { ... },
};
```

**Step 3: In `renderActiveList()` in main.js** (nach den `setStations` und `setActive` calls, ca. Zeile 439):

```js
// Re-apply offline status after DOM rebuild
const currentStatuses = streamProber.getStatuses();
if (Object.keys(currentStatuses).length > 0) {
  // Defer one microtask so the DOM has settled after innerHTML rebuild
  Promise.resolve().then(() => applyOfflineStatus(currentStatuses));
}
```

**Step 4: Commit**

```bash
git add src/player/stream-prober.js src/main.js
git commit -m "fix: re-apply offline status after station-list DOM rebuild"
```

---

### Task 5: Verifikation

**Objective:** Sicherstellen, dass alles korrekt zusammenspielt.

**Step 1: Lokalen Build starten**

```bash
npm run dev
```

**Step 2: Manuelle Tests**
- Öffne `http://localhost:5173` im Browser
- Warte bis zu 60 Sekunden — der Prober startet automatisch nach dem Bootstrap
- Prüfe im DevTools Network-Tab: `fetch`-Requests an die Stream-URLs erscheinen
- Prüfe, dass bei Nicht-Erreichbarkeit (Timeout/Error) das `data-offline` Attribut gesetzt wird
- Prüfe das visuelle Styling: Row wird ausgegraut, "OFF"-Badge erscheint
- Wechsle die Liste — der Prober resettet und probt die neue Liste
- Wechsle in einen anderen Tab → der Prober pausiert; kehre zurück → er resumed

**Step 3: Edge Cases**
- Leere Liste: Prober startet aber `getStations()` returned `[]` → Cycle ist no-op, kein Error
- Community-Liste mit vielen Stationen: Sequentielles Proben, 5s Timeout pro Station → max 50s, passt in 60s-Fenster
- Station ohne URL (`station.url` ist leer): `probeOne` returned früh, Status bleibt 'online' (default)

**Step 4: Commit (falls Änderungen nötig)**

---

## Risiken & Tradeoffs

| Risiko | Mitigation |
|--------|-----------|
| CORS-Fehler bei `fetch()` auf Stream-URLs verfälschen Erkennung | `fetch()`-Fehler mit `TypeError` + `NetworkError` → offline. Reine CORS-Fehler (TypeError ohne NetworkError) → `null` (inconclusive), Status bleibt unverändert. |
| Stream-Server antworten mit 200 auf Root-Pfad, aber Stream-Pfad ist kaputt | Wir proben die exakte `.url` aus den Station-Daten. Wenn der Server eine Fehlerseite mit 200 zurückgibt, erkennen wir das nicht. Edge Case — die meisten Server geben 404. |
| 10+ Stationen in einer Liste übersteigen das 60s-Fenster | Bei 10 Stationen × 5s = 50s. Wenn eine Liste >12 Stationen hat, läuft der nächste Cycle während der vorherige noch läuft. `probing`-Guard verhindert Doppel-Cycles. Der Cycle dauert dann >60s, aber das ist akzeptabel. |
| Silent-Stream (dead air) wird nicht als offline erkannt | Design-Entscheidung: Web Audio API bräuchte CORS-Headers, die die meisten Stream-Server nicht senden. Der Indikator erkennt "Server nicht erreichbar" — das ist der häufigste Fall. |

---

## Offene Fragen

- Soll der OFF-Indikator auch im Carousel-View (mobile) sichtbar sein? → Ja, `applyOfflineStatus` deckt bereits beide DOM-Pfade ab.
- Soll eine Station die gerade aktiv spielt und "offline" wird, automatisch gestoppt werden? → Nein, das wäre ein separates Feature. Der aktuelle Recovery-Layer (`recovery.js`) versucht bereits Reconnects.
