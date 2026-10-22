import { renderLogoSlot } from './station-logo.js';
import { formatCount } from './stations-format.js';

const PADDING = 240;
const CLEARANCE = 20;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function jitter(slug, axis) {
  const hash = hashString(`${slug}:${axis}`);
  return (hash % 24001) / 1000 - 12;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function jaccard(first, second) {
  if (!first.size || !second.size) return 0;
  let intersection = 0;
  for (const value of first) {
    if (second.has(value)) intersection += 1;
  }
  const union = first.size + second.size - intersection;
  return union ? intersection / union : 0;
}

function normaliseList(list) {
  if (!list || typeof list !== 'object') return null;
  const slug = typeof list.slug === 'string' ? list.slug.trim() : '';
  const title = typeof list.title === 'string' ? list.title.trim() : '';
  if (!slug || !title || !Array.isArray(list.stations) || !list.stations.length) return null;
  return { slug, title, stations: list.stations };
}

export function buildCloudModel(lists = []) {
  const nodes = [];
  for (const raw of Array.isArray(lists) ? lists : []) {
    const list = normaliseList(raw);
    if (!list) continue;
    const count = list.stations.length;
    const radius = Math.min(140, Math.max(80, 72 + Math.sqrt(count) * 7));
    const previewCount = Math.min(8, Math.max(5, count));
    const previewStations = list.stations.slice(0, previewCount);
    const preview = previewStations.map((station, index) => {
      const angle = (index / previewStations.length) * Math.PI * 2 - Math.PI / 2;
      return {
        station,
        x: Math.cos(angle) * radius * 0.42,
        y: Math.sin(angle) * radius * 0.42,
        size: clamp(radius * 0.32, 16, 34),
      };
    });
    nodes.push({
      slug: list.slug,
      title: list.title,
      count,
      stations: list.stations,
      preview,
      radius,
      x: 0,
      y: 0,
    });
  }

  nodes.forEach((node, index) => {
    const angle = index * GOLDEN_ANGLE;
    const distance = 165 * Math.sqrt(index + 0.5);
    node.x = Math.cos(angle) * distance + jitter(node.slug, 'x');
    node.y = Math.sin(angle) * distance + jitter(node.slug, 'y');
  });

  for (let iteration = 0; iteration < 220; iteration += 1) {
    for (let first = 0; first < nodes.length; first += 1) {
      for (let second = first + 1; second < nodes.length; second += 1) {
        const a = nodes[first];
        const b = nodes[second];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        const minimum = a.radius + b.radius + CLEARANCE;
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

  if (nodes.length) {
    const centerX = nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length;
    const centerY = nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length;
    for (const node of nodes) {
      node.x -= centerX;
      node.y -= centerY;
    }
  }

  const nodeBySlug = new Map();
  const stationByUuid = new Map();
  const countrySets = [];
  for (const node of nodes) {
    nodeBySlug.set(node.slug, node);
    const countries = new Set();
    for (const station of node.stations) {
      const uuid = station?.stationuuid ?? station?.uuid ?? station?.id;
      if (uuid && !stationByUuid.has(uuid)) stationByUuid.set(uuid, { station, node });
      const country = String(station?.countrycode ?? '').trim().toUpperCase();
      if (country) countries.add(country);
    }
    countrySets.push(countries);
  }

  const edges = [];
  const edgeKeys = new Set();
  for (let first = 0; first < nodes.length; first += 1) {
    const candidates = [];
    for (let second = 0; second < nodes.length; second += 1) {
      if (first === second) continue;
      const similarity = jaccard(countrySets[first], countrySets[second]);
      if (similarity > 0) candidates.push({ second, similarity });
    }
    candidates.sort((a, b) => (
      b.similarity - a.similarity
      || (nodes[a.second].slug < nodes[b.second].slug ? -1 : nodes[a.second].slug > nodes[b.second].slug ? 1 : 0)
    ));
    for (const candidate of candidates.slice(0, 2)) {
      const a = nodes[first].slug;
      const b = nodes[candidate.second].slug;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push(a < b ? { a, b } : { a: b, b: a });
    }
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

  const minX = Math.min(...nodes.map((node) => node.x - node.radius));
  const maxX = Math.max(...nodes.map((node) => node.x + node.radius));
  const minY = Math.min(...nodes.map((node) => node.y - node.radius));
  const maxY = Math.max(...nodes.map((node) => node.y + node.radius));
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

export function mountDiscoverCloud(host, { lists = [], nowPlayingId = null, onPlay = async () => false } = {}) {
  const model = buildCloudModel(lists);
  let destroyed = false;
  let fitScale = 0;
  let camera = { scale: 1, tx: 0, ty: 0 };
  let overviewCamera = null;
  let ring = null;
  let resultsEl = null;
  let tooltip = null;
  let highlightTimer = null;
  let suppressTimer = null;
  let fitTimer = null;
  const flashTimers = new Set();
  let cameraFrame = 0;
  let suppressClick = false;
  let dragMoved = false;
  let dragStart = null;
  let dragDistance = 0;
  let pinch = null;
  let resizeObserver = null;
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
  }
  const linkElements = [];
  for (const edge of model.edges) {
    const first = model.nodeBySlug.get(edge.a);
    const second = model.nodeBySlug.get(edge.b);
    if (!first || !second) continue;
    const x1 = first.x - model.bounds.minX;
    const y1 = first.y - model.bounds.minY;
    const x2 = second.x - model.bounds.minX;
    const y2 = second.y - model.bounds.minY;
    const midX = (x1 + x2) / 2 + (y2 - y1) * 0.08;
    const midY = (y1 + y2) / 2 - (x2 - x1) * 0.08;
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('class', 'stations-cloud-link');
    path.setAttribute('d', `M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`);
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    path.dataset.a = edge.a;
    path.dataset.b = edge.b;
    svg.append(path);
    linkElements.push(path);
  }

  const nodeElements = new Map();
  const labelElements = [];
  const labelSlugs = new Set(
    [...model.nodes]
      .sort((a, b) => b.count - a.count || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
      .slice(0, 12)
      .map((node) => node.slug),
  );

  world.append(svg);

  model.nodes.forEach((node, index) => {
    const nodeEl = document.createElement('button');
    nodeEl.type = 'button';
    nodeEl.className = 'stations-cloud-node';
    nodeEl.dataset.slug = node.slug;
    nodeEl.setAttribute('aria-label', `${node.title}, ${formatCount(node.count)} stations`);
    nodeEl.style.left = `${node.x - node.radius}px`;
    nodeEl.style.top = `${node.y - node.radius}px`;
    nodeEl.style.width = `${node.radius * 2}px`;
    nodeEl.style.height = `${node.radius * 2}px`;
    nodeEl.style.setProperty('--float-delay', `-${(index % 8) * 0.9}s`);
    if (labelSlugs.has(node.slug)) nodeEl.classList.add('is-label-visible');

    const bubble = document.createElement('span');
    bubble.className = 'stations-cloud-bubble';
    const orbit = document.createElement('span');
    orbit.className = 'stations-cloud-orbit';
    node.preview.forEach((preview) => {
      const logo = logoElement(preview.station, {
        imgClass: 'stations-cloud-logo',
        initialsClass: 'stations-cloud-initials',
        size: 'sm',
        resolveById: true,
        priority: index < 8,
      });
      if (!logo) return;
      logo.style.left = `calc(50% + ${preview.x}px)`;
      logo.style.top = `calc(50% + ${preview.y}px)`;
      logo.style.width = `${preview.size}px`;
      logo.style.height = `${preview.size}px`;
      orbit.append(logo);
    });
    bubble.append(orbit);

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
    nodeEl.addEventListener('pointerenter', () => activateNode(node.slug));
    nodeEl.addEventListener('pointerleave', () => activateNode(null));
    nodeEl.addEventListener('focus', () => {
      if (nodeEl.matches(':focus-visible')) activateNode(node.slug);
    });
    nodeEl.addEventListener('blur', () => activateNode(null));
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
  zoomReset.setAttribute('aria-label', 'Reset view');
  zoomReset.title = 'Reset view';
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
  controls.append(zoomIn, zoomOut, zoomReset);

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

  stage.append(back, world, controls, hint, tooltip);
  if (!model.nodes.length) {
    const empty = document.createElement('div');
    empty.className = 'stations-cloud-empty';
    empty.textContent = 'No collections to show yet.';
    stage.append(empty);
  }
  host.append(resultsEl, stage);
  hydrateLogos(stage);

  function fitTarget() {
    const width = Math.max(1, stage.clientWidth || host.clientWidth || 1);
    const height = Math.max(1, stage.clientHeight || host.clientHeight || 1);
    if (!model.nodes.length) return { scale: 1, tx: 0, ty: 0 };
    const scale = Math.max(0.0001, Math.min(width / model.bounds.width, height / model.bounds.height) * 0.84);
    return {
      scale,
      tx: width / 2 - (model.bounds.minX + model.bounds.width / 2) * scale,
      ty: height / 2 - (model.bounds.minY + model.bounds.height / 2) * scale,
    };
  }

  function clampScale(value) {
    const base = fitScale > 0 ? fitScale : 0.0001;
    return Math.min(base * 5, Math.max(base * 0.75, value));
  }

  function applyCamera() {
    const scale = Math.max(0.0001, camera.scale);
    world.style.transform = `translate3d(${camera.tx}px, ${camera.ty}px, 0) scale(${scale})`;
    const labelScale = Math.min(8, 1 / scale);
    for (const label of labelElements) label.style.transform = `scale(${labelScale})`;
    if (ring?.label) ring.label.style.transform = `scale(${labelScale})`;
    stage.classList.toggle('is-zoomed', fitScale > 0 && scale >= fitScale * 1.15);
  }

  function fitCamera() {
    const target = fitTarget();
    fitScale = target.scale;
    camera = { ...target };
    applyCamera();
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
      if (progress < 1) cameraFrame = requestAnimationFrame(step);
      else cameraFrame = 0;
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
    if (evt.target.closest('.stations-cloud-results')) return;
    evt.preventDefault();
    zoomAt(evt.clientX, evt.clientY, Math.exp(-evt.deltaY * 0.0015));
  }

  function onPointerDown(evt) {
    if (evt.button != null && evt.button !== 0) return;
    if (evt.target.closest('.stations-cloud-results, .stations-cloud-controls, .stations-cloud-back')) return;
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
    if (evt.target.closest('.stations-cloud-node, .stations-cloud-station, .stations-cloud-controls, .stations-cloud-back, .stations-cloud-results, .stations-cloud-tooltip')) return;
    closeRing();
  }

  function activateNode(slug) {
    if (stage.classList.contains('is-ring-open')) return;
    for (const [key, element] of nodeElements) {
      const active = key === slug;
      element.classList.toggle('is-active', active);
      element.classList.toggle('is-dimmed', !!slug && !active);
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

  function clearRing() {
    clearTimeout(highlightTimer);
    highlightTimer = null;
    if (!ring) return;
    ring.element.remove();
    ring = null;
    stage.classList.remove('is-ring-open');
    for (const element of nodeElements.values()) {
      element.classList.remove('is-dimmed', 'is-open');
      element.removeAttribute('aria-hidden');
      element.removeAttribute('tabindex');
    }
    for (const path of linkElements) path.classList.remove('is-dimmed');
    for (const button of controls.querySelectorAll('button')) {
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
    const node = model.nodeBySlug.get(slug);
    if (!node) return;
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
      const country = String(station.countrycode ?? '').trim().toUpperCase();
      stationEl.setAttribute('aria-label', `${station.name ?? 'Station'}${country ? `, ${country}` : ''}`);
      const logo = logoElement(station, {
        imgClass: 'stations-cloud-logo',
        initialsClass: 'stations-cloud-initials',
        size: 'sm',
        resolveById: true,
        priority: index < 8,
      });
      if (logo) stationEl.append(logo);
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

    ring = { slug, node, element, label, current, stationEls, ringScale, size, points };
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
    clearRing();
    overviewCamera = null;
    hideResults();
    const target = fitTarget();
    fitScale = target.scale;
    flyTo(target);
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
    fitCamera();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(cameraFrame);
    cameraFrame = 0;
    clearTimeout(highlightTimer);
    highlightTimer = null;
    clearTimeout(suppressTimer);
    suppressTimer = null;
    clearTimeout(fitTimer);
    fitTimer = null;
    flashTimers.forEach(clearTimeout);
    flashTimers.clear();
    document.removeEventListener('keydown', onDocumentKeydown, true);
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
    resultsEl = null;
    tooltip = null;
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
  if (model.nodes.length) fitCamera();
  else {
    camera = { scale: 1, tx: 0, ty: 0 };
    applyCamera();
  }
  if (nowPlayingId) setNowPlaying(nowPlayingId);
  fitTimer = setTimeout(() => {
    fitTimer = null;
    if (!destroyed && !ring) fitCamera();
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
