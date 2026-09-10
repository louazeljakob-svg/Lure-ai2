/**
 * Bibliotheque d'archetypes de corps — module N.
 *
 * Un archetype n'est pas une silhouette figee : c'est une FAMILLE de forme,
 * decrite par ses parametres geometriques reels — elancement, position de la
 * section maitresse, angle de nez, coefficient de section, forme de queue.
 * On atteint donc n'importe quelle silhouette de la famille au curseur, ce
 * qui est plus utile qu'un modele copie.
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

export const ARCHETYPES: Archetype[] = [
  {
    shape: 'vibetraine',
    rank: 1,
    family: 'Vibe de traine haute vitesse',
    action: 'Tient a grande vitesse sans se coucher ; vibration serree et puissante.',
    actionTag: 'vibration',
    hasBib: false,
    articulated: false,
    buoyancy: 'sink',
    lengths: [95, 230],
    slenderness: [2.5, 3.5],
    tie: 'Attache dorsale',
  },
  {
    shape: 'minnowtraine',
    rank: 2,
    family: 'Minnow de traine a grande bavette',
    action: 'Descend vite et tient sa profondeur ; lacet regulier sur de longues traines.',
    actionTag: 'lacet',
    hasBib: true,
    articulated: false,
    buoyancy: 'float',
    lengths: [120, 260],
    slenderness: [5, 7],
    tie: 'Attache sur la bavette',
    caveat:
      'La queue souple rapportee est disponible en piece distincte (onglet Scene) ; elle n est pas montee par defaut.',
  },
  {
    shape: 'stickbait165',
    rank: 3,
    family: 'Stickbait coulant (pencil)',
    action: 'Chute glissee, tete en avant ou a plat selon le lest arriere.',
    actionTag: 'glide',
    hasBib: false,
    articulated: false,
    buoyancy: 'float',
    lengths: [110, 220],
    slenderness: [5, 8],
    tie: 'Attache de nez',
  },
  {
    shape: 'popper',
    rank: 4,
    family: 'Popper a face creusee',
    action: 'Gerbe et « plop » sonore ; la face creusee fait tout le bruit.',
    actionTag: 'surface',
    hasBib: false,
    articulated: false,
    buoyancy: 'float',
    lengths: [60, 160],
    slenderness: [3, 4.5],
    tie: 'Attache de nez',
  },
  {
    shape: 'chugger',
    rank: 5,
    family: 'Chugger',
    action: 'Bruit plus sourd, action roulante ; face plate ou faiblement creusee.',
    actionTag: 'surface',
    hasBib: false,
    articulated: false,
    buoyancy: 'float',
    lengths: [65, 140],
    slenderness: [2.5, 3.5],
    tie: 'Attache de nez',
  },
  {
    shape: 'swimbait',
    rank: 6,
    family: 'Swimbait articule',
    action: 'Nage ondulante segment par segment ; la plus naturelle des familles.',
    actionTag: 'glide',
    hasBib: false,
    articulated: true,
    buoyancy: 'suspend',
    lengths: [90, 250],
    slenderness: [3, 4.5],
    tie: 'Attache de nez',
    caveat:
      'Deux segments sont produits. Au-dela, chaque segment intermediaire demande une face en V a ses DEUX bouts, ce que le decoupeur actuel ne sait pas faire : la valeur est acceptee mais la generation est bloquee avec son explication.',
  },
  {
    shape: 'lipless',
    rank: 7,
    family: 'Vibe coulant (lipless)',
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
    shape: 'jerkbait',
    rank: 8,
    family: 'Jerkbait a bavette courte',
    action: 'Depart lateral franc a chaque coup de scion, puis arret net.',
    actionTag: 'lacet',
    hasBib: true,
    articulated: false,
    buoyancy: 'suspend',
    lengths: [70, 160],
    slenderness: [5, 7],
    tie: 'Attache de nez ou sur la bavette',
  },
  {
    shape: 'minnownervure',
    rank: 9,
    family: 'Minnow a corps nervure',
    action: 'Meme depart que le jerkbait, avec la signature sonore des nervures.',
    actionTag: 'lacet',
    hasBib: true,
    articulated: false,
    buoyancy: 'float',
    lengths: [70, 160],
    slenderness: [5, 7],
    tie: 'Attache de nez',
  },
  {
    shape: 'topwater',
    rank: 10,
    family: 'Pencil flottant',
    action: 'Marche du chien : le lest arriere mobile decide de la cadence.',
    actionTag: 'surface',
    hasBib: false,
    articulated: false,
    buoyancy: 'float',
    lengths: [80, 180],
    slenderness: [6, 9],
    tie: 'Attache de nez',
  },
];

/** Elancement reel du preset : longueur / hauteur, recalcule et non saisi. */
export const slendernessOf = (params: LureParams): number =>
  params.length / Math.max(params.thickness, 1);

export const archetypeOf = (shape: ShapeId): Archetype | undefined =>
  ARCHETYPES.find((item) => item.shape === shape);

/** Formes historiques : conservees, mais rangees a part de la bibliotheque. */
export const HERITAGE_SHAPES: ShapeId[] = ['ryoshi', 'model25', 'crankbait', 'spoon'];

/** Parametres de depart d'un archetype, prets a ouvrir comme projet. */
export const archetypeParams = (shape: ShapeId): LureParams => getPreset(shape).params;
