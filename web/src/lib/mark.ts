/**
 * Marquage de propriete : le mot SAKUMA en relief sous la queue.
 *
 * Le texte est une VRAIE geometrie, pas une texture : chaque lettre est un
 * prisme dont la base est enfoncee sous la peau et le sommet decale le long
 * de la normale, de sorte que le relief sorte a l'impression.
 *
 * Les glyphes sont decrits ici en dur plutot que charges d'une police : une
 * police JSON pesait plus lourd que tout le reste de l'application, et six
 * lettres suffisent. Ils sont dessines au trait, sans contre-forme fermee —
 * un « A » a l'americaine, ouvert en haut — pour rester imprimables a 2 mm
 * de haut et se triangulariser sans trou.
 *
 * Repere du glyphe : x de 0 (gauche) a `advance`, y de 0 (bas) a 1 (haut).
 */

import * as THREE from 'three';
import type { LureParams } from '../types/lure';
import { createSurfaceSampler } from './geometry';
import { MM_TO_CM, clamp, type ProfileSampler } from './profile';

/** Texte impose. Non modifiable : c'est la signature du produit. */
export const MARK_TEXT = 'SAKUMA';

/** Hauteur du marquage, en fraction de la hauteur du corps. */
const HEIGHT_RATIO = 0.16;
/** Hauteur minimale et maximale du marquage, en cm. */
const HEIGHT_RANGE: [number, number] = [0.12, 0.32];
/** Relief au-dessus de la peau, en mm. */
const RELIEF_MM = 0.45;
/** Enfoncement de la base sous la peau, en mm. */
const ROOT_MM = 0.25;

interface Glyph {
  advance: number;
  /** Contours fermes, en coordonnees de glyphe. */
  paths: THREE.Vector2[][];
}

const at = (x: number, y: number) => new THREE.Vector2(x, y);

/**
 * Barre epaisse entre deux points : c'est la brique de tous les glyphes.
 * `w` est la demi-largeur du trait.
 */
function bar(x0: number, y0: number, x1: number, y1: number, w: number): THREE.Vector2[] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy) || 1;
  // Allongement d'un demi-trait a chaque bout : les jonctions se recouvrent
  // au lieu de laisser une encoche dans l'angle.
  const ex = (dx / length) * w;
  const ey = (dy / length) * w;
  const nx = (-dy / length) * w;
  const ny = (dx / length) * w;
  const ax = x0 - ex;
  const ay = y0 - ey;
  const bx = x1 + ex;
  const by = y1 + ey;
  // Sens trigonometrique : la triangulation l'exige.
  return [
    at(ax - nx, ay - ny),
    at(bx - nx, by - ny),
    at(bx + nx, by + ny),
    at(ax + nx, ay + ny),
  ];
}

const W = 0.12; // demi-largeur du trait
const A = 0.62; // avance standard

/** Les six lettres de SAKUMA, chacune comme un jeu de barres. */
const GLYPHS: Record<string, Glyph> = {
  S: {
    advance: A,
    paths: [
      bar(0.05, 0.86, 0.55, 0.86, W),
      bar(0.08, 0.86, 0.08, 0.56, W),
      bar(0.05, 0.53, 0.55, 0.53, W),
      bar(0.52, 0.53, 0.52, 0.2, W),
      bar(0.05, 0.16, 0.55, 0.16, W),
    ],
  },
  A: {
    advance: A,
    paths: [
      bar(0.05, 0.14, 0.3, 0.88, W),
      bar(0.3, 0.88, 0.55, 0.14, W),
      bar(0.14, 0.44, 0.46, 0.44, W),
    ],
  },
  K: {
    advance: A,
    paths: [
      bar(0.08, 0.14, 0.08, 0.88, W),
      bar(0.1, 0.48, 0.55, 0.88, W),
      bar(0.1, 0.48, 0.55, 0.14, W),
    ],
  },
  U: {
    advance: A,
    paths: [
      bar(0.08, 0.88, 0.08, 0.26, W),
      bar(0.05, 0.18, 0.55, 0.18, W),
      bar(0.52, 0.88, 0.52, 0.26, W),
    ],
  },
  M: {
    advance: 0.74,
    paths: [
      bar(0.08, 0.14, 0.08, 0.88, W),
      bar(0.08, 0.88, 0.35, 0.42, W),
      bar(0.35, 0.42, 0.62, 0.88, W),
      bar(0.62, 0.88, 0.62, 0.14, W),
    ],
  },
};

/** Chasse entre deux lettres : assez large pour qu elles ne se touchent pas. */
const SPACING = 0.24;

/** Largeur totale du mot, en unites de glyphe. */
function textWidth(text: string): number {
  let width = 0;
  for (const letter of text) width += (GLYPHS[letter]?.advance ?? A) + SPACING;
  return Math.max(width - SPACING, 1e-6);
}

/**
 * Angle, autour de la section, ou poser le marquage.
 *
 * On vise le ventre. Le plan de joint y passe quand il est vertical : le
 * texte est alors decale juste assez pour tenir entierement d'un cote, sans
 * chevaucher la ligne de separation.
 */
