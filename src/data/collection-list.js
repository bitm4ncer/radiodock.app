// Naming and id helpers for collections saved as personal station lists.
//
// A collection keeps a stable id derived from its slug. That makes repeated
// saves idempotent and lets the UI show the saved state even after the user
// renames the list.

export function collectionListId(slug) {
  const safe = String(slug ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `list_collection_${safe || 'untitled'}`;
}

export function uniqueListName(title, existingNames = []) {
  const base = String(title ?? '').trim().slice(0, 50) || 'Collection';
  const taken = new Set(
    existingNames
      .map((name) => String(name ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
  if (!taken.has(base.toLowerCase())) return base;
  for (let index = 2; index < 100; index += 1) {
    const suffix = ` (${index})`;
    const candidate = `${base.slice(0, 50 - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base.slice(0, 43).trimEnd()} (copy)`;
}
