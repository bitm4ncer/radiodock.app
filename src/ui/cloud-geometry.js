import { CLOUD_3D_AXES, CLOUD_DEFAULT_2D_AXES, CLOUD_DIMENSIONS } from './cloud-genre-map.js';

const FALLBACK_MIN = 6;
const FALLBACK_MAX = 94;
const DIMENSION_KEYS = Object.keys(CLOUD_DIMENSIONS);

export const CLOUD_SCENE_SCALE = 260;
export const CLOUD_FOCAL_LENGTH = 900;
export const CLOUD_NEAR_PLANE = 120;
export const CLOUD_MIN_DISTANCE = 420;
export const CLOUD_MAX_DISTANCE = 8000;
export const CLOUD_MIN_PITCH = -1.35;
export const CLOUD_MAX_PITCH = 1.35;
export const CLOUD_AXIS_EXTENT = 300;
export const CLOUD_RELAX_ITERATIONS = 180;
export const CLOUD_RELAX_MIN_DISTANCE = 0.22;
export const CLOUD_RELAX_ANCHOR = 0.035;

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

export function cloudStageDescription(mode, axes2d) {
  if (mode === '3d') {
    const x = CLOUD_DIMENSIONS[CLOUD_3D_AXES.x];
    const y = CLOUD_DIMENSIONS[CLOUD_3D_AXES.y];
    const z = CLOUD_DIMENSIONS[CLOUD_3D_AXES.z];
    return `Collection cloud in 3D. X axis ${x.label}, ${x.labels[0]} to ${x.labels[1]}. Y axis ${y.label}, ${y.labels[0]} to ${y.labels[1]}. Z axis ${z.label}, ${z.labels[0]} to ${z.labels[1]}. Drag to orbit, scroll or pinch to zoom, click a collection to open it.`;
  }
  const axes = normaliseCloudAxes(axes2d);
  const x = CLOUD_DIMENSIONS[axes.x];
  const y = CLOUD_DIMENSIONS[axes.y];
  return `Collection cloud. X axis ${x.label}, ${x.labels[0]} to ${x.labels[1]}. Y axis ${y.label}, ${y.labels[0]} to ${y.labels[1]}. Drag to pan, scroll to zoom, click a collection.`;
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

export function relaxCloudPoints(points) {
  const source = (Array.isArray(points) ? points : []).map((point) => ({
    x: clamp(finiteOr(point?.x, 0), -1, 1),
    y: clamp(finiteOr(point?.y, 0), -1, 1),
    z: clamp(finiteOr(point?.z, 0), -1, 1),
  }));
  const result = source.map((point) => ({ ...point }));
  if (result.length < 2) return result;

  for (let iteration = 0; iteration < CLOUD_RELAX_ITERATIONS; iteration += 1) {
    for (let first = 0; first < result.length; first += 1) {
      for (let second = first + 1; second < result.length; second += 1) {
        const a = result[first];
        const b = result[second];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dz = b.z - a.z;
        let distance = Math.hypot(dx, dy, dz);
        if (distance < 0.0001) {
          const seed = (first + 1) * 12.9898 + (second + 1) * 78.233;
          dx = Math.sin(seed) || 0.001;
          dy = Math.cos(seed * 1.37) || 0.001;
          dz = Math.sin(seed * 0.73) || 0.001;
          distance = Math.hypot(dx, dy, dz);
        }
        if (distance >= CLOUD_RELAX_MIN_DISTANCE) continue;
        const push = (CLOUD_RELAX_MIN_DISTANCE - distance) * 0.5;
        const nx = dx / distance;
        const ny = dy / distance;
        const nz = dz / distance;
        a.x -= nx * push;
        a.y -= ny * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.y += ny * push;
        b.z += nz * push;
      }
    }
    for (let index = 0; index < result.length; index += 1) {
      const point = result[index];
      point.x += (source[index].x - point.x) * CLOUD_RELAX_ANCHOR;
      point.y += (source[index].y - point.y) * CLOUD_RELAX_ANCHOR;
      point.z += (source[index].z - point.z) * CLOUD_RELAX_ANCHOR;
      point.x = clamp(point.x, -1.08, 1.08);
      point.y = clamp(point.y, -1.08, 1.08);
      point.z = clamp(point.z, -1.08, 1.08);
    }
  }

  const maxAbs = Math.max(
    0.0001,
    ...result.flatMap((point) => [Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)]),
  );
  for (const point of result) {
    point.x /= maxAbs;
    point.y /= maxAbs;
    point.z /= maxAbs;
  }
  return result;
}

function targetCoordinate(target, key) {
  return clamp(finiteOr(target?.[key], 0), -4, 4);
}

export function projectCloudPoint(point, orbit, viewport, target = null) {
  const camera = clampCloudOrbit(orbit);
  const width = Math.max(0, finiteOr(viewport?.width, 1));
  const height = Math.max(0, finiteOr(viewport?.height, 1));
  const centerX = width / 2;
  const centerY = height / 2;
  const targetX = targetCoordinate(target, 'x');
  const targetY = targetCoordinate(target, 'y');
  const targetZ = targetCoordinate(target, 'z');

  const x = clamp(finiteOr(point?.x, 0) - targetX, -4, 4) * CLOUD_SCENE_SCALE;
  const y = clamp(finiteOr(point?.y, 0) - targetY, -4, 4) * CLOUD_SCENE_SCALE;
  const z = clamp(finiteOr(point?.z, 0) - targetZ, -4, 4) * CLOUD_SCENE_SCALE;

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

export function projectCloudAxis(axis, orbit, viewport, target = null) {
  const dimensions = {
    x: { point: { x: 1, y: 0, z: 0 }, labels: CLOUD_DIMENSIONS[CLOUD_3D_AXES.x].labels },
    y: { point: { x: 0, y: 1, z: 0 }, labels: CLOUD_DIMENSIONS[CLOUD_3D_AXES.y].labels },
    z: { point: { x: 0, y: 0, z: 1 }, labels: CLOUD_DIMENSIONS[CLOUD_3D_AXES.z].labels },
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
      }, orbit, viewport, target),
      label: chosen.labels[0],
    },
    end: {
      ...projectCloudPoint({
        x: direction.x * extent,
        y: direction.y * extent,
        z: direction.z * extent,
      }, orbit, viewport, target),
      label: chosen.labels[1],
    },
  };
}
