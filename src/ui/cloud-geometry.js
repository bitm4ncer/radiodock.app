import { CLOUD_DEFAULT_2D_AXES, CLOUD_DIMENSIONS } from './cloud-genre-map.js';

const FALLBACK_MIN = 6;
const FALLBACK_MAX = 94;
const DIMENSION_KEYS = Object.keys(CLOUD_DIMENSIONS);

export const CLOUD_SCENE_SCALE = 260;
export const CLOUD_FOCAL_LENGTH = 900;
export const CLOUD_NEAR_PLANE = 120;
export const CLOUD_MIN_DISTANCE = 420;
export const CLOUD_MAX_DISTANCE = 2600;
export const CLOUD_MIN_PITCH = -1.35;
export const CLOUD_MAX_PITCH = 1.35;
export const CLOUD_AXIS_EXTENT = 300;

export const DEFAULT_CLOUD_ORBIT = Object.freeze({
  yaw: -0.42,
  pitch: 0.3,
  distance: 1100,
});

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

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function wrapAngle(value) {
  if (value >= -Math.PI && value < Math.PI) return value;
  const fullTurn = Math.PI * 2;
  return ((value + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
}

export function clampCloudOrbit(orbit) {
  return {
    yaw: Number.isFinite(orbit?.yaw)
      ? wrapAngle(orbit.yaw)
      : DEFAULT_CLOUD_ORBIT.yaw,
    pitch: clamp(
      finiteOr(orbit?.pitch, DEFAULT_CLOUD_ORBIT.pitch),
      CLOUD_MIN_PITCH,
      CLOUD_MAX_PITCH,
    ),
    distance: clamp(
      finiteOr(orbit?.distance, DEFAULT_CLOUD_ORBIT.distance),
      CLOUD_MIN_DISTANCE,
      CLOUD_MAX_DISTANCE,
    ),
  };
}

export function projectCloudPoint(point, orbit, viewport) {
  const camera = clampCloudOrbit(orbit);
  const width = Math.max(0, finiteOr(viewport?.width, 1));
  const height = Math.max(0, finiteOr(viewport?.height, 1));
  const centerX = width / 2;
  const centerY = height / 2;

  const x = clamp(finiteOr(point?.x, 0), -4, 4) * CLOUD_SCENE_SCALE;
  const y = clamp(finiteOr(point?.y, 0), -4, 4) * CLOUD_SCENE_SCALE;
  const z = clamp(finiteOr(point?.z, 0), -4, 4) * CLOUD_SCENE_SCALE;

  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const yawX = x * cosYaw + z * sinYaw;
  const yawZ = -x * sinYaw + z * cosYaw;
  const cosPitch = Math.cos(camera.pitch);
  const sinPitch = Math.sin(camera.pitch);
  const pitchY = y * cosPitch - yawZ * sinPitch;
  const pitchZ = y * sinPitch + yawZ * cosPitch;

  const depth = camera.distance - pitchZ;
  if (!(depth > CLOUD_NEAR_PLANE)) {
    return { x: centerX, y: centerY, depth: CLOUD_NEAR_PLANE, scale: 0, visible: false };
  }
  const perspective = CLOUD_FOCAL_LENGTH / depth;
  return {
    x: centerX + yawX * perspective,
    y: centerY - pitchY * perspective,
    depth,
    scale: clamp(perspective, 0.15, 3),
    visible: true,
  };
}

export function projectCloudAxis(axis, orbit, viewport) {
  const dimensions = {
    x: { point: { x: 1, y: 0, z: 0 }, labels: CLOUD_DIMENSIONS.electronic.labels },
    y: { point: { x: 0, y: 1, z: 0 }, labels: CLOUD_DIMENSIONS.energy.labels },
    z: { point: { x: 0, y: 0, z: 1 }, labels: CLOUD_DIMENSIONS.mood.labels },
  };
  const chosen = dimensions[axis] ?? dimensions.x;
  const extent = CLOUD_AXIS_EXTENT / CLOUD_SCENE_SCALE;
  const direction = chosen.point;
  return {
    axis: dimensions[axis] ? axis : 'x',
    start: {
      ...projectCloudPoint({
        x: -direction.x * extent,
        y: -direction.y * extent,
        z: -direction.z * extent,
      }, orbit, viewport),
      label: chosen.labels[0],
    },
    end: {
      ...projectCloudPoint({
        x: direction.x * extent,
        y: direction.y * extent,
        z: direction.z * extent,
      }, orbit, viewport),
      label: chosen.labels[1],
    },
  };
}
