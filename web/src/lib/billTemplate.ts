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

/** Masse volumique du polycarbonate, en g/cm3. */
export const POLYCARBONATE_DENSITY = 1.2;

/**
 * Volume de la plaque, en cm3 : surface du contour fois epaisseur. C'est la
 * meme plaque dans les deux modes ; seule sa matiere change.
 */
export function billPlateVolume(profile: ProfileSampler, params: LureParams): number {
  const { points } = bibShape(profile, params);
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return (Math.abs(area) / 2) * billSize(params).thickness * MM_TO_CM;
}

/** Contour du gabarit a decouper, aux cotes reelles. */
export const bibOutline = (profile: ProfileSampler, params: LureParams): THREE.Vector2[] =>
  bibShape(profile, params).points;

/**
 * Plan de la fente d'insertion — l'empreinte negative de la plaque.
 *
 * UNE seule fonction, pour la bavette imprimee comme pour la polycarbonate
 * (module AE) : meme fente, meme profil, meme jeu d'insertion, meme bornage.
 * Seules changent la matiere de la plaque et son epaisseur.
 *
 * Placement (module AF) : la fente debouche sous la tete, la ou l'axe de la
 * plaque traverse la peau du menton, a la distance du NEZ donnee par le
 * reglage — jamais depuis l'origine du repere. Elle ne bouge pas pour
 * « trouver de la place » : si la plaque ne tient pas la, c'est dit.
 *
 * Bornage : le volume creuse est l'emprise reelle de la plaque — son
 * epaisseur majoree du jeu, la largeur de sa partie enfoncee, la profondeur
 * d'insertion — et rien au-dela. Le fond est ferme. Ce n'est jamais un plan
 * de coupe traversant : la tete reste entiere autour de la fente.
 *
 * Refus : si l'enfoncement demande percerait la peau opposee ou sortirait de
 * la tete, la fente n'est pas creusee, et la profondeur maximale admissible
 * a cet emplacement est annoncee.
 */
export interface BillSlotPlan {
  /** Station du point de sortie de la plaque, en fraction de la longueur. */
  cutP: number;
  /** Centre de la fente, a une abscisse donnee. */
  centreAt: (x: number) => number;
  /** Demi-etendue de la fente mesuree a abscisse constante. */
  halfBand: number;
  /** Profondeur creusee par coque, en cm : demi-largeur de la partie enfoncee, jeu compris. */
  depth: number;
  /** Longueur de plaque reellement enfoncee, en cm. */
  insertion: number;
  /** Point du contour de la fente, en coordonnees (avance, travers). */
  along: (u: number, v: number) => THREE.Vector2;
  /** Demi-epaisseur de la fente, jeu d'insertion compris. */
  halfPlate: number;
  /** Vrai si le talon est plus large que ce que la tete peut recevoir. */
  tooWide: boolean;
  /** Position du talon de la plaque, en coordonnees du plan de joint. */
  root: THREE.Vector2;
  /** Point ou l'axe de la plaque traverse la peau du menton. */
  mouth: THREE.Vector2;
  /** Enfoncement maximal admissible a cet emplacement, en cm. */
  maxInsertion: number;
  /** Abscisse d'axe (parametre de `along`) atteinte a un enfoncement donne depuis la peau. */
  depthU: (insertion: number) => number;
}

/**
 * Epaisseur de matiere reellement disponible par coque sur une bande de la
 * face de joint, en cm. Le calcul vit dans l'assemblage, qui seul connait la
 * surface et le plan de joint.
 */
export type BillRoomProbe = (x: number, tLo: number, tHi: number) => number;

/** Etendue transverse du corps dans le plan de joint, a une abscisse. */
export type BillRangeProbe = (x: number) => [number, number] | null;

export interface BillPlacement {
  plan: BillSlotPlan | null;
  /** Refus motive, ou null. */
  problem: string | null;
}

/** Enfoncement automatique : la plaque entre jusqu'a buter, comme sur un leurre du commerce. */
export const BILL_AUTO = 0;

