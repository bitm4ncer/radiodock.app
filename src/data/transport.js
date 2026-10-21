// Shared fetch transport: a single timeout-and-abort-link helper reused by the
// Stations API client. Aborts on a timeout or when the caller's signal aborts,
// and always clears the timer and listener so neither leaks after the call.

const DEFAULT_TIMEOUT_MS = 12000;

export async function fetchWithTimeout(url, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, init = {} } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
