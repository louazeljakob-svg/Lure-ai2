/**
 * Bibliotheque des familles de leurres — modules N, AA et AB.
 *
 * Une famille n'est pas une silhouette figee : c'est un leurre complet et
 * regle, dont chaque cote reste ensuite modifiable au curseur.
 *
 * Aucune cote n'est relevee sur un modele du commerce, et aucune livree,
 * aucun logo ni aucun nom commercial n'est repris : ce sont les grandes
 * familles fonctionnelles, qui appartiennent a tout le monde.
 */

import type { LureParams, ShapeId } from '../types/lure';
import { getPreset } from './presets';

/** Familles d'action, pour le filtre de la bibliotheque. */
export type ActionTag = 'vibration' | 'roulis' | 'lacet' | 'surface' | 'glide';

export const ACTION_LABEL: Record<ActionTag, string> = {
  vibration: 'Vibration serree',
  roulis: 'Roulis large',
  lacet: 'Lacet',
  surface: 'Surface',
  glide: 'Glide',
};

export type FloatTag = 'float' | 'suspend' | 'sink';

export const FLOAT_LABEL: Record<FloatTag, string> = {
  float: 'Flottant',
  suspend: 'Suspendu',
  sink: 'Coulant',
};

export interface Archetype {
  shape: ShapeId;
  /** Numero de famille, dans l'ordre de la specification. */
  rank: number;
  family: string;
  /** Ce qu'on attend de cette famille sur l'eau, en une ligne. */
  action: string;
  actionTag: ActionTag;
  hasBib: boolean;
  articulated: boolean;
  buoyancy: FloatTag;
  /** Plage de longueurs usuelle de la famille, en mm. */
  lengths: [number, number];
  /** Plage d'elancement (longueur / hauteur) de la famille. */
  slenderness: [number, number];
  /** Ou se pose l'attache de ligne : c'est un trait de famille, pas un detail. */
  tie: string;
  /** Limite connue, affichee telle quelle plutot que passee sous silence. */
  caveat?: string;
}

/**
 * Les six familles de la bibliotheque — modules AB, AH et AO.
 *
 * Une entree par famille : ce qui n'est qu'une variante (minnow nervure,
 * suspendu, vibe de traine) est un reglage de sa famille. Chaque famille
 * ajoutee au module AO porte une geometrie reellement distincte : helice
 * rotative, section circulaire, chambre de billes, lest ventral integre.
 */
export const ARCHETYPES: Archetype[] = [
  {
    shape: 'minnow',
    rank: 1,
    family: 'Minnow / jerkbait',
    action: 'Depart lateral franc a chaque coup de scion, nage serree en recuperation lineaire.',
    actionTag: 'lacet',
    hasBib: true,
    articulated: false,
    buoyancy: 'float',
    lengths: [70, 160],
    slenderness: [4.5, 7],
    tie: 'Attache de nez, bavette polycarbonate en sandwich',
  },
  {
    shape: 'lipless',
    rank: 2,
    family: 'Lipless / vibe',
    action: 'Vibration serree a la descente comme a la recuperation.',
    actionTag: 'vibration',
    hasBib: false,
    articulated: false,
    buoyancy: 'sink',
    lengths: [50, 110],
    slenderness: [2.5, 3.5],
    tie: 'Attache dorsale',
  },
  {
    shape: 'plopper',
    rank: 3,
    family: 'Whopper_Plopper',
    action: 'Nage de surface en ligne droite, l helice de queue brasse et projette l eau.',
    actionTag: 'surface',
    hasBib: false,
    articulated: false,
    buoyancy: 'float',
    lengths: [90, 180],
    slenderness: [4.5, 5.5],
    tie: 'Attache de nez, fil traversant jusqu a l helice',
    caveat:
      'Visserie de la methode Minnow 100 inapplicable : le fil traversant, axe de l helice, occupe l axe du plan de joint, et la plus courte vis du catalogue (15 mm) monterait son ecrou dans ce canal. Coques assemblees par ergots, goujons et gorge de colle, sans vis.',
  },
  {
    shape: 'pencil',
    rank: 4,
    family: 'Pencil',
    action: 'Walking the dog en surface, lance tres loin grace au lest arriere.',
    actionTag: 'lacet',
    hasBib: false,
    articulated: false,
    buoyancy: 'float',
    lengths: [50, 120],
    slenderness: [3, 4.5],
    tie: 'Attache de nez, oeillet de queue',
  },
  {
    shape: 'nageur',
    rank: 5,
    family: 'Poisson nageur',
    action: 'Plonge sous la grande bavette et tient sa profondeur, arrets suspendus.',
    actionTag: 'roulis',
    hasBib: true,
    articulated: false,
    buoyancy: 'suspend',
    lengths: [80, 140],
    slenderness: [4, 5],
    tie: 'Attache de nez, grande bavette polycarbonate en sandwich',
  },
  {
    shape: 'souple',
    rank: 6,
    family: 'Souple',
    action: 'Descend droit, s anime a la canne par tirees et relachers.',
    actionTag: 'glide',
    hasBib: false,
    articulated: false,
    buoyancy: 'sink',
    lengths: [70, 150],
    slenderness: [3.8, 4.8],
    tie: 'Attache dorsale ou de nez',
    caveat:
      'Coques en TPU : serrez la visserie sans forcer — une tete fraisee s enfonce dans la matiere souple — et collez a la cyanoacrylate avec primaire.',
  },
];

