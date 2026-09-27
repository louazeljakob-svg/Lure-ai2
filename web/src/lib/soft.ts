/**
 * Souple monobloc en TPU — module AU.
 *
 * Exception explicite au standard male / femelle du module AM : un souple
 * s'imprime d'une piece, pleine, sans vis ni ecrou. Ce module fabrique :
 *
 *   - la piece unique : la peau du corps (canal ou fente d'armement compris),
 *     raffinee par le maillage adaptatif, la caudale, les pectorales en
 *     eventail, et les logements de lest internes (cavites fermees garnies
 *     pendant une pause d'impression) ;
 *   - l'hamecon represente pour verification, et la tete plombee du montage
 *     sur canal ;
 *   - le bilan d'armement : taille d'hamecon retenue, ouverture utile,
 *     hauteur de pause, et les refus nommes.
 */

import * as THREE from 'three';
import type { LureParams, SoftBodyConfig } from '../types/lure';
import { channelDepthCm, softSlotOf } from './anatomy';
import { ballastMarkers, createSkin, finSolids, stationAt, thetaAt } from './geometry';
import { buildTailFin } from './geometry';
import { MM_TO_CM, type ProfileSampler } from './profile';
import { refineSoup, type RefineStats } from './refine';

const MM = MM_TO_CM;
const LEAD = 11.34;
const STEEL = 7.85;

export const defaultSoftBody = (): SoftBodyConfig => ({
  enabled: false,
  hardness: 90,
  rigging: 'slot',
  channelDiameter: 2,
  ballastSeat: false,
  jigMass: 5,
});

/** Souple monobloc actif : famille Souple et assimiles. */
export const softActive = (params: LureParams): boolean => params.soft?.enabled === true;

// ---------------------------------------------------------------------------
// Hamecons
// ---------------------------------------------------------------------------

/**
 * Gabarit indicatif d'hamecons simples (texan / tete plombee), en mm. Les
 * cotes varient d'une marque a l'autre : c'est une verification d'ordre de
 * grandeur, a confronter a l'hamecon reel.
 */
export interface HookSpec {
  size: string;
  gapMm: number;
  shankMm: number;
  wireMm: number;
}

export const SOFT_HOOKS: HookSpec[] = [
  { size: '#1', gapMm: 8.5, shankMm: 19, wireMm: 0.8 },
  { size: '1/0', gapMm: 10, shankMm: 22, wireMm: 0.9 },
  { size: '2/0', gapMm: 11.5, shankMm: 25, wireMm: 1 },
  { size: '3/0', gapMm: 13, shankMm: 28, wireMm: 1.1 },
  { size: '4/0', gapMm: 14.5, shankMm: 31, wireMm: 1.2 },
  { size: '5/0', gapMm: 16, shankMm: 34, wireMm: 1.3 },
  { size: '6/0', gapMm: 18, shankMm: 38, wireMm: 1.4 },
  { size: '8/0', gapMm: 21, shankMm: 44, wireMm: 1.6 },
];

export interface SoftRigPlan {
  hook: HookSpec | null;
  /** Ouverture necessaire pour que la pointe sorte du dos avec 1,5 mm de marge, en mm. */
  neededGapMm: number;
  /** Abscisse de la hampe : de l'oeillet au coude, en cm. */
  shankFrom: number;
  shankTo: number;
  /** Hauteur de la hampe (fond de fente ou axe du canal), en cm. */
  shankY: number;
  /** Tete plombee (canal) : centre et rayon, en cm. */
  jig: { x: number; y: number; radius: number; massG: number } | null;
  hookMassG: number;
  /** Logements de lest : centre, rayon de cavite, en cm. */
  seats: { x: number; y: number; radius: number; massG: number }[];
  /** Pause d'impression pour garnir les logements, en mm depuis le ventre (piece posee sur le ventre), a l'equateur de la cavite. */
  pauseMm: number | null;
  problems: string[];
}

/** Rayon d'une bille de plomb de masse donnee, en cm. */
const leadRadius = (massG: number): number => Math.cbrt((3 * Math.max(massG, 0.01)) / (4 * Math.PI * LEAD));

/** Masse d'un hamecon : fil developpe (hampe, coude, pointe, oeillet), acier. */
const hookMass = (hook: HookSpec): number => {
  const length = hook.shankMm + (Math.PI * hook.gapMm) / 2 + 0.45 * hook.gapMm + 2 * Math.PI * 1.2 * hook.wireMm;
  return Math.PI * (hook.wireMm / 2) ** 2 * length * 1e-3 * STEEL;
};

/**
 * Plan d'armement : ou passe la hampe, quelle taille d'hamecon laisse la
 * pointe sortir du dos, ou se logent les lests, quand faire la pause.
 */
