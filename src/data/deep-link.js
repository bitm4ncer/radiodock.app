const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function stationUuidFromSearch(search) {
  const value = new URLSearchParams(search).get('station');
  if (!value) return null;
  const uuid = value.trim();
  return UUID_RE.test(uuid) ? uuid : null;
}

export function withoutStationParam(search) {
  const params = new URLSearchParams(search);
  params.delete('station');
  const next = params.toString();
  return next ? `?${next}` : '';
}
