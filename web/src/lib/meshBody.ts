/**
 * Corps tire d'un maillage importe — module AD.3.
 *
 * Le constructeur de demi-coques, la fente de bavette, les portees de
 * goupille, la visserie et la physique parlent tous la meme langue : une
 * peau parametree par (p, theta) — p le long de l'axe, theta autour. Pour
 * qu'un maillage importe recoive le principe de fabrication du logiciel, il
 * suffit donc de le traduire dans cette langue, et rien d'autre ne change.
 *
 * La traduction :
 *   - le maillage est tranche a pas regulier le long de X (un peu moins de
 *     0,2 mm entre tranches) ;
 *   - dans chaque tranche, des rayons partent du centre de la section, dans
 *     le plan de joint, tous les 0,7 degre ; la peau est le DERNIER passage
 *     du rayon hors de la matiere.
 *
 * Tant que la section est etoilee depuis son centre — chaque rayon ne sort
 * qu'une fois — la traduction est exacte au pas pres. Quand un rayon ressort
 * puis rentre (nageoire decollee du flanc, bavette soudee sous le menton),
 * la peau suit l'enveloppe et comble le creux : l'ecart est mesure, localise
 * et rapporte, jamais passe sous silence.
 *
 * La caudale, elle, n'est pas etoilee (une fourche a deux branches) : elle
 * n'est pas retraduite. Le corps s'arrete au pedoncule, et la caudale
 * d'origine est decoupee par un plan, refermee, puis partagee dans le plan
 * de joint — chaque moitie accompagne sa coque, comme la caudale des
 * familles.
 */

import * as THREE from 'three';
import type { LureParams, MeshBodyRef } from '../types/lure';
import type { ProfileSampler, Section } from './profile';
import { distribution, warpTheta } from './anatomy';

// ---------------------------------------------------------------------------
// Echantillonnage de la peau
// ---------------------------------------------------------------------------

/** Creux comble par l'enveloppe, a une station donnee. */
export interface MeshGap {
  /** Abscisse depuis le nez, en mm (echelle d'origine). */
  fromNoseMm: number;
  /** Angle du rayon, en degres : 0 = dos, 90 = flanc, 180 = ventre. */
  thetaDeg: number;
  /** Longueur du creux sur ce rayon, en mm. */
  gapMm: number;
}

/** Crete mince (nageoire) le long d'un bord du plan de joint. */
export interface MeshFinSpan {
  rail: 'lo' | 'hi';
  p0: number;
  p1: number;
  label: string;
}

export interface MeshSkin {
  /** Nombre de stations et de rayons. */
  nP: number;
  nT: number;
  /** Abscisse du nez et longueur, en cm. */
  x0: number;
  length: number;
  /** Ordonnee du centre de chaque section (origine des rayons), en cm. */
  yc: Float32Array;
  /** Rayons : nP x nT, en cm. */
  r: Float32Array;
  /** Demi-largeur de chaque section, en cm. */
  halfWidth: Float32Array;
  /** Aire de chaque tranche, en cm2. */
  area: Float32Array;
  /** Fin du corps tubulaire (pedoncule) ; 1 sans caudale. */
  bodyEnd: number;
  /** Plus grands creux combles par l'enveloppe, du plus grand au plus petit. */
  gaps: MeshGap[];
  maxGapMm: number;
  /** Rayons qui n'ont trouve aucune paroi : trou dans le maillage. */
  missingRays: number;
  /** Rayons dont l'origine semble hors matiere : maillage ouvert ou croise. */
  inconsistentRays: number;
  /** Volume de l'enveloppe echantillonnee, en cm3. */
  envelopeVolume: number;
  /** Plus grand vide interne traverse par un rayon, en mm (logements existants). */
  internalVoidMm: number;
  /** Plus grand creux dans la fente d'une bavette detachee, en mm. */
  slotGapMm: number;
  /** Plus grand passage de fabrication existant, au ras du plan de joint, en mm. */
  railGapMm: number;
  fins: MeshFinSpan[];
}

/** Recouvrement de la caudale dans le corps : la trancheuse les unit. */
const TAIL_OVERLAP_CM = 0.1;

/**
 * Demi-ouverture angulaire, autour du dos et du ventre, ou un creux est lu
 * comme un passage de fabrication dans le plan de joint (25 degres).
 */
const RAIL_BAND = (25 * Math.PI) / 180;

/**
 * Profondeur au-dela de laquelle une encoche du dos ou du ventre est une
 * bouche de logement et non du relief : 0,3 mm, juste au-dessus de la rainure
 * a collant (0,25 mm), qui doit rester.
 */
const NOTCH_CM = 0.03;

/** Resolution d'echantillonnage : 0,2 mm entre tranches, 512 rayons. */
const RAYS = 512;
const STEP_CM = 0.02;

interface SliceHit {
  j: number;
  t: number;
  exit: boolean;
  /** Segment traverse : sa boucle dit s'il borde un vide interne. */
  s: number;
}

/** Zone ou un creux est attendu : la fente d'une bavette detachee du fichier. */
export interface GapAllowance {
  /** Etendue en X, en cm, repere de travail. */
  x0: number;
  x1: number;
}

/**
 * Tranche un triangle par le plan x = xs. Le point de coupe d'une arete est
 * calcule dans un ordre canonique de ses extremites, pour que deux triangles
 * voisins trouvent exactement le meme point.
 */
function cutEdge(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  xs: number,
): [number, number] {
  if (ax > bx || (ax === bx && (ay > by || (ay === by && az > bz)))) {
    [ax, ay, az, bx, by, bz] = [bx, by, bz, ax, ay, az];
  }
  const u = (xs - ax) / (bx - ax);
  return [ay + u * (by - ay), az + u * (bz - az)];
}

