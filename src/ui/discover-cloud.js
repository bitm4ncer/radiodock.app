import { renderLogoSlot } from './station-logo.js';
import { formatCount } from './stations-format.js';
import {
  CLOUD_AXIS_PRESETS,
  CLOUD_GENRE_EDGES,
  CLOUD_GENRE_VECTORS,
  projectVector,
} from './cloud-genre-map.js';
import { collectionNoteFor } from './collection-notes.js';

const PADDING = 180;
const CLEARANCE = 56;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const RELAX_ITERATIONS = 380;
const REPULSION_RADIUS = 520;
const REPULSION_STRENGTH = 2.8;
const ANCHOR_PULL = 0.008;
const RADIUS_MIN = 80;
const RADIUS_MAX = 190;
const RADIUS_COUNT_MIN = 5;
const RADIUS_COUNT_MAX = 55;
const BASE_ZOOM = 3.2;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function fallbackVector(index) {
  const angle = index * GOLDEN_ANGLE;
  const distance = 34 * Math.sqrt(index + 0.5);
  return {
    family: 'other',
    energy: clamp(50 + Math.sin(angle) * distance, 6, 94),
    electronic: clamp(50 + Math.cos(angle) * distance, 6, 94),
    era: clamp(50 + Math.sin(angle + 2.1) * distance * 0.7, 6, 94),
  };
}

function relaxLayout(nodes, preset) {
  const anchors = nodes.map((node) => projectVector(node.vector, preset));
  const points = anchors.map((point) => ({ x: point.x, y: point.y }));
  for (let iteration = 0; iteration < RELAX_ITERATIONS; iteration += 1) {
    for (let first = 0; first < points.length; first += 1) {
      for (let second = first + 1; second < points.length; second += 1) {
        const a = points[first];
        const b = points[second];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.0001) {
          dx = 0.0001;
          dy = 0.0001;
          distance = Math.hypot(dx, dy);
        }
        const nx = dx / distance;
        const ny = dy / distance;
        if (distance < REPULSION_RADIUS) {
          const push = (1 - distance / REPULSION_RADIUS) * REPULSION_STRENGTH;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        }
        const minimum = nodes[first].radius + nodes[second].radius + CLEARANCE;
        if (distance < minimum) {
          const push = (minimum - distance) / 2 + 0.001;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        }
      }
    }
    for (let index = 0; index < points.length; index += 1) {
      points[index].x += (anchors[index].x - points[index].x) * ANCHOR_PULL;
      points[index].y += (anchors[index].y - points[index].y) * ANCHOR_PULL;
    }
  }
  for (let iteration = 0; iteration < 80; iteration += 1) {
    for (let first = 0; first < points.length; first += 1) {
      for (let second = first + 1; second < points.length; second += 1) {
        const a = points[first];
        const b = points[second];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        const minimum = nodes[first].radius + nodes[second].radius + CLEARANCE;
        if (distance >= minimum) continue;
        if (distance < 0.0001) {
          dx = 0.0001;
          dy = 0.0001;
          distance = Math.hypot(dx, dy);
        }
        const nx = dx / distance;
        const ny = dy / distance;
        const push = (minimum - distance) / 2 + 0.001;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }
    }
  }
  return points;
}

function normaliseList(list) {
  if (!list || typeof list !== 'object') return null;
  const slug = typeof list.slug === 'string' ? list.slug.trim() : '';
  const title = typeof list.title === 'string' ? list.title.trim() : '';
  if (!slug || !title || !Array.isArray(list.stations) || !list.stations.length) return null;
  return { slug, title, stations: list.stations, info: list.info ?? null };
}

function radiusForCount(count) {
  const span = Math.sqrt(RADIUS_COUNT_MAX) - Math.sqrt(RADIUS_COUNT_MIN);
  const progress = (Math.sqrt(count) - Math.sqrt(RADIUS_COUNT_MIN)) / span;
  return RADIUS_MIN + Math.min(1, Math.max(0, progress)) * (RADIUS_MAX - RADIUS_MIN);
}

function nodeTier(count) {
  if (count >= 40) return 'is-major';
  if (count >= 20) return 'is-mid';
  return 'is-minor';
}

