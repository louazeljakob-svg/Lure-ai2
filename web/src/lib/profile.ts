/**
 * Mathematiques de profil parametrique.
 *
 * Un seul et meme echantillonneur alimente :
 *   - la generation de la geometrie 3D (lib/geometry.ts)
 *   - les silhouettes SVG de la galerie et des projets (components/LureSilhouette)
 * ce qui garantit que la miniature correspond toujours au modele imprime.
 *
 * `p` est la position normalisee sur l'axe du leurre : 0 = nez, 1 = extremite
 * de la queue. Toutes les valeurs retournees sont en centimetres.
 */

import type { LureParams } from '../types/lure';

export const MM_TO_CM = 0.1;

export interface Section {
  /** Demi-largeur laterale (axe Z). */
  halfWidth: number;
  /** Ordonnee du dos (positive). */
  top: number;
  /** Ordonnee du ventre (negative). */
  bottom: number;
}

export interface ProfileSampler {
  /** Longueur hors-tout en cm. */
  lengthCm: number;
  /** Fraction de la longueur occupee par le corps tubulaire. */
  bodyEnd: number;
  /** Vrai si une nageoire caudale plate est ajoutee apres le corps. */
  hasFin: boolean;
  /** Facteur de section (0 -> 1) a la position p. */
  radiusFactor: (p: number) => number;
  /** Section complete a la position p. */
  section: (p: number) => Section;
  /** Abscisse en cm, repere centre sur le leurre (nez a -L/2), creux de bouche inclus. */
  xAt: (p: number) => number;
}

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

const gauss = (p: number, center: number, width: number): number =>
  Math.exp(-((p - center) ** 2) / (2 * width * width));

export const tailHasFin = (params: LureParams): boolean =>
  params.tailShape === 'forked' || params.tailShape === 'paddle' || params.tailShape === 'fan';

/**
 * Rayon relatif a l'extremite arriere du corps, avant arrondi de fermeture.
 * Une queue en pointe se ferme sur elle-meme, une queue a nageoire garde un
 * pedoncule sur lequel la nageoire vient se greffer.
 */
const endRadiusFor = (params: LureParams): number => {
  if (params.tailShape === 'taper') return 0;
  if (params.tailShape === 'round') return 0.34;
  return 0.28;
};

/** Longueur (en fraction de la longueur totale) de l'arrondi de fermeture. */
const capLengthFor = (params: LureParams): number => {
  if (params.tailShape === 'taper') return 0;
  if (params.tailShape === 'round') return 0.09;
  return 0.035;
};

export function createProfile(params: LureParams): ProfileSampler {
  const lengthCm = params.length * MM_TO_CM;
  const halfW = (params.maxWidth * MM_TO_CM) / 2;
  const halfH = (params.thickness * MM_TO_CM) / 2;

  const hasFin = tailHasFin(params);
  const bodyEnd = hasFin ? clamp(1 - 0.16 * params.tailSize, 0.68, 0.94) : 1;

  const belly = clamp(params.bellyPosition, 0.12, bodyEnd - 0.12);
  const noseExp = clamp(params.noseSharpness, 0.2, 1.6);
  const tailExp = clamp(params.tailTaper, 0.35, 2.4);
  const endR = endRadiusFor(params);
  const cup = clamp(params.mouthCup ?? 0, 0, 1);
  const capLen = capLengthFor(params);
  const capStart = bodyEnd - capLen;

  const radiusFactor = (p: number): number => {
    if (p <= 0 || p >= bodyEnd) return 0;

    let r: number;
    if (p < belly) {
      // Avant : montee du nez vers le ventre le plus large.
      r = Math.pow(Math.sin((p / belly) * (Math.PI / 2)), noseExp);
    } else {
      // Arriere : decroissance du ventre vers le pedoncule.
      const u = (p - belly) / (bodyEnd - belly);
      const core = Math.pow(Math.cos(u * (Math.PI / 2)), tailExp);
      r = endR + (1 - endR) * core;
    }

    // Fermeture spherique de l'arriere du corps.
    if (capLen > 0 && p > capStart) {
      const v = (p - capStart) / capLen;
      r *= Math.sqrt(Math.max(0, 1 - v * v));
    }
    return clamp(r, 0, 1);
  };

  const section = (p: number): Section => {
    const r = radiusFactor(p);
    const dorsal = clamp(1 + 0.5 * params.dorsalCurve * gauss(p, 0.33, 0.24), 0.3, 1.8);
    const ventral = clamp(1 + 0.5 * params.ventralCurve * gauss(p, belly, 0.26), 0.3, 1.8);
    return {
      halfWidth: halfW * r,
      top: halfH * r * dorsal,
      bottom: -halfH * r * ventral,
    };
  };

  // Bouche creusee : on recule l'apex du nez tout en laissant la levre en
  // place, ce qui creuse une cuvette conique a l'avant du leurre.
  const CUP_REGION = 0.13;
  const cupDepth = cup * 0.35 * halfH * radiusFactor(CUP_REGION);
  const xAt = (p: number): number => {
    const x = p * lengthCm - lengthCm / 2;
    if (cupDepth <= 0 || p >= CUP_REGION) return x;
    return x + cupDepth * Math.pow(1 - p / CUP_REGION, 1.4);
  };

  return { lengthCm, bodyEnd, hasFin, radiusFactor, section, xAt };
}
