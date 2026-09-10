/**
 * Bibliotheque de livrees — module L.
 *
 * Les noms sont ceux du metier, pas des inventions : un pecheur qui cherche
 * « perchaude » doit la trouver ecrite comme il la nomme. Chaque entree est
 * une PaintConfig complete, donc entierement modifiable une fois chargee —
 * c'est un point de depart, pas un verrou.
 *
 * Tout ce fichier est PUREMENT VISUEL. Aucune valeur n'entre dans une
 * geometrie exportee, dans un calcul de masse ni dans un verdict.
 */

import type { LiveryConfig, PaintConfig } from '../types/lure';

export const DEFAULT_LIVERY: LiveryConfig = {
  bars: { enabled: false, count: 7, width: 0.42, blur: 0.7, color: '#1b2a1b', opacity: 0.45 },
  iris: { strength: 0.35, hue: '#7fd8c0' },
  varnish: { gloss: 0.82, thickness: 0.5 },
  lateral: { enabled: false, color: '#8d99a6', width: 0.35, position: 0.5 },
  gillPlate: { enabled: false, color: '#e59ac0', size: 0.5 },
  microScales: { enabled: true, density: 0.55, contrast: 0.3 },
  pearl: 0.35,
};

/** Copie profonde : une livree chargee ne doit jamais partager ses objets. */
export const cloneLivery = (livery: LiveryConfig = DEFAULT_LIVERY): LiveryConfig => ({
  bars: { ...livery.bars },
  iris: { ...livery.iris },
  varnish: { ...livery.varnish },
  lateral: { ...livery.lateral },
  gillPlate: { ...livery.gillPlate },
  microScales: { ...livery.microScales },
  pearl: livery.pearl,
});

/** Fabrique une livree en ne precisant que ce qui change du defaut. */
const livery = (over: {
  bars?: Partial<LiveryConfig['bars']>;
  iris?: Partial<LiveryConfig['iris']>;
  varnish?: Partial<LiveryConfig['varnish']>;
  lateral?: Partial<LiveryConfig['lateral']>;
  gillPlate?: Partial<LiveryConfig['gillPlate']>;
  microScales?: Partial<LiveryConfig['microScales']>;
  pearl?: number;
}): LiveryConfig => ({
  bars: { ...DEFAULT_LIVERY.bars, ...over.bars },
  iris: { ...DEFAULT_LIVERY.iris, ...over.iris },
  varnish: { ...DEFAULT_LIVERY.varnish, ...over.varnish },
  lateral: { ...DEFAULT_LIVERY.lateral, ...over.lateral },
  gillPlate: { ...DEFAULT_LIVERY.gillPlate, ...over.gillPlate },
  microScales: { ...DEFAULT_LIVERY.microScales, ...over.microScales },
  pearl: over.pearl ?? DEFAULT_LIVERY.pearl,
});

export interface LiveryPreset {
  id: string;
  name: string;
  /** Ce que le pecheur cherche quand il monte cette livree. */
  note: string;
  paint: PaintConfig;
}

/** Base commune : seules les couleurs et les couches changent d'une livree a l'autre. */
const paint = (over: Partial<PaintConfig>): PaintConfig => ({
  dorsal: '#2f4f4f',
  flank: '#cfd8dc',
  belly: '#ffffff',
  head: '#2f4f4f',
  tail: '#cfd8dc',
  headLength: 0,
  tailLength: 0,
  blend: 0.62,
  eyeColor: '#e8b21a',
  pattern: 'scales',
  patternColor: '#9fb0bd',
  patternScale: 18,
  finish: 'gloss',
  livery: DEFAULT_LIVERY,
  ...over,
});

