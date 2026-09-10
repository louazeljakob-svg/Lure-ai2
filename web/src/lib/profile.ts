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

import type { LureParams, Outline } from '../types/lure';
import { flattenOutline } from './outline';

export const MM_TO_CM = 0.1;

export interface Section {
  /**
   * Decalage vertical de la section entiere, en cm.
   *
   * L'inclinaison de tete est une TRANSLATION, pas une deformation : si on
   * la baissait en modifiant `top` et `bottom`, une tete fortement piquee
   * ferait passer les deux du meme cote de zero et la superellipse se
   * retournerait. En la gardant a part, la forme reste exactement celle d'un
   * angle nul et ne fait que se deplacer.
   */
  offset: number;
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

  // Silhouette dessinee a la main : quand elle existe, c'est ELLE qui donne le
  // dos et le ventre. Le reste du parametrique — largeur, section, queue —
  // continue de s'appliquer par-dessus, sinon dessiner un profil obligerait a
  // tout redessiner.
  const drawn = drawnEnvelope(params.outline);

  // Inclinaison de tete : la silhouette avant se releve ou pique en bloc,
  // sans changer d'epaisseur. Le decalage s'eteint a la section maitresse —
  // au-dela, le corps est exactement celui d'avant, ce qui garantit qu'un
  // angle nul ne change rien du tout.
  const noseRad = (clamp(params.noseAngle ?? 0, -45, 45) * Math.PI) / 180;
  const rake = (p: number): number => {
    if (noseRad === 0 || p >= belly) return 0;
    const u = 1 - p / belly;
    return Math.tan(noseRad) * lengthCm * belly * 0.5 * u * u;
  };

  const section = (p: number): Section => {
    const r = radiusFactor(p);
    if (drawn) {
      const envelope = drawn(p);
      if (envelope) {
        // La largeur suit la hauteur locale : un corps dessine plus fin a la
        // queue doit aussi y etre moins large.
        const reference = Math.max(drawn.reference, 1e-6);
        const spread = (envelope.top - envelope.bottom) / (2 * reference);
        return {
          halfWidth: halfW * Math.min(spread, 1.4),
          top: halfH * envelope.top * 2,
          bottom: halfH * envelope.bottom * 2,
          offset: rake(p),
        };
      }
    }
    const dorsal = clamp(1 + 0.5 * params.dorsalCurve * gauss(p, 0.33, 0.24), 0.3, 1.8);
    const ventral = clamp(1 + 0.5 * params.ventralCurve * gauss(p, belly, 0.26), 0.3, 1.8);
    return {
      halfWidth: halfW * r,
      top: halfH * r * dorsal,
      bottom: -halfH * r * ventral,
      offset: rake(p),
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

// ---------------------------------------------------------------------------
// Silhouette dessinee a la main
// ---------------------------------------------------------------------------

/** Enveloppe haute et basse du trace, a une station donnee. */
interface Envelope {
  top: number;
  bottom: number;
}

interface DrawnSampler {
  (p: number): Envelope | null;
  /** Demi-hauteur maximale du trace : sert a normaliser l'echelle. */
  reference: number;
}

/**
 * Convertit un contour dessine en enveloppe interrogeable.
 *
 * On aplatit le trace, on le ramene dans [0, 1] sur l'axe du corps, puis on
 * releve pour chaque station la valeur la plus haute et la plus basse. Le
 * dessin peut donc etre fait a n'importe quelle echelle et dans n'importe
 * quel sens : c'est sa BOITE qui est recalee sur le leurre, pas ses nombres.
 */
export function drawnEnvelope(outline: Outline | undefined): DrawnSampler | null {
  if (!outline || outline.nodes.length < 2) return null;
  const points = flattenOutline(outline);
  if (points.length < 3) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX < 1e-6 || spanY < 1e-6) return null;

  // Echantillonnage regulier : plus rapide a interroger qu'un parcours du
  // polygone a chaque station, et le corps en demande des milliers.
  const STEPS = 240;
  const top = new Float32Array(STEPS + 1).fill(-Infinity);
  const bottom = new Float32Array(STEPS + 1).fill(Infinity);
  const centre = (minY + maxY) / 2;

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const from = Math.min(a.x, b.x);
    const to = Math.max(a.x, b.x);
    const i0 = Math.max(Math.floor(((from - minX) / spanX) * STEPS), 0);
    const i1 = Math.min(Math.ceil(((to - minX) / spanX) * STEPS), STEPS);
    for (let k = i0; k <= i1; k++) {
      const x = minX + (spanX * k) / STEPS;
      if (x < from - 1e-9 || x > to + 1e-9) continue;
      const t = Math.abs(b.x - a.x) < 1e-9 ? 0 : (x - a.x) / (b.x - a.x);
      const y = a.y + (b.y - a.y) * t;
      if (y > top[k]) top[k] = y;
      if (y < bottom[k]) bottom[k] = y;
    }
  }

  // Les stations que le trace ne couvre pas heritent de leur voisine : un
  // contour ouvert ne doit pas creuser un trou dans le corps.
  for (let k = 1; k <= STEPS; k++) {
    if (top[k] === -Infinity) top[k] = top[k - 1];
    if (bottom[k] === Infinity) bottom[k] = bottom[k - 1];
  }
  for (let k = STEPS - 1; k >= 0; k--) {
    if (top[k] === -Infinity) top[k] = top[k + 1];
    if (bottom[k] === Infinity) bottom[k] = bottom[k + 1];
  }

  const reference = spanY / 2;
  const sampler = ((p: number): Envelope | null => {
    if (p < 0 || p > 1) return null;
    const f = p * STEPS;
    const k = Math.min(Math.floor(f), STEPS - 1);
    const t = f - k;
    const hi = (top[k] * (1 - t) + top[k + 1] * t - centre) / spanY;
    const lo = (bottom[k] * (1 - t) + bottom[k + 1] * t - centre) / spanY;
    return { top: hi, bottom: lo };
  }) as DrawnSampler;
  sampler.reference = reference / spanY;
  return sampler;
}
