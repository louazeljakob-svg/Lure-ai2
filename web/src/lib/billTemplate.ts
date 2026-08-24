/**
 * Bavette universelle : un seul contour pour quatre usages.
 *
 * Le contour de reference est releve sur le modele STL fourni
 * (Minnow 100 : 37,09 x 18,15 x 3,00 mm, plaque plane inclinee a 40 degres).
 * Le maillage n'est pas embarque : une plaque plane est entierement decrite
 * par sa silhouette et son epaisseur, et une silhouette de trente points
 * pese mille fois moins qu'un STL tout en donnant la meme piece.
 *
 * Le meme contour sert a la bavette imprimee avec le corps, au gabarit
 * DXF / SVG a decouper dans du polycarbonate, a l'apercu fantome, et a la
 * fente d'insertion creusee dans les deux coques. La fente n'est pas une
 * approximation reglee a part : c'est l'EMPREINTE NEGATIVE de la plaque,
 * majoree du seul jeu d'insertion. Aucune derive possible entre la piece,
 * son gabarit et son logement.
 *
 * Repere local du contour : x part de la racine vers la pointe, y est la
 * demi-largeur. Unites en centimetres, comme le reste de la geometrie.
 */

import * as THREE from 'three';
import type { LureParams } from '../types/lure';
import { MM_TO_CM, clamp, type ProfileSampler } from './profile';

/** Epaisseur de matiere conservee entre la peau et le fond d'un logement. */
const WALL = 0.05;

/**
 * Demi-silhouette de la bavette de reference, du talon (u = 0) a la pointe
 * (u = 1), en fractions de la longueur. Le contour complet est obtenu par
 * miroir : la plaque est symetrique, et le miroir corrige les neuf dixiemes
 * de millimetre d'asymetrie du scan.
 */
const UNIVERSAL_HALF: [number, number][] = [
  [0.0000, 0.1308], [0.0557, 0.1339], [0.1312, 0.1368], [0.1833, 0.1404],
  [0.2331, 0.1459], [0.2790, 0.1535], [0.3245, 0.1636], [0.3778, 0.1787],
  [0.4417, 0.1986], [0.5001, 0.2155], [0.5490, 0.2273], [0.5949, 0.2360],
  [0.6382, 0.2417], [0.6806, 0.2446], [0.7273, 0.2446], [0.7582, 0.2428],
  [0.7838, 0.2394], [0.8081, 0.2338], [0.8315, 0.2258], [0.8565, 0.2140],
  [0.8821, 0.1984], [0.9075, 0.1793], [0.9313, 0.1575], [0.9489, 0.1378],
  [0.9647, 0.1163], [0.9776, 0.0943], [0.9875, 0.0721], [0.9944, 0.0507],
  [0.9986, 0.0268], [1.0000, 0.0001],
];

/** Cotes de la bavette de reference, en millimetres. */
export const UNIVERSAL_BILL = { length: 37.09, width: 18.15, thickness: 3.0 };

/** Demi-largeur maximale de la silhouette, en fraction de la longueur. */
const REFERENCE_HALF = 0.2446;

/** Demi-silhouette d'un profil droit ou en losange, conge compris. */
function shapedHalf(params: LureParams): [number, number][] {
  const fillet = clamp(params.billFillet / Math.max(params.bibLength, 1), 0, 0.3);
  const tang = 0.1308;
  if (params.billProfile === 'diamond') {
    return [[0, tang], [0.18, tang], [0.62, REFERENCE_HALF], [1, 0.0001]];
  }
  // Rectangulaire, coins avant adoucis par le conge.
  const r = Math.max(fillet * REFERENCE_HALF * 2, 1e-4);
  return [
    [0, tang],
    [0.2, tang],
    [0.34, REFERENCE_HALF],
    [1 - r, REFERENCE_HALF],
    [1, Math.max(REFERENCE_HALF - r, 0.0001)],
    [1, 0.0001],
  ];
}

