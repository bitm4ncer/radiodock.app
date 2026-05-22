// Curated colour palette + gradient presets for the background editor.
//
// SWATCHES are the seven brand-aligned colours shown as quick-pick chips
// in the editor. PRESETS are six hand-tuned 4-point mesh gradients that
// load both points + colours when clicked — point positions are off-centre
// + asymmetric so each preset reads as a finished composition the user
// can save immediately, or nudge.
//
// Hex format is required (the spec stores colour as `#rrggbb`); the colour
// picker outputs the same. Anywhere a colour is hand-written here it's
// also a usable spec value.

export const SWATCHES = [
  { name: 'Knall gelb', color: '#FFD500' },
  { name: 'Königs blau', color: '#1E3A8A' },
  { name: 'Altrosa', color: '#D49091' },
  { name: 'Oliv', color: '#7B824A' },
  { name: 'Pink', color: '#EC4899' },
  { name: 'Purple', color: '#7C3AED' },
  { name: 'Orange', color: '#F97316' },
];

// Point sizes are in viewport-fraction units (0..1) — 0.65 means the
// radial-gradient extends ~65 % of the diagonal before fading out.
// Keep them in the 0.55..0.85 range; smaller looks too "spotty",
// larger blurs the four points into a single wash.
function p(x, y, color, size = 0.7) {
  return { x, y, color, size };
}

export const PRESETS = [
  {
    name: 'Berlin Sunset',
    points: [
      p(0.15, 0.20, '#F97316', 0.75),   // orange
      p(0.85, 0.25, '#EC4899', 0.70),   // pink
      p(0.20, 0.85, '#7C3AED', 0.80),   // purple
      p(0.80, 0.80, '#1E3A8A', 0.85),   // königs blau
    ],
    base: '#1A0E2E',
    drift: false,
  },
  {
    name: 'Acid Trip',
    points: [
      p(0.22, 0.30, '#FFD500', 0.70),   // knall gelb
      p(0.75, 0.18, '#7B824A', 0.65),   // oliv
      p(0.18, 0.78, '#EC4899', 0.75),   // pink
      p(0.82, 0.72, '#22D3EE', 0.70),   // cool cyan
    ],
    base: '#1F1B0F',
    drift: false,
  },
  {
    name: 'Königsblau Dream',
    points: [
      p(0.20, 0.25, '#1E3A8A', 0.85),   // königs blau
      p(0.78, 0.22, '#D49091', 0.65),   // altrosa
      p(0.25, 0.80, '#7C3AED', 0.75),   // purple
      p(0.80, 0.78, '#60A5FA', 0.70),   // light blue
    ],
    base: '#0B1228',
    drift: false,
  },
  {
    name: 'Margarita',
    points: [
      p(0.18, 0.28, '#FFD500', 0.75),   // knall gelb
      p(0.78, 0.22, '#7B824A', 0.65),   // oliv
      p(0.22, 0.80, '#FEE3A2', 0.70),   // soft warm
      p(0.82, 0.78, '#FFF7E0', 0.65),   // cream
    ],
    base: '#3A3318',
    drift: false,
  },
  {
    name: 'Bubblegum',
    points: [
      p(0.20, 0.25, '#D49091', 0.75),   // altrosa
      p(0.80, 0.30, '#EC4899', 0.70),   // pink
      p(0.18, 0.80, '#7C3AED', 0.75),   // purple
      p(0.82, 0.75, '#FACC15', 0.65),   // warm yellow
    ],
    base: '#1F0B1F',
    drift: false,
  },
  {
    name: 'Hot Desert',
    points: [
      p(0.22, 0.28, '#F97316', 0.75),   // orange
      p(0.78, 0.22, '#D49091', 0.70),   // altrosa
      p(0.20, 0.78, '#7B824A', 0.70),   // oliv
      p(0.80, 0.80, '#7F1D1D', 0.80),   // dark red
    ],
    base: '#28140C',
    drift: false,
  },
];

// Neutral starting point when the user opens "Create" without clicking a
// preset. Four well-spaced points in muted, palette-aligned colours so
// the editor doesn't open with a jarring "white screen" — there's always
// something to look at and shape.
export function defaultSpec() {
  return {
    points: [
      p(0.25, 0.30, '#7C3AED', 0.70),
      p(0.75, 0.28, '#EC4899', 0.70),
      p(0.30, 0.78, '#1E3A8A', 0.75),
      p(0.78, 0.75, '#F97316', 0.70),
    ],
    base: '#141414',
    drift: false,
  };
}

// Deep-clone helper: specs are mutated freely in the editor (drag, colour
// pick, drift toggle, slider) and we don't want a preset object to be
// edited in place — re-clicking the preset would then load the user's
// stale edits instead of the original definition.
export function cloneSpec(spec) {
  return {
    points: spec.points.map((pt) => ({ x: pt.x, y: pt.y, color: pt.color, size: pt.size })),
    base: spec.base,
    drift: !!spec.drift,
  };
}
