/**
 * Montage traversant — module P.
 *
 * Le fil passe dans un canal creuse a MEME le plan de joint : chaque demi-
 * coque recoit une gorge demi-ronde, et les deux gorges refermees forment le
 * passage. C'est la meme mecanique que les canaux de goupille deja en place,
 * ce qui n'est pas un detail d'implementation : cette mecanique est prouvee
 * etanche sur toute la matrice de tests, et un montage traversant n'a aucune
 * raison de reinventer un percage.
 *
 * Consequence directe : le montage traversant EXIGE un corps en deux
 * parties. Un fil deja forme ne s'enfile pas dans un corps ferme, et une
 * boucle ventrale ne passe par aucun percage. On bloque donc la combinaison
 * plutot que d'en produire la moitie.
 */

import * as THREE from 'three';
import type { LureParams, ThroughWireConfig, WireMaterialId } from '../types/lure';
import { MM_TO_CM } from './profile';

export const defaultThroughWire = (): ThroughWireConfig => ({
  enabled: false,
  wireMm: 1.5,
  material: 'inox304',
  loopMm: 7,
  clearanceMm: 0.4,
  bellyExits: 1,
  bellyPositions: [0.42],
});

export const THROUGH_WIRE_LIMITS = {
  wireMm: { min: 0.8, max: 3, step: 0.1 },
  loopMm: { min: 4, max: 16, step: 0.5 },
  clearanceMm: { min: 0.1, max: 1, step: 0.05 },
  bellyExits: { min: 0, max: 3, step: 1 },
} as const;

/** Densite de l'acier, en g/cm3 — la meme que pour les goupilles. */
const STEEL_DENSITY = 7.9;

/**
 * Raison pour laquelle le montage traversant ne peut pas etre produit, ou
 * null s'il le peut. Le texte est destine a l'utilisateur, pas au journal.
 */
export function throughWireBlocker(params: LureParams): string | null {
  if (!params.throughWire.enabled) return null;
  if (!params.assembly.enabled) {
    return "Le montage traversant demande un corps en deux parties : un fil deja forme ne s'enfile pas dans un corps ferme, et une boucle ventrale ne passe par aucun percage. Activez « Corps en deux parties » dans l'onglet Assemblage.";
  }
  if (params.articulation.enabled) {
    return "Un fil traversant unique ne peut pas relier deux segments articules : il bloquerait la charniere. Utilisez des goupilles en 8, une par segment.";
  }
  const channelMm = params.throughWire.wireMm + params.throughWire.clearanceMm;
  if (channelMm > params.thickness * 0.4) {
    return `Le canal (${channelMm.toFixed(1)} mm avec son jeu) occupe plus de 40 % de la hauteur du corps (${params.thickness.toFixed(0)} mm). Il ne resterait pas assez de matiere de part et d'autre. Reduisez le fil ou grossissez le corps.`;
  }
  return null;
}

export interface ThroughWirePlan {
  /** Rayon du canal, en cm : demi-fil plus jeu. */
  channelRadius: number;
  /** Extremites du canal axial, dans le plan de joint (x, transverse). */
  from: THREE.Vector2;
  to: THREE.Vector2;
  /** Positions des sorties ventrales, en fraction de la longueur. */
  belly: number[];
  /** Longueur de fil developpee, en cm. */
  wireLengthCm: number;
  /** Masse du fil, en g. */
  massG: number;
  /** Vrai si l'encoche de sortie a reellement pu etre ouverte. */
  noseExit: boolean;
  tailExit: boolean;
}

/**
 * Longueur de fil reellement developpee.
 *
 * On ne saisit pas une masse : on la deduit, comme pour les goupilles. Le fil
 * parcourt le corps et ressort en nez et en queue pour y former une boucle.
 */
export function planThroughWire(params: LureParams, lengthCm: number): ThroughWirePlan {
  const wire = params.throughWire;
  const channelRadius = ((wire.wireMm + wire.clearanceMm) * MM_TO_CM) / 2;
  const half = lengthCm / 2;
  // Le canal s'arrete a une demi-boucle des pointes : c'est la que le fil
  // ressort pour se former.
  const inset = (wire.loopMm * MM_TO_CM) / 2;
  const from = new THREE.Vector2(-half + inset, 0);
  const to = new THREE.Vector2(half - inset, 0);

  const belly = wire.bellyPositions
    .slice(0, Math.max(Math.round(wire.bellyExits), 0))
    .map((p) => Math.min(Math.max(p, 0.12), 0.9));

  // Perimetre d'une boucle formee : un cercle de diametre loopMm.
  //
  // Le fil ne compte QUE le trajet nez-queue et ses deux boucles. Les sorties
  // ventrales ne sont pas formees sur ce fil : ce sont des oeillets a part,
  // dont la masse est deja comptee comme quincaillerie d'ancrage. Les
  // additionner ici les compterait deux fois.
  const loopCm = Math.PI * wire.loopMm * MM_TO_CM;
  const axialCm = to.x - from.x;
  const wireLengthCm = axialCm + 2 * loopCm;

  const sectionCm2 = Math.PI * Math.pow((wire.wireMm * MM_TO_CM) / 2, 2);
  return {
    channelRadius,
    from,
    to,
    belly,
    wireLengthCm,
    massG: wireLengthCm * sectionCm2 * STEEL_DENSITY,
    // Renseignes par le constructeur de coques : lui seul sait si la pointe
    // laissait la place d'ouvrir l'encoche.
    noseExit: false,
    tailExit: false,
  };
}

export const WIRE_MATERIAL_LABEL: Record<WireMaterialId, string> = {
  inox304: 'Inox 304',
  inox316: 'Inox 316',
  ressort: 'Acier ressort',
  laiton: 'Laiton',
};