/**
 * Echantillonne la peau d'un maillage ferme, oriente, en cm, nez vers -X.
 */
export function sampleSkin(positions: Float32Array, allowance: GapAllowance | null = null, onProgress?: (fraction: number) => void): MeshSkin {
  let xmin = Infinity;
  let xmax = -Infinity;
  for (let k = 0; k < positions.length; k += 3) {
    if (positions[k] < xmin) xmin = positions[k];
    if (positions[k] > xmax) xmax = positions[k];
  }
  const length = Math.max(xmax - xmin, 1e-6);
  const nP = Math.min(Math.max(Math.round(length / STEP_CM), 240), 900);
  const nT = RAYS;
  const dx = length / (nP - 1);

  // --- Segments de chaque tranche ------------------------------------------
  const segments: number[][] = Array.from({ length: nP }, () => []);
  for (let k = 0; k < positions.length; k += 9) {
    const ax = positions[k], ay = positions[k + 1], az = positions[k + 2];
    const bx = positions[k + 3], by = positions[k + 4], bz = positions[k + 5];
    const cx = positions[k + 6], cy = positions[k + 7], cz = positions[k + 8];
    const lo = Math.min(ax, bx, cx);
    const hi = Math.max(ax, bx, cx);
    const i0 = Math.max(1, Math.ceil((lo - xmin) / dx));
    const i1 = Math.min(nP - 2, Math.floor((hi - xmin) / dx));
    if (i0 > i1) continue;
    // Normale de la face projetee dans le plan de la tranche : elle oriente
    // le segment, matiere a gauche, exterieur a droite.
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (let i = i0; i <= i1; i++) {
      const xs = xmin + i * dx;
      const pa = ax >= xs, pb = bx >= xs, pc = cx >= xs;
      const points: [number, number][] = [];
      if (pa !== pb) points.push(cutEdge(ax, ay, az, bx, by, bz, xs));
      if (pb !== pc) points.push(cutEdge(bx, by, bz, cx, cy, cz, xs));
      if (pc !== pa) points.push(cutEdge(cx, cy, cz, ax, ay, az, xs));
      if (points.length !== 2) continue;
      let [P, Q] = points;
      const su = Q[0] - P[0], sv = Q[1] - P[1];
      if (sv * ny - su * nz < 0) [P, Q] = [Q, P];
      segments[i].push(P[0], P[1], Q[0], Q[1]);
    }
  }

  const yc = new Float32Array(nP);
  const r = new Float32Array(nP * nT);
  const halfWidth = new Float32Array(nP);
  const area = new Float32Array(nP);
  const gapAt: MeshGap[] = [];
  let missingRays = 0;
  let inconsistentRays = 0;
  let internalVoids = 0;
  let slotGap = 0;
  let railGap = 0;
  const dTheta = (Math.PI * 2) / nT;
  const railRays = Math.round(RAIL_BAND / dTheta);
  let frontOpen = true;
  const notch = new Uint8Array(railRays * 2 + 1);
  const cosT = new Float64Array(nT);
  const sinT = new Float64Array(nT);
  for (let j = 0; j < nT; j++) {
    cosT[j] = Math.cos(j * dTheta);
    sinT[j] = Math.sin(j * dTheta);
  }

  for (let i = 1; i < nP - 1; i++) {
    const seg = segments[i];
    if (onProgress && i % 60 === 0) onProgress(i / nP);
    if (seg.length === 0) continue;
    // --- Centre : barycentre de l'aire, ramene dans le plan de joint -------
    let A = 0;
    let Cy = 0;
    let wMax = 0;
    for (let s = 0; s < seg.length; s += 4) {
      const cross = seg[s] * seg[s + 3] - seg[s + 2] * seg[s + 1];
      A += cross / 2;
      Cy += ((seg[s] + seg[s + 2]) * cross) / 6;
      wMax = Math.max(wMax, Math.abs(seg[s + 1]), Math.abs(seg[s + 3]));
    }
    area[i] = Math.abs(A);
    halfWidth[i] = wMax;
    let oy = Math.abs(A) > 1e-12 ? Cy / A : seg[0];
    // L'origine doit etre dans la matiere : sinon, milieu du plus long
    // intervalle plein sur la ligne du plan de joint.
    let winding = 0;
    for (let s = 0; s < seg.length; s += 4) {
      const Py = seg[s], Pz = seg[s + 1], Qy = seg[s + 2], Qz = seg[s + 3];
      if (Py >= oy === Qy >= oy) continue;
      const z = Pz + ((oy - Py) / (Qy - Py)) * (Qz - Pz);
      if (z > 0) winding += Qy < Py ? 1 : -1;
    }
    if (winding < 1) {
      const crossings: { y: number; d: number }[] = [];
      for (let s = 0; s < seg.length; s += 4) {
        const Py = seg[s], Pz = seg[s + 1], Qy = seg[s + 2], Qz = seg[s + 3];
        if (Pz >= 0 === Qz >= 0) continue;
        crossings.push({ y: Py + ((0 - Pz) / (Qz - Pz)) * (Qy - Py), d: Qz < Pz ? 1 : -1 });
      }
      crossings.sort((a, b) => a.y - b.y);
      let w = 0;
      let best = -1;
      for (let c = 0; c + 1 < crossings.length; c++) {
        w += crossings[c].d;
        const span = crossings[c + 1].y - crossings[c].y;
        if (w > 0 && span > best) {
          best = span;
          oy = (crossings[c].y + crossings[c + 1].y) / 2;
        }
      }
    }
    yc[i] = oy;

    // --- Boucles de la tranche ---------------------------------------------
    // Les points de coupe sont canoniques : un segment commence exactement ou
    // finit son voisin. Une boucle parcourue a rebours (aire negative) borde
    // un VIDE INTERNE — logement de vis, poche, chambre — et non l'exterieur.
    const segCount = seg.length / 4;
    const startOf = new Map<string, number>();
    for (let k = 0; k < segCount; k++) startOf.set(`${seg[k * 4]},${seg[k * 4 + 1]}`, k);
    const loopOf = new Int32Array(segCount).fill(-1);
    const loopSign: number[] = [];
    for (let k = 0; k < segCount; k++) {
      if (loopOf[k] >= 0) continue;
      const id = loopSign.length;
      let area = 0;
      let j = k;
      let closed = false;
      for (let guard = 0; guard <= segCount; guard++) {
        loopOf[j] = id;
        area += seg[j * 4] * seg[j * 4 + 3] - seg[j * 4 + 2] * seg[j * 4 + 1];
        const next = startOf.get(`${seg[j * 4 + 2]},${seg[j * 4 + 3]}`);
        if (next === undefined || (loopOf[next] >= 0 && next !== k)) break;
        if (next === k) {
          closed = true;
          break;
        }
        j = next;
      }
      loopSign.push(closed ? Math.sign(area) : 0);
    }
    // Une boucle creuse presente des la premiere tranche du nez est une
    // cuvette ouverte vers l'avant (face de popper), pas un vide interne :
    // en 3D elle debouche. On la traite comme un creux de la forme.
    const hasHole = loopSign.some((sign) => sign < 0);
    const frontCup = frontOpen && hasHole;
    if (!hasHole) frontOpen = false;
    const allowed =
      allowance !== null &&
      xmin + i * dx >= allowance.x0 - 0.1 &&
      xmin + i * dx <= allowance.x1 + 0.1;

    // --- Rayons ------------------------------------------------------------
    const hits: SliceHit[] = [];
    for (let s = 0; s < seg.length; s += 4) {
      const Py = seg[s] - oy, Pz = seg[s + 1], Qy = seg[s + 2] - oy, Qz = seg[s + 3];
      const aP = Math.atan2(Pz, Py);
      const aQ = Math.atan2(Qz, Qy);
      let d = aQ - aP;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      const lo = d >= 0 ? aP : aQ;
      const j0 = Math.ceil(lo / dTheta - 1e-9);
      const j1 = Math.floor((lo + Math.abs(d)) / dTheta + 1e-9);
      const ex = Qy - Py, ez = Qz - Pz;
      for (let jj = j0; jj <= j1; jj++) {
        const j = ((jj % nT) + nT) % nT;
        const dy = cosT[j], dz = sinT[j];
        const denom = dy * ez - dz * ex;
        if (Math.abs(denom) < 1e-14) continue;
        const t = (Py * ez - Pz * ex) / denom;
        const u = (Py * dz - Pz * dy) / denom;
        if (u < 0 || u >= 1 || t <= 1e-9) continue;
        hits.push({ j, t, exit: denom > 0, s: s / 4 });
      }
    }
    hits.sort((a, b) => a.j - b.j || a.t - b.t);
    const row = i * nT;
    for (let j = 0; j < nT; j++) r[row + j] = NaN;
    let worstGap = 0;
    let worstTheta = 0;
    for (let h = 0; h < hits.length; ) {
      let e = h;
      while (e < hits.length && hits[e].j === hits[h].j) e++;
      let w0 = 0;
      for (let k = h; k < e; k++) w0 += hits[k].exit ? 1 : -1;
      if (w0 < 1) inconsistentRays++;
      let w = w0;
      let gap = 0;
      for (let k = h; k < e - 1; k++) {
        w += hits[k].exit ? -1 : 1;
        if (w > 0) continue;
        const span = hits[k + 1].t - hits[k].t;
        // Sortie dans un vide interne : il sera comble puis recreuse par
        // l'industrialisation, ce n'est pas un creux de la forme.
        if (loopSign[loopOf[hits[k].s]] < 0 && !frontCup) {
          internalVoids = Math.max(internalVoids, span);
          continue;
        }
        // Fente d'une bavette detachee, sous le menton : attendue.
        const theta = hits[h].j * dTheta;
        if (allowed && theta > Math.PI / 2 && theta < (3 * Math.PI) / 2) {
          slotGap = Math.max(slotGap, span);
          continue;
        }
        // Au ras du plan de joint, dos ou ventre : un passage de fabrication
        // existant — bouche de vis, canal de goupille, fente. Il est comble
        // puis recreuse par l'industrialisation ; il ne change pas la forme.
        const fromRail = Math.min(Math.abs(theta - Math.PI), theta, Math.PI * 2 - theta);
        if (fromRail < RAIL_BAND) {
          railGap = Math.max(railGap, span);
          continue;
        }
        gap += span;
      }
      r[row + hits[h].j] = hits[e - 1].t;
      if (gap > worstGap) {
        worstGap = gap;
        worstTheta = hits[h].j * dTheta;
      }
      h = e;
    }
    // Rayons sans paroi : interpoles entre voisins, et comptes.
    let valid = 0;
    for (let j = 0; j < nT; j++) if (!Number.isNaN(r[row + j])) valid++;
    missingRays += nT - valid;
    if (valid === 0) {
      for (let j = 0; j < nT; j++) r[row + j] = 0;
    } else if (valid < nT) {
      for (let j = 0; j < nT; j++) {
        if (!Number.isNaN(r[row + j])) continue;
        let a = 1;
        while (Number.isNaN(r[row + ((j - a + nT) % nT)])) a++;
        let b = 1;
        while (Number.isNaN(r[row + ((j + b) % nT)])) b++;
        const ra = r[row + ((j - a + nT) % nT)];
        const rb = r[row + ((j + b) % nT)];
        r[row + j] = ra + ((rb - ra) * a) / (a + b);
      }
    }
    // Bouches de logement au ras du dos ou du ventre (tete de vis, sortie de
    // goupille) : le rayon s'y engouffre et s'arrete au fond du logement. Une
    // encoche etroite, plus profonde que la rainure a collant, est refermee
    // sur ses bords — la hauteur de section redevient celle du corps.
    for (const centre of [0, nT / 2]) {
      notch.fill(0);
      for (let jj = -railRays; jj <= railRays; jj++) {
        const j = (centre + jj + nT) % nT;
        let left = 0;
        let right = 0;
        for (let k = 1; k <= railRays; k++) {
          left = Math.max(left, r[row + ((j - k + nT) % nT)]);
          right = Math.max(right, r[row + ((j + k) % nT)]);
        }
        const depth = Math.min(left, right) - r[row + j];
        if (depth > NOTCH_CM) {
          notch[jj + railRays] = 1;
          railGap = Math.max(railGap, depth);
        }
      }
      for (let jj = -railRays; jj <= railRays; jj++) {
        if (!notch[jj + railRays]) continue;
        let a = 1;
        while (jj - a >= -railRays && notch[jj - a + railRays]) a++;
        let b = 1;
        while (jj + b <= railRays && notch[jj + b + railRays]) b++;
        const ra = r[row + ((centre + jj - a + nT) % nT)];
        const rb = r[row + ((centre + jj + b) % nT)];
        r[row + ((centre + jj + nT) % nT)] = ra + ((rb - ra) * a) / (a + b);
      }
    }
    if (worstGap > 0.005) {
      const deg = (worstTheta * 180) / Math.PI;
      gapAt.push({
        fromNoseMm: i * dx * 10,
        thetaDeg: deg > 180 ? 360 - deg : deg,
        gapMm: worstGap * 10,
      });
    }
  }
  // Pointes : rayon nul, centre repris de la tranche voisine.
  yc[0] = yc[1];
  yc[nP - 1] = yc[nP - 2];

  // --- Volume de l'enveloppe ----------------------------------------------
  let envelopeVolume = 0;
  for (let i = 1; i < nP - 1; i++) {
    let polar = 0;
    for (let j = 0; j < nT; j++) polar += r[i * nT + j] ** 2;
    envelopeVolume += (polar * dTheta) / 2 * dx;
  }

  // --- Caudale : un pedoncule, puis une lame qui remonte en hauteur -------
  const height = (i: number) => r[i * nT] + r[i * nT + nT / 2];
  let bodyEnd = 1;
  let iMin = -1;
  for (let i = Math.round(nP * 0.55); i < nP - 2; i++) {
    if (iMin < 0 || height(i) < height(iMin)) iMin = i;
  }
  if (iMin > 0) {
    let iPeak = iMin;
    for (let i = iMin + 1; i < nP - 1; i++) if (height(i) > height(iPeak)) iPeak = i;
    const rises = height(iPeak) > height(iMin) * 1.25 && height(iMin) > 0.05;
    const thin = halfWidth[iPeak] * 2 < height(iPeak) * 0.45;
    if (rises && thin) bodyEnd = iMin / (nP - 1);
  }

  // --- Cretes minces sur les bords du plan de joint (nageoires) -----------
  const fins: MeshFinSpan[] = [];
  const iEnd = Math.floor(bodyEnd * (nP - 1)) - 1;
  for (const rail of ['hi', 'lo'] as const) {
    let start = -1;
    let kind: 'crest' | 'flap' = 'crest';
    const flush = (i: number) => {
      if (start >= 0 && (i - start) * dx >= 0.05) {
        fins.push({
          rail,
          p0: start / (nP - 1),
          p1: i / (nP - 1),
          label:
            kind === 'crest'
              ? rail === 'hi'
                ? 'la crete dorsale (nageoire)'
                : 'la crete ventrale (nageoire)'
              : rail === 'hi'
                ? 'une nageoire couchee sur le dos'
                : 'une nageoire couchee sous le ventre',
        });
      }
      start = -1;
    };
    for (let i = 1; i <= iEnd; i++) {
      const row = i * nT;
      const edge = rail === 'hi' ? 0 : nT / 2;
      const tip = r[row + edge];
      // Largeur de la matiere dans le millimetre qui borde le rail.
      let width = 0;
      const reach = Math.round(nT / 6);
      for (let dj = -reach; dj <= reach; dj++) {
        const j = (edge + dj + nT) % nT;
        const along = r[row + j] * Math.cos(dj * dTheta);
        if (along >= tip - 0.1) width = Math.max(width, Math.abs(r[row + j] * Math.sin(dj * dTheta)));
      }
      const crest = tip > 0.15 && width < 0.04;
      // Surplomb : en s'eloignant du rail le long de la peau, on doit
      // s'eloigner aussi du bord dans le plan de joint. Une nageoire couchee
      // pres du rail fait revenir la peau sur elle-meme : une bouche ouverte
      // la, et sa face de coupe se recouperait.
      let flap = false;
      for (const side of [1, -1]) {
        let previous = tip;
        for (let dj = 1; dj <= reach && !flap; dj++) {
          const j = (edge + side * dj + nT) % nT;
          // Seule compte la bande que les bouches entament : la tete de vis
          // la plus large (M4) y tient.
          const lateral = Math.abs(r[row + j] * Math.sin(dj * dTheta));
          if (lateral > 0.35) break;
          const along = r[row + j] * Math.cos(dj * dTheta);
          if (along > previous + 0.004) flap = true;
          previous = Math.min(previous, along);
        }
      }
      const thin = crest || flap;
      if (thin && start < 0) {
        start = i;
        kind = crest ? 'crest' : 'flap';
      }
      if (!thin) flush(i);
    }
    flush(iEnd);
  }

  // Au-dela du pedoncule, la caudale d'origine est gardee telle quelle : ses
  // creux (la fourche) ne concernent pas la peau retraduite.
  // Le dernier millimetre avant la coupe est recouvert par la racine de la
  // caudale d'origine, rapportee sur chaque coque : ses creux n'y comptent pas.
  const reachMm = bodyEnd < 1 ? bodyEnd * length * 10 - TAIL_OVERLAP_CM * 10 : length * 10 + 1e-6;
  const bodyGaps = gapAt.filter((gap) => gap.fromNoseMm < reachMm);
  bodyGaps.sort((a, b) => b.gapMm - a.gapMm);
  return {
    nP,
    nT,
    x0: xmin,
    length,
    yc,
    r,
    halfWidth,
    area,
    bodyEnd,
    gaps: bodyGaps.slice(0, 12),
    maxGapMm: bodyGaps.length ? bodyGaps[0].gapMm : 0,
    missingRays,
    inconsistentRays,
    envelopeVolume,
    internalVoidMm: internalVoids * 10,
    slotGapMm: slotGap * 10,
    railGapMm: railGap * 10,
    fins,
  };
}

