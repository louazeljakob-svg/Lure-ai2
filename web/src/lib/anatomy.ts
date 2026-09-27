/**
 * Corps anatomique — module AB.
 *
 * Le corps historique etait une goutte : un rayon interpole entre le nez et
 * la queue, et une section constante etiree dessus. Un poisson ne se
 * construit pas ainsi. Ici le corps repose sur une ARMATURE — commissure,
 * oeil, bord d'opercule, section maitresse, pedoncule, base de caudale — et
 * sur trois profils independants :
 *
 *   - le dos, au-dessus de l'axe ;
 *   - le ventre, au-dessous ;
 *   - la demi-largeur.
 *
 * Aucun des trois n'est derive d'un autre. Ce sont des courbes cubiques
 * monotones par morceaux (PCHIP) : elles passent exactement par leurs points
 * de controle, gardent la continuite de tangente d'une station a l'autre et
 * ne depassent jamais — une bosse de dos ne fabrique pas de creux parasite
 * juste avant elle, ce que ferait une spline naturelle.
 *
 * La FORME de section varie elle aussi le long du corps : l'exposant de
 * superellipse du dessus et celui du dessous sont deux courbes de plus. Un
 * exposant inferieur a 2 donne une carene — l'arete dorsale — dont la
 * vivacite suit la courbe ; superieur a 2, une epaule pleine. Les deux moities
 * se raccordent toujours avec une tangente verticale a la largeur maximale,
 * quel que soit l'ecart entre leurs exposants : la continuite G1 est acquise
 * par construction, pas par reglage.
 *
 * L'anatomie de tete, la ligne laterale et les nageoires sont des champs de
 * deplacement de la peau, comme les ouies historiques : ils deforment le
 * corps lui-meme, si bien que le maillage reste ferme et que chaque detail
 * existe dans le STL, dans les deux coques et dans le calcul de volume.
 */

import * as THREE from 'three';
import type { Anatomy, FinConfig, FinMode, LureParams, ProfileKnot } from '../types/lure';
import type { ProfileSampler, Section } from './profile';

const MM = 0.1;

const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const sgnPow = (v: number, e: number): number =>
  (v < 0 ? -1 : 1) * Math.pow(Math.abs(v), e);

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clampN((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Maximum adouci : raccord de conge quadratique entre deux surfaces. */
const softMax0 = (a: number, k: number): number => {
  if (a <= -k) return 0;
  if (a >= k) return a;
  return ((a + k) * (a + k)) / (4 * k);
};

/** Angle de l'oeil depuis le dos, en radians : le meme que la livree. */
export const EYE_THETA = 1.15;

/**
 * Fente ventrale d'un souple : 42 % de la hauteur locale, 1,2 mm de large
 * (fil d'hamecon de 1 a 1,2 mm, plus le jeu).
 */
export function softSlotOf(params: LureParams): { from: number; to: number; depth: number; halfWidth: number } | null {
  if (!params.soft?.enabled || params.soft.rigging !== 'slot') return null;
  const anatomy = params.anatomy;
  // Juste derriere la ventouse (ou la gorge), sur 12 % de la longueur : la
  // hampe va de l'oeillet, au nez, au bout de la fente ; la pointe ressort
  // du dos au droit du coude. Un 90 mm prend ainsi un hamecon de 4/0.
  const from = anatomy ? Math.max(anatomy.pelvicFin.to + 0.02, 0.25) : 0.3;
  const limit = anatomy && anatomy.analFin.enabled ? anatomy.analFin.from - 0.03 : 0.9;
  const to = Math.min(from + 0.12, limit);
  return { from, to: Math.max(to, from + 0.06), depth: 0.42, halfWidth: 0.06 };
}

/**
 * Profondeur du canal longitudinal d'un souple, en cm : la longueur de hampe
 * d'une tete plombee a la taille du leurre, un tiers de la longueur.
 */
export const channelDepthCm = (params: LureParams): number =>
  clampN(0.33 * params.length, 15, 50) * MM;

// ---------------------------------------------------------------------------
// Courbes de profil
// ---------------------------------------------------------------------------

/**
 * Interpolation cubique d'Hermite monotone par morceaux (Fritsch-Carlson).
 *
 * Les tangentes sont choisies pour que la courbe reste monotone sur chaque
 * intervalle ou les donnees le sont : pas de depassement, et une derivee
 * continue d'un point de controle a l'autre.
 */
export function pchip(knots: ProfileKnot[]): (u: number) => number {
  const sorted = [...knots]
    .filter((k) => Number.isFinite(k.u) && Number.isFinite(k.v))
    .sort((a, b) => a.u - b.u);
  const pts: ProfileKnot[] = [];
  for (const k of sorted) {
    if (pts.length && Math.abs(k.u - pts[pts.length - 1].u) < 1e-6) pts[pts.length - 1] = k;
    else pts.push(k);
  }
  const n = pts.length;
  if (n === 0) return () => 0;
  if (n === 1) return () => pts[0].v;

  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(pts[i + 1].u - pts[i].u);
    d.push((pts[i + 1].v - pts[i].v) / h[i]);
  }
  const m: number[] = new Array(n).fill(0);
  if (n === 2) {
    m[0] = d[0];
    m[1] = d[0];
  } else {
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) {
        m[i] = 0;
      } else {
        const w1 = 2 * h[i] + h[i - 1];
        const w2 = h[i] + 2 * h[i - 1];
        m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
      }
    }
    const end = (h0: number, h1: number, d0: number, d1: number): number => {
      let t = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
      if (Math.sign(t) !== Math.sign(d0)) t = 0;
      else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(t) > Math.abs(3 * d0)) t = 3 * d0;
      return t;
    };
    m[0] = end(h[0], h[1], d[0], d[1]);
    m[n - 1] = end(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
  }

  return (u: number): number => {
    if (u <= pts[0].u) return pts[0].v;
    if (u >= pts[n - 1].u) return pts[n - 1].v;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].u <= u) lo = mid;
      else hi = mid;
    }
    const t = (u - pts[lo].u) / h[lo];
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * pts[lo].v +
      (t3 - 2 * t2 + t) * h[lo] * m[lo] +
      (-2 * t3 + 3 * t2) * pts[hi].v +
      (t3 - t2) * h[lo] * m[hi]
    );
  };
}

// ---------------------------------------------------------------------------
// Point de section
// ---------------------------------------------------------------------------

/**
 * Point de la section non deformee a l'angle theta (0 = dos, PI = ventre).
 *
 * C'est la seule definition de la forme de section du logiciel : corps,
 * segments, coques d'assemblage et reliefs passent tous par elle.
 */
export function sectionPoint(
  section: Section,
  theta: number,
  fallbackN: number,
): { y: number; z: number } {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const upper = c >= 0;
  const n = (upper ? section.nUpper : section.nLower) ?? fallbackN;
  const e = 2 / n;
  return {
    y: sgnPow(c, e) * (upper ? section.top : -section.bottom),
    z: sgnPow(s, e) * section.halfWidth,
  };
}

// ---------------------------------------------------------------------------
// Champ anatomique
// ---------------------------------------------------------------------------

export interface AnatomyField {
  /** Deplacement le long de la normale approchee, en cm : tete, ligne laterale, nageoires couchees. */
  relief: (p: number, theta: number, section: Section) => number;
  /** Deplacement vertical signe, en cm : cretes dorsale et anale, dans le plan de symetrie. */
  crest: (p: number, theta: number, z: number) => number;
  /** Repartition angulaire : s dans [0, 1] donne theta, plus serre au dos et au ventre. */
  thetaAt: (s: number) => number;
  /** Repartition des stations : t dans [0, 1] donne p, serrees a la tete et au pedoncule. */
  stationAt: (t: number) => number;
  /** Reciproque de `stationAt`. */
  stationOf: (p: number) => number;
}

/** Resserrement angulaire : deux fois plus de colonnes au dos et au ventre qu'aux flancs. */
const THETA_WARP = 0.5;

export const warpTheta = (s: number, c = THETA_WARP): number =>
  Math.PI * 2 * (s - (c * Math.sin(4 * Math.PI * s)) / (4 * Math.PI));

