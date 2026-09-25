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
 * Les deux familles de la bibliotheque — modules AB et AH.
 *
 * Une entree par famille : ce qui n'est qu'une variante (minnow nervure,
 * suspendu, vibe de traine) est un reglage de sa famille. Crankbait, deep
 * diver, popper, stickbait et swimbait ont quitte la bibliotheque (module
 * AH) ; leurs corps restent atteignables par les curseurs de forme.
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
    rank: 6,
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