// ---------------------------------------------------------------------------
// Decoupe par un plan, refermee
// ---------------------------------------------------------------------------

/**
 * Garde la partie d'un maillage ferme situee du cote `keep` du plan
 * `coordonnee[axis] = value`, et la referme par une face plane.
 *
 * Les points de coupe sont calcules dans un ordre canonique : les aretes
 * partagees donnent le meme point de part et d'autre, et le contour de la
 * face de fermeture se chaine sans soudure approximative. `ok` est faux si
 * un contour ne se referme pas — topologie non-manifold sur le plan.
 */
export function clipClosed(
  positions: Float32Array,
  axis: 0 | 1 | 2,
  value: number,
  keep: 1 | -1,
): { positions: Float32Array; ok: boolean } {
  // Aucun sommet exactement sur le plan : il ne faut ni triangle plat ni
  // point de coupe confondu avec un sommet.
  for (let attempt = 0; attempt < 8; attempt++) {
    let close = false;
    for (let k = axis; k < positions.length; k += 3) {
      if (Math.abs(positions[k] - value) < 1e-7) {
        close = true;
        break;
      }
    }
    if (!close) break;
    value += 3e-7 * keep;
  }
  const u = axis === 0 ? 1 : 0;
  const v = axis === 2 ? 1 : 2;
  const out: number[] = [];
  const edges = new Map<string, { to: string; a: number[]; b: number[] }>();
  const keyOf = (p: number[]) => `${p[0]},${p[1]},${p[2]}`;
  const cut = (a: number[], b: number[]): number[] => {
    let p = a;
    let q = b;
    if (p[0] > q[0] || (p[0] === q[0] && (p[1] > q[1] || (p[1] === q[1] && p[2] > q[2])))) {
      p = b;
      q = a;
    }
    const s = (value - p[axis]) / (q[axis] - p[axis]);
    const point = [p[0] + s * (q[0] - p[0]), p[1] + s * (q[1] - p[1]), p[2] + s * (q[2] - p[2])];
    point[axis] = value;
    return point;
  };
  const push = (...pts: number[][]) => {
    for (const p of pts) out.push(p[0], p[1], p[2]);
  };
  const addEdge = (a: number[], b: number[]) => {
    edges.set(keyOf(a), { to: keyOf(b), a, b });
  };
  for (let k = 0; k < positions.length; k += 9) {
    const V = [0, 1, 2].map((i) => [positions[k + i * 3], positions[k + i * 3 + 1], positions[k + i * 3 + 2]]);
    const inside = V.map((p) => (p[axis] - value) * keep > 0);
    const n = inside.filter(Boolean).length;
    if (n === 3) {
      push(...V);
      continue;
    }
    if (n === 0) continue;
    // Rotation du triangle pour que le cas se lise toujours de la meme facon.
    let s = 0;
    if (n === 1) while (!inside[s]) s++;
    else while (inside[s]) s++;
    const a = V[s], b = V[(s + 1) % 3], c = V[(s + 2) % 3];
    if (n === 1) {
      // a dedans : triangle (a, ab, ca), arete de coupe ab -> ca.
      const ab = cut(a, b);
      const ca = cut(c, a);
      push(a, ab, ca);
      addEdge(ab, ca);
    } else {
      // a dehors, b et c dedans : quadrilatere (b, c, ca, ab).
      const ab = cut(a, b);
      const ca = cut(c, a);
      push(b, c, ca);
      push(b, ca, ab);
      addEdge(ca, ab);
    }
  }

  // --- Face de fermeture ----------------------------------------------------
  let ok = true;
  const loops: number[][][] = [];
  const visited = new Set<string>();
  for (const [start, first] of edges) {
    if (visited.has(start)) continue;
    const loop: number[][] = [];
    let key = start;
    let edge = first;
    let guard = 0;
    while (!visited.has(key)) {
      visited.add(key);
      loop.push(edge.a);
      key = edge.to;
      const next = edges.get(key);
      if (!next) {
        ok = false;
        break;
      }
      edge = next;
      if (++guard > edges.size + 1) {
        ok = false;
        break;
      }
    }
    if (key !== start) ok = false;
    if (loop.length >= 3) loops.push(loop);
  }
  const area2 = (loop: number[][]) => {
    let s = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i];
      const q = loop[(i + 1) % loop.length];
      s += p[u] * q[v] - q[u] * p[v];
    }
    return s / 2;
  };
  const areas = loops.map(area2);
  let largest = 0;
  for (let i = 1; i < loops.length; i++) if (Math.abs(areas[i]) > Math.abs(areas[largest])) largest = i;
  const outerSign = loops.length ? Math.sign(areas[largest]) : 1;
  const inside = (point: number[], loop: number[][]) => {
    let c = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[i];
      const b = loop[j];
      if (a[v] > point[v] !== b[v] > point[v]) {
        const x = ((b[u] - a[u]) * (point[v] - a[v])) / (b[v] - a[v]) + a[u];
        if (point[u] < x) c = !c;
      }
    }
    return c;
  };
  const outers = loops.map((loop, i) => ({ loop, area: areas[i], holes: [] as number[][][] }))
    .filter((item) => Math.sign(item.area) === outerSign && Math.abs(item.area) > 1e-12);
  loops.forEach((loop, i) => {
    if (Math.sign(areas[i]) === outerSign || Math.abs(areas[i]) <= 1e-12) return;
    let host: (typeof outers)[number] | null = null;
    for (const outer of outers) {
      if (!inside(loop[0], outer.loop)) continue;
      if (!host || Math.abs(outer.area) < Math.abs(host.area)) host = outer;
    }
    if (host) host.holes.push(loop);
  });
  // La face de fermeture regarde hors de la partie gardee.
  const facing = -keep;
  for (const outer of outers) {
    const contour = outer.loop.map((p) => new THREE.Vector2(p[u], p[v]));
    const holes = outer.holes.map((loop) => loop.map((p) => new THREE.Vector2(p[u], p[v])));
    const flat = [...outer.loop, ...outer.holes.flat()];
    let faces: number[][];
    try {
      faces = THREE.ShapeUtils.triangulateShape(contour, holes);
    } catch {
      ok = false;
      continue;
    }
    for (const [i0, i1, i2] of faces) {
      const a = flat[i0], b = flat[i1], c = flat[i2];
      if (!a || !b || !c) continue;
      const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const along = [nx, ny, nz][axis];
      if (along * facing >= 0) push(a, b, c);
      else push(a, c, b);
    }
  }
  return { positions: new Float32Array(out), ok };
}