/** Elancement reel du preset : longueur / hauteur, recalcule et non saisi. */
export const slendernessOf = (params: LureParams): number =>
  params.length / Math.max(params.thickness, 1);

export const archetypeOf = (shape: ShapeId): Archetype | undefined =>
  ARCHETYPES.find((item) => item.shape === shape);

/** Parametres de depart d'une famille, prets a ouvrir comme projet. */
export const archetypeParams = (shape: ShapeId): LureParams => getPreset(shape).params;

// ---------------------------------------------------------------------------
// Filtres de la bibliotheque (module AH)
// ---------------------------------------------------------------------------

export type FilterKey = 'action' | 'bib' | 'articulated' | 'float';
export type LibraryChoice = Partial<Record<FilterKey, string>>;

export interface LibraryFilter {
  key: FilterKey;
  label: string;
  all: string;
  value: (item: Archetype) => string;
  name: (value: string) => string;
}

export const LIBRARY_FILTERS: LibraryFilter[] = [
  { key: 'action', label: 'Action', all: 'Toutes', value: (item) => item.actionTag, name: (value) => ACTION_LABEL[value as ActionTag] },
  {
    key: 'bib',
    label: 'Bavette',
    all: 'Indifferent',
    value: (item) => (item.hasBib ? 'oui' : 'non'),
    name: (value) => (value === 'oui' ? 'Avec bavette' : 'Sans bavette'),
  },
  {
    key: 'articulated',
    label: 'Articulation',
    all: 'Indifferent',
    value: (item) => (item.articulated ? 'oui' : 'non'),
    name: (value) => (value === 'oui' ? 'Articule' : 'Monobloc'),
  },
  { key: 'float', label: 'Flottaison', all: 'Toutes', value: (item) => item.buoyancy, name: (value) => FLOAT_LABEL[value as FloatTag] },
];

/** Vrai si la famille passe tous les filtres choisis, sauf `except`. */
export const matchesChoice = (item: Archetype, chosen: LibraryChoice, except?: FilterKey): boolean =>
  LIBRARY_FILTERS.every((filter) => filter.key === except || !chosen[filter.key] || filter.value(item) === chosen[filter.key]);

/**
 * Filtres proposes : un critere que toutes les familles partagent n'en est
 * pas un — il ne ferait que vider la liste.
 */
export const activeFilters = (): LibraryFilter[] =>
  LIBRARY_FILTERS.filter((filter) => new Set(ARCHETYPES.map(filter.value)).size > 1);

/**
 * Valeurs proposees par un filtre : celles qui renvoient au moins une
 * famille compte tenu des autres filtres. Aucune combinaison ne peut donc
 * produire une liste vide.
 */
export const filterValues = (key: FilterKey, chosen: LibraryChoice): string[] => {
  const filter = LIBRARY_FILTERS.find((item) => item.key === key)!;
  return [...new Set(ARCHETYPES.filter((item) => matchesChoice(item, chosen, key)).map(filter.value))];
};
