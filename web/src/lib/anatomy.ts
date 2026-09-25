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
import type { Anatomy, FinConfig, LureParams, ProfileKnot } from '../types/lure';
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
  const pc = cup ? 0.035 : 0;
  const lipR = cup ? Math.max(face.lipRadius, 0.3) * MM : 0;
  const cupDepth = cup ? Math.max(face.depth * MM, lipR * 1.2) : 0;
  const bottomRatio = cup ? clampN(1 - face.diameter, 0.15, 0.75) : 0;
  const xFront = -L / 2;
  const bodyStartX = xFront + lipR;

  const uOf = (p: number): number =>
    cup ? clampN((p - pc) / Math.max(bodyEnd - pc, 1e-6), 0, 1) : clampN(p / bodyEnd, 0, 1);

  const xBody = (p: number): number =>
    cup ? bodyStartX + ((p - pc) / (1 - pc)) * (L - lipR) : p * L - L / 2;

  // Calotte de nez : le corps se referme en ogive, tangente perpendiculaire
  // a l'axe a la pointe. Pas de pointe vive, donc pas de facette de nez.
  const noseCap = cup ? 0 : clampN(anatomy.noseCap, 0.005, 0.25);
  const noseShape = clampN(anatomy.noseShape, 0.35, 1);
  // Arriere : une nageoire se greffe sur un pedoncule qui se referme en
  // calotte courte ; une queue ronde se ferme plus largement.
  const tailCap = hasFin ? 0.03 : 0.07;

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
    return {
      offset: rake(p),
      top,
      bottom,
      halfWidth,
      nUpper: clampN(NU(u) * cs, 1.15, 5),
      nLower: clampN(NL(u) * cs, 1.15, 5),
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
    if (p <= 0 && !cup) {
      result = { offset: rake(0), top: 0, bottom: 0, halfWidth: 0, nUpper: 2, nLower: 2 };
    } else if (p >= bodyEnd) {
      const end = bodySection(bodyEnd);
      result = { ...end, top: 0, bottom: 0, halfWidth: 0 };
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
    if (cup && p < pc) return cupAt(p).x;
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
    cup,
    section,
    xAt,
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

function createAnatomyField(
  params: LureParams,
  anatomy: Anatomy,
  ctx: FieldContext,
): AnatomyField {
  const { L, H, bodyEnd, pc } = ctx;

  // --- Repartition des stations -------------------------------------------
  // Serrees la ou la forme change vite : pointe du nez, tete (machoire, oeil,
  // opercule), pedoncule, calotte de queue, et le long des nageoires dont
  // les rayons demandent une station tous les quelques dixiemes.
  const ped = clampN(anatomy.peduncle, 0.4, bodyEnd - 0.02);
  const head = Math.max(params.gills.position, anatomy.jaw) + 0.04;
  const dorsal = anatomy.dorsalFin;
  const anal = anatomy.analFin;
  const density = (p: number): number => {
    let rho = 1;
    rho += 5 * Math.exp(-(((p - pc) / 0.012) ** 2));
    rho += 1.8 * smoothstep(head + 0.06, head - 0.02, p);
    rho += 1.3 * Math.exp(-(((p - ped) / 0.07) ** 2));
    rho += 4 * Math.exp(-(((bodyEnd - p) / 0.015) ** 2));
    if (ctx.cup && p < pc) rho += 4;
    for (const fin of [dorsal, anal]) {
      if (finEnabled(fin) && p > fin.from - 0.01 && p < fin.to + 0.01) rho += 0.7;
    }
    return rho;
  };
  const warp = distribution(density, bodyEnd);

  // --- Cotes des reliefs, en cm -------------------------------------------
  const jawP = clampN(anatomy.jaw, 0.02, 0.3);
  const jawDepth = Math.max(anatomy.jawDepth, 0) * H;
  const jawSigma = clampN(0.0035 * L, 0.018, 0.05);

  const eyes = params.eyes.enabled ? params.eyes : null;
  const eyeX = eyes ? ctx.xAt(eyes.position) : 0;
  const eyeR = eyes ? Math.max((eyes.size * MM) / 2, 0.05) : 1;
  const orbitDepth = Math.max(anatomy.orbitDepth, 0) * MM;
  const socketR = eyeR * 1.06;
  const socketWall = Math.max(0.3 * eyeR, 0.04);
  const rimH = Math.max(0.35 * orbitDepth, 0.012);
  const rimW = Math.max(0.22 * eyeR, 0.04);
  const corneaH = eyes ? Math.max(eyes.relief, 0) * MM : 0;

  const gills = params.gills.enabled ? params.gills : null;
  const opX = gills ? ctx.xAt(gills.position) : 0;
  const opBow = gills ? Math.max(gills.size * MM, 0.05) : 0;
  const opR = Math.max(anatomy.opercleRelief, 0) * H;
  const slitD = gills ? Math.abs(gills.relief) * MM : 0;
  const opEdge = clampN(0.002 * L, 0.012, 0.035);
  const opLen = 0.075 * L;
  const OP_TOP = 0.42;
  const OP_BOT = 2.55;

  const llDepth = Math.max(anatomy.lateralLine, 0) * MM;
  const llFrom = (gills ? gills.position : 0.25) + 0.04;
  const llTo = Math.min(ped + 0.05, bodyEnd - 0.04);
  const llSigma = clampN(0.0022 * L, 0.012, 0.03);

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
  const flat = (fin: FinConfig, theta: number, tilt: number) => {
    if (!finEnabled(fin)) return;
    flats.push({
      fin,
      theta,
      tilt,
      x0: ctx.xAt(fin.from),
      length: Math.max((fin.to - fin.from) * L, 0.1),
      span: fin.size * H,
      thick: clampN(0.035 * H, 0.04, 0.12),
    });
  };
  flat(anatomy.pectoralFin, 2.02, 0.2);
  flat(anatomy.pelvicFin, 2.62, 0.1);

  const relief = (p: number, theta: number, section: Section): number => {
    if (p <= 0 || p >= bodyEnd) return 0;
    if (ctx.cup && p < pc) return 0;
    // Symetrie laterale : tous les reliefs sont definis sur le flanc droit.
    const th = theta > Math.PI ? Math.PI * 2 - theta : theta;
    const x = ctx.xAt(p);
    let d = 0;

    // Machoire : sillon de la pointe du museau a la commissure, qui descend
    // legerement vers l'arriere, avec la levre inferieure en leger bourrelet
    // et une fossette a la commissure.
    if (jawDepth > 0 && p < jawP + 0.05) {
      const pClamp = Math.min(p, jawP);
      const lineTheta = Math.PI / 2 + 0.05 + 0.28 * Math.pow(pClamp / jawP, 1.3);
      const across = chordBetween(section, th, lineTheta);
      const along = p <= jawP ? 0 : x - ctx.xAt(jawP);
      const dist = Math.hypot(across, along);
      const envelope = smoothstep(pc + 0.004, pc + 0.03, p);
      const groove = -jawDepth * Math.exp(-((dist / jawSigma) ** 2));
      const lip =
        0.4 * jawDepth * Math.exp(-(((across - 1.8 * jawSigma) / jawSigma) ** 2)) *
        Math.exp(-((along / jawSigma) ** 2));
      const pit =
        -0.5 * jawDepth *
        Math.exp(-((Math.hypot(x - ctx.xAt(jawP), chordBetween(section, th, Math.PI / 2 + 0.33)) /
          (1.6 * jawSigma)) ** 2));
      d += envelope * (groove + lip + pit);
    }

    // Orbite creusee, bourrelet de bord, et cornee bombee dans le logement.
    if (eyes) {
      const dx = x - eyeX;
      if (Math.abs(dx) < socketR + 4 * rimW) {
        const chord = Math.abs(chordBetween(section, th, EYE_THETA));
        const dist = Math.hypot(dx, chord);
        if (dist < socketR + 4 * rimW) {
          const socket = -orbitDepth * (1 - smoothstep(socketR - socketWall, socketR, dist));
          const rim = rimH * Math.exp(-(((dist - socketR - 0.25 * rimW) / rimW) ** 2));
          let cornea = 0;
          const rd = eyeR * 0.9;
          if (corneaH > 0 && dist < rd) {
            cornea = (orbitDepth * 0.9 + corneaH) * Math.pow(1 - (dist / rd) ** 2, 0.7);
          }
          d += socket + rim + cornea;
        }
      }
    }

    // Opercule : plaque en relief dont le bord arriere est saillant, doublee
    // d'un bourrelet, suivie de la fente d'ouie ; sillon du preopercule en
    // avant. Le bord bombe vers l'arriere a mi-flanc et revient vers la gorge.
    if (gills && th > OP_TOP - 0.1 && th < OP_BOT + 0.1) {
      const phi = clampN((th - OP_TOP) / (OP_BOT - OP_TOP), 0, 1);
      const edge = opX + opBow * Math.sin(Math.PI * Math.pow(phi, 0.85)) - 0.5 * opBow * phi * phi;
      const a = edge - x;
      if (a > -8 * opEdge && a < opLen * 1.1) {
        const window =
          smoothstep(0, 0.1, (th - OP_TOP + 0.1) / (OP_BOT - OP_TOP)) *
          smoothstep(0, 0.1, (OP_BOT + 0.1 - th) / (OP_BOT - OP_TOP));
        const plate = opR * smoothstep(-opEdge, opEdge, a) * (1 - smoothstep(0.55 * opLen, opLen, a));
        const rim = 0.6 * opR * Math.exp(-(((a - 1.5 * opEdge) / (1.2 * opEdge)) ** 2));
        const slit = -slitD * Math.exp(-(((a + 2.4 * opEdge) / (1.3 * opEdge)) ** 2));
        const pre = -0.35 * opR * Math.exp(-(((a - 0.55 * opLen) / (1.6 * opEdge)) ** 2));
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

    // Nageoires couchees (pectorales, ventrales) : un eventail en relief,
    // epais a la racine et mince au bord, rayons compris. Le bord est arrondi
    // et la racine se fond dans le corps.
    for (const fin of flats) {
      const dx = x - fin.x0;
      if (dx < -0.1 || dx > fin.length * 1.1) continue;
      const ds = chordBetween(section, th, fin.theta);
      if (Math.abs(ds) > fin.span) continue;
      const a = dx * Math.cos(fin.tilt) + ds * Math.sin(fin.tilt);
      const b = -dx * Math.sin(fin.tilt) + ds * Math.cos(fin.tilt);
      const s = a / fin.length;
      if (s < -0.05 || s > 1.05) continue;
      const half = 0.5 * fin.span * (0.3 + 0.7 * Math.pow(Math.sin(Math.PI * clampN(s * 0.85, 0, 1)), 0.7));
      const q = Math.abs(b) / Math.max(half, 1e-4);
      const margin = Math.min(0.045 / Math.max(half, 1e-4), 0.5);
      const inside = smoothstep(1, 1 - margin, q) * smoothstep(1, 0.95, s) * smoothstep(-0.03, 0.06, s);
      if (inside <= 0) continue;
      const thick = fin.thick * (1 - 0.7 * clampN(s, 0, 1));
      const origin = -0.2 * fin.length;
      const psi = Math.atan2(b, a - origin) / 0.9;
      const ray = Math.pow(0.5 + 0.5 * Math.cos(Math.PI * 2 * psi * Math.max(fin.fin.rays, 1) * 0.5), 3);
      d += inside * (thick + 0.22 * fin.thick * (1 - 0.5 * clampN(s, 0, 1)) * ray);
    }

    return d;
  };

  // --- Cretes : dorsale et anale ------------------------------------------
  interface Crest {
    fin: FinConfig;
    sign: 1 | -1;
    height: number;
    wb: number;
    we: number;
  }
  const crests: Crest[] = [];
  const addCrest = (fin: FinConfig, sign: 1 | -1) => {
    if (!finEnabled(fin)) return;
    crests.push({
      fin,
      sign,
      height: fin.size * H,
      wb: clampN(0.045 * H, 0.05, 0.16),
      we: clampN(0.014 * H, 0.03, 0.06),
    });
  };
  addCrest(dorsal, 1);
  addCrest(anal, -1);

  const crest = (p: number, theta: number, z: number): number => {
    let out = 0;
    const c = Math.cos(theta);
    for (const fin of crests) {
      if (fin.sign * c <= 0) continue;
      const s = (p - fin.fin.from) / (fin.fin.to - fin.fin.from);
      if (s <= 0 || s >= 1) continue;
      // Bord d'attaque haut, bord de fuite qui s'abaisse.
      const h = fin.height * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.75)), 0.6) * (1 - 0.3 * s);
      if (h <= 1e-4) continue;
      const az = Math.abs(z);
      // Rayons : une surepaisseur qui court de la base vers le bord, inclinee
      // vers l'arriere comme sur une vraie nageoire.
      const rays = Math.max(fin.fin.rays, 1);
      const q = s * rays - 0.6 * clampN(1 - az / fin.wb, 0, 1);
      const ray = Math.pow(Math.max(Math.cos(Math.PI * 2 * q), 0), 4);
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
  part: 'full' | 'male' | 'female' = 'full',
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
  const h = Math.max(H * 0.5 * size * (params.tailShape === 'fan' ? 1.02 : params.tailShape === 'paddle' ? 0.8 : 0.95), stalk * 1.2);
  const rays = Math.max(Math.round(params.anatomy?.caudalRays ?? 14), 4);
  const tb = clampN(0.06 * H, 0.08, 0.22);

  /** Bord de fuite, pour v de -1 (lobe bas) a +1 (lobe haut). */
  const trailing = (v: number): { x: number; y: number } => {
    const av = Math.abs(v);
    if (params.tailShape === 'forked') {
      const notch = 0.55;
      return { x: len * (notch + (1 - notch) * Math.pow(av, 1.25)), y: v * h * (0.2 + 0.8 * Math.pow(av, 0.8)) };
    }
    if (params.tailShape === 'paddle') {
      return { x: len * (0.97 - 0.08 * av * av), y: v * h };
    }
    // Eventail : bord de fuite legerement convexe.
    return { x: len * (0.9 + 0.1 * Math.cos((av * Math.PI) / 2)), y: v * h };
  };

  const NV = 48 + rays * 5;
  const NW = 40;
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
    const edge = Math.max(0, 1 - Math.pow(Math.abs(v), 6)) * Math.max(0, 1 - Math.pow(w, 6));
    const rootRamp = smoothstep(0, 0.04, w);
    const k = ((v + 1) / 2) * rays;
    const ray = Math.pow(Math.max(Math.cos(Math.PI * 2 * k), 0), 4);
    const blade = tb * (1 - 0.72 * w) * (1 + 0.28 * ray * (1 - 0.5 * w));
    // Pres de la racine, l'epaisseur est celle du pedoncule, puis elle se
    // resserre vers la lame : c'est le raccord, sans marche.
    const hub = rootThick * (1 - smoothstep(0, 0.2, w));
    const base = Math.max(blade, hub);
    return base * Math.sqrt(edge) * (0.25 + 0.75 * rootRamp);
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
        const t = onEdge ? 0 : Math.max(thickness(v, w) / 2, 2e-5);
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
  if (part === 'full' || part === 'male') emit(grid(1), true);
  if (part === 'full' || part === 'female') emit(grid(-1), false);
  if (part === 'male') emit(grid(0), false);
  if (part === 'female') emit(grid(0), true);

  for (let i = 0; i < tris.length; i++) positions.push(tris[i]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geometry.setIndex(positions);
  geometry.computeVertexNormals();
  return geometry;
}