// ---------------------------------------------------------------------------
// Corps maille enregistre
// ---------------------------------------------------------------------------

export interface MeshBody {
  id: string;
  name: string;
  /** Corps d'origine, sans bavette detachee, en cm, repere de travail. */
  source: Float32Array;
  /** Cotes du corps d'origine, en mm. */
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  skin: MeshSkin;
  /** Corps jusqu'au pedoncule, et caudale au-dela, tous deux refermes. */
  bodyPart: Float32Array;
  tailPart: Float32Array | null;
  /** Moities de caudale pour les deux coques, avec recouvrement dans le corps. */
  tailHalves: { male: Float32Array; female: Float32Array } | null;
  /** Operations bloquees par la topologie, nommees. */
  blocked: string[];
  /** Version allegee pour l'affichage seul. */
  display: Float32Array | null;
}


export function createMeshBody(
  id: string,
  name: string,
  source: Float32Array,
  display: Float32Array | null = null,
  allowance: GapAllowance | null = null,
  onProgress?: (fraction: number) => void,
): MeshBody {
  const skin = sampleSkin(source, allowance, onProgress);
  const extent = (axis: number) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = axis; k < source.length; k += 3) {
      if (source[k] < lo) lo = source[k];
      if (source[k] > hi) hi = source[k];
    }
    return (hi - lo) * 10;
  };
  const blocked: string[] = [];
  let bodyPart = source;
  let tailPart: Float32Array | null = null;
  let tailHalves: MeshBody['tailHalves'] = null;
  if (skin.bodyEnd < 1) {
    const xCut = skin.x0 + skin.bodyEnd * skin.length;
    const body = clipClosed(source, 0, xCut, -1);
    const tail = clipClosed(source, 0, xCut, 1);
    const rooted = clipClosed(source, 0, xCut - TAIL_OVERLAP_CM, 1);
    const male = rooted.ok ? clipClosed(rooted.positions, 2, 0, 1) : null;
    const female = rooted.ok ? clipClosed(rooted.positions, 2, 0, -1) : null;
    if (body.ok && tail.ok && male?.ok && female?.ok) {
      bodyPart = body.positions;
      tailPart = tail.positions;
      tailHalves = { male: male.positions, female: female.positions };
    } else {
      blocked.push(
        'Decoupe de la caudale au pedoncule : le contour de coupe ne se referme pas (aretes ' +
          'non-manifold ou faces croisees sur le plan). La caudale n est pas partagee entre les ' +
          'coques ; les demi-coques s arretent au pedoncule.',
      );
    }
  }
  return {
    id,
    name,
    source,
    lengthMm: extent(0),
    widthMm: extent(2),
    heightMm: extent(1),
    skin,
    bodyPart,
    tailPart,
    tailHalves,
    blocked,
    display,
  };
}