/** Demi-silhouette retenue pour le profil de coupe choisi. */
const halfOutline = (params: LureParams): [number, number][] =>
  params.billProfile === 'rounded' ? UNIVERSAL_HALF : shapedHalf(params);

/** Demi-largeur de la plaque a l'avance u, en fraction de la longueur. */
function halfWidthAt(half: [number, number][], u: number): number {
  if (u <= half[0][0]) return half[0][1];
  for (let i = 1; i < half.length; i++) {
    if (u <= half[i][0]) {
      const [u0, v0] = half[i - 1];
      const [u1, v1] = half[i];
      return v0 + ((v1 - v0) * (u - u0)) / Math.max(u1 - u0, 1e-9);
    }
  }
  return half[half.length - 1][1];
}

/** Avance a laquelle la plaque atteint une demi-largeur donnee. */
function advanceAtHalfWidth(half: [number, number][], target: number): number {
  for (let i = 1; i < half.length; i++) {
    const [u0, v0] = half[i - 1];
    const [u1, v1] = half[i];
    if (v1 >= target && v0 <= target) {
      return u0 + ((u1 - u0) * (target - v0)) / Math.max(v1 - v0, 1e-9);
    }
  }
  return target <= half[0][1] ? 0 : 1;
}

/**
 * Proportions de la bavette de reference, pour l'echelle liee : largeur et
 * epaisseur suivent la longueur.
 */
const RATIO = {
  width: UNIVERSAL_BILL.width / UNIVERSAL_BILL.length,
  thickness: UNIVERSAL_BILL.thickness / UNIVERSAL_BILL.length,
};

/** Cotes reelles de la plaque, echelle liee ou libre, en millimetres. */
export function billSize(params: LureParams): {
  length: number;
  width: number;
  thickness: number;
} {
  const length = Math.max(params.bibLength, 1);
  if (!params.billUniform) {
    return { length, width: params.bibWidth, thickness: params.billThickness };
  }
  return {
    length,
    width: length * RATIO.width,
    thickness: clamp(length * RATIO.thickness, 0.5, 3),
  };
}

export interface BibShape {
  /** Contour ferme, en centimetres. */
  points: THREE.Vector2[];
  length: number;
  halfWidth: number;
  /** Demi-largeur du talon, en cm. */
  rootHalf: number;
}

/** Contour complet de la plaque, a l'echelle demandee. */
export function bibShape(_profile: ProfileSampler, params: LureParams): BibShape {
  const size = billSize(params);
  const length = Math.max(size.length * MM_TO_CM, 0.2);
  const halfWidth = Math.max((size.width * MM_TO_CM) / 2, 0.15);
  // La silhouette est normalisee sur la largeur de reference : la mettre a la
  // largeur demandee revient a l'etirer transversalement.
  const scale = halfWidth / (REFERENCE_HALF * length);
  const half = halfOutline(params);

  const upper = half.map(([u, v]) => new THREE.Vector2(u * length, v * length * scale));
  const lower = [...half].reverse().map(([u, v]) => new THREE.Vector2(u * length, -v * length * scale));
  return {
    points: [...upper, ...lower],
    length,
    halfWidth,
    rootHalf: half[0][1] * length * scale,
  };
}

/** Contour du gabarit a decouper, aux cotes reelles. */
export const bibOutline = (profile: ProfileSampler, params: LureParams): THREE.Vector2[] =>
  bibShape(profile, params).points;

/**
 * Plan de la fente d'insertion — l'empreinte negative de la plaque.
 *
 * La fente doit DEBOUCHER : une bavette qui ne ressort pas du corps ne sert
 * a rien. Elle sort par l'avant de la tete, la ou la plaque emerge sur un
 * vrai leurre. Le nez est donc coupe net a la premiere station ou la bande
 * de la plaque tient dans la section avec 0,5 mm de peau tout autour — deux
 * a quatre millimetres, invisibles a l'oeil.
 *
 * La profondeur decoule de la plaque elle-meme : la bavette s'enfonce
 * jusqu'a ce que sa largeur atteigne celle du logement. C'est donc la
 * section de la tete qui fixe l'enfoncement, exactement comme sur une
 * bavette du commerce que l'on pousse jusqu'a ce qu'elle bute.
 */