export const LIVERY_LIBRARY: LiveryPreset[] = [
  {
    id: 'shad',
    name: 'Shad naturel',
    note: 'Dos olive, flanc argent, la livree passe-partout des eaux claires.',
    paint: paint({
      dorsal: '#3c4a33',
      flank: '#d7dee2',
      belly: '#fdfbf7',
      patternColor: '#a9b6bd',
      blend: 0.7,
      livery: livery({
        iris: { strength: 0.4, hue: '#9fe0c8' },
        pearl: 0.4,
        microScales: { density: 0.6, contrast: 0.28 },
        gillPlate: { enabled: true, color: '#dfb7c8', size: 0.46 },
      }),
    }),
  },
  {
    id: 'perchaude',
    name: 'Perchaude',
    note: 'Barres verticales franches sur fond dore : la perche, partout ou elle vit.',
    paint: paint({
      dorsal: '#3f4a20',
      flank: '#d3a83f',
      belly: '#f6efd8',
      patternColor: '#7d6a2c',
      blend: 0.5,
      eyeColor: '#e06a12',
      livery: livery({
        bars: { enabled: true, count: 7, width: 0.4, blur: 0.35, color: '#2b3315', opacity: 0.72 },
        iris: { strength: 0.24, hue: '#c8e07f' },
        pearl: 0.2,
        microScales: { density: 0.5, contrast: 0.34 },
      }),
    }),
  },
  {
    id: 'achigan',
    name: 'Achigan',
    note: 'Vert bronze et bande laterale sombre : l achigan a petite bouche.',
    paint: paint({
      dorsal: '#38492c',
      flank: '#9aa661',
      belly: '#f0ead6',
      patternColor: '#5c6b3c',
      blend: 0.66,
      eyeColor: '#c8462a',
      livery: livery({
        lateral: { enabled: true, color: '#2f3a22', width: 0.5, position: 0.5 },
        bars: { enabled: true, count: 9, width: 0.3, blur: 0.85, color: '#2b3520', opacity: 0.3 },
        iris: { strength: 0.28, hue: '#a8d089' },
        pearl: 0.25,
      }),
    }),
  },
  {
    id: 'menee',
    name: 'Menee doree',
    note: 'Flanc dore a irisation verte, ventre nacre : la reference de la photo.',
    paint: paint({
      dorsal: '#2a3318',
      flank: '#c8a84a',
      belly: '#fdf3ee',
      patternColor: '#9c8347',
      blend: 0.74,
      eyeColor: '#f0c419',
      finish: 'holo',
      livery: livery({
        bars: { enabled: true, count: 9, width: 0.4, blur: 0.78, color: '#1e2a14', opacity: 0.5 },
        iris: { strength: 0.62, hue: '#8ce0a0' },
        varnish: { gloss: 0.93, thickness: 0.78 },
        gillPlate: { enabled: true, color: '#f0a6c4', size: 0.52 },
        microScales: { enabled: true, density: 0.72, contrast: 0.26 },
        pearl: 0.55,
      }),
    }),
  },
  {
    id: 'truite',
    name: 'Truite arc-en-ciel',
    note: 'Bande rose sur flanc argent et mouchetures sombres.',
    paint: paint({
      dorsal: '#3a4a4a',
      flank: '#dfe4e6',
      belly: '#fbf7f2',
      pattern: 'dots',
      patternColor: '#41494c',
      patternScale: 22,
      blend: 0.7,
      eyeColor: '#d8a520',
      livery: livery({
        lateral: { enabled: true, color: '#d4788f', width: 0.7, position: 0.5 },
        iris: { strength: 0.34, hue: '#c9a8e0' },
        pearl: 0.45,
      }),
    }),
  },
  {
    id: 'chrome',
    name: 'Chrome',
    note: 'Miroir integral : l eclat qui se voit de loin en eau teintee.',
    paint: paint({
      dorsal: '#8f9aa3',
      flank: '#eef2f5',
      belly: '#ffffff',
      pattern: 'none',
      blend: 0.85,
      finish: 'chrome',
      eyeColor: '#e02b2b',
      livery: livery({
        iris: { strength: 0.18, hue: '#cfe4ff' },
        varnish: { gloss: 0.98, thickness: 0.9 },
        microScales: { enabled: false, density: 0.4, contrast: 0.2 },
        pearl: 0.1,
      }),
    }),
  },
  {
    id: 'feu',
    name: 'Feu de circulation',
    note: 'Tete rouge, corps jaune, dos vert : le classique des eaux sales.',
    paint: paint({
      dorsal: '#2f7a2f',
      flank: '#f2d024',
      belly: '#f7f0c8',
      head: '#d62828',
      headLength: 0.24,
      blend: 0.38,
      pattern: 'none',
      eyeColor: '#101114',
      livery: livery({
        iris: { strength: 0.1, hue: '#ffd9a0' },
        varnish: { gloss: 0.88, thickness: 0.6 },
        microScales: { enabled: false, density: 0.4, contrast: 0.2 },
        pearl: 0.1,
      }),
    }),
  },
  {
    id: 'ayu',
    name: 'Ayu',
    note: 'Dos vert olive translucide et tache pectorale jaune : la livree japonaise.',
    paint: paint({
      dorsal: '#4a5a3a',
      flank: '#e3e7e2',
      belly: '#fbfaf6',
      patternColor: '#b6bfb2',
      blend: 0.78,
      eyeColor: '#e8d24a',
      livery: livery({
        iris: { strength: 0.42, hue: '#a8e0c0' },
        gillPlate: { enabled: true, color: '#e8d24a', size: 0.44 },
        varnish: { gloss: 0.9, thickness: 0.7 },
        pearl: 0.5,
      }),
    }),
  },
  {
    id: 'ghost',
    name: 'Ghost minnow',
    note: 'Corps translucide et arete dorsale sombre : discret sur poisson eduque.',
    paint: paint({
      dorsal: '#4a5560',
      flank: '#e8edf1',
      belly: '#ffffff',
      pattern: 'none',
      blend: 0.9,
      finish: 'satin',
      eyeColor: '#b0332a',
      livery: livery({
        iris: { strength: 0.5, hue: '#bcd8f0' },
        varnish: { gloss: 0.7, thickness: 0.4 },
        microScales: { enabled: true, density: 0.4, contrast: 0.16 },
        pearl: 0.6,
      }),
    }),
  },
];

export const getLivery = (id: string): LiveryPreset | undefined =>
  LIVERY_LIBRARY.find((item) => item.id === id);