/** Meme resserrement sur un arc de coque : dense aux deux bords du plan de joint. */
export const warpArc = (t: number, c = THETA_WARP): number =>
  t - (c * Math.sin(2 * Math.PI * t)) / (2 * Math.PI);

/** Table de repartition : densite -> abscisse cumulee, inversible. */
export function distribution(
  density: (p: number) => number,
  end: number,
): { at: (t: number) => number; of: (p: number) => number } {
  const N = 2400;
  const cdf = new Float64Array(N + 1);
  let prev = density(0);
  for (let i = 1; i <= N; i++) {
    const p = (end * i) / N;
    const cur = density(p);
    cdf[i] = cdf[i - 1] + ((prev + cur) / 2) * (end / N);
    prev = cur;
  }
  const total = cdf[N];
  for (let i = 0; i <= N; i++) cdf[i] /= total;
  const at = (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return end;
    let lo = 0;
    let hi = N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] <= t) lo = mid;
      else hi = mid;
    }
    const f = (t - cdf[lo]) / Math.max(cdf[hi] - cdf[lo], 1e-15);
    return (end * (lo + f)) / N;
  };
  const of = (p: number): number => {
    if (p <= 0) return 0;
    if (p >= end) return 1;
    const f = (p / end) * N;
    const i = Math.min(Math.floor(f), N - 1);
    return cdf[i] + (cdf[i + 1] - cdf[i]) * (f - i);
  };
  return { at, of };
}

/** Dependances fournies par le module de profil, pour eviter un cycle d'import. */
export interface AnatomyContext {
  hasFin: boolean;
  bodyEnd: number;
  /** Enveloppe dessinee a la main, ou null. */
  drawn: ((p: number) => { top: number; bottom: number } | null) | null;
  /** Caudale dessinee en relief sur le bout de queue (module AW). */
  caudalDrawn?: boolean;
  /** Caudale rapportee : le pedoncule se referme court, comme sous une lame. */
  finRoot?: boolean;
}

/**
 * Echantillonneur de profil d'un corps anatomique.
 *
 * Il presente exactement l'interface du profil historique : la geometrie,
 * l'assemblage en deux coques, la physique et les exports s'en servent sans
 * savoir quel moteur est derriere.
 */
export function createAnatomicalProfile(
  params: LureParams,
  anatomy: Anatomy,
  ctx: AnatomyContext,
): ProfileSampler {
  const L = params.length * MM;
  const H = params.thickness * MM;
  const W2 = (params.maxWidth * MM) / 2;
  const { hasFin, bodyEnd } = ctx;

  const D = pchip(anatomy.dorsal);
  const V = pchip(anatomy.ventral);
  const Wd = pchip(anatomy.width);
  const NU = pchip(anatomy.upper);
  const NL = pchip(anatomy.lower);

  // Les trois profils sont RELATIFS : on les recale pour que la hauteur et la
  // largeur maximales soient exactement celles des reglages. Les curseurs de
  // cotes restent donc la reference, les courbes ne portent que la forme.
  let maxH = 1e-6;
  let maxW = 1e-6;
  for (let i = 0; i <= 400; i++) {
    const u = i / 400;
    maxH = Math.max(maxH, D(u) + V(u));
    maxW = Math.max(maxW, Wd(u));
  }
  const kH = H / maxH;
  const kW = W2 / maxW;
  const cs = clampN(params.crossSection, 1.2, 3.6) / 2;

  // --- Face de popper creusee ---------------------------------------------
  //
  // La cuvette n'est plus un recul axial applique apres coup — ce recul
  // rendait chaque anneau non plan et interdisait l'assemblage en deux
  // coques. C'est ici le LOFT lui-meme qui entre dans la tete : les
  // premieres stations partent d'un fond plat, remontent la paroi de la
  // cuvette vers l'avant, contournent la levre par un conge, puis repartent
  // vers l'arriere le long du corps. Chaque station reste un anneau plan.
  const face = params.popperFace;
  const cup = face.enabled && face.depth > 0.05;
  // Canal longitudinal d'un souple (module AU.2) : meme principe, le loft
  // entre par le nez — mais en tube circulaire a fond hemispherique, raccorde
  // au museau par un conge. Le nez garde sa calotte, refermee sur l'anneau
  // du canal au lieu d'une pointe.
  const bore =
    !cup && params.soft?.enabled && params.soft.rigging === 'channel'
      ? {
          rc: (clampN(params.soft.channelDiameter, 0.8, 5) * MM) / 2,
          depth: channelDepthCm(params),
        }
      : null;
  const open = cup || bore !== null;
  const pc = cup ? 0.035 : bore ? 0.03 : 0;
  const lipR = cup ? Math.max(face.lipRadius, 0.3) * MM : bore ? 0.05 : 0;
  const cupDepth = cup ? Math.max(face.depth * MM, lipR * 1.2) : 0;
  const bottomRatio = cup ? clampN(1 - face.diameter, 0.15, 0.75) : 0;
  const xFront = -L / 2;
  const bodyStartX = xFront + (bore ? 0 : lipR);

  const uOf = (p: number): number =>
    open ? clampN((p - pc) / Math.max(bodyEnd - pc, 1e-6), 0, 1) : clampN(p / bodyEnd, 0, 1);

  const xBody = (p: number): number =>
    open ? bodyStartX + ((p - pc) / (1 - pc)) * (L - (bore ? 0 : lipR)) : p * L - L / 2;

  // Calotte de nez : le corps se referme en ogive, tangente perpendiculaire
  // a l'axe a la pointe. Pas de pointe vive, donc pas de facette de nez.
  const noseCap = cup ? 0 : clampN(anatomy.noseCap, 0.005, 0.25);
  const noseShape = clampN(anatomy.noseShape, 0.35, 1);
  // Arriere : une nageoire se greffe sur un pedoncule qui se referme en
  // calotte courte ; une queue ronde se ferme plus largement.
  const tailCap = hasFin || ctx.finRoot ? 0.03 : 0.07;

  const capFactor = (u: number): number => {
    let f = 1;
    if (noseCap > 0 && u < noseCap) {
      const s = u / noseCap;
      f *= Math.pow(Math.max(2 * s - s * s, 0), noseShape);
    }
    if (u > 1 - tailCap) {
      const s = (1 - u) / tailCap;
      f *= Math.sqrt(Math.max(2 * s - s * s, 0));
    }
    return f;
  };

  // Inclinaison de tete : meme translation que le profil historique.
  const noseRad = (clampN(params.noseAngle ?? 0, -45, 45) * Math.PI) / 180;
  const rakeEnd = 0.4 * bodyEnd;
  const rake = (p: number): number => {
    if (noseRad === 0 || p >= rakeEnd) return 0;
    const u = 1 - Math.max(p, pc) / rakeEnd;
    return Math.tan(noseRad) * L * rakeEnd * 0.5 * u * u;
  };

  const drawn = ctx.drawn;
  const bodySection = (p: number): Section => {
    const u = uOf(p);
    const f = capFactor(u);
    let top = D(u) * kH * f;
    let bottom = -V(u) * kH * f;
    let halfWidth = Wd(u) * kW * f;
    if (drawn) {
      // Silhouette dessinee : elle remplace le dos et le ventre, la largeur
      // reste celle de l'anatomie — dessiner un profil ne dit rien de la
      // vue de dessus.
      const env = drawn(p);
      if (env) {
        top = H * env.top * f;
        bottom = H * env.bottom * f;
      }
    }
    let nUpper = clampN(NU(u) * cs, 1.15, 5);
    let nLower = clampN(NL(u) * cs, 1.15, 5);
    if (bore) {
      // Le museau se referme sur l'anneau du canal : maximum adouci, sans
      // arete, et section qui s'arrondit en cercle a la levre.
      const R0 = bore.rc + lipR;
      const k = 0.6 * R0;
      const smax = (a: number, b: number) => {
        const d = Math.abs(a - b);
        return d >= k ? Math.max(a, b) : Math.max(a, b) + ((k - d) * (k - d)) / (4 * k);
      };
      top = smax(top, R0);
      bottom = -smax(-bottom, R0);
      halfWidth = smax(halfWidth, R0);
      const w = smoothstep(0, Math.max(noseCap, 0.02), u);
      nUpper = 2 + (nUpper - 2) * w;
      nLower = 2 + (nLower - 2) * w;
    }
    return {
      offset: rake(p),
      top,
      bottom,
      halfWidth,
      nUpper,
      nLower,
    };
  };

  // --- Trace de la cuvette : fond plat, paroi en S, conge de levre --------
  interface CupPoint {
    x: number;
    rho: number;
  }
  let cupPath: CupPoint[] = [];
  if (cup) {
    const lip = bodySection(pc);
    const S = Math.max((lip.top - lip.bottom) / 2, 0.05);
    const r1 = Math.max(S - lipR, S * 0.5);
    const rb = Math.min(bottomRatio * S, r1 * 0.9);
    const pts: { x: number; r: number }[] = [];
    const WALL_STEPS = 48;
    for (let i = 0; i <= WALL_STEPS; i++) {
      const tau = i / WALL_STEPS;
      const s = tau * tau * (3 - 2 * tau);
      pts.push({ x: xFront + cupDepth * (1 - s), r: rb + (r1 - rb) * tau });
    }
    const ARC_STEPS = 24;
    const cx = xFront + lipR;
    const cy = S - lipR;
    for (let i = 1; i <= ARC_STEPS; i++) {
      const phi = Math.PI - (Math.PI / 2) * (i / ARC_STEPS);
      pts.push({ x: cx + lipR * Math.cos(phi), r: cy + lipR * Math.sin(phi) });
    }
    // Abscisse curviligne : les stations se repartissent sur la longueur
    // reelle du trace, pas sur son parametre.
    const arc: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      arc.push(arc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].r - pts[i - 1].r));
    }
    const total = arc[arc.length - 1];
    cupPath = pts.map((pt, i) => ({ x: pt.x, rho: pt.r / S, s: arc[i] / total })) as (CupPoint & {
      s: number;
    })[];
  }
  if (bore) {
    // Fond hemispherique, tube, conge de levre : abscisse, rayon.
    const pts: { x: number; r: number }[] = [];
    const xb = xFront + bore.depth;
    const CAP = 16;
    for (let i = 0; i <= CAP; i++) {
      const a = (Math.PI / 2) * (i / CAP);
      pts.push({ x: xb - bore.rc + bore.rc * Math.cos(a), r: bore.rc * Math.sin(a) });
    }
    const TUBE = 40;
    for (let i = 1; i <= TUBE; i++) {
      pts.push({ x: xb - bore.rc + (xFront + lipR - (xb - bore.rc)) * (i / TUBE), r: bore.rc });
    }
    const ARC = 12;
    for (let i = 1; i <= ARC; i++) {
      const phi = -Math.PI / 2 - (Math.PI / 2) * (i / ARC);
      pts.push({ x: xFront + lipR + lipR * Math.cos(phi), r: bore.rc + lipR + lipR * Math.sin(phi) });
    }
    const arc: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      arc.push(arc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].r - pts[i - 1].r));
    }
    const total = arc[arc.length - 1];
    cupPath = pts.map((pt, i) => ({ x: pt.x, rho: pt.r, s: arc[i] / total })) as (CupPoint & { s: number })[];
  }
  const cupAt = (p: number): CupPoint => {
    const s = clampN(p / pc, 0, 1);
    const path = cupPath as (CupPoint & { s: number })[];
    let i = 1;
    while (i < path.length - 1 && path[i].s < s) i++;
    const a = path[i - 1];
    const b = path[i];
    const t = (s - a.s) / Math.max(b.s - a.s, 1e-12);
    return { x: a.x + (b.x - a.x) * t, rho: a.rho + (b.rho - a.rho) * t };
  };

  let lastP = NaN;
  let lastSection: Section | null = null;
  const section = (p: number): Section => {
    if (p === lastP && lastSection) return lastSection;
    let result: Section;
    if (p <= 0 && !open) {
      result = { offset: rake(0), top: 0, bottom: 0, halfWidth: 0, nUpper: 2, nLower: 2 };
    } else if (p >= bodyEnd) {
      const end = bodySection(bodyEnd);
      result = { ...end, top: 0, bottom: 0, halfWidth: 0 };
    } else if (bore && p < pc) {
      // Canal : section circulaire, sur l'axe de la levre.
      const lip = bodySection(pc);
      const { rho } = cupAt(p);
      const centre = (lip.top + lip.bottom) / 2;
      result = { offset: lip.offset + centre, top: rho, bottom: -rho, halfWidth: rho, nUpper: 2, nLower: 2 };
    } else if (cup && p < pc) {
      const lip = bodySection(pc);
      const { rho } = cupAt(p);
      result = {
        offset: lip.offset,
        top: lip.top * rho,
        bottom: lip.bottom * rho,
        halfWidth: lip.halfWidth * rho,
        nUpper: lip.nUpper,
        nLower: lip.nLower,
      };
    } else {
      result = bodySection(p);
    }
    lastP = p;
    lastSection = result;
    return result;
  };

  const xAt = (p: number): number => {
    if (open && p < pc) return cupAt(p).x;
    return xBody(p);
  };

  const radiusFactor = (p: number): number => {
    const s = section(p);
    return clampN((s.top - s.bottom) / Math.max(H, 1e-6), 0, 1);
  };

  const field = createAnatomyField(params, anatomy, {
    L,
    H,
    bodyEnd,
    pc,
    cup: open,
    section,
    xAt,
    caudalDrawn: ctx.caudalDrawn === true,
  });

  return {
    lengthCm: L,
    bodyEnd,
    hasFin,
    radiusFactor,
    section,
    xAt,
    popperCut: () => 0,
    anatomy: field,
    openFront: cup,
  };
}