function markAngle(params: LureParams, halfSpan: number): number {
  const belly = Math.PI;
  const joint = THREE.MathUtils.degToRad(params.assembly.planeAngle);
  // Les deux traces du plan de joint sur la section, en angle.
  const seams = [joint + Math.PI / 2, joint + (3 * Math.PI) / 2];
  let angle = belly;
  for (const seam of seams) {
    let delta = angle - seam;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) < halfSpan) angle = seam + Math.sign(delta || 1) * halfSpan;
  }
  return angle;
}

/**
 * Position retenue pour le marquage : station centrale et angle de section.
 * Partagee par la generation du relief et par l'export, qui doit savoir
 * laquelle des deux coques porte le texte.
 */
function markPlacement(
  profile: ProfileSampler,
  params: LureParams,
): { start: number; end: number; angle: number; height: number; width: number } | null {
  const bodyHeight = params.thickness * MM_TO_CM;
  const height = clamp(bodyHeight * HEIGHT_RATIO, HEIGHT_RANGE[0], HEIGHT_RANGE[1]);
  const width = textWidth(MARK_TEXT) * height;
  const end = clamp(profile.bodyEnd - 0.08, 0.3, 0.94);
  const start = end - width / Math.max(profile.lengthCm, 1e-6);
  if (start < 0.25) return null;

  const midSection = profile.section((start + end) / 2);
  const localRadius = Math.max(
    (midSection.halfWidth + (midSection.top - midSection.bottom) / 2) / 2,
    0.05,
  );
  return {
    start,
    end,
    height,
    width,
    angle: markAngle(params, height / (2 * localRadius) + 0.12),
  };
}

/**
 * Coque qui porte le marquage.
 *
 * Le texte est pose entierement d'un cote du plan de joint : c'est cette
 * coque-la qui doit l'emporter a l'export, sinon la seconde se retrouverait
 * avec un relief flottant dans le vide.
 */
export function markOnMaleSide(profile: ProfileSampler, params: LureParams): boolean {
  const place = markPlacement(profile, params);
  if (!place) return true;
  const surface = createSurfaceSampler(profile, params);
  const point = surface((place.start + place.end) / 2, place.angle);
  const a = THREE.MathUtils.degToRad(params.assembly.planeAngle);
  return -point.y * Math.sin(a) + point.z * Math.cos(a) >= 0;
}

/**
 * Marquage SAKUMA en relief, sous la queue.
 *
 * Retourne un solide ferme par lettre, reuni en une seule geometrie. Les
 * lettres empietent legerement dans le corps : le trancheur fusionne les
 * volumes qui se recouvrent, ce qui donne un relief solidaire de la piece.
 */
export function buildMark(
  profile: ProfileSampler,
  params: LureParams,
): THREE.BufferGeometry | null {
  // Sous la queue, mais devant le pedoncule : la ou il reste de la matiere.
  const placement = markPlacement(profile, params);
  if (!placement) return null;
  const { start, end, angle, height, width } = placement;
  const surface = createSurfaceSampler(profile, params);
  const midSection = profile.section((start + end) / 2);
  const localRadius = Math.max(
    (midSection.halfWidth + (midSection.top - midSection.bottom) / 2) / 2,
    0.05,
  );

  const relief = RELIEF_MM * MM_TO_CM;
  const root = ROOT_MM * MM_TO_CM;
  const positions: number[] = [];

  /** Point de la peau, decale de `offset` le long de la normale locale. */
  const place = (u: number, v: number, offset: number): THREE.Vector3 => {
    const p = start + (end - start) * u;
    const theta = angle + (v - 0.5) * (height / localRadius);
    const point = surface(p, theta);
    const centre = surface(p, theta + 0.02);
    const before = surface(p, theta - 0.02);
    // Normale approchee : perpendiculaire a la tangente de section, dans le
    // plan de la section. Suffisant pour un relief d'un demi-millimetre.
    const tangent = new THREE.Vector3().subVectors(centre, before).normalize();
    const axis = new THREE.Vector3(1, 0, 0);
    const normal = new THREE.Vector3().crossVectors(tangent, axis).normalize();
    if (normal.dot(new THREE.Vector3(0, point.y, point.z)) < 0) normal.negate();
    return point.clone().addScaledVector(normal, offset);
  };

  const push = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };

  let pen = 0;
  for (const letter of MARK_TEXT) {
    const glyph = GLYPHS[letter];
    if (!glyph) {
      pen += A + SPACING;
      continue;
    }
    for (const path of glyph.paths) {
      // Repere du mot : u le long du corps, v en travers, tous deux 0..1.
      const outline = path.map((point) =>
        new THREE.Vector2((pen + point.x) * height / width, point.y),
      );
      const faces = THREE.ShapeUtils.triangulateShape(outline, []);
      const top = outline.map((point) => place(point.x, point.y, relief));
      const bottom = outline.map((point) => place(point.x, point.y, -root));
      for (const [i0, i1, i2] of faces) {
        push(top[i0], top[i2], top[i1]);
        push(bottom[i0], bottom[i1], bottom[i2]);
      }
      for (let i = 0; i < outline.length; i++) {
        const j = (i + 1) % outline.length;
        push(bottom[i], top[j], bottom[j]);
        push(bottom[i], top[i], top[j]);
      }
    }
    pen += glyph.advance + SPACING;
  }

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