const REGISTRY = new Map<string, MeshBody>();

export function registerMeshBody(body: MeshBody): void {
  REGISTRY.set(body.id, body);
}

export function getMeshBody(id: string): MeshBody | null {
  return REGISTRY.get(id) ?? null;
}

/** Corps maille d'un projet, s'il est charge. */
export const meshBodyOf = (params: LureParams): MeshBody | null =>
  params.meshBody ? getMeshBody(params.meshBody.id) : null;

/** Reference a ranger dans les parametres du projet. */
export const meshBodyRef = (body: MeshBody): MeshBodyRef => ({
  id: body.id,
  name: body.name,
  lengthMm: body.lengthMm,
  widthMm: body.widthMm,
  heightMm: body.heightMm,
});

// ---------------------------------------------------------------------------
// Profil
// ---------------------------------------------------------------------------

/** Ce que le profil d'un corps maille expose en plus du profil commun. */
export interface MeshProfileData {
  body: MeshBody;
  /** Facteurs d'echelle appliques au maillage d'origine. */
  scale: [number, number, number];
  /** Cretes minces, en abscisses reelles (cm). */
  fins: { rail: 'lo' | 'hi'; x0: number; x1: number; label: string }[];
}

/**
 * Profil d'un corps maille, a l'echelle des cotes du projet.
 *
 * Longueur, hauteur et largeur du projet reglent trois facteurs d'echelle
 * independants : on peut donc agrandir un modele importe, ou l'affiner,
 * sans le redessiner.
 */
