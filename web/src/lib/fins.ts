/**
 * Nageoires en volume — modules AW et AU.
 *
 * Trois realisations par nageoire (module AW) :
 *
 *   - integree : la nageoire sort du corps. Les impaires (dorsales, anale)
 *     sont des cretes de la peau elle-meme (anatomy.ts) ; les paires
 *     (pectorales, pelviennes) sont des lames posees au flanc, racine noyee
 *     dans le corps, construites ici ;
 *   - en relief : dessinee sur le flanc, rien a construire ici ;
 *   - rapportee : piece separee, imprimee a plat, avec sa languette (impaires,
 *     caudale) ou son tenon (paires), et son logement dans le corps.
 *
 * Toutes les lames suivent la meme loi : epaisseur degressive de la racine
 * au bord libre, jamais moins de 1,2 mm a la racine ni 0,6 mm au bord (bord
 * arrondi en demi-rond), rayons en relief, bord libre festonne entre deux
 * rayons.
 */

import * as THREE from 'three';
import type { FinConfig, LureParams } from '../types/lure';
import { FIN_FIT, FIN_MIN, buildCaudalFin, finModeOf, medianTabOf, pairedTabOf, type FinKind } from './anatomy';
import { caudalAttached, type ProfileSampler } from './profile';

const MM = 0.1;
const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clampN((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export type SkinSampler = (p: number, theta: number) => THREE.Vector3;

// ---------------------------------------------------------------------------
// Lame generique
// ---------------------------------------------------------------------------

/**
 * Lame : surface moyenne parametree (a de la racine au bord, b d'un bord
 * lateral a l'autre), normale, epaisseur. `flat` : une face plane (face
 * d'impression) et toute l'epaisseur de l'autre cote.
 */
export interface BladeSpec {
  mid: (a: number, b: number) => THREE.Vector3;
  normal: THREE.Vector3;
  thickness: (a: number, b: number) => number;
  na: number;
  nb: number;
  flat?: boolean;
}

/** Maillage ferme d'une lame : deux faces qui partagent exactement leur contour. */
export function buildBlade(spec: BladeSpec): THREE.BufferGeometry {
  const { na, nb } = spec;
  const cosSpace = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
  const verts: number[] = [];
  const index = new Map<string, number>();
  const vertex = (v: THREE.Vector3): number => {
    const key = `${v.x.toFixed(7)},${v.y.toFixed(7)},${v.z.toFixed(7)}`;
    const found = index.get(key);
    if (found !== undefined) return found;
    const id = verts.length / 3;
    verts.push(v.x, v.y, v.z);
    index.set(key, id);
    return id;
  };
  const rim = new Set<number>();
  const n = spec.normal.clone().normalize();
  const grid = (side: 1 | -1): number[][] => {
    const rows: number[][] = [];
    for (let i = 0; i <= na; i++) {
      const a = cosSpace(i / na);
      const row: number[] = [];
      for (let k = 0; k <= nb; k++) {
        const b = -1 + 2 * cosSpace(k / nb);
        const onEdge = i === 0 || i === na || k === 0 || k === nb;
        const t = onEdge ? 0 : Math.max(spec.thickness(a, b), 4e-5);
        const base = spec.mid(a, b);
        const offset = spec.flat ? (side > 0 ? t : 0) : (side * t) / 2;
        const id = vertex(base.addScaledVector(n, offset));
        if (onEdge) rim.add(id);
        row.push(id);
      }
      rows.push(row);
    }
    return rows;
  };
  const tris: number[] = [];
  const emit = (rows: number[][], flip: boolean) => {
    for (let i = 0; i < na; i++) {
      for (let k = 0; k < nb; k++) {
        const a = rows[i][k];
        const b = rows[i + 1][k];
        const c = rows[i + 1][k + 1];
        const d = rows[i][k + 1];
        const push = (p: number, q: number, r: number) => {
          if (p === q || q === r || p === r) return;
          if (rim.has(p) && rim.has(q) && rim.has(r)) return;
          if (flip) tris.push(p, r, q);
          else tris.push(p, q, r);
        };
        push(a, b, c);
        push(a, c, d);
      }
    }
  };
  const upper = grid(1);
  const lower = grid(-1);
  // Orientation : (a croissant, b croissant) x normale ; on retourne la face
  // dont la normale geometrique pointerait vers l'interieur.
  const probeA = spec.mid(0.5, 0);
  const da = spec.mid(0.55, 0).sub(probeA);
  const db = spec.mid(0.5, 0.05).sub(probeA);
  const upperOut = da.clone().cross(db).dot(n) > 0;
  emit(upper, !upperOut);
  emit(lower, upperOut);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geometry.setIndex(tris);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Epaisseur d'une lame de nageoire : degressive de la racine au bord libre,
 * surepaisseur des rayons, bord libre arrondi en demi-rond (rayon = moitie de
 * l'epaisseur locale), racine qui se referme dans le corps.
 */
function finThickness(opts: {
  base: number;
  edge: number;
  rays: number;
  /** Distance reelle au bord libre, en cm, pour (a, b). */
  toEdge: (a: number, b: number) => number;
  rootClose?: boolean;
}): (a: number, b: number) => number {
  return (a, b) => {
    const k = ((b + 1) / 2) * Math.max(opts.rays, 1);
    const ray = Math.pow(Math.max(Math.cos(Math.PI * 2 * k), 0), 4);
    const plain = Math.max(opts.base * (1 - a) + opts.edge * a, opts.edge);
    const t = plain * (1 + 0.3 * ray * (1 - 0.5 * a));
    const d = opts.toEdge(a, b);
    const r = t / 2;
    const e = d >= r ? 1 : Math.sqrt(Math.max(1 - (1 - d / r) ** 2, 0));
    const root = opts.rootClose === false ? 1 : 0.35 + 0.65 * smoothstep(0, 0.06, a);
    return t * e * root;
  };
}

/** Feston du bord libre : la membrane recule entre deux rayons. */
const festoon = (b: number, rays: number, depth = 0.04): number => {
  const k = ((b + 1) / 2) * Math.max(rays, 1);
  return 1 - depth * (1 - Math.pow(0.5 + 0.5 * Math.cos(Math.PI * 2 * k), 2));
};

// ---------------------------------------------------------------------------
// Nageoires paires en volume
// ---------------------------------------------------------------------------

const PAIRED: { kind: FinKind; key: 'pectoralFin' | 'pelvicFin'; theta: number; spread: number }[] = [
  { kind: 'pectoral', key: 'pectoralFin', theta: 2.02, spread: 0.6 },
  { kind: 'pelvic', key: 'pelvicFin', theta: 2.62, spread: 0.5 },
];

const finOn = (fin: FinConfig | undefined): fin is FinConfig =>
  !!fin && fin.enabled && fin.to - fin.from > 0.01 && fin.size > 0.001;

/** Repere local au pied d'une nageoire paire, cote droit (+z). */
function footFrame(skin: SkinSampler, p: number, theta: number) {
  const eps = 1e-3;
  const S = skin(p, theta);
  const Sp = skin(p + eps, theta);
  const St = skin(p, theta + eps);
  const alongBody = Sp.clone().sub(S).normalize();
  const aroundBody = St.clone().sub(S).normalize();
  const outward = alongBody.clone().cross(aroundBody).normalize();
  // Sur le flanc droit, la normale sortante a une composante +z.
  if (outward.z < 0) outward.negate();
  return { S, alongBody, aroundBody, outward };
}

/**
 * Nageoires paires INTEGREES d'un cote (+1 : droit, coque male ; -1 : gauche,
 * coque femelle), en repere du leurre.
 *
 * Les pectorales du gobie (anatomy.pectoralSpan) sont deployees en eventail
 * vers l'exterieur ; les autres se couchent vers l'arriere en s'ecartant du
 * flanc, comme une pectorale au repos.
 */
export function pairedFinSolids(
  params: LureParams,
  skin: SkinSampler,
  side: 1 | -1,
): THREE.BufferGeometry[] {
  const anatomy = params.anatomy;
  if (!anatomy) return [];
  const H = params.thickness * MM;
  const L = params.length * MM;
  const out: THREE.BufferGeometry[] = [];
  for (const def of PAIRED) {
    const fin = anatomy[def.key];
    if (!finOn(fin) || finModeOf(fin, def.kind) !== 'integrated') continue;
    if (def.kind === 'pelvic' && anatomy.pelvicSucker) continue;
    const fan = def.kind === 'pectoral' && anatomy.pectoralSpan !== undefined;
    const pFoot = fin.from + 0.12 * (fin.to - fin.from);
    const f = footFrame(skin, pFoot, def.theta);
    const rays = Math.max(fin.rays, 4);
    let u: THREE.Vector3;
    let reach: number;
    let halfSpan: number;
    let halfRoot: number;
    if (fan) {
      // Eventail deploye : la lame part vers l'exterieur, un peu vers
      // l'arriere et vers le bas ; sa portee fait l'envergure demandee.
      u = f.outward.clone().multiplyScalar(0.82).addScaledVector(f.alongBody, 0.5).add(new THREE.Vector3(0, -0.22, 0)).normalize();
      const span = (anatomy.pectoralSpan ?? 30) * MM;
      const lateral = Math.max(span / 2 - Math.abs(f.S.z), 0.2);
      reach = lateral / Math.max(Math.abs(u.z), 0.35) + 0.05;
      halfSpan = 0.55 * reach;
      halfRoot = clampN(0.3 * fin.size * H, 0.12, 0.45);
    } else {
      const spread = def.spread;
      u = f.alongBody.clone().multiplyScalar(Math.cos(spread)).addScaledVector(f.outward, Math.sin(spread)).normalize();
      reach = Math.max((fin.to - fin.from) * L, 0.2);
      halfSpan = 0.5 * fin.size * H;
      halfRoot = 0.3 * halfSpan;
    }
    // Racine noyee de 0,6 mm dans le corps.
    const origin = f.S.clone().addScaledVector(f.outward, -0.06);
    let v = f.aroundBody.clone();
    v.addScaledVector(u, -v.dot(u)).normalize();
    const normal = u.clone().cross(v).normalize();
    if (side < 0) {
      origin.z = -origin.z;
      u = new THREE.Vector3(u.x, u.y, -u.z);
      v = new THREE.Vector3(v.x, v.y, -v.z);
    }
    const nrm = side < 0 ? new THREE.Vector3(normal.x, normal.y, -normal.z) : normal;
    const tip = (b: number) => {
      const phi = b * (fan ? 1.05 : 0.8);
      const r = reach * festoon(b, rays) * (fan ? 1 : 0.8 + 0.2 * Math.cos(phi));
      return { x: r * Math.cos(phi * 0.55), y: halfSpan * Math.sin(phi) / Math.sin(fan ? 1.05 : 0.8) };
    };
    const planar = (a: number, b: number) => {
      const t = tip(b);
      return { x: t.x * a, y: b * halfRoot * (1 - a) + t.y * a };
    };
    const mid = (a: number, b: number) => {
      const q = planar(a, b);
      return origin.clone().addScaledVector(u, q.x).addScaledVector(v, q.y);
    };
    // TPU (gobie) : lame souple, un peu plus epaisse a la racine.
    const soft = params.material === 'tpu';
    const base = soft ? Math.max(FIN_MIN.base, 0.16) : FIN_MIN.base;
    const edge = soft ? Math.max(FIN_MIN.edge, 0.07) : FIN_MIN.edge;
    const thickness = finThickness({
      base,
      edge,
      rays,
      toEdge: (a, b) => Math.min((1 - a) * reach, (1 - Math.abs(b)) * halfSpan),
    });
    out.push(buildBlade({ mid, normal: nrm, thickness, na: 18 + rays, nb: 14 + rays * 4 }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pieces rapportees
// ---------------------------------------------------------------------------

/** Boite plate (languette), face d'appui en z = 0. */
function slab(x0: number, x1: number, y0: number, y1: number, t: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, t);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, t / 2);
  return g.toNonIndexed();
}

export interface AttachedFinPart {
  label: string;
  /** Piece a plat, face d'appui en z = 0, pret a imprimer. */
  geometry: THREE.BufferGeometry;
  /** Encombrement a plat, en mm. */
  sizeMm: { x: number; y: number };
}

/** Lame plate a imprimer : base le long de x, hauteur en y, epaisseur en z >= 0. */
function flatFin(opts: {
  length: number;
  height: (s: number) => number;
  rays: number;
  sweep: number;
}): THREE.BufferGeometry {
  const { length, rays } = opts;
  const mid = (a: number, b: number) => {
    // b de -1 (bord d'attaque) a +1 (bord de fuite), a de la base au bord.
    const s = (b + 1) / 2;
    const h = opts.height(s) * festoon(b, rays, 0.07);
    return new THREE.Vector3(s * length + a * h * opts.sweep, a * h, 0);
  };
  const thickness = finThickness({
    base: FIN_MIN.base,
    edge: FIN_MIN.edge,
    rays,
    rootClose: false,
    toEdge: (a, b) => {
      const s = (b + 1) / 2;
      const h = opts.height(s);
      return Math.min((1 - a) * h, Math.min(s, 1 - s) * length);
    },
  });
  return buildBlade({ mid, normal: new THREE.Vector3(0, 0, 1), thickness, na: 16, nb: 24 + rays * 4, flat: true });
}

/**
 * Nageoires rapportees, a plat, cote a cote : chaque piece porte sa
 * languette (impaires, caudale) ou son tenon (paires). Les pieces paires
 * sortent en deux exemplaires.
 */
export function attachedFinParts(profile: ProfileSampler, params: LureParams): AttachedFinPart[] {
  const anatomy = params.anatomy;
  if (!anatomy) return [];
  const H = params.thickness * MM;
  const L = params.length * MM;
  const parts: AttachedFinPart[] = [];
  const median: [FinConfig | undefined, FinKind, string][] = [
    [anatomy.dorsalFin, 'dorsal', 'dorsale'],
    [anatomy.dorsalFin2, 'dorsal2', 'seconde dorsale'],
    [anatomy.analFin, 'anal', 'anale'],
  ];
  for (const [fin, kind, label] of median) {
    if (!finOn(fin) || finModeOf(fin, kind) !== 'attached') continue;
    const base = (fin.to - fin.from) * L;
    const height = fin.size * H;
    const tab = medianTabOf(H);
    const blade = flatFin({
      length: base,
      height: (s) => Math.max(height * Math.pow(Math.sin(Math.PI * Math.pow(clampN(s, 0.001, 0.999), 0.75)), 0.6) * (1 - 0.3 * s), 0.03),
      rays: Math.max(fin.rays, 3),
      sweep: 0.55,
    });
    const tongue = slab(FIN_FIT, base - FIN_FIT, -(tab.depth - FIN_FIT), 0.02, tab.thickness);
    parts.push({ label: `Nageoire ${label}`, geometry: merge([blade, tongue]), sizeMm: { x: base / MM, y: (height + tab.depth) / MM } });
  }
  // Caudale rapportee : la lame a plat et sa languette, qui entre dans la
  // fente du pedoncule.
  const slot = caudalSlot(profile, params);
  if (slot) {
    const blade = buildCaudalFin(profile, params, 'print');
    blade.translate(-slot.xCut, -slot.centreY, 0);
    const tang = slab(-(slot.xCut - slot.xRoot - FIN_FIT), 0.03, -slot.tangHalf, slot.tangHalf, slot.depth * 2 - FIN_FIT * 2);
    const whole = merge([blade, tang]);
    whole.computeBoundingBox();
    const bb = whole.boundingBox!;
    parts.push({
      label: 'Nageoire caudale',
      geometry: whole,
      sizeMm: { x: (bb.max.x - bb.min.x) / MM, y: (bb.max.y - bb.min.y) / MM },
    });
  }
  for (const def of PAIRED) {
    const fin = anatomy[def.key];
    if (!finOn(fin) || finModeOf(fin, def.kind) !== 'attached') continue;
    const right = pairedPart(fin, H, L);
    const label = def.kind === 'pectoral' ? 'pectorale' : 'pelvienne';
    parts.push({ label: `Nageoire ${label} droite`, geometry: right.geometry, sizeMm: right.sizeMm });
    parts.push({ label: `Nageoire ${label} gauche`, geometry: mirrorY(right.geometry), sizeMm: right.sizeMm });
  }
  return parts;
}

/** Balayage vers l'arriere d'une nageoire paire rapportee, dans son plan. */
const PAIRED_SWEEP = 0.9;

/**
 * Nageoire paire rapportee, cote droit, a plat : le tenon part vers -x (il
 * entre dans le puits du flanc), la lame s'ouvre en eventail en s'inclinant
 * de 50 degres vers +y, qui sera l'arriere du leurre une fois montee.
 */
function pairedPart(fin: FinConfig, H: number, L: number): { geometry: THREE.BufferGeometry; sizeMm: { x: number; y: number } } {
  const reach = Math.max((fin.to - fin.from) * L, 0.2);
  const span = fin.size * H;
  const tab = pairedTabOf(H);
  const rays = Math.max(fin.rays, 3);
  const c = Math.cos(PAIRED_SWEEP);
  const sn = Math.sin(PAIRED_SWEEP);
  const mid = (a: number, b: number) => {
    const r = reach * festoon(b, rays, 0.05);
    const phi = b * 0.7;
    const along = a * r * Math.cos(phi);
    const across = (b * tab.width) / 2 * (1 - a) + a * span * 0.5 * Math.sin(phi) / Math.sin(0.7);
    return new THREE.Vector3(along * c - across * sn, along * sn + across * c, 0);
  };
  const thickness = finThickness({
    base: FIN_MIN.base,
    edge: FIN_MIN.edge,
    rays,
    rootClose: false,
    toEdge: (a, b) => Math.min((1 - a) * reach, (1 - Math.abs(b)) * span * 0.5 + (1 - a) * 0.02),
  });
  const blade = buildBlade({ mid, normal: new THREE.Vector3(0, 0, 1), thickness, na: 16, nb: 20 + rays * 4, flat: true });
  const tenon = slab(-(tab.depth - FIN_FIT), 0.02, -tab.width / 2, tab.width / 2, tab.thickness);
  return { geometry: merge([blade, tenon]), sizeMm: { x: (reach + tab.depth) / MM, y: span / MM } };
}

/** Image miroir y -> -y d'une piece a plat (sens des triangles retabli). */
function mirrorY(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const pos = g.getAttribute('position');
  const out: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    for (const k of [0, 2, 1]) out.push(pos.getX(i + k), -pos.getY(i + k), pos.getZ(i + k));
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  m.computeVertexNormals();
  return m;
}

/** Applique une matrice a une copie, en retablissant le sens si la matrice est un miroir. */
function placed(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const g = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(matrix);
  if (matrix.determinant() < 0) {
    const pos = g.getAttribute('position');
    const out: number[] = [];
    for (let i = 0; i < pos.count; i += 3) for (const k of [0, 2, 1]) out.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
    const m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    m.computeVertexNormals();
    return m;
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Nageoires rapportees montees en place, en repere du leurre : pour
 * l'affichage, le modele assemble et la physique. Face plane de chaque
 * piece contre le plan de symetrie (impaires) ; tenon dans le puits du flanc
 * (paires).
 */
export function attachedFinsMounted(profile: ProfileSampler, params: LureParams, skin: SkinSampler): THREE.BufferGeometry[] {
  const anatomy = params.anatomy;
  if (!anatomy) return [];
  const H = params.thickness * MM;
  const L = params.length * MM;
  const out: THREE.BufferGeometry[] = [];
  const parts = attachedFinParts(profile, params);
  const find = (label: string) => parts.find((part) => part.label === label);
  const medianMount = (fin: FinConfig, label: string, belly: boolean) => {
    const part = find(`Nageoire ${label}`);
    if (!part) return;
    const ridge = belly ? Math.PI : 0;
    const a = skin(fin.from, ridge);
    const b = skin(fin.to, ridge);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const t = FIN_MIN.base;
    const m = new THREE.Matrix4().makeTranslation(a.x, a.y, 0);
    m.multiply(new THREE.Matrix4().makeRotationZ(angle));
    if (belly) m.multiply(new THREE.Matrix4().makeScale(1, -1, 1));
    m.multiply(new THREE.Matrix4().makeTranslation(0, 0, -t / 2));
    out.push(placed(part.geometry, m));
  };
  if (finOn(anatomy.dorsalFin) && finModeOf(anatomy.dorsalFin, 'dorsal') === 'attached') medianMount(anatomy.dorsalFin, 'dorsale', false);
  if (finOn(anatomy.dorsalFin2) && finModeOf(anatomy.dorsalFin2, 'dorsal2') === 'attached') medianMount(anatomy.dorsalFin2, 'seconde dorsale', false);
  if (finOn(anatomy.analFin) && finModeOf(anatomy.analFin, 'anal') === 'attached') medianMount(anatomy.analFin, 'anale', true);
  const caudal = find('Nageoire caudale');
  const slot = caudalSlot(profile, params);
  if (caudal && slot) {
    out.push(placed(caudal.geometry, new THREE.Matrix4().makeTranslation(slot.xCut, slot.centreY, -(slot.depth - FIN_FIT))));
  }
  for (const def of PAIRED) {
    const fin = anatomy[def.key];
    if (!finOn(fin) || finModeOf(fin, def.kind) !== 'attached') continue;
    const label = def.kind === 'pectoral' ? 'pectorale' : 'pelvienne';
    const right = find(`Nageoire ${label} droite`);
    if (!right) continue;
    const radius = Math.hypot(pairedTabOf(H).width, pairedTabOf(H).thickness) / 2 + FIN_FIT;
    const pSock = fin.from + (radius + 0.02) / L;
    const f = footFrame(skin, pSock, def.theta);
    // Axes de la piece : x -> normale sortante, y -> arriere du leurre, z -> le troisieme.
    const X = f.outward.clone();
    const Y = f.alongBody.clone().addScaledVector(X, -f.alongBody.dot(X)).normalize();
    const Z = X.clone().cross(Y);
    const basis = new THREE.Matrix4().makeBasis(X, Y, Z);
    const m = new THREE.Matrix4().makeTranslation(f.S.x, f.S.y, f.S.z).multiply(basis);
    m.multiply(new THREE.Matrix4().makeTranslation(0, 0, -FIN_MIN.base / 2));
    out.push(placed(right.geometry, m));
    // Cote gauche : image miroir par le plan de symetrie.
    out.push(placed(right.geometry, new THREE.Matrix4().makeScale(1, 1, -1).multiply(m)));
  }
  return out;
}

/** Reunit des geometries en une soupe non indexee. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const part of parts) {
    const g = part.index ? part.toNonIndexed() : part;
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.computeVertexNormals();
  return out;
}

/** Pieces rapportees posees a plat en une rangee, espacees de 3 mm. */
export function layoutFlat(parts: AttachedFinPart[]): THREE.BufferGeometry | null {
  if (parts.length === 0) return null;
  const placed: THREE.BufferGeometry[] = [];
  let cursor = 0;
  for (const part of parts) {
    const g = part.geometry.clone();
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    g.translate(cursor - bb.min.x, -bb.min.y, -bb.min.z);
    cursor += bb.max.x - bb.min.x + 0.3;
    placed.push(g);
  }
  return merge(placed);
}

/** Vrai si une nageoire du leurre est rapportee (piece separee). */
export function hasAttachedFins(params: LureParams): boolean {
  const a = params.anatomy;
  if (!a) return false;
  return (
    ([
      [a.dorsalFin, 'dorsal'],
      [a.dorsalFin2, 'dorsal2'],
      [a.analFin, 'anal'],
      [a.pectoralFin, 'pectoral'],
      [a.pelvicFin, 'pelvic'],
    ] as [FinConfig | undefined, FinKind][]).some(([fin, kind]) => finOn(fin) && finModeOf(fin, kind) === 'attached')
  );
}


/**
 * Fente de pedoncule d'une caudale rapportee : la meme construction que la
 * queue rapportee (bout de queue tronque, languette prise en sandwich entre
 * les deux coques), aux cotes de la languette de caudale.
 */
export interface CaudalSlot {
  pCut: number;
  xCut: number;
  xRoot: number;
  centreY: number;
  tangHalf: number;
  halfBand: number;
  depth: number;
}

export function caudalSlot(profile: ProfileSampler, params: LureParams): CaudalSlot | null {
  if (!caudalAttached(params) || !params.anatomy) return null;
  // Coupe au debut de la calotte de queue : le pedoncule y a encore toute
  // son epaisseur pour loger la languette.
  const pCut = Math.max(profile.bodyEnd * (1 - 0.03) - 0.005, 0.5);
  const section = profile.section(pCut);
  const xCut = profile.xAt(pCut);
  const halfHeight = Math.min(section.top, -section.bottom);
  const insertion = clampN(0.04 * params.length * MM, 0.3, 0.5);
  // Languette basse : au milieu de la hauteur, la ou le pedoncule est le
  // plus epais.
  const tangHalf = Math.max(Math.min(halfHeight * 0.4 - FIN_FIT, 0.3), 0.06);
  const thickness = FIN_MIN.base;
  return {
    pCut,
    xCut,
    xRoot: xCut - insertion,
    centreY: (section.top + section.bottom) / 2 + section.offset,
    tangHalf,
    halfBand: tangHalf + FIN_FIT,
    depth: thickness / 2 + FIN_FIT,
  };
}