export function buildCloudModel(lists = []) {
  const nodes = [];
  for (const raw of Array.isArray(lists) ? lists : []) {
    const list = normaliseList(raw);
    if (!list) continue;
    const count = list.stations.length;
    const radius = radiusForCount(count);
    const previewCount = Math.min(8, Math.max(5, count));
    const previewStations = list.stations.slice(0, previewCount);
    const preview = previewStations.map((station, index) => {
      const angle = (index / previewStations.length) * Math.PI * 2 - Math.PI / 2;
      return {
        station,
        x: Math.cos(angle) * radius * 0.42,
        y: Math.sin(angle) * radius * 0.42,
        size: clamp(radius * 0.32, 16, 54),
      };
    });
    const vector = CLOUD_GENRE_VECTORS[list.slug] ?? fallbackVector(nodes.length);
    nodes.push({
      slug: list.slug,
      title: list.title,
      count,
      stations: list.stations,
      preview,
      radius,
      vector,
      family: vector.family,
      info: collectionNoteFor(list),
      layouts: {},
      x: 0,
      y: 0,
    });
  }

  for (const preset of Object.values(CLOUD_AXIS_PRESETS)) {
    const points = relaxLayout(nodes, preset);
    nodes.forEach((node, index) => {
      node.layouts[preset.key] = points[index];
    });
  }

  const initial = CLOUD_AXIS_PRESETS.vibe;
  for (const node of nodes) {
    node.x = node.layouts[initial.key].x;
    node.y = node.layouts[initial.key].y;
  }

  const nodeBySlug = new Map();
  const stationByUuid = new Map();
  for (const node of nodes) {
    nodeBySlug.set(node.slug, node);
    for (const station of node.stations) {
      const uuid = station?.stationuuid ?? station?.uuid ?? station?.id;
      if (uuid && !stationByUuid.has(uuid)) stationByUuid.set(uuid, { station, node });
    }
  }

  const edges = [];
  const edgeKeys = new Set();
  const presentSlugs = new Set(nodes.map((node) => node.slug));
  for (const [first, second] of CLOUD_GENRE_EDGES) {
    if (first === second || !presentSlugs.has(first) || !presentSlugs.has(second)) continue;
    const a = first < second ? first : second;
    const b = first < second ? second : first;
    const key = `${a}|${b}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ a, b });
  }

  if (!nodes.length) {
    return {
      nodes,
      edges,
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
      nodeBySlug,
      stationByUuid,
    };
  }

  const points = [];
  for (const node of nodes) {
    for (const layout of Object.values(node.layouts)) {
      points.push({ x: layout.x, y: layout.y, radius: node.radius });
    }
  }
  const minX = Math.min(...points.map((point) => point.x - point.radius));
  const maxX = Math.max(...points.map((point) => point.x + point.radius));
  const minY = Math.min(...points.map((point) => point.y - point.radius));
  const maxY = Math.max(...points.map((point) => point.y + point.radius));
  const bounds = {
    minX: minX - PADDING,
    minY: minY - PADDING,
    maxX: maxX + PADDING,
    maxY: maxY + PADDING,
    width: maxX - minX + PADDING * 2,
    height: maxY - minY + PADDING * 2,
  };

  return { nodes, edges, bounds, nodeBySlug, stationByUuid };
}

export function ringLayout(count, { radius = 170, gap = 58, startAngle = -Math.PI / 2 } = {}) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  if (!total) return [];
  const ringCount = total <= 18 ? 1 : total <= 36 ? 2 : 3;
  const base = Math.floor(total / ringCount);
  const remainder = total % ringCount;
  const sizes = Array.from({ length: ringCount }, (_, index) => base + (index < remainder ? 1 : 0));
  const points = [];
  let index = 0;
  for (let ring = 0; ring < ringCount; ring += 1) {
    const amount = sizes[ring];
    const step = (Math.PI * 2) / amount;
    const start = startAngle + (ring % 2 ? step / 2 : 0);
    const ringRadius = radius + ring * gap;
    for (let position = 0; position < amount; position += 1) {
      const angle = start + position * step;
      points.push({
        index,
        x: Math.cos(angle) * ringRadius,
        y: Math.sin(angle) * ringRadius,
        ring,
      });
      index += 1;
    }
  }
  return points;
}

export function matchCloud(model, query, { collectionLimit = 6, stationLimit = 12 } = {}) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return { collections: [], stations: [], collectionTotal: 0, stationTotal: 0 };

  const collections = [];
  const stations = [];
  const seen = new Set();
  for (const node of model?.nodes ?? []) {
    if (String(node.title ?? '').toLowerCase().includes(needle)
      || String(node.slug ?? '').toLowerCase().includes(needle)) {
      collections.push({ slug: node.slug, title: node.title, count: node.count });
    }
    for (const station of node.stations ?? []) {
      const name = String(station?.name ?? '');
      if (!name.toLowerCase().includes(needle)) continue;
      const uuid = station.stationuuid ?? station.uuid ?? station.id;
      if (!uuid || seen.has(uuid)) continue;
      seen.add(uuid);
      stations.push({
        stationuuid: uuid,
        name: station.name,
        countrycode: station.countrycode ?? '',
        collectionSlug: node.slug,
        collectionTitle: node.title,
      });
    }
  }

  const collectionMax = Math.max(0, collectionLimit);
  const stationMax = Math.max(0, stationLimit);
  return {
    collections: collections.slice(0, collectionMax),
    stations: stations.slice(0, stationMax),
    collectionTotal: collections.length,
    stationTotal: stations.length,
  };
}

function logoElement(station, options) {
  const wrapper = document.createElement('span');
  wrapper.innerHTML = renderLogoSlot(station, options);
  return wrapper.firstElementChild;
}

function hydrateLogoSlot(slot) {
  if (!slot || slot.dataset.logoHydrated === '1') return;
  slot.dataset.logoHydrated = '1';
  const image = slot.querySelector('[data-logo-img]');
  const fallback = slot.querySelector('[data-logo-fallback]');
  if (!image) {
    fallback?.classList.remove('is-hidden');
    return;
  }
  const showImage = () => {
    slot.classList.add('is-loaded');
    fallback?.classList.add('is-hidden');
  };
  const showFallback = () => {
    slot.classList.remove('is-loaded');
    fallback?.classList.remove('is-hidden');
  };
  image.addEventListener('load', showImage, { once: true });
  image.addEventListener('error', showFallback, { once: true });
  if (image.complete) {
    if (image.naturalWidth > 0) showImage();
    else showFallback();
  }
}

function hydrateLogos(root) {
  root.querySelectorAll('[data-logo-slot]').forEach(hydrateLogoSlot);
}

export function mountDiscoverCloud(host, { lists = [], nowPlayingId = null, onPlay = async () => false, playerCard = null } = {}) {
  const model = buildCloudModel(lists);
  const neighbors = new Map();
  for (const edge of model.edges) {
    if (!neighbors.has(edge.a)) neighbors.set(edge.a, new Set());
    if (!neighbors.has(edge.b)) neighbors.set(edge.b, new Set());
    neighbors.get(edge.a).add(edge.b);
    neighbors.get(edge.b).add(edge.a);
  }
  let destroyed = false;
  let fitScale = 0;
  let camera = { scale: 1, tx: 0, ty: 0 };
  let overviewCamera = null;
  let ring = null;
  let noteEl = null;
  let resultsEl = null;
  let tooltip = null;
  let highlightTimer = null;
  let suppressTimer = null;
  let fitTimer = null;
  const flashTimers = new Set();
  let cameraFrame = 0;
  let axis = CLOUD_AXIS_PRESETS.vibe.key;
  let axisFrame = 0;
  let labelFrame = 0;
  let axisControl = null;
  let axisX = null;
  let axisY = null;
  let axisXStart = null;
  let axisXEnd = null;
  let axisYStart = null;
  let axisYEnd = null;
  const axisButtons = new Map();
  let suppressClick = false;
  let dragMoved = false;
  let dragStart = null;
  let dragDistance = 0;
  let pinch = null;
  let resizeObserver = null;
  let playerDock = null;
  let playerOrigin = null;
  let fullscreenButton = null;
  const pointers = new Map();

  host.classList.add('stations-cloud');
  host.innerHTML = '';

  const stage = document.createElement('div');
  stage.className = 'stations-cloud-stage';
  stage.setAttribute('role', 'region');
  stage.setAttribute('aria-label', 'Collection cloud. Drag to pan, scroll to zoom, click a collection.');

  const world = document.createElement('div');
  world.className = 'stations-cloud-world';

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.classList.add('stations-cloud-links');
  svg.setAttribute('aria-hidden', 'true');
  if (model.nodes.length) {
    svg.setAttribute('viewBox', `0 0 ${model.bounds.width} ${model.bounds.height}`);
    svg.style.left = `${model.bounds.minX}px`;
    svg.style.top = `${model.bounds.minY}px`;
    svg.style.width = `${model.bounds.width}px`;
    svg.style.height = `${model.bounds.height}px`;
    const defs = document.createElementNS(svgNS, 'defs');
    const gradient = document.createElementNS(svgNS, 'linearGradient');
    gradient.setAttribute('id', 'stationsCloudLinkGradient');
    gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
    gradient.setAttribute('x1', '0');
    gradient.setAttribute('y1', '0');
    gradient.setAttribute('x2', String(model.bounds.width));
    gradient.setAttribute('y2', String(model.bounds.height));
    for (const [offset, variable] of [[0, '--cloud-link-a'], [0.52, '--cloud-link-b'], [1, '--cloud-link-c']]) {
      const stop = document.createElementNS(svgNS, 'stop');
      stop.setAttribute('offset', `${offset * 100}%`);
      stop.setAttribute('stop-color', `var(${variable})`);
      gradient.append(stop);
    }
    defs.append(gradient);
    svg.append(defs);
  }
  function edgePath(first, second) {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const distance = Math.max(0.0001, Math.hypot(dx, dy));
    const ux = dx / distance;
    const uy = dy / distance;
    const gap = 4;
    const x1 = first.x + ux * gap - model.bounds.minX;
    const y1 = first.y + uy * gap - model.bounds.minY;
    const x2 = second.x - ux * gap - model.bounds.minX;
    const y2 = second.y - uy * gap - model.bounds.minY;
    const chord = Math.max(0.0001, Math.hypot(x2 - x1, y2 - y1));
    const handle = Math.min(chord * 0.42, 240);
    const bend = Math.min(chord * 0.16, 64);
    const nx = -uy;
    const ny = ux;
    const c1x = x1 + ux * handle + nx * bend;
    const c1y = y1 + uy * handle + ny * bend;
    const c2x = x2 - ux * handle - nx * bend;
    const c2y = y2 - uy * handle - ny * bend;
    return `M ${x1} ${y1} C ${c1x} ${c1y} ${c2x} ${c2y} ${x2} ${y2}`;
  }

  const linkElements = [];
  for (const edge of model.edges) {
    const first = model.nodeBySlug.get(edge.a);
    const second = model.nodeBySlug.get(edge.b);
    if (!first || !second) continue;
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('class', 'stations-cloud-link');
    path.setAttribute('d', edgePath(first, second));
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    path.style.strokeWidth = (2.6 + Math.min(1.2, Math.min(first.count, second.count) / 55)).toFixed(2);
    path.dataset.a = edge.a;
    path.dataset.b = edge.b;
    svg.append(path);
    linkElements.push(path);
  }

  function updateLinkPaths() {
    for (const path of linkElements) {
      const first = model.nodeBySlug.get(path.dataset.a);
      const second = model.nodeBySlug.get(path.dataset.b);
      if (first && second) path.setAttribute('d', edgePath(first, second));
    }
  }

  const nodeElements = new Map();
  const labelElements = [];

  world.append(svg);

  function miniPosition(node, station, stationIndex, count) {
    const key = String(station?.stationuuid ?? station?.uuid ?? station?.id ?? station?.name ?? stationIndex);
    let hash = 2166136261;
    for (let i = 0; i < key.length; i += 1) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const jitter = ((hash >>> 0) % 997) / 997;
    const angle = stationIndex * GOLDEN_ANGLE + jitter * 0.8;
    const maxRadius = node.radius * 0.78;
    const radius = Math.sqrt((stationIndex + 0.55) / count) * maxRadius + (jitter - 0.5) * maxRadius * 0.12;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      size: clamp(node.radius * 0.24, 16, 34),
    };
  }

  function ensureMiniCloud(node, button) {
    const bubble = button.querySelector('.stations-cloud-bubble');
    let layer = bubble?.querySelector('.stations-cloud-mini-layer');
    if (layer) return layer;
    if (!bubble || !node.stations?.length) return null;
    layer = document.createElement('span');
    layer.className = 'stations-cloud-mini-layer is-preparing';
    layer.setAttribute('aria-hidden', 'true');
    const count = node.stations.length;
    const previewCount = node.preview.length;
    node.stations.slice(previewCount).forEach((station, offset) => {
      const stationIndex = previewCount + offset;
      const position = miniPosition(node, station, stationIndex, count);
      const logo = logoElement(station, {
        imgClass: 'stations-cloud-mini-logo',
        initialsClass: 'stations-cloud-mini-initials',
        size: 'sm',
        resolveById: true,
        priority: false,
      });
      if (!logo) return;
      const uuid = String(station?.stationuuid ?? station?.uuid ?? station?.id ?? '');
      if (uuid) logo.dataset.uuid = uuid;
      logo.style.left = `calc(50% + ${position.x}px)`;
      logo.style.top = `calc(50% + ${position.y}px)`;
      logo.style.width = `${position.size}px`;
      logo.style.height = `${position.size}px`;
      logo.style.setProperty('--mini-order', String(offset));
      layer.append(logo);
    });
    bubble.append(layer);
    hydrateLogos(layer);
    requestAnimationFrame(() => {
      if (layer.isConnected) layer.classList.remove('is-preparing');
    });
    return layer;
  }

  function expandNode(node, button) {
    ensureMiniCloud(node, button);
    button.classList.add('is-expanded');
  }

  model.nodes.forEach((node, index) => {
    const nodeEl = document.createElement('button');
    nodeEl.type = 'button';
    nodeEl.className = `stations-cloud-node ${nodeTier(node.count)}`;
    nodeEl.dataset.slug = node.slug;
    nodeEl.setAttribute('aria-label', `${node.title}, ${formatCount(node.count)} stations`);
    nodeEl.style.left = `${node.x - node.radius}px`;
    nodeEl.style.top = `${node.y - node.radius}px`;
    nodeEl.style.width = `${node.radius * 2}px`;
    nodeEl.style.height = `${node.radius * 2}px`;
    nodeEl.style.setProperty('--float-delay', `-${(index % 8) * 0.9}s`);

    const bubble = document.createElement('span');
    bubble.className = 'stations-cloud-bubble';
    const previewOrbit = document.createElement('span');
    previewOrbit.className = 'stations-cloud-preview-orbit';
    const orbit = document.createElement('span');
    orbit.className = 'stations-cloud-orbit';
    const hub = document.createElement('span');
    hub.className = 'stations-cloud-hub';
    node.preview.forEach((preview, previewIndex) => {
      const logo = logoElement(preview.station, {
        imgClass: 'stations-cloud-logo',
        initialsClass: 'stations-cloud-initials',
        size: 'sm',
        resolveById: true,
        priority: index < 8,
      });
      if (!logo) return;
      const uuid = String(preview.station?.stationuuid ?? preview.station?.uuid ?? preview.station?.id ?? '');
      if (uuid) logo.dataset.uuid = uuid;
      const target = miniPosition(node, preview.station, previewIndex, node.stations.length);
      logo.style.setProperty('--orbit-left', `calc(50% + ${preview.x}px)`);
      logo.style.setProperty('--orbit-top', `calc(50% + ${preview.y}px)`);
      logo.style.setProperty('--orbit-size', `${preview.size}px`);
      logo.style.setProperty('--mini-left', `calc(50% + ${target.x}px)`);
      logo.style.setProperty('--mini-top', `calc(50% + ${target.y}px)`);
      logo.style.setProperty('--mini-size', `${target.size}px`);
      orbit.append(logo);
    });
    bubble.append(previewOrbit, orbit, hub);

    const label = document.createElement('span');
    label.className = 'stations-cloud-label';
    const title = document.createElement('strong');
    title.textContent = node.title;
    const count = document.createElement('span');
    count.textContent = `${formatCount(node.count)} stations`;
    label.append(title, count);
    labelElements.push(label);

    nodeEl.append(bubble, label);
    nodeEl.addEventListener('click', (evt) => {
      evt.stopPropagation();
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      openCollection(node.slug);
    });
    nodeEl.addEventListener('pointerenter', () => {
      activateNode(node.slug);
      expandNode(node, nodeEl);
    });
    nodeEl.addEventListener('pointerleave', () => {
      activateNode(null);
      nodeEl.classList.remove('is-expanded');
    });
    nodeEl.addEventListener('focus', () => {
      if (nodeEl.matches(':focus-visible')) {
        activateNode(node.slug);
        expandNode(node, nodeEl);
      }
    });
    nodeEl.addEventListener('blur', () => {
      activateNode(null);
      nodeEl.classList.remove('is-expanded');
    });
    world.append(nodeEl);
    nodeElements.set(node.slug, nodeEl);
  });

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'stations-cloud-back';
  back.textContent = 'All collections';
  back.addEventListener('click', (evt) => {
    evt.stopPropagation();
    closeRing();
  });

  const controls = document.createElement('div');
  controls.className = 'stations-cloud-controls';
  const zoomIn = document.createElement('button');
  zoomIn.type = 'button';
  zoomIn.dataset.cloudZoom = 'in';
  zoomIn.textContent = '+';
  zoomIn.setAttribute('aria-label', 'Zoom in');
  zoomIn.title = 'Zoom in';
  const zoomOut = document.createElement('button');
  zoomOut.type = 'button';
  zoomOut.dataset.cloudZoom = 'out';
  zoomOut.textContent = '-';
  zoomOut.setAttribute('aria-label', 'Zoom out');
  zoomOut.title = 'Zoom out';
  const zoomReset = document.createElement('button');
  zoomReset.type = 'button';
  zoomReset.dataset.cloudZoom = 'reset';
  zoomReset.textContent = '↺';
  zoomReset.setAttribute('aria-label', 'Auto view');
  zoomReset.title = 'Auto view';
  zoomIn.addEventListener('click', (evt) => {
    evt.stopPropagation();
    const rect = stage.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.25);
  });
  zoomOut.addEventListener('click', (evt) => {
    evt.stopPropagation();
    const rect = stage.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.8);
  });
  zoomReset.addEventListener('click', (evt) => {
    evt.stopPropagation();
    reset();
  });
  fullscreenButton = document.createElement('button');
  fullscreenButton.type = 'button';
  fullscreenButton.dataset.cloudFullscreen = '1';
  fullscreenButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5"/><path d="M16 3h5v5"/><path d="M8 21H3v-5"/><path d="M21 16v5h-5"/></svg>';
  fullscreenButton.setAttribute('aria-label', 'Enter fullscreen');
  fullscreenButton.title = 'Enter fullscreen';
  fullscreenButton.addEventListener('click', (evt) => {
    evt.stopPropagation();
    toggleFullscreen();
  });
  if (!host.requestFullscreen) fullscreenButton.hidden = true;
  controls.append(zoomIn, zoomOut, zoomReset, fullscreenButton);

  axisControl = document.createElement('div');
  axisControl.className = 'stations-cloud-axes';
  axisControl.setAttribute('role', 'group');
  axisControl.setAttribute('aria-label', 'Cloud axes');
  for (const preset of Object.values(CLOUD_AXIS_PRESETS)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.cloudAxis = preset.key;
    button.textContent = preset.label;
    button.setAttribute('aria-pressed', String(preset.key === axis));
    button.title = `${preset.xLabels[0]} to ${preset.xLabels[1]}, ${preset.yLabels[0]} to ${preset.yLabels[1]}`;
    button.addEventListener('click', (evt) => {
      evt.stopPropagation();
      setAxis(preset.key);
    });
    axisControl.append(button);
    axisButtons.set(preset.key, button);
  }

  axisX = document.createElement('div');
  axisX.className = 'stations-cloud-axis stations-cloud-axis--x';
  axisX.setAttribute('aria-hidden', 'true');
  axisXStart = document.createElement('span');
  axisXEnd = document.createElement('span');
  axisX.append(axisXStart, axisXEnd);

  axisY = document.createElement('div');
  axisY.className = 'stations-cloud-axis stations-cloud-axis--y';
  axisY.setAttribute('aria-hidden', 'true');
  axisYStart = document.createElement('span');
  axisYEnd = document.createElement('span');
  axisY.append(axisYEnd, axisYStart);
  updateAxisLabels();

  const hint = document.createElement('div');
  hint.className = 'stations-cloud-hint';
  hint.textContent = window.matchMedia('(max-width: 699px)').matches
    ? 'Drag to pan. Pinch to zoom. Tap a collection.'
    : 'Drag to pan. Scroll to zoom. Click a collection.';

  resultsEl = document.createElement('div');
  resultsEl.className = 'stations-cloud-results';
  resultsEl.setAttribute('role', 'region');
  resultsEl.setAttribute('aria-label', 'Cloud search results');
  resultsEl.setAttribute('aria-live', 'polite');
  resultsEl.hidden = true;

  tooltip = document.createElement('div');
  tooltip.className = 'stations-cloud-tooltip';
  tooltip.hidden = true;

  stage.append(back, world, axisX, axisY, controls, hint, tooltip, axisControl);
  if (!model.nodes.length) {
    const empty = document.createElement('div');
    empty.className = 'stations-cloud-empty';
    empty.textContent = 'No collections to show yet.';
    stage.append(empty);
  }
  playerDock = document.createElement('div');
  playerDock.className = 'stations-cloud-player';
  playerDock.hidden = true;
  host.append(resultsEl, stage, playerDock);
  hydrateLogos(stage);

  function movePlayerIntoDock() {
    if (!playerCard || playerOrigin || !playerCard.parentElement) return;
    playerOrigin = { parent: playerCard.parentElement, next: playerCard.nextSibling };
    playerCard.classList.add('is-cloud-player');
    playerDock.append(playerCard);
  }

  function restorePlayerFromDock() {
    if (!playerOrigin) return;
    const { parent, next } = playerOrigin;
    playerOrigin = null;
    playerCard.classList.remove('is-cloud-player');
    if (!parent?.isConnected) return;
    if (next && next.parentNode === parent) parent.insertBefore(playerCard, next);
    else parent.append(playerCard);
  }

  function syncFullscreenState() {
    const active = document.fullscreenElement === host;
    if (playerCard) {
      if (active) movePlayerIntoDock();
      else restorePlayerFromDock();
      playerDock.hidden = !active;
    }
    if (!fullscreenButton) return;
    fullscreenButton.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    fullscreenButton.title = active ? 'Exit fullscreen' : 'Enter fullscreen';
    fullscreenButton.innerHTML = active
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h5V3"/><path d="M16 3v5h5"/><path d="M3 16v5h5"/><path d="M21 16h-5v5"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5"/><path d="M16 3h5v5"/><path d="M8 21H3v-5"/><path d="M21 16v5h-5"/></svg>';
  }

  function onFullscreenChange() {
    syncFullscreenState();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement === host) {
      document.exitFullscreen?.()?.catch?.(() => {});
      return;
    }
    if (!host.requestFullscreen) return;
    host.requestFullscreen()?.catch?.(() => {});
  }

  document.addEventListener('fullscreenchange', onFullscreenChange);

  function fitTarget() {
    const width = Math.max(1, stage.clientWidth || host.clientWidth || 1);
    const height = Math.max(1, stage.clientHeight || host.clientHeight || 1);
    if (!model.nodes.length) return { scale: 1, tx: 0, ty: 0 };
    const scale = Math.max(0.0001, Math.min(width / model.bounds.width, height / model.bounds.height) * 0.92);
    return {
      scale,
      tx: width / 2 - (model.bounds.minX + model.bounds.width / 2) * scale,
      ty: height / 2 - (model.bounds.minY + model.bounds.height / 2) * scale,
    };
  }

  function spreadZoom() {
    const nodes = Math.max(1, model.nodes.length);
    const stations = Math.max(1, model.nodes.reduce((sum, node) => sum + node.count, 0));
    const nodeScale = Math.max(1, Math.sqrt(nodes / 35));
    const stationScale = Math.max(1, Math.sqrt(stations / 700));
    return Math.min(5.5, BASE_ZOOM * nodeScale * stationScale);
  }

  function clampScale(value) {
    const base = fitScale > 0 ? fitScale : 0.0001;
    return Math.min(base * 6, Math.max(base * 0.75, value));
  }

  function applyCamera() {
    const scale = Math.max(0.0001, camera.scale);
    world.style.transform = `translate3d(${camera.tx}px, ${camera.ty}px, 0) scale(${scale})`;
    const labelScale = Math.min(8, 1 / scale);
    for (const label of labelElements) label.style.transform = `scale(${labelScale})`;
    if (ring?.label) ring.label.style.transform = `scale(${labelScale})`;
    stage.classList.toggle('is-zoomed', fitScale > 0 && scale >= fitScale * 1.8);
  }

  function applyLabelSide(label, side, gap) {
    label.style.left = '50%';
    label.style.right = 'auto';
    label.style.top = `calc(100% + ${gap}px)`;
    label.style.bottom = 'auto';
    label.style.translate = '-50% 0';
    label.style.transformOrigin = 'top center';
    label.style.textAlign = 'center';
    if (side === 'above') {
      label.style.top = 'auto';
      label.style.bottom = `calc(100% + ${gap}px)`;
      label.style.transformOrigin = 'bottom center';
    } else if (side === 'right') {
      label.style.left = `calc(100% + ${gap}px)`;
      label.style.top = '50%';
      label.style.translate = '0 -50%';
      label.style.transformOrigin = 'left center';
      label.style.textAlign = 'left';
    } else if (side === 'left') {
      label.style.left = 'auto';
      label.style.right = `calc(100% + ${gap}px)`;
      label.style.top = '50%';
      label.style.translate = '0 -50%';
      label.style.transformOrigin = 'right center';
      label.style.textAlign = 'right';
    }
  }

  function overlapArea(rect, others) {
    let area = 0;
    for (const other of others) {
      const width = Math.min(rect.right, other.right) - Math.max(rect.left, other.left);
      const height = Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top);
      if (width > 0 && height > 0) area += width * height;
    }
    return area;
  }

  function layoutOverviewLabels() {
    if (destroyed) return;
    const stageRect = stage.getBoundingClientRect();
    const keepOut = [axisControl, controls, hint, back, axisX, axisY]
      .filter((element) => element && !element.hidden)
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }));
    const placed = [...keepOut];
    const nodes = [...model.nodes].sort((a, b) => (
      b.count - a.count || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)
    ));
    let fallbackCount = 0;
    for (const node of nodes) {
      const element = nodeElements.get(node.slug);
      const label = element?.querySelector('.stations-cloud-label');
      if (!label) continue;
      const nodeRect = element.getBoundingClientRect();
      const measured = label.getBoundingClientRect();
      const width = Math.max(1, measured.width);
      const height = Math.max(1, measured.height);
      const centerX = nodeRect.left + nodeRect.width / 2;
      const centerY = nodeRect.top + nodeRect.height / 2;
      const sides = [
        { side: 'below', gap: 6, x: centerX - width / 2, y: nodeRect.bottom + 6 },
        { side: 'above', gap: 6, x: centerX - width / 2, y: nodeRect.top - 6 - height },
        { side: 'right', gap: 6, x: nodeRect.right + 6, y: centerY - height / 2 },
        { side: 'left', gap: 6, x: nodeRect.left - 6 - width, y: centerY - height / 2 },
        { side: 'below', gap: 24, x: centerX - width / 2, y: nodeRect.bottom + 24 },
        { side: 'above', gap: 24, x: centerX - width / 2, y: nodeRect.top - 24 - height },
        { side: 'right', gap: 24, x: nodeRect.right + 24, y: centerY - height / 2 },
        { side: 'left', gap: 24, x: nodeRect.left - 24 - width, y: centerY - height / 2 },
      ];
      const candidates = sides.map((candidate) => {
        const rect = {
          left: candidate.x,
          right: candidate.x + width,
          top: candidate.y,
          bottom: candidate.y + height,
        };
        const inside = (
          rect.left >= stageRect.left + 3
          && rect.right <= stageRect.right - 3
          && rect.top >= stageRect.top + 3
          && rect.bottom <= stageRect.bottom - 3
        );
        const overlaps = placed.filter((other) => (
          rect.left < other.right + 4
          && rect.right > other.left - 4
          && rect.top < other.bottom + 4
          && rect.bottom > other.top - 4
        )).length;
        return { ...candidate, rect, inside, overlaps, area: overlapArea(rect, placed) };
      });
      const best = candidates.find((candidate) => candidate.inside && candidate.overlaps === 0)
        ?? candidates.slice().sort((a, b) => (
          Number(b.inside) - Number(a.inside)
          || a.overlaps - b.overlaps
          || a.area - b.area
          || a.gap - b.gap
        ))[0];
      applyLabelSide(label, best.side, best.gap);
      element.classList.add('is-label-visible');
      placed.push(best.rect);
      if (!best.inside || best.overlaps > 0) fallbackCount += 1;
    }
    stage.dataset.cloudLabels = String(nodes.length);
    stage.dataset.cloudLabelFallbacks = String(fallbackCount);
  }

  function scheduleLabelLayout() {
    cancelAnimationFrame(labelFrame);
    labelFrame = requestAnimationFrame(() => {
      labelFrame = 0;
      layoutOverviewLabels();
    });
  }

  function fitCamera({ spread = false } = {}) {
    const target = fitTarget();
    fitScale = target.scale;
    if (spread && model.nodes.length) {
      const width = Math.max(1, stage.clientWidth || host.clientWidth || 1);
      const height = Math.max(1, stage.clientHeight || host.clientHeight || 1);
      const scale = clampScale(fitScale * spreadZoom());
      camera = {
        scale,
        tx: width / 2 - (model.bounds.minX + model.bounds.width / 2) * scale,
        ty: height / 2 - (model.bounds.minY + model.bounds.height / 2) * scale,
      };
    } else {
      camera = { ...target };
    }
    applyCamera();
    scheduleLabelLayout();
  }

  function updateAxisLabels() {
    const preset = CLOUD_AXIS_PRESETS[axis];
    if (!preset) return;
    axisXStart.textContent = preset.xLabels[0];
    axisXEnd.textContent = preset.xLabels[1];
    axisYStart.textContent = preset.yLabels[0];
    axisYEnd.textContent = preset.yLabels[1];
  }

  function snapAxis(key) {
    for (const node of model.nodes) {
      const layout = node.layouts[key];
      if (!layout) continue;
      node.x = layout.x;
      node.y = layout.y;
      const element = nodeElements.get(node.slug);
      if (element) {
        element.style.left = `${node.x - node.radius}px`;
        element.style.top = `${node.y - node.radius}px`;
      }
    }
    updateLinkPaths();
    scheduleLabelLayout();
  }

  function finishAxis() {
    if (!axisFrame) return;
    cancelAnimationFrame(axisFrame);
    axisFrame = 0;
    snapAxis(axis);
  }

  function animateAxis(fromKey, toKey) {
    cancelAnimationFrame(axisFrame);
    axisFrame = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = model.nodes.map((node) => {
      const layout = node.layouts[fromKey];
      return layout ? { x: layout.x, y: layout.y } : { x: node.x, y: node.y };
    });
    const to = model.nodes.map((node) => node.layouts[toKey] ?? { x: node.x, y: node.y });
    if (reduced) {
      snapAxis(toKey);
      return;
    }
    const started = performance.now();
    const duration = 460;
    const step = (now) => {
      if (destroyed) return;
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      model.nodes.forEach((node, index) => {
        node.x = from[index].x + (to[index].x - from[index].x) * eased;
        node.y = from[index].y + (to[index].y - from[index].y) * eased;
        const element = nodeElements.get(node.slug);
        if (element) {
          element.style.left = `${node.x - node.radius}px`;
          element.style.top = `${node.y - node.radius}px`;
        }
      });
      updateLinkPaths();
      if (progress < 1) {
        axisFrame = requestAnimationFrame(step);
      } else {
        axisFrame = 0;
        snapAxis(toKey);
      }
    };
    axisFrame = requestAnimationFrame(step);
  }

  function setAxis(key) {
    if (destroyed || ring || key === axis || !CLOUD_AXIS_PRESETS[key]) return;
    const previous = axis;
    axis = key;
    for (const [buttonKey, button] of axisButtons) {
      button.setAttribute('aria-pressed', String(buttonKey === axis));
    }
    updateAxisLabels();
    animateAxis(previous, key);
  }

  function flyTo(target, { animate = true } = {}) {
    const next = {
      scale: Math.max(0.0001, target.scale),
      tx: target.tx,
      ty: target.ty,
    };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduced) {
      camera = next;
      applyCamera();
      scheduleLabelLayout();
      return;
    }
    cancelAnimationFrame(cameraFrame);
    const start = { ...camera };
    const started = performance.now();
    const duration = 420;
    const step = (now) => {
      if (destroyed) return;
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      camera = {
        scale: start.scale + (next.scale - start.scale) * eased,
        tx: start.tx + (next.tx - start.tx) * eased,
        ty: start.ty + (next.ty - start.ty) * eased,
      };
      applyCamera();
      if (progress < 1) {
        cameraFrame = requestAnimationFrame(step);
      } else {
        cameraFrame = 0;
        scheduleLabelLayout();
      }
    };
    cameraFrame = requestAnimationFrame(step);
  }

  function zoomAt(clientX, clientY, factor) {
    const rect = stage.getBoundingClientRect();
    const pointerX = clientX - rect.left;
    const pointerY = clientY - rect.top;
    const nextScale = clampScale(camera.scale * factor);
    const worldX = (pointerX - camera.tx) / camera.scale;
    const worldY = (pointerY - camera.ty) / camera.scale;
    camera.scale = nextScale;
    camera.tx = pointerX - worldX * nextScale;
    camera.ty = pointerY - worldY * nextScale;
    hideTooltip();
    applyCamera();
  }

  function onWheel(evt) {
    if (evt.target.closest('.stations-cloud-results, .stations-cloud-note-panel')) return;
    evt.preventDefault();
    zoomAt(evt.clientX, evt.clientY, Math.exp(-evt.deltaY * 0.0015));
  }

  function onPointerDown(evt) {
    if (evt.button != null && evt.button !== 0) return;
    if (evt.target.closest('.stations-cloud-results, .stations-cloud-note-panel, .stations-cloud-controls, .stations-cloud-axes, .stations-cloud-back')) return;
    pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
    if (pointers.size === 1) {
      dragStart = { x: evt.clientX, y: evt.clientY };
      dragDistance = 0;
      dragMoved = false;
      pinch = null;
    }
    if (pointers.size === 2) {
      pinch = null;
      stage.classList.add('is-dragging');
      for (const id of pointers.keys()) {
        try { stage.setPointerCapture(id); } catch { /* capture is best effort */ }
      }
    }
  }

  function onPointerMove(evt) {
    if (!pointers.has(evt.pointerId)) return;
    const previous = pointers.get(evt.pointerId);
    pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });

    if (pointers.size >= 2) {
      const [first, second] = [...pointers.values()];
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const rect = stage.getBoundingClientRect();
      const midpoint = {
        x: (first.x + second.x) / 2 - rect.left,
        y: (first.y + second.y) / 2 - rect.top,
      };
      if (!pinch) {
        pinch = {
          distance: Math.max(1, distance),
          scale: camera.scale,
          tx: camera.tx,
          ty: camera.ty,
          midpoint,
        };
        return;
      }
      const factor = Math.max(0.2, Math.min(5, distance / pinch.distance));
      const nextScale = clampScale(pinch.scale * factor);
      const worldX = (pinch.midpoint.x - pinch.tx) / pinch.scale;
      const worldY = (pinch.midpoint.y - pinch.ty) / pinch.scale;
      camera.scale = nextScale;
      camera.tx = midpoint.x - worldX * nextScale;
      camera.ty = midpoint.y - worldY * nextScale;
      dragMoved = true;
      hideTooltip();
      applyCamera();
      return;
    }

    if (!dragStart || pinch) return;
    dragDistance = Math.max(dragDistance, Math.hypot(evt.clientX - dragStart.x, evt.clientY - dragStart.y));
    if (dragDistance > 5) {
      dragMoved = true;
      stage.classList.add('is-dragging');
      try { stage.setPointerCapture(evt.pointerId); } catch { /* capture is best effort */ }
      camera.tx += evt.clientX - previous.x;
      camera.ty += evt.clientY - previous.y;
      hideTooltip();
      applyCamera();
    }
  }

  function onPointerUp(evt) {
    pointers.delete(evt.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      if (dragMoved) {
        suppressClick = true;
        clearTimeout(suppressTimer);
        suppressTimer = setTimeout(() => {
          suppressClick = false;
          suppressTimer = null;
        }, 0);
      }
      stage.classList.remove('is-dragging');
      dragStart = null;
      dragDistance = 0;
      dragMoved = false;
    }
    try {
      if (stage.hasPointerCapture?.(evt.pointerId)) stage.releasePointerCapture(evt.pointerId);
    } catch { /* capture is best effort */ }
  }

  function onStageClick(evt) {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (!ring) return;
    if (evt.target.closest('.stations-cloud-node, .stations-cloud-station, .stations-cloud-controls, .stations-cloud-axes, .stations-cloud-axis, .stations-cloud-back, .stations-cloud-results, .stations-cloud-note-panel, .stations-cloud-tooltip')) return;
    closeRing();
  }

  function activateNode(slug) {
    if (stage.classList.contains('is-ring-open')) return;
    const related = slug ? neighbors.get(slug) ?? new Set() : null;
    for (const [key, element] of nodeElements) {
      const active = key === slug;
      const isRelated = !!related?.has(key);
      element.classList.toggle('is-active', active);
      element.classList.toggle('is-related', isRelated);
      element.classList.toggle('is-dimmed', !!slug && !active && !isRelated);
    }
    for (const path of linkElements) {
      const active = !!slug && (path.dataset.a === slug || path.dataset.b === slug);
      path.classList.toggle('is-active', active);
      path.classList.toggle('is-dimmed', !!slug && !active);
    }
  }

  function showTooltip(station, element) {
    if (!tooltip) return;
    const rect = element.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const country = String(station?.countrycode ?? '').trim().toUpperCase();
    tooltip.textContent = `${station?.name ?? 'Station'}${country ? ` · ${country}` : ''}`;
    tooltip.style.left = `${rect.left - stageRect.left + rect.width / 2}px`;
    tooltip.style.top = `${rect.top - stageRect.top - 6}px`;
    tooltip.hidden = false;
  }

  function hideTooltip() {
    if (tooltip) tooltip.hidden = true;
  }

  function hideResults() {
    if (resultsEl) resultsEl.hidden = true;
  }

  function clearCollectionNote() {
    noteEl?.remove();
    noteEl = null;
  }

  function renderCollectionNote(node) {
    clearCollectionNote();
    if (!node?.info?.short) return;
    const panel = document.createElement('div');
    panel.className = 'stations-cloud-note-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', `About ${node.title}`);
    const kicker = document.createElement('span');
    kicker.className = 'stations-cloud-note-kicker';
    kicker.textContent = 'Collection note';
    const title = document.createElement('strong');
    title.className = 'stations-cloud-note-title';
    title.textContent = node.title;
    const text = document.createElement('p');
    text.className = 'stations-cloud-note-text';
    text.id = 'stationsCloudNoteText';
    text.textContent = node.info.long ?? node.info.short;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'stations-cloud-note-toggle';
    toggle.textContent = 'Expand';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', text.id);
    toggle.addEventListener('click', (evt) => {
      evt.stopPropagation();
      const expanded = panel.classList.toggle('is-expanded');
      toggle.textContent = expanded ? 'Collapse' : 'Expand';
      toggle.setAttribute('aria-expanded', String(expanded));
      if (!expanded) panel.scrollTop = 0;
    });
    panel.append(kicker, title, text, toggle);
    stage.append(panel);
    noteEl = panel;
    requestAnimationFrame(() => {
      if (!panel.isConnected) return;
      toggle.hidden = text.scrollHeight <= text.clientHeight + 1;
    });
  }

  function clearRing() {
    clearTimeout(highlightTimer);
    highlightTimer = null;
    clearCollectionNote();
    if (!ring) return;
    for (const item of ring.migratedLogos ?? []) {
      const { logo, parent, styles } = item;
      logo.classList.remove('stations-cloud-ring-logo');
      if (parent?.isConnected) parent.append(logo);
      for (const property of ['left', 'top', 'width', 'height']) {
        if (styles[property]) logo.style[property] = styles[property];
        else logo.style.removeProperty(property);
      }
    }
    ring.element.remove();
    ring = null;
    stage.classList.remove('is-ring-open');
    for (const element of nodeElements.values()) {
      element.classList.remove('is-active', 'is-related', 'is-dimmed', 'is-open', 'is-expanded');
      element.removeAttribute('aria-hidden');
      element.removeAttribute('tabindex');
    }
    for (const path of linkElements) path.classList.remove('is-dimmed');
    for (const button of controls.querySelectorAll('button')) {
      button.removeAttribute('aria-hidden');
      button.removeAttribute('tabindex');
    }
    for (const button of axisButtons.values()) {
      button.removeAttribute('aria-hidden');
      button.removeAttribute('tabindex');
    }
    activateNode(null);
    hideTooltip();
  }

  function closeRing({ restoreFocus = true, restoreCamera = true } = {}) {
    if (!ring) return;
    const slug = ring.slug;
    const overview = overviewCamera;
    clearRing();
    overviewCamera = null;
    if (restoreCamera) {
      if (overview) flyTo(overview);
      else {
        const target = fitTarget();
        fitScale = target.scale;
        flyTo(target);
      }
    }
    if (restoreFocus) nodeElements.get(slug)?.focus({ preventScroll: true });
  }

  function playStation(uuid, element = null) {
    const target = element ?? ring?.stationEls.get(uuid) ?? null;
    if (target) {
      target.classList.remove('is-flashing');
      void target.offsetWidth;
      target.classList.add('is-flashing');
      const timer = setTimeout(() => {
        target.classList.remove('is-flashing');
        flashTimers.delete(timer);
      }, 500);
      flashTimers.add(timer);
    }
    let result;
    try {
      result = onPlay(uuid);
    } catch {
      target?.classList.remove('is-flashing');
      return;
    }
    Promise.resolve(result).then((ok) => {
      if (!ok) target?.classList.remove('is-flashing');
    }).catch(() => {
      target?.classList.remove('is-flashing');
    });
  }

  function highlightStation(uuid) {
    clearTimeout(highlightTimer);
    const element = ring?.stationEls.get(uuid);
    if (!element) return;
    element.classList.add('is-search-match');
    highlightTimer = setTimeout(() => {
      element.classList.remove('is-search-match');
      highlightTimer = null;
    }, 1600);
  }

  function setNowPlaying(uuid) {
    nowPlayingId = uuid ?? null;
    if (destroyed || !ring) return;
    for (const [stationUuid, element] of ring.stationEls) {
      element.classList.toggle('is-playing', stationUuid === nowPlayingId);
    }
    const current = ring.node.stations.find((station) => (
      (station.stationuuid ?? station.uuid ?? station.id) === nowPlayingId
    ));
    ring.current.textContent = current ? current.name : '';
  }

  function openCollection(slug) {
    if (destroyed) return;
    finishAxis();
    hideTooltip();
    const node = model.nodeBySlug.get(slug);
    if (!node) return;
    const nodeEl = nodeElements.get(slug);
    if (nodeEl) ensureMiniCloud(node, nodeEl);
    const cloudLogos = new Map();
    nodeEl?.querySelectorAll('.stations-cloud-orbit .logo-slot, .stations-cloud-mini-layer .logo-slot').forEach((logo) => {
      const uuid = logo.dataset.uuid;
      if (uuid && !cloudLogos.has(uuid)) cloudLogos.set(uuid, logo);
    });
    const fit = fitTarget();
    if (fit.scale > 0 && (fitScale <= 0 || camera.scale < fit.scale * 0.5)) {
      fitScale = fit.scale;
      camera = { ...fit };
      applyCamera();
    }
    if (!ring) overviewCamera = { ...camera };
    else clearRing();
    hideResults();
    stage.classList.add('is-ring-open');
    for (const [key, element] of nodeElements) {
      const selected = key === slug;
      element.classList.remove('is-active', 'is-related', 'is-expanded');
      element.classList.toggle('is-dimmed', !selected);
      element.classList.toggle('is-open', selected);
      element.setAttribute('aria-hidden', 'true');
      element.tabIndex = -1;
    }
    for (const path of linkElements) path.classList.add('is-dimmed');
    for (const button of controls.querySelectorAll('button')) {
      button.setAttribute('aria-hidden', 'true');
      button.tabIndex = -1;
    }
    for (const button of axisButtons.values()) {
      button.setAttribute('aria-hidden', 'true');
      button.tabIndex = -1;
    }

    const points = ringLayout(node.count, { radius: 170, gap: 58 });
    const maxRing = points.length ? Math.max(...points.map((point) => point.ring)) : 0;
    const maxRadius = 170 + maxRing * 58;
    const width = Math.max(1, stage.clientWidth || host.clientWidth || 1);
    const height = Math.max(1, stage.clientHeight || host.clientHeight || 1);
    const size = width < 520 ? 44 : 52;
    const ringScale = clampScale(Math.min(width, height) / 2 / (maxRadius + 40));

    const element = document.createElement('div');
    element.className = 'stations-cloud-ring';
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
    const stationEls = new Map();
    const migratedLogos = [];

    points.forEach((point, index) => {
      const station = node.stations[point.index];
      if (!station) return;
      const uuid = station.stationuuid ?? station.uuid ?? station.id;
      if (!uuid) return;
      const stationEl = document.createElement('button');
      stationEl.type = 'button';
      stationEl.className = 'stations-cloud-station';
      stationEl.dataset.uuid = uuid;
      stationEl.style.left = `${point.x}px`;
      stationEl.style.top = `${point.y}px`;
      stationEl.style.width = `${size / ringScale}px`;
      stationEl.style.height = `${size / ringScale}px`;
      stationEl.style.setProperty('--ring-order', String(index));
      const country = String(station.countrycode ?? '').trim().toUpperCase();
      stationEl.setAttribute('aria-label', `${station.name ?? 'Station'}${country ? `, ${country}` : ''}`);
      const moved = cloudLogos.get(uuid);
      if (moved) {
        migratedLogos.push({
          logo: moved,
          parent: moved.parentElement,
          styles: {
            left: moved.style.left,
            top: moved.style.top,
            width: moved.style.width,
            height: moved.style.height,
          },
        });
        moved.classList.add('stations-cloud-ring-logo');
        for (const property of ['left', 'top', 'width', 'height', 'scale', 'opacity', 'transition', 'transition-delay']) {
          moved.style.removeProperty(property);
        }
        stationEl.append(moved);
      } else {
        const logo = logoElement(station, {
          imgClass: 'stations-cloud-logo',
          initialsClass: 'stations-cloud-initials',
          size: 'sm',
          resolveById: true,
          priority: index < 8,
        });
        if (logo) stationEl.append(logo);
      }
      stationEl.addEventListener('pointerenter', () => showTooltip(station, stationEl));
      stationEl.addEventListener('pointerleave', hideTooltip);
      stationEl.addEventListener('focus', () => showTooltip(station, stationEl));
      stationEl.addEventListener('blur', hideTooltip);
      stationEl.addEventListener('click', (evt) => {
        evt.stopPropagation();
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        playStation(uuid, stationEl);
      });
      element.append(stationEl);
      stationEls.set(uuid, stationEl);
    });

    const label = document.createElement('div');
    label.className = 'stations-cloud-ring-label';
    const title = document.createElement('strong');
    title.textContent = node.title;
    const count = document.createElement('span');
    count.textContent = `${formatCount(node.count)} stations`;
    const current = document.createElement('span');
    current.className = 'stations-cloud-ring-current';
    label.append(title, count, current);
    element.append(label);
    world.append(element);
    hydrateLogos(element);

    ring = { slug, node, element, label, current, stationEls, ringScale, size, points, migratedLogos };
    renderCollectionNote(node);
    if (nowPlayingId) setNowPlaying(nowPlayingId);
    flyTo({
      scale: ringScale,
      tx: width / 2 - node.x * ringScale,
      ty: height / 2 - node.y * ringScale,
    });
    stationEls.values().next().value?.focus({ preventScroll: true });
  }

  function reset() {
    if (destroyed) return;
    finishAxis();
    clearRing();
    overviewCamera = null;
    hideResults();
    fitCamera({ spread: true });
  }

  function search(query) {
    if (destroyed) return;
    const value = String(query ?? '').trim();
    if (!value) {
      hideResults();
      return;
    }
    const matches = matchCloud(model, value, { collectionLimit: 6, stationLimit: 12 });
    resultsEl.innerHTML = '';
    resultsEl.hidden = false;
    if (!matches.collections.length && !matches.stations.length) {
      const empty = document.createElement('div');
      empty.className = 'stations-cloud-results-empty';
      empty.textContent = 'No collections or stations found.';
      resultsEl.append(empty);
      return;
    }
    if (matches.collections.length) {
      const head = document.createElement('div');
      head.className = 'stations-cloud-results-head';
      head.textContent = 'Collections';
      resultsEl.append(head);
      for (const collection of matches.collections) {
        const row = document.createElement('button');
        row.type = 'button';
        row.dataset.slug = collection.slug;
        const title = document.createElement('span');
        title.className = 'stations-cloud-results-title';
        title.textContent = collection.title;
        const count = document.createElement('span');
        count.className = 'stations-cloud-results-count';
        count.textContent = `${formatCount(collection.count)} stations`;
        row.append(title, count);
        row.addEventListener('click', (evt) => {
          evt.stopPropagation();
          openCollection(collection.slug);
          hideResults();
        });
        resultsEl.append(row);
      }
    }
    if (matches.stations.length) {
      const head = document.createElement('div');
      head.className = 'stations-cloud-results-head';
      head.textContent = 'Stations';
      resultsEl.append(head);
      for (const station of matches.stations) {
        const row = document.createElement('button');
        row.type = 'button';
        row.dataset.uuid = station.stationuuid;
        row.dataset.collection = station.collectionSlug;
        const logo = logoElement(station, {
          imgClass: 'stations-cloud-results-logo',
          initialsClass: 'stations-cloud-results-initials',
          size: 'sm',
          resolveById: true,
        });
        if (logo) row.append(logo);
        const copy = document.createElement('span');
        copy.className = 'stations-cloud-results-copy';
        const name = document.createElement('span');
        name.className = 'stations-cloud-results-title';
        name.textContent = station.name;
        const source = document.createElement('span');
        source.className = 'stations-cloud-results-count';
        source.textContent = station.collectionTitle;
        copy.append(name, source);
        row.append(copy);
        row.addEventListener('click', (evt) => {
          evt.stopPropagation();
          openCollection(station.collectionSlug);
          highlightStation(station.stationuuid);
          playStation(station.stationuuid);
          hideResults();
        });
        resultsEl.append(row);
      }
    }
    hydrateLogos(resultsEl);
  }

  function onDocumentKeydown(evt) {
    if (evt.key !== 'Escape') return;
    if (resultsEl && !resultsEl.hidden) {
      evt.preventDefault();
      evt.stopPropagation();
      hideResults();
      return;
    }
    if (ring) {
      evt.preventDefault();
      evt.stopPropagation();
      closeRing();
    }
  }

  function handleResize() {
    if (destroyed) return;
    const width = Math.max(1, stage.clientWidth || host.clientWidth || 1);
    const height = Math.max(1, stage.clientHeight || host.clientHeight || 1);
    const fit = fitTarget();
    fitScale = fit.scale;
    if (ring) {
      const maxRing = ring.points.length ? Math.max(...ring.points.map((point) => point.ring)) : 0;
      const maxRadius = 170 + maxRing * 58;
      const size = width < 520 ? 44 : 52;
      const ringScale = clampScale(Math.min(width, height) / 2 / (maxRadius + 40));
      ring.ringScale = ringScale;
      ring.size = size;
      for (const element of ring.stationEls.values()) {
        element.style.width = `${size / ringScale}px`;
        element.style.height = `${size / ringScale}px`;
      }
      camera = {
        scale: ringScale,
        tx: width / 2 - ring.node.x * ringScale,
        ty: height / 2 - ring.node.y * ringScale,
      };
      applyCamera();
      return;
    }
    fitCamera({ spread: true });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(cameraFrame);
    cameraFrame = 0;
    cancelAnimationFrame(axisFrame);
    axisFrame = 0;
    cancelAnimationFrame(labelFrame);
    labelFrame = 0;
    axisButtons.clear();
    axisControl?.remove();
    axisControl = null;
    clearTimeout(highlightTimer);
    highlightTimer = null;
    clearTimeout(suppressTimer);
    suppressTimer = null;
    clearTimeout(fitTimer);
    fitTimer = null;
    flashTimers.forEach(clearTimeout);
    flashTimers.clear();
    document.removeEventListener('keydown', onDocumentKeydown, true);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    restorePlayerFromDock();
    if (document.fullscreenElement === host) document.exitFullscreen?.()?.catch?.(() => {});
    resizeObserver?.disconnect();
    resizeObserver = null;
    stage.removeEventListener('pointerdown', onPointerDown);
    stage.removeEventListener('pointermove', onPointerMove);
    stage.removeEventListener('pointerup', onPointerUp);
    stage.removeEventListener('pointercancel', onPointerUp);
    stage.removeEventListener('wheel', onWheel);
    stage.removeEventListener('click', onStageClick);
    pointers.clear();
    ring = null;
    noteEl = null;
    resultsEl = null;
    tooltip = null;
    playerDock = null;
    fullscreenButton = null;
    host.innerHTML = '';
    host.classList.remove('stations-cloud');
  }

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('click', onStageClick);
  document.addEventListener('keydown', onDocumentKeydown, true);

  resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(stage);
  if (model.nodes.length) fitCamera({ spread: true });
  else {
    camera = { scale: 1, tx: 0, ty: 0 };
    applyCamera();
  }
  if (nowPlayingId) setNowPlaying(nowPlayingId);
  fitTimer = setTimeout(() => {
    fitTimer = null;
    if (!destroyed && !ring) fitCamera({ spread: true });
  }, 0);

  return {
    destroy,
    setNowPlaying,
    search,
    openCollection,
    reset,
    element: stage,
  };
}