// ---------------------------------------------------------------------------
// Reliefs
// ---------------------------------------------------------------------------

interface FieldContext {
  L: number;
  H: number;
  bodyEnd: number;
  pc: number;
  caudalDrawn: boolean;
  cup: boolean;
  section: (p: number) => Section;
  xAt: (p: number) => number;
}

/** Distance signee le long de la section, entre deux angles d'une meme station. */
function chordBetween(section: Section, a: number, b: number): number {
  const pa = sectionPoint(section, a, 2);
  const pb = sectionPoint(section, b, 2);
  const d = Math.hypot(pa.y - pb.y, pa.z - pb.z);
  return a >= b ? d : -d;
}

function finEnabled(fin: FinConfig): boolean {
  return fin.enabled && fin.to - fin.from > 0.01 && fin.size > 0.001;
}

/** Realisation effective d'une nageoire (module AW). */
export type FinKind = 'dorsal' | 'dorsal2' | 'adipose' | 'anal' | 'pectoral' | 'pelvic';

/**
 * Mode d'une nageoire : celui du reglage, ou a defaut le comportement d'avant
 * le module AW — cretes pour la dorsale et l'anale, nageoires couchees pour
 * les paires. Un projet anterieur se rouvre donc a l'identique.
 */
export function finModeOf(fin: FinConfig | undefined, kind: FinKind): FinMode {
  if (fin?.mode) return fin.mode;
  return kind === 'pectoral' || kind === 'pelvic' ? 'relief' : 'integrated';
}

/** Mode de la caudale : integree par defaut. */
export const caudalModeOf = (anatomy: Anatomy | null | undefined): FinMode =>
  anatomy?.caudalMode ?? 'integrated';

/** Angle de l'oeil depuis le dos, en radians. */
export const eyeThetaOf = (anatomy: Anatomy | null | undefined): number =>
  clampN(anatomy?.eyeTheta ?? EYE_THETA, 0.35, 1.5);

/** Epaisseurs minimales d'une nageoire integree (module AW), en cm. */
export const FIN_MIN = { base: 0.12, edge: 0.06 };

/** Jeu d'insertion d'une nageoire rapportee, par face, en cm : celui des portees d'ecrou. */
export const FIN_FIT = 0.01;

/**
 * Crete a rayons : un leger creusement de la membrane entre deux rayons, qui
 * fait le bord libre dentele. `s` court de 0 a 1 le long de la base.
 */
