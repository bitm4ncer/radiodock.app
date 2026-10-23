// Editorial super-genres for the 3D cloud. Colors stay in CSS; this module only
// decides which family belongs to which readable group.

export const CLOUD_GENRE_GROUPS = [
  {
    key: 'club',
    label: 'Electronic / Club',
    families: ['electronic', 'dance', 'trance', 'house', 'techno', 'minimal', 'hardstyle', 'synthwave'],
  },
  {
    key: 'bass',
    label: 'Bass / UK Bass',
    families: ['bass', 'uk-bass'],
  },
  {
    key: 'hiphop',
    label: 'Hip-Hop / Rap',
    families: ['hiphop', 'uk-rap'],
  },
  {
    key: 'pop',
    label: 'Pop / Schlager',
    families: ['pop', 'schlager', 'jpop', 'kpop'],
  },
  {
    key: 'rock',
    label: 'Rock / Metal / Punk',
    families: ['rock', 'metal', 'punk', 'indie', 'new-wave', 'industrial'],
  },
  {
    key: 'soul',
    label: 'Soul / Funk / Disco',
    families: ['soul', 'disco', 'gospel', 'blues'],
  },
  {
    key: 'jazz',
    label: 'Jazz / Classical',
    families: ['jazz', 'classical'],
  },
  {
    key: 'roots',
    label: 'Roots / Folk / Global',
    families: ['roots', 'folk', 'reggae', 'world', 'afrobeat', 'desi', 'balkan', 'arabic', 'latin'],
  },
  {
    key: 'ambient',
    label: 'Ambient / Other',
    families: ['ambient', 'experimental', 'trip-hop', 'chill', 'spoken', 'soundtrack', 'eclectic', 'oldies'],
  },
];

export const CLOUD_GENRE_FALLBACK = CLOUD_GENRE_GROUPS[CLOUD_GENRE_GROUPS.length - 1];

const GROUP_BY_FAMILY = new Map(
  CLOUD_GENRE_GROUPS.flatMap((group) => group.families.map((family) => [family, group])),
);

export function cloudGenreGroup(family) {
  return GROUP_BY_FAMILY.get(family) ?? CLOUD_GENRE_FALLBACK;
}