export function softRigPlan(profile: ProfileSampler, params: LureParams): SoftRigPlan {
  const soft = params.soft!;
  const problems: string[] = [];
  // Pointe du nez : sur un corps perce d'un canal, xAt(0) est le FOND du
  // canal, pas le nez.
  const noseX = -profile.lengthCm / 2;
  const pOf = (x: number) => Math.min(Math.max((x - noseX) / profile.lengthCm, 0), profile.bodyEnd);
  const sectionAtX = (x: number) => profile.section(pOf(x));
  let shankFrom = noseX;
  let shankTo = shankFrom;
  let shankY = 0;
  let above = 0;
  let jig: SoftRigPlan['jig'] = null;
  if (soft.rigging === 'slot') {
    const slot = softSlotOf(params)!;
    shankFrom = noseX;
    shankTo = profile.xAt(slot.to);
    const sec = profile.section(slot.to - 0.01);
    shankY = sec.bottom + slot.depth * (sec.top - sec.bottom) + sec.offset;
    above = sec.top + sec.offset - shankY;
  } else if (soft.rigging === 'channel') {
    const depth = channelDepthCm(params);
    shankFrom = noseX - 0.05;
    shankTo = noseX + depth;
    const nose = profile.section(0.035);
    shankY = (nose.top + nose.bottom) / 2 + nose.offset;
    const sec = sectionAtX(shankTo);
    above = sec.top + sec.offset - shankY;
    const r = leadRadius(soft.jigMass);
    jig = { x: noseX - r * 0.55, y: shankY, radius: r, massG: soft.jigMass };
  }
  const neededGapMm = soft.rigging === 'none' ? 0 : above / MM + 1.5;
  const shankMm = (shankTo - shankFrom) / MM;
  let hook: HookSpec | null = null;
  if (soft.rigging !== 'none') {
    hook = SOFT_HOOKS.find((h) => h.gapMm >= neededGapMm && h.shankMm >= shankMm * 0.8) ?? null;
    if (!hook) {
      problems.push(
        `Aucun hamecon du gabarit (jusqu au 8/0) n ouvre assez : il faut ${neededGapMm.toFixed(1)} mm ` +
          `d ouverture pour que la pointe sorte du dos. Reduisez la hauteur du corps a la sortie ou passez en ` +
          'fente ventrale plus profonde.',
      );
    }
  }
  const seats: SoftRigPlan['seats'] = [];
  if (soft.ballastSeat) {
    // Memes billes que la liste des lests : le logement est la bille, plus
    // 0,10 mm au diametre — le jeu des portees d'ecrou.
    const markers = ballastMarkers(profile, params.ballasts, params.ballastDensity);
    for (const marker of markers) {
      const [x, y] = marker.position;
      const p = pOf(x);
      const sec = profile.section(p);
      const r = marker.radius + 0.005;
      const centre = (sec.top + sec.bottom) / 2 + sec.offset;
      const half = (sec.top - sec.bottom) / 2;
      const where = `Logement de lest a ${((x - noseX) / MM).toFixed(0)} mm du nez`;
      // Paroi de TPU d'au moins 1 mm tout autour.
      const wall = Math.min(half - Math.abs(y - centre) - r, sec.halfWidth - r);
      if (wall < 0.1) {
        problems.push(
          `${where} : la bille de ${marker.mass.toFixed(1)} g (${((2 * r) / MM).toFixed(1)} mm) laisse moins de ` +
            '1 mm de TPU autour. Allegez-la ou deplacez-la vers une section plus epaisse.',
        );
        continue;
      }
      if (soft.rigging === 'slot') {
        const slot = softSlotOf(params)!;
        if (p > slot.from - 0.02 && p < slot.to + 0.02 && y - r < shankY + 0.1) {
          problems.push(`${where} : il croise la fente ventrale. Montez-le ou placez-le devant la fente.`);
          continue;
        }
      }
      if (soft.rigging === 'channel' && x - r < shankTo + 0.1 && Math.abs(y - shankY) < r + (soft.channelDiameter * MM) / 2 + 0.1) {
        problems.push(`${where} : il croise le canal. Baissez-le ou reculez-le.`);
        continue;
      }
      seats.push({ x, y, radius: r, massG: marker.mass });
    }
  }
  const belly = Math.min(
    ...Array.from({ length: 40 }, (_, i) => {
      const s = profile.section((profile.bodyEnd * (i + 0.5)) / 40);
      return s.bottom + s.offset;
    }),
  );
  // Pause a l'equateur de la cavite la plus basse : la bille y entre dans la
  // demi-coupelle deja imprimee, et l'impression reprend autour d'elle.
  const pauseMm = seats.length ? Math.min(...seats.map((s) => (s.y - belly) / MM)) : null;
  return {
    hook,
    neededGapMm,
    shankFrom,
    shankTo,
    shankY,
    jig,
    hookMassG: hook ? hookMass(hook) : 0,
    seats,
    pauseMm,
    problems,
  };
}