export function billSlotPlan(
  profile: ProfileSampler,
  params: LureParams,
  room: BillRoomProbe,
  range: BillRangeProbe,
  /** Abscisse de la coupe de nez imposee par une goupille, ou -Infinity. */
  minX = -Infinity,
): BillPlacement {
  const size = billSize(params);
  const angle = THREE.MathUtils.degToRad(clamp(params.bibAngle, 5, 89));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Empreinte = plaque + jeu d'insertion, sur toutes les dimensions. Le jeu
  // est le meme pour les deux modes : il n'existe qu'une table de jeux.
  const fit = params.fabrication.billFit * MM_TO_CM;
  const halfPlate = (size.thickness * MM_TO_CM + fit) / 2;
  const halfBand = halfPlate / cos;
  const length = Math.max(size.length * MM_TO_CM, 0.2);

  // Repere : le NEZ. L'abscisse 0 du profil est la pointe du leurre, quelle
  // que soit la longueur ou l'origine de la scene.
  const nose = profile.xAt(0);
  const offsetMm = clamp(params.billOffset, 0, (profile.lengthCm / MM_TO_CM) * 0.3);
  const xA = nose + offsetMm * MM_TO_CM;
  if (xA < minX + 0.02) {
    return {
      plan: null,
      problem:
        `La fente de bavette a ${offsetMm.toFixed(1)} mm du nez tombe dans la coupe du passage de ` +
        `goupille de nez (${((minX - nose) / MM_TO_CM).toFixed(1)} mm). Reculez l ancrage de bavette ` +
        'ou sortez la goupille de nez autrement.',
    };
  }
  const at = range(xA);
  if (!at) {
    return { plan: null, problem: `A ${offsetMm.toFixed(1)} mm du nez, la tete n a pas encore de section.` };
  }
  // Point d'ancrage : sur l'axe de la plaque, a 55 % de la hauteur du ventre
  // sous l'axe du corps — la convention historique de l'ancrage de bavette.
  // L'inclinaison de tete est prise en compte : c'est un decalage de la
  // section entiere, pas du repere.
  let lo = 0;
  let hi = profile.bodyEnd;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (profile.xAt(mid) < xA) lo = mid;
    else hi = mid;
  }
  const raise = profile.section((lo + hi) / 2).offset;
  const tA = raise + 0.55 * (at[0] - raise);
  const axis = (u: number) => new THREE.Vector2(xA - u * cos, tA - u * sin);

  // Point de sortie : la ou l'axe traverse la peau du menton, vers l'avant.
  // L'enfoncement se mesure depuis la, le long de la plaque.
  let uSkin = 0;
  for (let u = 0; u <= profile.lengthCm * 0.2; u += 0.005) {
    const point = axis(u);
    const span = range(point.x);
    uSkin = u;
    if (!span || point.y <= span[0]) break;
  }
  const along = (u: number, v: number) =>
    new THREE.Vector2(xA - u * cos + v * sin, tA - u * sin - v * cos);
  const centreAt = (x: number) => tA - ((xA - x) / cos) * sin;
  const mouth = axis(uSkin);
  /** Point de l'axe a une profondeur d'enfoncement donnee, depuis la peau. */
  const depthU = (insertion: number) => uSkin - insertion;

  // Profondeur creusee pour un enfoncement I : la demi-largeur de la partie
  // de plaque reellement enfoncee (le talon s'elargit vers la sortie), plus
  // la moitie du jeu. Pas davantage.
  const depthFor = (insertion: number) =>
    billHalfWidthAt(params, clamp(insertion / length, 0, 1)) + fit / 2;

  // Releve le long de l'axe, une fois pour toutes, depuis la peau vers
  // l'interieur : bande dans la section, et matiere disponible par coque sur
  // la largeur de la bande.
  const STEP = 0.02;
  const reachMax = Math.min(length * 0.8, profile.lengthCm * 0.3);
  const samples: { u: number; inside: boolean; fits: boolean; room: number }[] = [];
  let entered = false;
  for (let u = STEP; u <= reachMax + 1e-9; u += STEP) {
    const point = along(depthU(u), 0);
    const span = range(point.x);
    if (!span) {
      samples.push({ u, inside: false, fits: false, room: 0 });
      continue;
    }
    const [lo, hi] = span;
    const base = point.y - halfBand;
    const top = point.y + halfBand;
    const inside = base >= lo + WALL;
    const fits = top <= hi - WALL;
    if (inside) entered = true;
    samples.push({
      u,
      inside,
      fits,
      room: inside && fits ? room(point.x, base, top) : entered ? 0 : Infinity,
    });
  }

  // Enfoncement admissible pour une profondeur donnee. Juste derriere la
  // peau, la plaque peut etre plus large que le menton : c'est la bouche,
  // ouverte de part en part sur quelques millimetres au plus. Des que la
  // tete la tient — bande dans la section ET coque assez epaisse pour sa
  // largeur —, elle doit la tenir jusqu'au fond, peau comprise.
  const MOUTH_MAX = 0.35;
  const reachFor = (depth: number): number => {
    let reach = 0;
    let held = false;
    for (const sample of samples) {
      if (!sample.fits) break;
      if (!sample.inside) {
        if (held) break;
        reach = sample.u;
        continue;
      }
      if (sample.room >= depth + WALL) {
        held = true;
        reach = sample.u;
        continue;
      }
      if (held || sample.u > MOUTH_MAX) break;
      reach = sample.u;
    }
    return held ? reach : 0;
  };
  let maxInsertion = 0;
  for (let insertion = STEP; insertion <= reachMax + 1e-9; insertion += STEP) {
    if (reachFor(depthFor(insertion)) + 1e-9 >= insertion) maxInsertion = insertion;
    else break;
  }

  const requested = Math.max(params.billInsertion ?? BILL_AUTO, 0) * MM_TO_CM;
  const insertion = requested > 0 ? requested : Math.min(maxInsertion, length * 0.6);
  if (maxInsertion < 0.2) {
    const first = samples.find((sample) => sample.inside && sample.fits);
    const need = depthFor(0.2) + WALL;
    const problem =
      first && first.room < need
        ? `A ${offsetMm.toFixed(1)} mm du nez, le talon de la bavette demande ` +
          `${((need * 2) / MM_TO_CM).toFixed(1)} mm de large peau comprise et la tete n en offre que ` +
          `${((first.room * 2) / MM_TO_CM).toFixed(1)} mm : reduisez la largeur de la bavette ou ` +
          'reculez l ancrage vers une section plus large.'
        : `A ${offsetMm.toFixed(1)} mm du nez, la plaque de ${size.thickness.toFixed(1)} mm (jeu compris ` +
          `${((halfPlate * 2) / MM_TO_CM).toFixed(2)} mm) sortirait par le dessus de la tete avant de ` +
          'se loger : reduisez l angle de la bavette ou reculez l ancrage.';
    return { plan: null, problem };
  }
  if (insertion > maxInsertion + 1e-6) {
    return {
      plan: null,
      problem:
        `Enfoncement de ${(insertion / MM_TO_CM).toFixed(1)} mm refuse : au-dela de ` +
        `${(maxInsertion / MM_TO_CM).toFixed(1)} mm, la fente percerait la peau de la tete ou en ` +
        `sortirait. Profondeur maximale admissible a ${offsetMm.toFixed(1)} mm du nez : ` +
        `${(maxInsertion / MM_TO_CM).toFixed(1)} mm.`,
    };
  }

  return {
    plan: {
      cutP: clamp((xA - nose) / Math.max(profile.lengthCm, 1e-6), 0, 1),
      centreAt,
      halfBand,
      depth: depthFor(insertion),
      insertion,
      along,
      halfPlate,
      tooWide: false,
      root: along(depthU(insertion), 0),
      mouth,
      maxInsertion,
      depthU,
    },
    problem: null,
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