export interface BillSlotPlan {
  /** Station de coupe du nez, en fraction de la longueur. */
  cutP: number;
  /** Centre de la fente, a une abscisse donnee. */
  centreAt: (x: number) => number;
  /** Demi-etendue de la fente mesuree a abscisse constante. */
  halfBand: number;
  /** Profondeur creusee par coque, en cm. */
  depth: number;
  /** Longueur de plaque reellement enfoncee, en cm. */
  insertion: number;
  /** Point du contour de la fente, en coordonnees (avance, travers). */
  along: (u: number, v: number) => THREE.Vector2;
  /** Demi-epaisseur de la fente, jeu d'insertion compris. */
  halfPlate: number;
  /** Vrai si la plaque est plus large que ce que la tete peut recevoir. */
  tooWide: boolean;
  /** Position du talon de la plaque, en coordonnees du plan de joint. */
  root: THREE.Vector2;
}

/**
 * Epaisseur de matiere reellement disponible par coque sur une bande de la
 * face de coupe, en cm.
 *
 * La demi-largeur de la section ne suffit pas : la fente est basse dans la
 * tete, et la coque y est bien plus mince qu'a mi-hauteur. Sans cette mesure
 * la fente serait annoncee plus profonde qu'elle ne peut l'etre, et la
 * plaque buterait avant d'entrer. Le calcul vit dans l'assemblage, qui seul
 * connait la surface et le plan de joint.
 */
export type BillRoomProbe = (x: number, tLo: number, tHi: number) => number;

