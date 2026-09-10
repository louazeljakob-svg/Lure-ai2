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

/**
 * Facteur d'echelle du catalogue.
 *
 * Les cotes de reference ci-dessous sont celles relevees a l'origine ; ce
 * facteur les porte a la taille reellement utilisee. Le changer ici suffit :
 * les logements en 8, les alesages et les profils balayes se redimensionnent
 * tout seuls, parce qu'ils lisent cette table et ne connaissent aucune cote
 * en dur. Leur METHODE de generation, elle, ne change pas.
 *
 * Attention : les jeux et offsets de fabrication ne sont PAS concernes. Un
 * jeu de 0,05 mm reste 0,05 mm quelle que soit la taille de la goupille —
 * c'est une tolerance de machine, pas une proportion.
 */
export const PIN_SCALE = 1.3;

/** Cotes de reference, avant mise a l'echelle. Un seul endroit a modifier. */
const PIN_BASE: (Omit<PinSpec, 'hint'> & { minLength: number })[] = [
  { id: 'xs06', label: 'XS 0,6', wire: 0.6, length: 6.5, loopWidth: 3, minLength: 0 },
  { id: 'xs10', label: 'XS 1,0', wire: 1, length: 8, loopWidth: 4, minLength: 65 },
  { id: 's', label: 'S (Petit)', wire: 1, length: 16, loopWidth: 5.5, minLength: 90 },
  { id: 'm', label: 'M (Moyen)', wire: 1.5, length: 17.5, loopWidth: 7.5, minLength: 140 },
  { id: 'l', label: 'L (Large)', wire: 2, length: 21.5, loopWidth: 10, minLength: 180 },
];

/** Arrondi au centieme : une cote de catalogue se lit, elle ne traine pas. */
const scaled = (value: number): number => Math.round(value * PIN_SCALE * 100) / 100;

/**
 * Seuil de bascule automatique, en mm de longueur de leurre.
 *
 * Il suit l'echelle : des goupilles 30 % plus grosses conviennent a des
 * leurres 30 % plus longs, sinon la selection automatique proposerait une
 * taille systematiquement trop forte.
 */
export const pinThreshold = (index: number): number =>
  Math.round(PIN_BASE[index].minLength * PIN_SCALE);

/** Catalogue reel, de la plus petite a la plus grande. */
export const PINS: PinSpec[] = PIN_BASE.map((base, index) => {
  const next = PIN_BASE[index + 1];
  return {
    id: base.id,
    label: base.label,
    wire: scaled(base.wire),
    length: scaled(base.length),
    loopWidth: scaled(base.loopWidth),
    hint: next
      ? `Leurres ${pinThreshold(index)} a ${pinThreshold(index + 1)} mm`
      : 'Gros leurres, eaux sales',
  };
});

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
  // Les seuils viennent de la meme table que les cotes : agrandir le
  // catalogue les decale d'autant, sans quoi la selection automatique
  // proposerait une taille systematiquement trop forte.
  for (let index = PINS.length - 1; index > 0; index--) {
    if (lureLengthMm >= pinThreshold(index)) return PINS[index].id;
  }
  return PINS[0].id;
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
export function buildPin(
  spec: PinSpec,
  origin: THREE.Vector3,
  planeAngle: number,
  axisAngle = 0,
): PinPart {
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
  // La grande boucle sort dans la direction demandee, puis le plan du fil
  // bascule pour epouser le plan de joint.
  geometry.rotateZ(THREE.MathUtils.degToRad(axisAngle));
  geometry.rotateX(planeAngle);
  geometry.translate(origin.x, origin.y, origin.z);

  const mass =
    pinWireLength(path) * Math.PI * path.wireRadius * path.wireRadius * STAINLESS_DENSITY;
  return { geometry, mass, path };
}
