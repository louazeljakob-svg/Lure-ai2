/**
 * Quincaillerie reelle : goupilles en 8, agrafes, lests.
 *
 * Les cotes sont celles des catalogues fournisseurs. Les masses ne sont
 * jamais saisies en dur : elles se deduisent de la longueur de fil
 * reellement developpee par la courbe, multipliee par la section du fil et
 * la densite de l'acier.
 */

import * as THREE from 'three';
import type { PinId } from '../types/lure';

/** Densite de l'acier inoxydable des goupilles et agrafes, en g/cm3. */
export const STAINLESS_DENSITY = 7.9;

/** Bornes usuelles de densite pour les lests inox, en g/cm3. */
export const BALLAST_DENSITY_RANGE = { min: 7.0, max: 11.4 };

export interface PinSpec {
  id: PinId;
  label: string;
  /** Diametre du fil, en mm. */
  wire: number;
  /** Longueur hors-tout, en mm. */
  length: number;
  /** Largeur de la petite boucle (celle qui s'enfile sur le goujon), en mm. */
  loopWidth: number;
  /** Plage de longueur de leurre visee, pour l'aide au choix. */
  hint: string;
}

/** Catalogue reel, de la plus petite a la plus grande. */
export const PINS: PinSpec[] = [
  { id: 'xs06', label: 'XS 0,6', wire: 0.6, length: 6.5, loopWidth: 3, hint: 'Leurres 40 a 65 mm' },
  { id: 'xs10', label: 'XS 1,0', wire: 1, length: 8, loopWidth: 4, hint: 'Leurres 65 a 90 mm' },
  { id: 's', label: 'S (Petit)', wire: 1, length: 16, loopWidth: 5.5, hint: 'Leurres 90 a 140 mm' },
  { id: 'm', label: 'M (Moyen)', wire: 1.5, length: 17.5, loopWidth: 7.5, hint: 'Leurres 140 a 180 mm' },
  { id: 'l', label: 'L (Large)', wire: 2, length: 21.5, loopWidth: 10, hint: 'Gros leurres, eaux sales' },
];

export const getPin = (id: PinId): PinSpec => PINS.find((pin) => pin.id === id) ?? PINS[2];

/**
 * Choix proportionnel a la longueur du leurre.
 *
 * La regle de robustesse prime : un gros leurre destine aux eaux sales
 * (gros stickbait, popper de grande taille) passe en L quelle que soit sa
 * longueur, parce que c'est la traction qui dimensionne, pas la silhouette.
 */
export function autoPin(lureLengthMm: number, roughWater: boolean): PinId {
  if (roughWater) return 'l';
  if (lureLengthMm < 65) return 'xs06';
  if (lureLengthMm < 90) return 'xs10';
  if (lureLengthMm < 140) return 's';
  if (lureLengthMm < 180) return 'm';
  return 'l';
}

// ---------------------------------------------------------------------------
// Trace du fil
// ---------------------------------------------------------------------------

export interface PinPath {
  /** Points de l'axe du fil, dans le plan de joint (x = axe du leurre, y = vertical). */
  points: THREE.Vector2[];
  /** Rayon du fil, en cm. */
  wireRadius: number;
  /** Centre et rayon de la petite boucle, en cm : c'est la que passe le goujon. */
  smallLoop: { center: THREE.Vector2; radius: number };
  bigLoop: { center: THREE.Vector2; radius: number };
}

/**
 * Silhouette d'une goupille en 8, en centimetres, orientee vers l'avant :
 * la petite boucle est a l'interieur du corps (en +x), la grande emerge au
 * nez (en -x). L'origine est le centre de la petite boucle.
 */
export function pinPath(spec: PinSpec): PinPath {
  const wireRadius = spec.wire * 0.05; // mm -> cm, puis rayon
  // Les largeurs catalogue sont hors-tout : l'axe du fil passe au milieu.
  const smallRadius = Math.max((spec.loopWidth * 0.1 - spec.wire * 0.1) / 2, 0.05);
  const total = spec.length * 0.1;
  // La grande boucle occupe ce qui reste de la longueur hors-tout.
  const bigRadius = Math.max((total - 2 * smallRadius) / 2 - wireRadius, smallRadius * 1.15);

  const smallCenter = new THREE.Vector2(0, 0);
  const bigCenter = new THREE.Vector2(-(smallRadius + bigRadius) * 0.92, 0);

  const points: THREE.Vector2[] = [];
  const arc = (
    center: THREE.Vector2,
    radius: number,
    from: number,
    to: number,
    steps: number,
  ) => {
    for (let i = 0; i <= steps; i++) {
      const a = from + ((to - from) * i) / steps;
      points.push(
        new THREE.Vector2(center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius),
      );
    }
  };

  // Petite boucle : un tour complet, depart et arrivee cote grande boucle.
  arc(smallCenter, smallRadius, Math.PI, Math.PI - Math.PI * 2, 28);
  // Croisement au niveau de la taille, puis grande boucle.
  arc(bigCenter, bigRadius, 0, Math.PI * 2, 32);

  return {
    points,
    wireRadius,
    smallLoop: { center: smallCenter, radius: smallRadius },
    bigLoop: { center: bigCenter, radius: bigRadius },
  };
}

/** Longueur de fil developpee, en cm. */
export function pinWireLength(path: PinPath): number {
  let length = 0;
  for (let i = 1; i < path.points.length; i++) {
    length += path.points[i].distanceTo(path.points[i - 1]);
  }
  return length;
}

export interface PinPart {
  geometry: THREE.BufferGeometry;
  mass: number;
  path: PinPath;
}

/**
 * Goupille en 8 modelisee comme un vrai fil : un tube balaye le long de
 * l'axe du fil. `origin` place le centre de la petite boucle dans le repere
 * du leurre, `planeAngle` oriente le plan de joint.
 */
export function buildPin(spec: PinSpec, origin: THREE.Vector3, planeAngle: number): PinPart {
  const path = pinPath(spec);
  const curve = new THREE.CatmullRomCurve3(
    path.points.map((p) => new THREE.Vector3(p.x, p.y, 0)),
    false,
    'catmullrom',
    0.25,
  );
  const geometry = new THREE.TubeGeometry(
    curve,
    Math.max(path.points.length * 2, 120),
    path.wireRadius,
    8,
    false,
  );
  // Le fil vit dans le plan de joint : on fait tourner le plan XY autour de
  // l'axe du leurre pour suivre l'orientation choisie.
  geometry.rotateX(planeAngle);
  geometry.translate(origin.x, origin.y, origin.z);

  const mass =
    pinWireLength(path) * Math.PI * path.wireRadius * path.wireRadius * STAINLESS_DENSITY;
  return { geometry, mass, path };
}
