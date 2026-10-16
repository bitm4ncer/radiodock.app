// Shared Cap CAPTCHA helper for the public write forms.
//
// The widget script and its WASM are served from the Stations API origin
// (self-hosted, no third-party host). Loading is memoised so several forms can
// share one script tag; each form gets its own <cap-widget>, and the widget
// injects its hidden `cap-token` field into the surrounding <form>.

import { STATIONS_BASE } from '../data/stations-api.js';

let widgetScript = null;

export function loadCapWidget() {
  if (widgetScript) return widgetScript;
  widgetScript = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${STATIONS_BASE}/cap/assets/widget.js`;
    script.async = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Could not load the captcha.')));
    document.head.append(script);
  });
  return widgetScript;
}

export function mountCapWidget(container) {
  let widget = null;
  if (!container) return { reset: () => {} };
  loadCapWidget()
    .then(() => {
      widget = document.createElement('cap-widget');
      widget.setAttribute('data-cap-api-endpoint', `${STATIONS_BASE}/cap/`);
      container.replaceChildren(widget);
    })
    .catch(() => { /* the submit path reports the missing token */ });
  return {
    reset: () => { try { widget?.reset?.(); } catch { /* ignore */ } },
  };
}