// ---------------------------------------------------------------------------
// Hamecon et tete plombee, pour la verification
// ---------------------------------------------------------------------------

/** Tube ferme le long d'un chemin, rayon constant, pointe effilee au bout. */
function tube(path: THREE.Vector3[], radius: number, sharpEnd: boolean): THREE.BufferGeometry {
  const seg = 12;
  const rings: THREE.Vector3[][] = [];
  let normal = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < path.length; i++) {
    const t = (i < path.length - 1 ? path[i + 1].clone().sub(path[i]) : path[i].clone().sub(path[i - 1])).normalize();
    normal = normal.clone().addScaledVector(t, -normal.dot(t)).normalize();
    const binormal = t.clone().cross(normal);
    const r = sharpEnd && i >= path.length - 4 ? radius * ((path.length - 1 - i) / 3) : radius;
    const ring: THREE.Vector3[] = [];
    for (let k = 0; k < seg; k++) {
      const a = (2 * Math.PI * k) / seg;
      ring.push(path[i].clone().addScaledVector(normal, Math.cos(a) * r).addScaledVector(binormal, Math.sin(a) * r));
    }
    rings.push(ring);
  }
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = rings[i][k];
      const b = rings[i][(k + 1) % seg];
      const c = rings[i + 1][(k + 1) % seg];
      const d = rings[i + 1][k];
      tri(a, b, c);
      tri(a, c, d);
    }
  }
  const cap = (ring: THREE.Vector3[], centre: THREE.Vector3, flip: boolean) => {
    for (let k = 0; k < seg; k++) {
      if (flip) tri(centre, ring[(k + 1) % seg], ring[k]);
      else tri(centre, ring[k], ring[(k + 1) % seg]);
    }
  };
  cap(rings[0], path[0], true);
  if (!sharpEnd) cap(rings[rings.length - 1], path[path.length - 1], false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Hamecon en place, dans le plan de symetrie : oeillet au nez, hampe dans la
 * fente (ou le canal), coude au bout, pointe qui sort au-dessus du dos et
 * revient vers l'avant. Plus la tete plombee pour un montage sur canal.
 */
export function buildSoftRig(profile: ProfileSampler, params: LureParams, plan: SoftRigPlan): THREE.BufferGeometry | null {
  if (!plan.hook) return null;
  const hook = plan.hook;
  const r = (hook.wireMm * MM) / 2;
  const gap = hook.gapMm * MM;
  const path: THREE.Vector3[] = [];
  const x0 = plan.shankFrom;
  const x1 = Math.max(plan.shankTo, x0 + 0.5);
  const y = plan.shankY;
  const N = 24;
  for (let i = 0; i <= N; i++) path.push(new THREE.Vector3(x0 + ((x1 - x0) * i) / N, y, 0));
  const R = gap / 2;
  for (let i = 1; i <= 20; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 20;
    path.push(new THREE.Vector3(x1 + R * Math.cos(a), y + R + R * Math.sin(a), 0));
  }
  const point = 0.45 * gap;
  for (let i = 1; i <= 8; i++) path.push(new THREE.Vector3(x1 - (point * i) / 8, y + gap - 0.02 * (i / 8), 0));
  const parts = [tube(path, r, true)];
  // Oeillet : un anneau vertical au bout avant de la hampe.
  const eye: THREE.Vector3[] = [];
  const eyeR = Math.max(1.4 * hook.wireMm * MM, 0.08);
  for (let i = 0; i <= 28; i++) {
    const a = Math.PI / 2 + (2 * Math.PI * i) / 28;
    eye.push(new THREE.Vector3(x0 - eyeR + eyeR * Math.cos(a), y + eyeR * Math.sin(a) * 0.9, 0));
  }
  parts.push(tube(eye, r * 0.9, false));
  if (plan.jig) {
    const s = new THREE.SphereGeometry(plan.jig.radius, 28, 18).toNonIndexed();
    s.translate(plan.jig.x, plan.jig.y, 0);
    parts.push(s);
  }
  const pos: number[] = [];
  for (const g of parts) {
    const a = g.getAttribute('position');
    for (let i = 0; i < a.count; i++) pos.push(a.getX(i), a.getY(i), a.getZ(i));
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  void profile;
  void params;
  return out;
}

// ---------------------------------------------------------------------------
// Piece unique
// ---------------------------------------------------------------------------

/**
 * Budget de la piece unique (module AT.2) : un souple monobloc de 90 mm sort
 * entre 60 000 et 150 000 triangles. La peau du corps recoit au plus 1 150
 * triangles par millimetre, au moins 620 ; nageoires et caudale s'y
 * ajoutent.
 */
export const MONOBLOC_REFINE = { chordMm: 0.015, perMm: 1150, floorPerMm: 620, minEdgeMm: 0.04 };

export interface Monobloc {
  geometry: THREE.BufferGeometry;
  stats: RefineStats | null;
  /** Volume des logements de lest, en cm3 (TPU retire, plomb ajoute). */
  seatVolume: number;
}

/**
 * Piece unique en TPU : peau du corps raffinee, caudale, nageoires en
 * volume, cavites de lest. Chaque partie est un solide ferme ; la
 * trancheuse les reunit.
 */
export function buildMonobloc(profile: ProfileSampler, params: LureParams, refine = true): Monobloc {
  const skin = createSkin(profile, params, true);
  const L = params.length;
  const stationsCount = Math.min(Math.max(Math.round(L / 0.9), 80), 420);
  let girth = 0;
  for (let k = 1; k < 24; k++) {
    const s = profile.section((k / 24) * profile.bodyEnd);
    girth = Math.max(girth, Math.PI * (s.halfWidth * 2 + (s.top - s.bottom)) / 2 / MM);
  }
  const columns = Math.min(Math.max(Math.round((2 * girth) / 0.75), 64), 320);
  const ps: number[] = [];
  for (let i = 0; i <= stationsCount; i++) ps.push(stationAt(profile, i / stationsCount));
  const thetas: number[] = [];
  for (let j = 0; j <= columns; j++) thetas.push(j === columns ? Math.PI * 2 : thetaAt(profile, j / columns));
  const grid: THREE.Vector3[][] = ps.map((p) => thetas.map((t) => skin(p, t)));
  const positions: number[] = [];
  const params2: number[] = [];
  const skinFlags: number[] = [];
  const tri = (i0: number, j0: number, i1: number, j1: number, i2: number, j2: number) => {
    const a = grid[i0][j0];
    const b = grid[i1][j1];
    const c = grid[i2][j2];
    if (a.distanceToSquared(b) < 1e-18 || b.distanceToSquared(c) < 1e-18 || a.distanceToSquared(c) < 1e-18) return;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    params2.push(ps[i0], thetas[j0], ps[i1], thetas[j1], ps[i2], thetas[j2]);
    skinFlags.push(1);
  };
  for (let i = 0; i < ps.length - 1; i++) {
    for (let j = 0; j < columns; j++) {
      // Sens : normale sortante (theta croissant du dos vers le flanc droit).
      tri(i, j, i, j + 1, i + 1, j + 1);
      tri(i, j, i + 1, j + 1, i + 1, j);
    }
  }
  let body: number[] = positions;
  let stats: RefineStats | null = null;
  if (refine) {
    const out = refineSoup({ positions, params: params2, skin: skinFlags }, (u, v) => skin(u, v), {
      tolerance: MONOBLOC_REFINE.chordMm * MM,
      budget: Math.round(MONOBLOC_REFINE.perMm * L),
      floor: Math.round(MONOBLOC_REFINE.floorPerMm * L),
      minEdge: MONOBLOC_REFINE.minEdgeMm * MM,
      periodV: Math.PI * 2,
    });
    body = out.positions;
    stats = out.stats;
  }
  const extra: THREE.BufferGeometry[] = [];
  if (profile.hasFin) extra.push(buildTailFin(profile, params));
  const fins = finSolids(profile, params);
  if (fins) extra.push(fins);
  // Logements de lest : spheres creuses, normales vers le vide.
  const plan = softRigPlan(profile, params);
  let seatVolume = 0;
  for (const seat of plan.seats) {
    const s = new THREE.SphereGeometry(seat.radius, 32, 20).toNonIndexed();
    const pos = s.getAttribute('position');
    const flipped: number[] = [];
    for (let i = 0; i < pos.count; i += 3) {
      for (const k of [0, 2, 1]) flipped.push(pos.getX(i + k) + seat.x, pos.getY(i + k) + seat.y, pos.getZ(i + k));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(flipped, 3));
    extra.push(g);
    seatVolume += (4 / 3) * Math.PI * seat.radius ** 3;
    s.dispose();
  }
  const all: number[] = [...body];
  for (const g of extra) {
    const src = g.index ? g.toNonIndexed() : g;
    const pos = src.getAttribute('position');
    for (let i = 0; i < pos.count; i++) all.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    g.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(all, 3));
  geometry.computeVertexNormals();
  return { geometry, stats, seatVolume };
}