const rayScallop = (s: number, rays: number): number => {
  const q = s * Math.max(rays, 1);
  return 0.5 + 0.5 * Math.cos(Math.PI * 2 * q);
};

function createAnatomyField(
  params: LureParams,
  anatomy: Anatomy,
  ctx: FieldContext,
): AnatomyField {
  const { L, H, bodyEnd, pc } = ctx;

  // --- Repartition des stations -------------------------------------------
  // Serrees la ou la forme change vite : pointe du nez, tete (machoire, oeil,
  // opercule), pedoncule, calotte de queue, et le long des nageoires dont
  // les rayons demandent une station tous les quelques dixiemes. A l'export,
  // le maillage adaptatif (module AT.2) affine encore la ou la surface
  // s'ecarte de ses facettes.
  const ped = clampN(anatomy.peduncle, 0.4, bodyEnd - 0.02);
  const head = Math.max(params.gills.position, anatomy.jaw) + 0.04;
  const dorsal = anatomy.dorsalFin;
  const dorsal2 = anatomy.dorsalFin2;
  const anal = anatomy.analFin;
  const density = (p: number): number => {
    let rho = 1;
    rho += 5 * Math.exp(-(((p - pc) / 0.012) ** 2));
    rho += 1.8 * smoothstep(head + 0.06, head - 0.02, p);
    rho += 1.3 * Math.exp(-(((p - ped) / 0.07) ** 2));
    rho += 4 * Math.exp(-(((bodyEnd - p) / 0.015) ** 2));
    if (ctx.cup && p < pc) rho += 4;
    for (const fin of [dorsal, dorsal2, anatomy.adiposeFin, anal]) {
      if (fin && finEnabled(fin) && p > fin.from - 0.01 && p < fin.to + 0.01) rho += 0.7;
    }
    return rho;
  };
  const warp = distribution(density, bodyEnd);

  // Largeur minimale d'un detail : en dessous de 0,25 mm, une buse de
  // 0,4 mm ne le reproduit pas, et une facette le trahirait.
  const FEATURE = 0.025;

  // --- Bouche : levres, commissure, rebord de machoire ---------------------
  const jawP = clampN(anatomy.jaw, 0.02, 0.3);
  const jawDepth = Math.max(anatomy.jawDepth, 0) * H;
  const jawSigma = clampN(0.0035 * L, FEATURE, 0.05);
  const lipH = Math.max(anatomy.lips ?? 0.4 * anatomy.jawDepth, 0) * H;
  const protrude = clampN(anatomy.jawProtrusion ?? 0, -1, 1.5) * MM;
  const lineThetaAt = (p: number) => Math.PI / 2 + 0.05 + 0.28 * Math.pow(Math.min(Math.max(p, 0), jawP) / jawP, 1.3);
  const xJaw = ctx.xAt(jawP);

  // --- Oeil : logement au diametre reel, bourrelet periorbitaire ----------
  const eyes = params.eyes.enabled ? params.eyes : null;
  const eyeTheta = eyeThetaOf(anatomy);
  const eyeX = eyes ? ctx.xAt(eyes.position) : 0;
  const eyeR = eyes ? Math.max((eyes.size * MM) / 2, 0.05) : 1;
  const orbitDepth = Math.max(anatomy.orbitDepth, 0) * MM;
  const socketWall = Math.max(0.25 * eyeR, 0.03);
  const rimW = Math.max(0.24 * eyeR, 0.035);
  const rimH = Math.max(0.4 * orbitDepth, 0.015);
  const corneaH = eyes ? Math.max(eyes.relief, 0) * MM : 0;
  const orbitReach = eyeR + socketWall + 3.5 * rimW;

  // --- Narines : deux fossettes entre le museau et l'oeil ------------------
  const nostrilDepth = Math.max(anatomy.nostrils ?? 0, 0) * MM;
  const nostrilR = clampN(0.012 * H, 0.03, 0.06);
  const nostrilP = eyes ? eyes.position * 0.55 : jawP * 0.7;
  const nostrilX = ctx.xAt(nostrilP);
  const nostrilGap = Math.max(2.2 * nostrilR, 0.07);
  const nostrilTheta = Math.max(eyeTheta - 0.14, 0.3);

  // --- Opercule, preopercule, fente branchiale ----------------------------
  const gills = params.gills.enabled ? params.gills : null;
  const opX = gills ? ctx.xAt(gills.position) : 0;
  const opBow = gills ? Math.max(gills.size * MM, 0.05) : 0;
  const opR = Math.max(anatomy.opercleRelief, 0) * H;
  const slitD = gills ? Math.abs(gills.relief) * MM : 0;
  // Transitions d'au moins 0,3 mm : le bord libre reste franc a l'oeil et
  // imprimable a la buse.
  const opEdge = clampN(0.0028 * L, 0.03, 0.045);
  const opLen = 0.075 * L;
  const preA = 0.42 * opLen;
  const OP_TOP = 0.42;
  const OP_BOT = 2.55;

  // --- Ligne laterale et carene ventrale ----------------------------------
  const llDepth = Math.max(anatomy.lateralLine, 0) * MM;
  const llFrom = (gills ? gills.position : 0.25) + 0.04;
  const llTo = Math.min(ped + 0.05, bodyEnd - 0.04);
  const llSigma = clampN(0.0022 * L, 0.02, 0.03);
  const keel = Math.max(anatomy.ventralLine ?? 0, 0) * MM;
  const keelFrom = (gills ? gills.position : 0.2) + 0.02;
  const keelTo = Math.min(finEnabled(anal) ? anal.from : ped, bodyEnd - 0.05);
  const keelSigma = Math.max(0.004 * H, FEATURE);

  // --- Nageoires paires couchees ------------------------------------------
  interface Flat {
    fin: FinConfig;
    theta: number;
    tilt: number;
    x0: number;
    length: number;
    span: number;
    thick: number;
  }
  const flats: Flat[] = [];
  const flat = (fin: FinConfig, kind: FinKind, theta: number, tilt: number) => {
    if (!finEnabled(fin) || finModeOf(fin, kind) !== 'relief') return;
    flats.push({
      fin,
      theta,
      tilt,
      x0: ctx.xAt(fin.from),
      length: Math.max((fin.to - fin.from) * L, 0.1),
      span: fin.size * H,
      // Nageoire dessinee, pas plaquee : 0,3 a 0,6 mm de relief.
      thick: clampN(0.018 * H, 0.03, 0.06),
    });
  };
  flat(anatomy.pectoralFin, 'pectoral', 2.02, 0.2);
  if (!anatomy.pelvicSucker) flat(anatomy.pelvicFin, 'pelvic', 2.62, 0.1);

  // Logements des nageoires paires rapportees : un puits a fond plat au pied
  // de la nageoire, qui recoit le tenon de la piece, jeu de collage compris.
  interface Socket {
    x: number;
    theta: number;
    radius: number;
    depth: number;
  }
  const sockets: Socket[] = [];
  for (const [fin, kind, theta] of [
    [anatomy.pectoralFin, 'pectoral', 2.02],
    [anatomy.pelvicFin, 'pelvic', 2.62],
  ] as [FinConfig, FinKind, number][]) {
    if (!finEnabled(fin) || finModeOf(fin, kind) !== 'attached') continue;
    const tab = pairedTabOf(H);
    const radius = pairedSocketRadius(H);
    sockets.push({ x: ctx.xAt(fin.from) + radius + 0.02, theta, radius, depth: tab.depth + FIN_FIT });
  }

  // Ventouse pelvienne (gobie) : disque sous la gorge, bourrelet et rayons.
  const sucker =
    anatomy.pelvicSucker && finEnabled(anatomy.pelvicFin)
      ? {
          x: ctx.xAt((anatomy.pelvicFin.from + anatomy.pelvicFin.to) / 2),
          radius: Math.max(((anatomy.pelvicFin.to - anatomy.pelvicFin.from) * L) / 2, 0.15),
          height: clampN(0.02 * H, 0.03, 0.08),
          rays: Math.max(anatomy.pelvicFin.rays, 4),
        }
      : null;

  // --- Nageoires impaires couchees sur le flanc ----------------------------
  // Mode relief : la nageoire est rabattue contre le flanc, rayons inclines
  // vers l'arriere, bord libre dentele. Rien ne depasse du corps.
  interface Folded {
    fin: FinConfig;
    /** Adipeuse : pas de rayons, bord lisse. */
    rayless?: boolean;
    /** 0 pour une dorsale (depuis le dos), PI pour l'anale (depuis le ventre). */
    ridge: number;
    xa: number;
    xb: number;
    height: number;
    thick: number;
  }
  const folded: Folded[] = [];
  const fold = (fin: FinConfig | undefined, kind: FinKind, ridge: number) => {
    if (!fin || !finEnabled(fin) || finModeOf(fin, kind) !== 'relief') return;
    folded.push({
      fin,
      rayless: kind === 'adipose',
      ridge,
      xa: ctx.xAt(fin.from),
      xb: ctx.xAt(fin.to),
      height: fin.size * H,
      thick: clampN(0.016 * H, 0.03, 0.055),
    });
  };
  fold(dorsal, 'dorsal', 0);
  fold(dorsal2, 'dorsal2', 0);
  fold(anatomy.adiposeFin, 'adipose', 0);
  fold(anal, 'anal', Math.PI);
  const RAY_SWEEP = Math.tan(0.85);

  // Caudale en relief (module AW) : un eventail rayonne dessine sur le bout
  // de queue, de part et d'autre, du pedoncule a la pointe.
  const caudal = ctx.caudalDrawn
    ? (() => {
        const x0 = ctx.xAt(ped);
        const x1 = ctx.xAt(bodyEnd);
        const span = Math.max(x1 - x0, 0.1);
        const xo = x0 - 0.35 * span;
        return {
          xo,
          r0: x0 - xo,
          r1: (x1 - xo) * 0.96,
          psiMax: 0.75,
          rays: Math.max(Math.round(anatomy.caudalRays), 6),
          thick: clampN(0.014 * H, 0.025, 0.045),
        };
      })()
    : null;

  const relief = (p: number, theta: number, section: Section): number => {
    if (p <= 0 || p >= bodyEnd) return 0;
    if (ctx.cup && p < pc) return 0;
    // Symetrie laterale : tous les reliefs sont definis sur le flanc droit.
    // L'angle est d'abord ramene dans [0, 2 PI) : la coque male parcourt son
    // arc de 2 PI a 3 PI, et un angle non replie y effacait nageoires
    // pectorales, orbites et opercule d'un seul cote.
    const turn = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const th = turn > Math.PI ? Math.PI * 2 - turn : turn;
    const x = ctx.xAt(p);
    let d = 0;

    // Bouche : sillon de la pointe du museau a la commissure, levre
    // superieure au-dessus, levre inferieure au-dessous, commissure marquee
    // d'une fossette ; sous la levre, le rebord de la machoire inferieure.
    if ((jawDepth > 0 || lipH > 0) && p < jawP * 1.35 + 0.03) {
      const lineTheta = lineThetaAt(p);
      const across = chordBetween(section, th, lineTheta);
      const along = p <= jawP ? 0 : x - xJaw;
      const envelope = smoothstep(pc + 0.004, pc + 0.03, p);
      const behind = Math.exp(-((along / (1.3 * jawSigma)) ** 2));
      const groove = -jawDepth * Math.exp(-((Math.hypot(across, along) / jawSigma) ** 2));
      const upperLip = lipH * Math.exp(-(((across + 1.7 * jawSigma) / (1.1 * jawSigma)) ** 2)) * behind;
      const lowerLip = lipH * Math.exp(-(((across - 1.7 * jawSigma) / (1.1 * jawSigma)) ** 2)) * behind;
      const pit =
        -0.6 * jawDepth *
        Math.exp(-((Math.hypot(x - xJaw, chordBetween(section, th, lineThetaAt(jawP))) / (1.4 * jawSigma)) ** 2));
      // Rebord de machoire inferieure : une arete douce parallele a la levre,
      // plus bas, jusqu'un peu au-dela de la commissure.
      const mandible =
        0.55 * lipH *
        Math.exp(-(((across - 4.2 * jawSigma) / (1.2 * jawSigma)) ** 2)) *
        (1 - smoothstep(jawP, jawP * 1.35 + 0.02, p));
      // Machoire proeminente (ou en retrait) : la levre inferieure et le
      // menton poussent vers l'exterieur pres de la pointe.
      const jut = protrude * smoothstep(0, 2 * jawSigma, across) * (1 - smoothstep(0, 0.45 * jawP, p));
      d += envelope * (groove + upperLip + lowerLip + pit + mandible + jut);
    }

    // Narines : deux fossettes ourlees, devant l'oeil.
    if (nostrilDepth > 0 && Math.abs(x - nostrilX) < nostrilGap + 3 * nostrilR) {
      const across = chordBetween(section, th, nostrilTheta);
      for (const dx of [-nostrilGap / 2, nostrilGap / 2]) {
        const dist = Math.hypot(x - nostrilX - dx, across);
        if (dist > 2.2 * nostrilR) continue;
        d += -nostrilDepth * (1 - smoothstep(0.45 * nostrilR, nostrilR, dist));
        d += 0.3 * nostrilDepth * Math.exp(-(((dist - 1.25 * nostrilR) / (0.4 * nostrilR)) ** 2));
      }
    }

    // Orbite : logement a fond plat au diametre reel de l'oeil, paroi, puis
    // bourrelet periorbitaire ; cornee bombee dans le logement si demandee.
    if (eyes && Math.abs(x - eyeX) < orbitReach) {
      const chord = Math.abs(chordBetween(section, th, eyeTheta));
      const dist = Math.hypot(x - eyeX, chord);
      if (dist < orbitReach) {
        const socket = -orbitDepth * (1 - smoothstep(eyeR, eyeR + socketWall, dist));
        const rim = rimH * Math.exp(-(((dist - eyeR - socketWall - rimW) / rimW) ** 2));
        let cornea = 0;
        const rd = eyeR * 0.92;
        if (corneaH > 0 && dist < rd) {
          const q = dist / rd;
          cornea = (orbitDepth * 0.9 + corneaH) * (1 - q * q) * (1 - q * q);
        }
        d += socket + rim + cornea;
      }
    }

    // Opercule : plaque en relief a bord libre saillant (bourrelet), fente
    // branchiale juste derriere ; en avant, le preopercule : un second plan
    // plus bas, separe de l'opercule par son propre bord et un sillon. Le
    // bord bombe vers l'arriere a mi-flanc et revient vers la gorge.
    let opCover = 0;
    if (gills && th > OP_TOP - 0.1 && th < OP_BOT + 0.1) {
      const phi = clampN((th - OP_TOP) / (OP_BOT - OP_TOP), 0, 1);
      const edge = opX + opBow * Math.sin(Math.PI * Math.pow(phi, 0.85)) - 0.5 * opBow * phi * phi;
      const a = edge - x;
      if (a > -8 * opEdge && a < opLen * 1.25) {
        const window =
          smoothstep(0, 0.1, (th - OP_TOP + 0.1) / (OP_BOT - OP_TOP)) *
          smoothstep(0, 0.1, (OP_BOT + 0.1 - th) / (OP_BOT - OP_TOP));
        opCover = window * smoothstep(-opEdge, opEdge, a);
        const plate =
          opR *
          smoothstep(-opEdge, opEdge, a) *
          (1 - 0.45 * smoothstep(preA - opEdge, preA + opEdge, a)) *
          (1 - smoothstep(0.75 * opLen, 1.2 * opLen, a));
        const rim = 0.45 * opR * Math.exp(-(((a - 1.2 * opEdge) / opEdge) ** 2));
        const slit = -slitD * Math.exp(-(((a + 2 * opEdge) / (1.1 * opEdge)) ** 2));
        // Sillon du preopercule : au pied de la marche, du cote du
        // preopercule, net comme sur les scans (0,15 a 0,2 mm sous son plan).
        const pre = -0.45 * opR * Math.exp(-(((a - preA - 0.5 * opEdge) / (1.2 * opEdge)) ** 2));
        d += window * (plate + rim + slit + pre);
      }
    }

    // Ligne laterale : sillon fin qui descend vers l'axe du pedoncule.
    if (llDepth > 0 && p > llFrom && p < llTo) {
      const t = (p - llFrom) / (llTo - llFrom);
      const lineTheta = 1.28 + 0.26 * t;
      const across = chordBetween(section, th, lineTheta);
      if (Math.abs(across) < 4 * llSigma) {
        const env = smoothstep(0, 0.08, t) * smoothstep(0, 0.08, 1 - t);
        d -= llDepth * env * Math.exp(-((across / llSigma) ** 2));
      }
    }

    // Carene ventrale : la ligne mediane du ventre, un leger bourrelet.
    if (keel > 0 && p > keelFrom && p < keelTo && th > Math.PI / 2) {
      const across = chordBetween(section, Math.PI, th);
      if (across < 4 * keelSigma) {
        const t = (p - keelFrom) / Math.max(keelTo - keelFrom, 1e-6);
        const env = smoothstep(0, 0.12, t) * smoothstep(0, 0.12, 1 - t);
        d += keel * env * Math.exp(-((across / keelSigma) ** 2));
      }
    }

    // Nageoires couchees (pectorales, ventrales) : un eventail en relief,
    // epais a la racine et mince au bord, rayons compris, bord libre
    // festonne entre les rayons. La racine sort de sous l'opercule : le
    // relief s'efface la ou la plaque operculaire le recouvre.
    for (const fin of flats) {
      const dx = x - fin.x0;
      if (dx < -0.1 || dx > fin.length * 1.1) continue;
      const ds = chordBetween(section, th, fin.theta);
      if (Math.abs(ds) > fin.span) continue;
      const a = dx * Math.cos(fin.tilt) + ds * Math.sin(fin.tilt);
      const b = -dx * Math.sin(fin.tilt) + ds * Math.cos(fin.tilt);
      const s = a / fin.length;
      if (s < -0.05 || s > 1.08) continue;
      const origin = -0.2 * fin.length;
      const psi = Math.atan2(b, a - origin) / 0.9;
      const rays = Math.max(fin.fin.rays, 1);
      const ray = Math.pow(0.5 + 0.5 * Math.cos(Math.PI * 2 * psi * rays * 0.5), 3);
      // Bord libre festonne : la membrane recule entre deux rayons.
      const reach = 1 - 0.06 * (1 - ray);
      const half = 0.5 * fin.span * (0.3 + 0.7 * Math.pow(Math.sin(Math.PI * clampN(s * 0.85, 0, 1)), 0.7));
      const q = Math.abs(b) / Math.max(half, 1e-4);
      const margin = Math.min(FEATURE * 1.6 / Math.max(half, 1e-4), 0.5);
      const inside =
        smoothstep(1, 1 - margin, q) *
        smoothstep(reach, reach - Math.max(0.05, FEATURE / fin.length), s) *
        smoothstep(-0.03, 0.06, s);
      if (inside <= 0) continue;
      const thick = fin.thick * (1 - 0.6 * clampN(s, 0, 1));
      d += inside * (1 - opCover) * (thick + 0.35 * fin.thick * (1 - 0.5 * clampN(s, 0, 1)) * ray);
    }

    // Nageoires impaires rabattues (mode relief) : la base court le long de
    // l'arete, la nageoire se couche vers l'arriere et vers le bas.
    for (const fin of folded) {
      if (x < fin.xa - 0.05 || x > fin.xb + fin.height * RAY_SWEEP + 0.1) continue;
      const ds = Math.abs(chordBetween(section, th, fin.ridge));
      if (ds > fin.height * 1.1) continue;
      const xBase = x - ds * RAY_SWEEP;
      const s = (xBase - fin.xa) / Math.max(fin.xb - fin.xa, 1e-4);
      if (s < -0.04 || s > 1.04) continue;
      const rays = Math.max(fin.fin.rays, 1);
      const scallop = fin.rayless ? 1 : rayScallop(s, rays);
      const ray = fin.rayless ? 0 : Math.pow(scallop, 3);
      const reach =
        fin.height * Math.pow(Math.sin(Math.PI * Math.pow(clampN(s, 0, 1), fin.rayless ? 1 : 0.75)), 0.6) *
        (1 - (fin.rayless ? 0 : 0.3) * s) *
        (1 - 0.07 * (1 - scallop));
      const along = ds * Math.sqrt(1 + RAY_SWEEP * RAY_SWEEP);
      const inside =
        smoothstep(reach, reach - FEATURE * 1.6, along) *
        smoothstep(-0.03, 0.03, s) *
        smoothstep(1.03, 0.97, s);
      if (inside <= 0) continue;
      const t = clampN(along / Math.max(reach, 1e-4), 0, 1);
      d += inside * fin.thick * ((1 - 0.6 * t) + 0.4 * ray * (1 - 0.5 * t));
    }

    // Caudale dessinee : eventail de rayons sur le flanc du bout de queue,
    // bord libre festonne, rien ne depasse du corps.
    if (caudal && x > caudal.xo + caudal.r0 * 0.8) {
      const ds = chordBetween(section, th, Math.PI / 2);
      const r = Math.hypot(x - caudal.xo, ds);
      const psi = Math.atan2(ds, x - caudal.xo);
      if (Math.abs(psi) < caudal.psiMax * 1.1 && r > caudal.r0 * 0.9) {
        const k = ((psi / caudal.psiMax + 1) / 2) * caudal.rays;
        const scallop = 0.5 + 0.5 * Math.cos(Math.PI * 2 * k);
        const edge = caudal.r1 * (1 - 0.03 * (1 - scallop));
        const inside =
          smoothstep(caudal.r0, caudal.r0 + FEATURE * 2, r) *
          smoothstep(edge, edge - FEATURE * 1.6, r) *
          smoothstep(caudal.psiMax, caudal.psiMax - 0.12, Math.abs(psi));
        if (inside > 0) {
          const t = clampN((r - caudal.r0) / Math.max(caudal.r1 - caudal.r0, 1e-4), 0, 1);
          d += inside * caudal.thick * ((1 - 0.5 * t) + 0.5 * Math.pow(scallop, 3) * (1 - 0.4 * t));
        }
      }
    }

    // Ventouse pelvienne : disque ourle, creux au centre, rayons rayonnants.
    if (sucker && th > Math.PI / 2 && Math.abs(x - sucker.x) < sucker.radius * 1.4) {
      const across = chordBetween(section, Math.PI, th);
      const dist = Math.hypot(x - sucker.x, across);
      if (dist < sucker.radius * 1.3) {
        const q = dist / sucker.radius;
        const lip = sucker.height * Math.exp(-(((q - 0.86) / 0.12) ** 2));
        const cup = -0.45 * sucker.height * (1 - smoothstep(0.2, 0.8, q));
        const ang = Math.atan2(across, x - sucker.x);
        const spokes = Math.pow(0.5 + 0.5 * Math.cos(ang * sucker.rays), 3);
        const disc = smoothstep(1.05, 0.9, q);
        d += lip + cup + 0.35 * sucker.height * spokes * disc * smoothstep(0.25, 0.5, q);
      }
    }

    // Logements des nageoires paires rapportees.
    for (const sock of sockets) {
      if (Math.abs(x - sock.x) > sock.radius * 1.6) continue;
      const dist = Math.hypot(x - sock.x, chordBetween(section, th, sock.theta));
      if (dist > sock.radius * 1.6) continue;
      d -= sock.depth * (1 - smoothstep(sock.radius, sock.radius + 0.015, dist));
    }

    return d;
  };

  // --- Cretes : nageoires impaires integrees -------------------------------
  interface Crest {
    fin: FinConfig;
    rayless?: boolean;
    sign: 1 | -1;
    height: number;
    wb: number;
    we: number;
  }
  const crests: Crest[] = [];
  const addCrest = (fin: FinConfig | undefined, kind: FinKind, sign: 1 | -1) => {
    if (!fin || !finEnabled(fin) || finModeOf(fin, kind) !== 'integrated') return;
    // Souple monobloc : les nageoires impaires sont des lames en volume
    // (fins.ts), pas des cretes de peau.
    if (params.soft?.enabled) return;
    crests.push({
      fin,
      rayless: kind === 'adipose',
      sign,
      height: fin.size * H,
      // Integree (module AW) : 1,2 mm minimum a la base, 0,6 mm au bord libre.
      wb: Math.max(clampN(0.045 * H, 0.05, 0.16), FIN_MIN.base / 2),
      we: Math.max(clampN(0.014 * H, 0.03, 0.06), FIN_MIN.edge / 2),
    });
  };
  addCrest(dorsal, 'dorsal', 1);
  addCrest(dorsal2, 'dorsal2', 1);
  addCrest(anatomy.adiposeFin, 'adipose', 1);
  addCrest(anal, 'anal', -1);

  // Fente ventrale d'un souple (module AU.2) : montage texan ou weightless.
  // Une crete inversee : dans la bande de la fente, le ventre remonte de la
  // profondeur de la fente ; ses parois sont verticales, ses extremites
  // arrondies. La hampe de l'hamecon s'y loge, le TPU se referme dessus.
  const slot = softSlotOf(params);
  const crest = (p: number, theta: number, z: number): number => {
    let out = 0;
    const c = Math.cos(theta);
    if (slot && c < 0 && p > slot.from && p < slot.to) {
      const s = (p - slot.from) / (slot.to - slot.from);
      const sec = ctx.section(p);
      // Extremites en rampe (pente de l'ordre de 60 degres) : la hampe y
      // entre sans accrocher, et la paroi n'est pas une falaise transversale.
      const rampCm = 0.6 * slot.depth * (sec.top - sec.bottom);
      const ramp = Math.min(rampCm / Math.max((slot.to - slot.from) * L, 1e-3), 0.4);
      const ends = smoothstep(0, ramp, s) * smoothstep(0, ramp, 1 - s);
      const depth = slot.depth * (sec.top - sec.bottom) * ends;
      const az = Math.abs(z);
      out += depth * smoothstep(slot.halfWidth + 0.015, slot.halfWidth - 0.015, az);
    }
    for (const fin of crests) {
      if (fin.sign * c <= 0) continue;
      const s = (p - fin.fin.from) / (fin.fin.to - fin.fin.from);
      if (s <= 0 || s >= 1) continue;
      const rays = Math.max(fin.fin.rays, 1);
      // Bord d'attaque haut, bord de fuite qui s'abaisse ; le bord libre est
      // festonne entre les rayons, jamais une decoupe franche. L'adipeuse,
      // charnue, n'a ni rayons ni feston : un lobe arrondi.
      const scallop = fin.rayless ? 1 : rayScallop(s, rays);
      const h = fin.rayless
        ? fin.height * Math.pow(Math.sin(Math.PI * s), 0.7)
        : fin.height * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.75)), 0.6) * (1 - 0.3 * s) *
          (1 - 0.07 * (1 - scallop));
      if (h <= 1e-4) continue;
      const az = Math.abs(z);
      // Rayons : une surepaisseur qui court de la base vers le bord, inclinee
      // vers l'arriere comme sur une vraie nageoire.
      const q = s * rays - 0.6 * clampN(1 - az / fin.wb, 0, 1);
      const ray = fin.rayless ? 0 : Math.pow(Math.max(Math.cos(Math.PI * 2 * q), 0), 4);
      const wb = fin.wb * (1 + 0.25 * ray);
      const we = Math.min(fin.we * (1 + 0.25 * ray), wb * 0.8);
      if (az > wb + fin.wb) continue;
      // Plaque effilee de la base vers le bord, bord arrondi.
      let eta: number;
      if (az <= we) eta = h - we + Math.sqrt(Math.max(we * we - az * az, 0));
      else eta = (h - we) * ((wb - az) / (wb - we));
      // Conge de raccord a la base : la crete se fond dans le dos.
      out += fin.sign * softMax0(eta, 0.35 * (wb - we));
    }
    return out;
  };

  return {
    relief,
    crest,
    thetaAt: (s) => warpTheta(s),
    stationAt: warp.at,
    stationOf: warp.of,
  };
}

