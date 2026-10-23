import { CLOUD_DEFAULT_2D_AXES, CLOUD_DIMENSIONS } from './cloud-genre-map.js';

const FALLBACK_MIN = 6;
const FALLBACK_MAX = 94;
const DIMENSION_KEYS = Object.keys(CLOUD_DIMENSIONS);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function fallbackSample(slug, dimension) {
  const hash = hashString(`${dimension}\0${String(slug ?? '')}`);
  return FALLBACK_MIN + (hash / 0xffffffff) * (FALLBACK_MAX - FALLBACK_MIN);
}

export function fallbackVectorForSlug(slug) {
  return {
    family: 'other',
    electronic: fallbackSample(slug, 'electronic'),
    energy: fallbackSample(slug, 'energy'),
    era: fallbackSample(slug, 'era'),
    mood: fallbackSample(slug, 'mood'),
  };
}

export function normaliseCloudVector(slug, vector) {
  const fallback = fallbackVectorForSlug(slug);
  const result = {
    family: typeof vector?.family === 'string' && vector.family.trim()
      ? vector.family
      : fallback.family,
  };
  for (const dimension of DIMENSION_KEYS) {
    result[dimension] = Number.isFinite(vector?.[dimension])
      ? clamp(vector[dimension], 0, 100)
      : fallback[dimension];
  }
  return result;
}

export function axisPairKey(x, y) {
  return `${x}:${y}`;
}

export function normaliseCloudAxes(axes) {
  const x = axes?.x;
  const y = axes?.y;
  if (!CLOUD_DIMENSIONS[x] || !CLOUD_DIMENSIONS[y] || x === y) {
    return { ...CLOUD_DEFAULT_2D_AXES };
  }
  return { x, y };
}

export function assignCloudAxis(current, targetAxis, dimension) {
  const axes = normaliseCloudAxes(current);
  if ((targetAxis !== 'x' && targetAxis !== 'y') || !CLOUD_DIMENSIONS[dimension]) return axes;
  const otherAxis = targetAxis === 'x' ? 'y' : 'x';
  if (axes[otherAxis] === dimension) {
    return { ...axes, [targetAxis]: dimension, [otherAxis]: axes[targetAxis] };
  }
  return { ...axes, [targetAxis]: dimension };
}
