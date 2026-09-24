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
 * Les sept familles de la bibliotheque — module AB.
 *
 * Une entree par famille : ce qui n'est qu'une variante (chugger, minnow
 * nervure, vibe de traine, glide bait) est un reglage de sa famille. Les
 * anciens archetypes, les formes historiques et les modeles guides ont ete
 * retires (module AA) : c'etaient des volumes lisses, sans anatomie.
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
    shape: 'crankbait',
    rank: 2,
    family: 'Crankbait',
    action: 'Plonge vite et vibre large ; les epaules pleines portent le roulis.',
    actionTag: 'roulis',
    hasBib: true,
    articulated: false,
    buoyancy: 'float',
    lengths: [40, 90],
    slenderness: [2, 3],
    tie: 'Attache de nez, grande bavette',
  },
  {
    shape: 'deepdiver',
    rank: 3,
    family: 'Deep diver de traine',
    action: 'Descend et tient sa profondeur en traine ; lacet regulier.',
    actionTag: 'lacet',
    hasBib: true,
    articulated: false,
    buoyancy: 'float',
    lengths: [120, 260],
    slenderness: [4.5, 6.5],
    tie: 'Attache de nez, tete renforcee pour la bavette',
  },
  {
    shape: 'popper',
    rank: 4,
    family: 'Popper',
    action: 'Gerbe et « plop » sonore : la face creusee fait tout le bruit.',
    actionTag: 'surface',
    hasBib: false,
    articulated: false,
    buoyancy: 'float',
    lengths: [60, 160],
    slenderness: [3, 4.5],
    tie: 'Attache au fond de la cuvette',
  },
  {
    shape: 'stickbait',
    rank: 5,
    family: 'Stickbait / pencil',
    action: 'Marche du chien en surface, ou chute glissee en version coulante.',
    actionTag: 'surface',
    hasBib: false,
    articulated: false,
    buoyancy: 'float',
    lengths: [110, 220],
    slenderness: [5, 8],
    tie: 'Attache de nez',
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
  {
    shape: 'swimbait',
    rank: 7,
    family: 'Swimbait articule',
    action: 'Nage ondulante segment par segment, caudale souple rapportee.',
    actionTag: 'glide',
    hasBib: false,
    articulated: true,
    buoyancy: 'suspend',
    lengths: [90, 250],
    slenderness: [3.5, 5],
    tie: 'Attache de nez',
  },
];

/** Elancement reel du preset : longueur / hauteur, recalcule et non saisi. */
export const slendernessOf = (params: LureParams): number =>
  params.length / Math.max(params.thickness, 1);

export const archetypeOf = (shape: ShapeId): Archetype | undefined =>
  ARCHETYPES.find((item) => item.shape === shape);

/** Parametres de depart d'une famille, prets a ouvrir comme projet. */
export const archetypeParams = (shape: ShapeId): LureParams => getPreset(shape).params;