/** Languette d'une nageoire paire rapportee, en cm : elle entre dans un puits du flanc. */
export function pairedTabOf(bodyHeightCm: number): { width: number; thickness: number; depth: number } {
  return {
    width: clampN(0.1 * bodyHeightCm, 0.15, 0.25),
    thickness: FIN_MIN.base,
    depth: clampN(0.06 * bodyHeightCm, 0.1, 0.18),
  };
}

/** Rayon du puits d'une nageoire paire rapportee : demi-diagonale de la languette, plus le jeu. */
export const pairedSocketRadius = (bodyHeightCm: number): number => {
  const tab = pairedTabOf(bodyHeightCm);
  return Math.hypot(tab.width, tab.thickness) / 2 + FIN_FIT;
};

/** Languette d'une nageoire impaire rapportee (dorsale, anale), en cm. */
export function medianTabOf(bodyHeightCm: number): { thickness: number; depth: number } {
  return { thickness: FIN_MIN.base, depth: clampN(0.09 * bodyHeightCm, 0.15, 0.3) };
}

// ---------------------------------------------------------------------------
// Nageoire caudale en volume
// ---------------------------------------------------------------------------

/**
 * Caudale anatomique : une lame dont l'epaisseur decroit de la racine vers
 * le bord, parcourue de rayons, aux bords arrondis.
 *
 * Elle est construite comme un coussin ferme : les deux faces partagent
 * exactement leur contour, ou l'epaisseur tombe a zero selon une racine
 * carree — la tangente y est perpendiculaire a la lame, c'est donc un bord
 * rond et non une arete. La racine est noyee dans la calotte du pedoncule.
 *
 * `part` coupe la lame dans le plan de symetrie : chaque coque en recoit une
 * moitie fermee par sa face de joint.
 */
