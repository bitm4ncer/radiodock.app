// Curated genre map for the Discover cloud. The vectors are editorial: they
// describe a collection, not an individual station. Edges stay fixed when the
// visible axes change, so the graph keeps its meaning across projections.

export const CLOUD_MAP_SCALE = 26;

export const CLOUD_AXIS_PRESETS = {
  vibe: {
    key: 'vibe',
    label: 'Vibe',
    x: 'electronic',
    y: 'energy',
    xLabels: ['Acoustic', 'Electronic'],
    yLabels: ['Calm', 'Intense'],
  },
  era: {
    key: 'era',
    label: 'Era',
    x: 'era',
    y: 'energy',
    xLabels: ['Roots', 'Modern'],
    yLabels: ['Calm', 'Intense'],
  },
  texture: {
    key: 'texture',
    label: 'Texture',
    x: 'electronic',
    y: 'era',
    xLabels: ['Acoustic', 'Electronic'],
    yLabels: ['Roots', 'Modern'],
  },
};

export const CLOUD_GENRE_VECTORS = {
  news: { family: 'spoken', energy: 30, electronic: 44, era: 20 },
  jazz: { family: 'jazz', energy: 46, electronic: 18, era: 10 },
  dubby: { family: 'reggae', energy: 52, electronic: 30, era: 35 },
  'country-roots': { family: 'roots', energy: 52, electronic: 10, era: 12 },
  ambient: { family: 'ambient', energy: 16, electronic: 60, era: 55 },
  noise: { family: 'experimental', energy: 38, electronic: 74, era: 66 },
  obscure: { family: 'eclectic', energy: 30, electronic: 34, era: 50 },
  'late-night': { family: 'eclectic', energy: 38, electronic: 36, era: 35 },
  'bass-rave': { family: 'bass', energy: 72, electronic: 64, era: 70 },
  dubstep: { family: 'bass', energy: 82, electronic: 60, era: 72 },
  classical: { family: 'classical', energy: 24, electronic: 8, era: 0 },
  'soul-funk': { family: 'soul', energy: 60, electronic: 30, era: 25 },
  punk: { family: 'punk', energy: 84, electronic: 20, era: 42 },
  hiphop: { family: 'hiphop', energy: 70, electronic: 48, era: 60 },
  chill: { family: 'chill', energy: 26, electronic: 54, era: 60 },
  pop: { family: 'pop', energy: 46, electronic: 48, era: 55 },
  electro: { family: 'electronic', energy: 64, electronic: 76, era: 58 },
  dance: { family: 'dance', energy: 56, electronic: 80, era: 62 },
  eurodance: { family: 'dance', energy: 64, electronic: 84, era: 60 },
  'trance-psy': { family: 'trance', energy: 80, electronic: 96, era: 66 },
  dubtechno: { family: 'minimal', energy: 38, electronic: 82, era: 72 },
  'drum-and-bass': { family: 'bass', energy: 92, electronic: 78, era: 70 },
  jungle: { family: 'bass', energy: 84, electronic: 70, era: 64 },
  minimal: { family: 'minimal', energy: 42, electronic: 90, era: 76 },
  techno: { family: 'techno', energy: 68, electronic: 92, era: 70 },
  hardcore: { family: 'bass', energy: 96, electronic: 80, era: 60 },
  'tech-house': { family: 'house', energy: 58, electronic: 90, era: 74 },
  house: { family: 'house', energy: 48, electronic: 84, era: 62 },
  metal: { family: 'metal', energy: 90, electronic: 16, era: 35 },
  'classic-rock': { family: 'rock', energy: 70, electronic: 24, era: 28 },
  'uk-garage': { family: 'uk-bass', energy: 66, electronic: 60, era: 68 },
  grime: { family: 'uk-rap', energy: 76, electronic: 54, era: 78 },
  'black-metal-doom': { family: 'metal', energy: 96, electronic: 8, era: 45 },
  'boom-bap': { family: 'hiphop', energy: 62, electronic: 44, era: 58 },
  'trap-drill': { family: 'uk-rap', energy: 92, electronic: 60, era: 92 },
};

export const CLOUD_GENRE_EDGES = [
  ['black-metal-doom', 'metal'],
  ['metal', 'punk'],
  ['metal', 'classic-rock'],
  ['classic-rock', 'country-roots'],
  ['classic-rock', 'soul-funk'],
  ['country-roots', 'jazz'],
  ['jazz', 'classical'],
  ['jazz', 'soul-funk'],
  ['jazz', 'late-night'],
  ['jazz', 'dubby'],
  ['dubby', 'soul-funk'],
  ['late-night', 'news'],
  ['late-night', 'obscure'],
  ['late-night', 'chill'],
  ['news', 'pop'],
  ['news', 'obscure'],
  ['pop', 'soul-funk'],
  ['pop', 'hiphop'],
  ['pop', 'dance'],
  ['chill', 'ambient'],
  ['chill', 'pop'],
  ['soul-funk', 'boom-bap'],
  ['boom-bap', 'hiphop'],
  ['hiphop', 'grime'],
  ['hiphop', 'uk-garage'],
  ['grime', 'trap-drill'],
  ['grime', 'uk-garage'],
  ['grime', 'dubstep'],
  ['dubby', 'dubstep'],
  ['dubstep', 'bass-rave'],
  ['dubstep', 'jungle'],
  ['bass-rave', 'drum-and-bass'],
  ['jungle', 'drum-and-bass'],
  ['drum-and-bass', 'hardcore'],
  ['hardcore', 'jungle'],
  ['bass-rave', 'uk-garage'],
  ['electro', 'bass-rave'],
  ['electro', 'dance'],
  ['electro', 'noise'],
  ['dance', 'eurodance'],
  ['dance', 'house'],
  ['dance', 'uk-garage'],
  ['eurodance', 'trance-psy'],
  ['house', 'tech-house'],
  ['house', 'minimal'],
  ['tech-house', 'techno'],
  ['minimal', 'techno'],
  ['minimal', 'dubtechno'],
  ['dubtechno', 'techno'],
  ['techno', 'trance-psy'],
  ['techno', 'noise'],
  ['ambient', 'noise'],
];

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function projectVector(vector, preset = CLOUD_AXIS_PRESETS.vibe) {
  const rawX = Number(vector?.[preset.x]);
  const rawY = Number(vector?.[preset.y]);
  const x = clamp(Number.isFinite(rawX) ? rawX : 50, 0, 100);
  const y = clamp(Number.isFinite(rawY) ? rawY : 50, 0, 100);
  return {
    x: (x - 50) * CLOUD_MAP_SCALE,
    y: (50 - y) * CLOUD_MAP_SCALE,
  };
}