export function meshProfile(body: MeshBody, params: LureParams): ProfileSampler {
  const { skin } = body;
  const sx = params.length / body.lengthMm;
  const sy = params.thickness / body.heightMm;
  const sz = params.maxWidth / body.widthMm;
  const { nP, nT, r, yc } = skin;
  const last = nP - 1;
  let maxArea = 0;
  for (let i = 0; i < nP; i++) maxArea = Math.max(maxArea, skin.area[i]);

  const at = (p: number) => {
    const f = Math.min(Math.max(p, 0), 1) * last;
    const i0 = Math.min(Math.floor(f), last - 1);
    return { i0, f: f - i0 };
  };
  const lerp = (array: Float32Array, p: number) => {
    const { i0, f } = at(p);
    return array[i0] + (array[i0 + 1] - array[i0]) * f;
  };
  const ray = (p: number, j: number) => {
    const { i0, f } = at(p);
    return r[i0 * nT + j] + (r[(i0 + 1) * nT + j] - r[i0 * nT + j]) * f;
  };
  const radius = (p: number, theta: number) => {
    let t = (theta / (Math.PI * 2)) * nT;
    t = ((t % nT) + nT) % nT;
    const j0 = Math.floor(t);
    const g = t - j0;
    return ray(p, j0) * (1 - g) + ray(p, (j0 + 1) % nT) * g;
  };

  // Cotes ABSOLUES, decalage nul : le dos et le ventre se lisent tels quels
  // partout ou le code lit `top` et `bottom` (visserie, lest, hamecons),
  // meme si le centre de la section n'est pas sur l'axe.
  const section = (p: number): Section => {
    const centre = lerp(yc, p);
    return {
      offset: 0,
      top: (centre + ray(p, 0)) * sy,
      bottom: (centre - ray(p, nT / 2)) * sy,
      halfWidth: lerp(skin.halfWidth, p) * sz,
    };
  };

  // Stations serrees la ou la section change vite : tete, pedoncule.
  const size = new Float32Array(nP);
  for (let i = 0; i < nP; i++) size[i] = r[i * nT] + r[i * nT + nT / 2] + skin.halfWidth[i] * 2;
  let maxSlope = 1e-9;
  const slope = new Float32Array(nP);
  for (let i = 1; i < last; i++) {
    slope[i] = Math.abs(size[i + 1] - size[i - 1]) / 2;
    maxSlope = Math.max(maxSlope, slope[i]);
  }
  const density = (p: number) => {
    const i = Math.min(Math.max(Math.round((p / 1) * last), 0), last);
    return (
      1 +
      2 * Math.min(slope[i] / maxSlope, 1) +
      2 * Math.exp(-p / 0.03) +
      (skin.bodyEnd < 1 ? 1.5 * Math.exp(-Math.abs(skin.bodyEnd - p) / 0.03) : 2 * Math.exp(-(1 - p) / 0.03))
    );
  };
  const stations = distribution(density, skin.bodyEnd);

  const lengthCm = (body.lengthMm / 10) * sx;
  return {
    popperCut: () => 0,
    lengthCm,
    bodyEnd: skin.bodyEnd,
    hasFin: skin.bodyEnd < 1 && body.tailHalves !== null,
    radiusFactor: (p: number) => Math.sqrt(Math.max(lerp(skin.area, p), 0) / Math.max(maxArea, 1e-9)),
    section,
    xAt: (p: number) => (skin.x0 + p * skin.length) * sx,
    shape: (p: number, theta: number) => {
      const rr = radius(p, theta);
      return { y: (lerp(yc, p) + rr * Math.cos(theta)) * sy, z: rr * Math.sin(theta) * sz };
    },
    anatomy: {
      relief: () => 0,
      crest: () => 0,
      thetaAt: (s: number) => warpTheta(s),
      stationAt: stations.at,
      stationOf: stations.of,
    },
    openRear: skin.bodyEnd < 1,
    mesh: {
      body,
      scale: [sx, sy, sz],
      fins: skin.fins.map((fin) => ({
        rail: fin.rail,
        x0: (skin.x0 + fin.p0 * skin.length) * sx,
        x1: (skin.x0 + fin.p1 * skin.length) * sx,
        label: fin.label,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Geometries
// ---------------------------------------------------------------------------

const GEOMETRY_CACHE = new Map<string, THREE.BufferGeometry>();

/**
 * Pieces du maillage d'origine, a l'echelle du projet.
 *
 * Elles sont mises en cache et marquees partagees : le corps d'un modele
 * importe de 171 000 facettes ne se reconstruit pas a chaque reglage, et
 * les controles qui le parcourent (etancheite) ne le relisent qu'une fois.
 */
export function meshGeometry(
  data: MeshProfileData,
  part: 'body' | 'tail' | 'male' | 'female' | 'display',
): THREE.BufferGeometry | null {
  const { body, scale } = data;
  const source =
    part === 'body'
      ? body.bodyPart
      : part === 'tail'
        ? body.tailPart
        : part === 'display'
          ? body.display
          : body.tailHalves?.[part] ?? null;
  if (!source) return null;
  const key = `${body.id}|${part}|${scale.map((s) => s.toFixed(6)).join(',')}`;
  const cached = GEOMETRY_CACHE.get(key);
  if (cached) return cached;
  const positions = new Float32Array(source.length);
  for (let k = 0; k < source.length; k += 3) {
    positions[k] = source[k] * scale[0];
    positions[k + 1] = source[k + 1] * scale[1];
    positions[k + 2] = source[k + 2] * scale[2];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(meshUvs(body.skin, source), 2));
  geometry.computeVertexNormals();
  geometry.userData.shared = true;
  // Quelques echelles recentes suffisent : un curseur qu'on fait glisser ne
  // doit pas remplir la memoire.
  if (GEOMETRY_CACHE.size > 24) {
    const oldest = GEOMETRY_CACHE.keys().next().value;
    if (oldest !== undefined) {
      GEOMETRY_CACHE.get(oldest)?.dispose();
      GEOMETRY_CACHE.delete(oldest);
    }
  }
  GEOMETRY_CACHE.set(key, geometry);
  return geometry;
}

/**
 * Coordonnees de texture d'un corps maille, dans la convention des corps
 * generes : u le long de l'axe (p), v autour (theta / 2 PI, 0 au dos). La
 * livree peinte tombe donc au meme endroit que sur une famille. Un triangle
 * a cheval sur la ligne du dos voit ses petits v remontes d'un tour, pour
 * ne pas balayer toute la texture.
 */
function meshUvs(skin: MeshSkin, source: Float32Array): Float32Array {
  const uv = new Float32Array((source.length / 3) * 2);
  const last = skin.nP - 1;
  for (let k = 0, v = 0; k < source.length; k += 3, v += 2) {
    const p = Math.min(Math.max((source[k] - skin.x0) / skin.length, 0), 1);
    const f = p * last;
    const i0 = Math.min(Math.floor(f), last - 1);
    const centre = skin.yc[i0] + (skin.yc[i0 + 1] - skin.yc[i0]) * (f - i0);
    let theta = Math.atan2(source[k + 2], source[k + 1] - centre);
    if (theta < 0) theta += Math.PI * 2;
    uv[v] = p;
    uv[v + 1] = theta / (Math.PI * 2);
  }
  for (let t = 0; t < uv.length; t += 6) {
    const vs = [uv[t + 1], uv[t + 3], uv[t + 5]];
    if (Math.max(...vs) - Math.min(...vs) > 0.5) {
      for (let c = 0; c < 3; c++) if (uv[t + 1 + c * 2] < 0.5) uv[t + 1 + c * 2] += 1;
    }
  }
  return uv;
}

/** Libere une geometrie, sauf si elle est partagee par le cache. */
export const releaseGeometry = (geometry: THREE.BufferGeometry | null | undefined): void => {
  if (geometry && !geometry.userData.shared) geometry.dispose();
};

// ---------------------------------------------------------------------------
// Enregistrement dans le projet
// ---------------------------------------------------------------------------

/** Maillage embarque dans un fichier projet. */
export interface MeshBodyFile {
  id: string;
  name: string;
  /** Encombrement du maillage d'origine, en cm : borne de la quantification. */
  min: [number, number, number];
  max: [number, number, number];
  /**
   * Positions en entiers 16 bits, base64. Sur 160 mm, un pas de 0,003 mm :
   * bien en dessous de toute tolerance d'impression.
   */
  data: string;
}

function toBase64(bytes: Uint8Array): string {
  let text = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function encodeMeshBody(body: MeshBody): MeshBodyFile {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const { source } = body;
  for (let k = 0; k < source.length; k += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], source[k + a]);
      max[a] = Math.max(max[a], source[k + a]);
    }
  }
  const q = new Int16Array(source.length);
  for (let k = 0; k < source.length; k++) {
    const a = k % 3;
    const span = Math.max(max[a] - min[a], 1e-9);
    q[k] = Math.round(((source[k] - min[a]) / span) * 65534 - 32767);
  }
  return { id: body.id, name: body.name, min, max, data: toBase64(new Uint8Array(q.buffer)) };
}

/** Relit un maillage embarque et l'enregistre ; renvoie null s'il est illisible. */
export function restoreMeshBody(file: unknown): MeshBody | null {
  if (!file || typeof file !== 'object') return null;
  const raw = file as Partial<MeshBodyFile>;
  if (typeof raw.id !== 'string' || typeof raw.data !== 'string' || !Array.isArray(raw.min) || !Array.isArray(raw.max)) {
    return null;
  }
  try {
    const bytes = fromBase64(raw.data);
    const q = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 2));
    if (q.length < 9 || q.length % 9 !== 0) return null;
    const positions = new Float32Array(q.length);
    for (let k = 0; k < q.length; k++) {
      const a = k % 3;
      const lo = Number(raw.min[a]);
      const hi = Number(raw.max[a]);
      positions[k] = lo + ((q[k] + 32767) / 65534) * (hi - lo);
    }
    const body = createMeshBody(raw.id, typeof raw.name === 'string' ? raw.name : 'maillage importe', positions);
    registerMeshBody(body);
    return body;
  } catch {
    return null;
  }
}