export function billSlotPlan(
  profile: ProfileSampler,
  params: LureParams,
  probe?: BillRoomProbe,
  minCutP = 0,
): BillSlotPlan | null {
  const size = billSize(params);
  const angle = THREE.MathUtils.degToRad(clamp(params.bibAngle, 5, 89));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Empreinte = plaque + jeu d'insertion, sur toutes les dimensions.
  const fit = params.fabrication.billFit * MM_TO_CM;
  const half = (size.thickness * MM_TO_CM + fit) / 2;
  const halfBand = half / cos;

  // La bavette sort de la FACE DE COUPE, au menton, a 55 % de la hauteur vers
  // le ventre. C'est la face qui la porte : la pointe du nez, elle, a ete
  // retiree pour laisser passer la plaque. Ancrer l'axe sur la pointe
  // disparue le ferait grimper jusqu'a mi-hauteur de la tete, la ou passe
  // deja la goupille de nez.
  const centreOf = (p: number) => profile.section(p).bottom * 0.55;
  /** Axe de la plaque pour une coupe donnee : u = 0 a la bouche de la fente. */
  const axisFor = (p: number) => {
    const x = profile.xAt(p);
    const t = centreOf(p);
    return {
      along: (u: number, v: number) =>
        new THREE.Vector2(x - u * cos + v * sin, t - u * sin - v * cos),
      centreAt: (q: number) => t - ((x - q) / cos) * sin,
    };
  };

  const fits = (p: number): boolean => {
    const section = profile.section(p);
    const t = centreOf(p);
    return (
      section.halfWidth - WALL >= 0.08 &&
      section.bottom <= t - halfBand - WALL &&
      t + halfBand <= section.top - WALL
    );
  };

  const length = Math.max(size.length * MM_TO_CM, 0.2);
  const plateHalf = Math.max((size.width * MM_TO_CM) / 2, 0.15);
  const outline = halfOutline(params);
  // Demi-largeur du talon de la plaque : c'est elle qu'il faut loger.
  const tangHalf = (outline[0][1] / REFERENCE_HALF) * plateHalf + fit / 2;

  // On coupe la tete la ou la bande de la plaque tient dans la section. On
  // recule ensuite tant que la coupe gagne de l'enfoncement — la section
  // s'epaissit, donc la fente s'approfondit et la plaque entre plus loin —
  // sans jamais depasser un dixieme de la longueur ni douze millimetres,
  // au-dela desquels la coupe se verrait sur le nez.
  const roomAt = (p: number) => {
    if (!probe) return profile.section(p).halfWidth - WALL;
    const t = centreOf(p);
    return Math.max(probe(profile.xAt(p), t - halfBand, t + halfBand) - WALL, 0);
  };
  const insertionAt = (p: number) => {
    const depth = Math.min(roomAt(p), plateHalf + fit / 2);
    const target = ((depth - fit / 2) / plateHalf) * REFERENCE_HALF;
    return advanceAtHalfWidth(outline, target) * length;
  };

  // La coupe ne peut pas etre plus en avant que celle qu'un passage de
  // goupille de nez impose deja, ni que le recul demande par l'utilisateur.
  const offset = clamp(params.billOffset * MM_TO_CM, 0, profile.lengthCm * 0.3);
  const floor = clamp(Math.max(minCutP, offset / Math.max(profile.lengthCm, 1e-6)), 0, 0.45);
  let cutP = -1;
  const steps = 400;
  for (let i = 0; i <= steps; i++) {
    const p = floor + ((0.5 - floor) * i) / steps;
    if (fits(p)) {
      cutP = p;
      break;
    }
  }
  if (cutP < 0) return null;

  const wanted = length * 0.3;
  const setback = Math.min(
    cutP + 0.08,
    cutP + 0.8 / Math.max(profile.lengthCm, 1e-6),
    Math.max(0.4, floor + 0.02),
  );
  let best = cutP;
  for (let i = 1; i <= steps; i++) {
    const p = cutP + ((setback - cutP) * i) / steps;
    if (!fits(p)) continue;
    // A enfoncement egal — cas d'une tete trop fine pour le talon — on garde
    // au moins la section la plus large, donc la fente la plus profonde.
    const gain = insertionAt(p) - insertionAt(best);
    if (gain > 1e-6 || (Math.abs(gain) <= 1e-6 && roomAt(p) > roomAt(best))) best = p;
    if (insertionAt(best) >= wanted && roomAt(best) >= tangHalf) break;
  }
  cutP = best;

  const room = roomAt(cutP);
  const depth = Math.min(room, plateHalf + fit / 2);
  const insertion = Math.max(insertionAt(cutP), 0.2);

  const { along, centreAt } = axisFor(cutP);

  return {
    cutP,
    centreAt,
    halfBand,
    depth,
    insertion,
    along,
    halfPlate: half,
    // Seul le talon doit tenir : la palette, elle, reste dehors.
    tooWide: tangHalf > room,
    root: along(-insertion, 0),
  };
}

/** Demi-largeur de la plaque a une avance donnee, en cm. */
export function billHalfWidthAt(params: LureParams, u: number): number {
  const size = billSize(params);
  const plateHalf = Math.max((size.width * MM_TO_CM) / 2, 0.15);
  return (halfWidthAt(halfOutline(params), u) / REFERENCE_HALF) * plateHalf;
}

/**
 * Coupe un contour ferme par le demi-plan y >= 0 (ou y <= 0).
 *
 * La bavette est une plaque dont la LARGEUR est laterale : pour la partager
 * entre les deux coques, il faut trancher son contour dans le plan de joint,
 * et non couper son epaisseur.
 */
export function clipHalfPlane(
  points: THREE.Vector2[],
  keepPositive: boolean,
): THREE.Vector2[] {
  const inside = (point: THREE.Vector2) => (keepPositive ? point.y >= 0 : point.y <= 0);
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const previous = points[(i + points.length - 1) % points.length];
    const currentIn = inside(current);
    const previousIn = inside(previous);
    if (currentIn !== previousIn) {
      // Intersection avec y = 0.
      const t = previous.y / (previous.y - current.y);
      out.push(new THREE.Vector2(previous.x + (current.x - previous.x) * t, 0));
    }
    if (currentIn) out.push(current);
  }
  return out;
}
