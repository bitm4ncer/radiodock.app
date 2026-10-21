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