export function buildCaudalFin(
  profile: ProfileSampler,
  params: LureParams,
  part: 'full' | 'male' | 'female' | 'print' = 'full',
): THREE.BufferGeometry {
  const H = params.thickness * MM;
  // La racine est posee la ou la calotte de queue commence : la lame y
  // reprend toute la hauteur du pedoncule et un peu plus que sa largeur, si
  // bien qu'elle enveloppe la calotte au lieu d'en sortir comme d'un moignon.
  const pRoot = Math.max(profile.bodyEnd - 0.03 * profile.bodyEnd, 0.05);
  const rootSection = profile.section(pRoot);
  const x0 = profile.xAt(pRoot);
  const xEnd = profile.xAt(1);
  const len = Math.max(xEnd - x0, 0.2);
  const stalk = Math.max(Math.min(rootSection.top, -rootSection.bottom) * 0.96, 0.05);
  const centreY = (rootSection.top + rootSection.bottom) / 2 + rootSection.offset;
  const rootThick = rootSection.halfWidth * 2 * 1.08;
  const size = clampN(params.tailSize, 0.4, 1.8);
  const shapeK =
    params.tailShape === 'fan' ? 1.02 : params.tailShape === 'paddle' ? 0.8 : params.tailShape === 'rounded' ? 0.9 : 0.95;
  const h = Math.max(H * 0.5 * size * shapeK, stalk * 1.2);
  const rays = Math.max(Math.round(params.anatomy?.caudalRays ?? 14), 4);
  // Integree (module AW) : 1,2 mm au moins a la racine de la lame.
  const tb = clampN(0.06 * H, FIN_MIN.base, 0.22);
  // Feston du bord libre : la membrane recule d'un rien entre deux rayons.
  const scallopDepth = params.tailShape === 'paddle' ? 0 : 0.035;
  const festoon = (v: number): number => {
    const k = ((v + 1) / 2) * rays;
    return 1 - scallopDepth * (1 - Math.pow(0.5 + 0.5 * Math.cos(Math.PI * 2 * k), 2));
  };

  /** Bord de fuite, pour v de -1 (lobe bas) a +1 (lobe haut). */
  const trailing = (v: number): { x: number; y: number } => {
    const av = Math.abs(v);
    if (params.tailShape === 'forked') {
      const notch = 0.55;
      return { x: len * (notch + (1 - notch) * Math.pow(av, 1.25)) * festoon(v), y: v * h * (0.2 + 0.8 * Math.pow(av, 0.8)) };
    }
    if (params.tailShape === 'paddle') {
      return { x: len * (0.97 - 0.08 * av * av), y: v * h };
    }
    if (params.tailShape === 'rounded') {
      // Caudale arrondie (gobie) : bord de fuite en demi-cercle.
      return { x: len * (0.6 + 0.4 * Math.sqrt(Math.max(1 - av * av, 0))) * festoon(v), y: v * h * 0.94 };
    }
    // Eventail : bord de fuite legerement convexe.
    return { x: len * (0.9 + 0.1 * Math.cos((av * Math.PI) / 2)) * festoon(v), y: v * h };
  };

  // Demi-caudale d'une coque (modules AQ, AT.2) : quatre rangs par rayon
  // portent les nervures et le feston ; la caudale reste plus dense que les
  // flancs raffines. La caudale d'affichage garde sa finesse.
  const shellPart = part !== 'full';
  const NV = shellPart ? 30 + rays * 4 : 48 + rays * 5;
  const NW = shellPart ? 26 : 40;
  // Repartition resserree vers les bords : c'est la que l'epaisseur varie vite.
  const cosSpace = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);

  const planform = (v: number, w: number): { x: number; y: number } => {
    const root = { x: 0, y: v * stalk };
    const tip = trailing(v);
    // Bords d'attaque galbes vers l'exterieur.
    const bulge = Math.sign(v) * v * v * 0.1 * h * Math.sin(Math.PI * w);
    return { x: root.x + (tip.x - root.x) * w, y: root.y + (tip.y - root.y) * w + bulge };
  };

  const thickness = (v: number, w: number): number => {
    const rootRamp = smoothstep(0, 0.04, w);
    const k = ((v + 1) / 2) * rays;
    const ray = Math.pow(Math.max(Math.cos(Math.PI * 2 * k), 0), 4);
    // Epaisseur degressive de la racine au bord libre, jamais moins de
    // 0,6 mm au bord (module AW).
    // Piece rapportee : la racine a l'epaisseur de la languette, pour entrer
    // dans la fente ; pas de moyeu, le pedoncule est dans le corps.
    const printPart = part === 'print';
    const tbEff = printPart ? FIN_MIN.base : tb;
    const blade = Math.max(tbEff * (1 - (printPart ? 0.5 : 0.72) * w), FIN_MIN.edge) * (1 + (printPart ? 0 : 0.28) * ray * (1 - 0.5 * w));
    // Pres de la racine, l'epaisseur est celle du pedoncule, puis elle se
    // resserre vers la lame : c'est le raccord, sans marche.
    const hub = printPart ? 0 : rootThick * (1 - smoothstep(0, 0.2, w));
    const base = Math.max(blade, hub);
    // Bord libre arrondi : demi-rond de rayon egal a la demi-epaisseur,
    // mesure en distance reelle au contour. La lame garde ainsi toute son
    // epaisseur jusqu'a 0,3 mm du bord, puis se referme sans arete vive.
    const tip = trailing(v);
    const across = Math.max(Math.abs(tip.y) - Math.abs(v * stalk), 1e-4) + stalk;
    const dEdge = Math.min((1 - Math.abs(v)) * across, (1 - w) * Math.max(tip.x, 1e-4));
    const r = base / 2;
    const e = dEdge >= r ? 1 : Math.sqrt(Math.max(1 - (1 - dEdge / r) ** 2, 0));
    return base * e * (0.25 + 0.75 * rootRamp);
  };

  const positions: number[] = [];
  const index = new Map<string, number>();
  const verts: number[] = [];
  const vertex = (x: number, y: number, z: number): number => {
    const key = `${x.toFixed(7)},${y.toFixed(7)},${(z + 0).toFixed(7)}`;
    const found = index.get(key);
    if (found !== undefined) return found;
    const id = verts.length / 3;
    verts.push(x, y, z);
    index.set(key, id);
    return id;
  };

  const rim = new Set<number>();
  const grid = (side: 1 | -1 | 0): number[][] => {
    const rows: number[][] = [];
    for (let i = 0; i <= NV; i++) {
      const v = -1 + 2 * cosSpace(i / NV);
      const row: number[] = [];
      for (let k = 0; k <= NW; k++) {
        const w = cosSpace(k / NW);
        const pt = planform(v, w);
        const onEdge = i === 0 || i === NV || k === 0 || k === NW;
        // Un sommet interieur garde une epaisseur minimale : arrondi a zero,
        // il se confondrait avec son vis-a-vis et deux faces partageraient
        // la meme arete.
        // Piece a imprimer (caudale rapportee) : toute l'epaisseur d'un seul
        // cote, face d'appui plane.
        const t = onEdge ? 0 : Math.max(thickness(v, w) / (part === 'print' ? 1 : 2), 2e-5);
        const id = vertex(x0 + pt.x, centreY + pt.y, side * t);
        if (onEdge) rim.add(id);
        row.push(id);
      }
      rows.push(row);
    }
    return rows;
  };

  const tris: number[] = [];
  const onRim = (id: number) => rim.has(id);
  const emit = (rows: number[][], flip: boolean) => {
    for (let i = 0; i < NV; i++) {
      for (let k = 0; k < NW; k++) {
        const a = rows[i][k];
        const b = rows[i + 1][k];
        const c = rows[i + 1][k + 1];
        const d = rows[i][k + 1];
        const push = (p: number, q: number, r: number) => {
          if (p === q || q === r || p === r) return;
          // Aux coins de la grille, un triangle a ses trois sommets sur le
          // contour : il serait emis par les deux faces, a plat et en sens
          // oppose. On le laisse tomber, le contour se referme sans lui.
          if (onRim(p) && onRim(q) && onRim(r)) return;
          if (flip) tris.push(p, r, q);
          else tris.push(p, q, r);
        };
        push(a, b, c);
        push(a, c, d);
      }
    }
  };

  // Face +z : (v croissant, w croissant) donne une normale vers -z ; on
  // retourne donc cette face, et pas l'autre.
  const upper = part === 'full' || part === 'male' || part === 'print' ? grid(1) : null;
  const lower = part === 'full' || part === 'female' ? grid(-1) : null;
  if (upper) emit(upper, true);
  if (lower) emit(lower, false);
  if (part !== 'full') {
    // Face de joint d'une demi-caudale : un plan. Son contour est le bord
    // reel de la face galbee — aretes qui n'apparaissent qu'une fois —, et
    // l'interieur se triangule sans aucun sommet de plus.
    const next = new Map<number, number>();
    const seen = new Map<string, number>();
    for (let t = 0; t < tris.length; t += 3) {
      for (const [a, b] of [
        [tris[t], tris[t + 1]],
        [tris[t + 1], tris[t + 2]],
        [tris[t + 2], tris[t]],
      ]) {
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    for (let t = 0; t < tris.length; t += 3) {
      for (const [a, b] of [
        [tris[t], tris[t + 1]],
        [tris[t + 1], tris[t + 2]],
        [tris[t + 2], tris[t]],
      ]) {
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (seen.get(key) === 1) next.set(b, a);
      }
    }
    const startId = next.keys().next().value as number;
    const ring: number[] = [startId];
    for (let guard = 0; guard < next.size; guard++) {
      const id = next.get(ring[ring.length - 1]);
      if (id === undefined || id === startId) break;
      ring.push(id);
    }
    const contour = ring.map((id) => new THREE.Vector2(verts[id * 3], verts[id * 3 + 1]));
    const clockwise = THREE.ShapeUtils.isClockWise(contour);
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      // Le contour suit deja le sens inverse du bord de la face galbee :
      // les triangles le reprennent tel quel.
      if (clockwise) tris.push(ring[a], ring[c], ring[b]);
      else tris.push(ring[a], ring[b], ring[c]);
    }
  }

  for (let i = 0; i < tris.length; i++) positions.push(tris[i]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geometry.setIndex(positions);
  geometry.computeVertexNormals();
  return geometry;
}
