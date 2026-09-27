/**
 * Maillage adaptatif — module AT.2.
 *
 * Une grille reguliere met autant de facettes sur un flanc presque plat que
 * sur le bord d'un opercule : trop pour l'un, pas assez pour l'autre. Ici la
 * grille de depart reste grossiere, et chaque triangle de PEAU est coupe en
 * deux tant que la surface reelle s'ecarte de lui de plus que la tolerance de
 * corde. La surface est connue exactement — c'est le moteur de forme qui la
 * definit, point par point, en (p, theta) — : chaque sommet ajoute est pose
 * dessus, jamais interpole a plat.
 *
 * Methode : bissection par la plus longue arete, avec propagation (LEPP,
 * Rivara). Un triangle n'est coupe que par sa plus longue arete ; si son
 * voisin a une arete plus longue, on coupe d'abord celle du voisin. Le
 * maillage reste conforme a chaque etape (aucune T-jonction), et la qualite
 * des triangles ne se degrade pas au fil des coupes.
 *
 * Seules les aretes de peau sont coupees. Les faces planes — plan de joint,
 * parois de logement — ne recoivent de sommet que la ou une arete de peau
 * qu'elles partagent a ete coupee : elles restent planes et fermees.
 *
 * Les coupes sont faites dans l'ordre de l'ecart mesure, le plus grand
 * d'abord : si le budget de triangles est atteint, il a ete depense la ou la
 * forme le demandait — tete, opercule, orbites, rayons et bords libres —, pas
 * sur les flancs.
 */

import * as THREE from "three";

/** Surface parametrique : (u, v) -> point, en cm. */
export type ParamSurface = (u: number, v: number) => THREE.Vector3;

export interface RefineOptions {
  /** Ecart de corde vise, en cm. */
  tolerance: number;
  /** Nombre maximal de triangles de la piece, toutes faces comprises. */
  budget: number;
  /** Arete en dessous de laquelle on ne coupe plus, en cm. */
  minEdge: number;
  /** Arete maximale admise sur la peau, en cm (0 : pas de limite). */
  maxEdge?: number;
  /**
   * Nombre minimal de triangles : si la tolerance est tenue plus tot (corps
   * tres lisse), elle est resserree de moitie en moitie jusqu'a l'atteindre.
   */
  floor?: number;
  /**
   * Periode du second parametre (2 PI pour un corps entier) : la couture ou
   * theta repasse de 2 PI a 0 n'est pas un pole.
   */
  periodV?: number;
}

export interface RefineStats {
  before: number;
  after: number;
  splits: number;
  /** Ecart de corde residuel le plus grand, en cm (sur les aretes de peau). */
  worst: number;
  /** Vrai si le budget a arrete le raffinement avant la tolerance. */
  budgetHit: boolean;
  /** Ecart de corde median et au 95e centile, en cm, sur les triangles de peau. */
  median: number;
  p95: number;
  /** Part des triangles de peau dont l'ecart est sous 0,02 mm. */
  within: number;
}

/**
 * Soupe de triangles etiquetee : pour chaque sommet de triangle, ses
 * parametres de surface (NaN hors peau), et pour chaque triangle, s'il est
 * de peau.
 */
export interface TaggedSoup {
  positions: number[];
  /** Deux valeurs par sommet de triangle (u, v), NaN si le sommet n'est pas sur la peau. */
  params: number[];
  skin: number[];
}

class Heap {
  private keys: number[] = [];
  private items: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(key: number, item: number): void {
    const k = this.keys;
    const it = this.items;
    k.push(key);
    it.push(item);
    let i = k.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (k[parent] >= k[i]) break;
      [k[parent], k[i]] = [k[i], k[parent]];
      [it[parent], it[i]] = [it[i], it[parent]];
      i = parent;
    }
  }
  peekKey(): number {
    return this.keys[0];
  }
  pop(): number {
    const k = this.keys;
    const it = this.items;
    const top = it[0];
    const lastK = k.pop()!;
    const lastI = it.pop()!;
    if (k.length > 0) {
      k[0] = lastK;
      it[0] = lastI;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] > k[m]) m = l;
        if (r < k.length && k[r] > k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [it[m], it[i]] = [it[i], it[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Raffine une soupe etiquetee et la rend en soupe (neuf coordonnees par
 * triangle), prete pour un BufferGeometry non indexe.
 */
export function refineSoup(
  soup: TaggedSoup,
  surface: ParamSurface,
  options: RefineOptions,
): { positions: number[]; stats: RefineStats } {
  // --- Soudure des sommets -------------------------------------------------
  const vx: number[] = [];
  const index = new Map<string, number>();
  const key = (x: number, y: number, z: number) =>
    `${Math.round(x * 1e7)},${Math.round(y * 1e7)},${Math.round(z * 1e7)}`;
  const triCount = soup.positions.length / 9;
  const tv: number[] = [];
  const tp: number[] = [];
  // Parametres vus pour chaque sommet soude : un pole (pointe de nez ou de
  // queue) en recoit plusieurs, tous justes — a cet endroit, theta n'a pas
  // de sens. On le note pour interpoler depuis l'autre bout de l'arete.
  const period = options.periodV ?? 0;
  const periodicGap = (a: number, b: number): number => {
    const d = Math.abs(a - b);
    return period > 0 ? Math.min(d, Math.abs(d - period)) : d;
  };
  const firstU: number[] = [];
  const firstV: number[] = [];
  const singular: number[] = [];
  const tskin: number[] = [];
  const alive: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const ids: number[] = [];
    for (let c = 0; c < 3; c++) {
      const o = t * 9 + c * 3;
      const x = soup.positions[o];
      const y = soup.positions[o + 1];
      const z = soup.positions[o + 2];
      const k = key(x, y, z);
      let id = index.get(k);
      if (id === undefined) {
        id = vx.length / 3;
        vx.push(x, y, z);
        index.set(k, id);
      }
      ids.push(id);
      const u = soup.params[t * 6 + c * 2];
      const v = soup.params[t * 6 + c * 2 + 1];
      if (Number.isFinite(u) && Number.isFinite(v)) {
        if (firstU[id] === undefined) {
          firstU[id] = u;
          firstV[id] = v;
        } else if (
          Math.abs(firstU[id] - u) > 1e-9 ||
          periodicGap(firstV[id], v) > 1e-7
        ) {
          singular[id] = 1;
        }
      }
    }
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
    tv.push(ids[0], ids[1], ids[2]);
    for (let c = 0; c < 3; c++)
      tp.push(soup.params[t * 6 + c * 2], soup.params[t * 6 + c * 2 + 1]);
    tskin.push(soup.skin[t] ? 1 : 0);
    alive.push(1);
  }
  const before = tskin.length;

  // --- Voisinage des sommets ----------------------------------------------
  // Sur une paroi quasi verticale (fente d'un souple, bord d'opercule), les
  // milieux geometriques de deux aretes voisines peuvent tomber au meme
  // point : deux sommets distincts a quelques dixiemes de micron, que tout
  // lecteur STL soude, et le maillage n'est plus une variete. On refuse donc
  // toute coupe dont le milieu tomberait a moins de NEAR d'un sommet existant.
  const NEAR = Math.max(options.minEdge * 0.25, 1e-6);
  const cells = new Map<string, number[]>();
  const cellOf = (x: number, y: number, z: number) =>
    `${Math.floor(x / NEAR)},${Math.floor(y / NEAR)},${Math.floor(z / NEAR)}`;
  const addVertex = (id: number) => {
    const k = cellOf(vx[id * 3], vx[id * 3 + 1], vx[id * 3 + 2]);
    const list = cells.get(k);
    if (list) list.push(id);
    else cells.set(k, [id]);
  };
  for (let id = 0; id < vx.length / 3; id++) addVertex(id);
  const crowdedAt = (p: THREE.Vector3): boolean => {
    const cx = Math.floor(p.x / NEAR);
    const cy = Math.floor(p.y / NEAR);
    const cz = Math.floor(p.z / NEAR);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          for (const id of cells.get(`${cx + i},${cy + j},${cz + k}`) ?? []) {
            const dx = vx[id * 3] - p.x;
            const dy = vx[id * 3 + 1] - p.y;
            const dz = vx[id * 3 + 2] - p.z;
            if (dx * dx + dy * dy + dz * dz < NEAR * NEAR) return true;
          }
        }
    return false;
  };

  // --- Aretes -------------------------------------------------------------
  const SHIFT = 67108864; // 2^26
  const edgeKey = (a: number, b: number) =>
    a < b ? a * SHIFT + b : b * SHIFT + a;
  const edges = new Map<number, number[]>();
  // Valence des sommets : un sommet qui accumule les triangles signale un
  // relief plus fin que ce que la bissection peut suivre (arete vive de
  // quelques centiemes). On cesse d'y couper plutot que d'y construire un
  // eventail sans fin.
  const valence: number[] = [];
  const MAX_VALENCE = 16;
  const frozen: number[] = [];
  const addEdge = (a: number, b: number, t: number) => {
    const k = edgeKey(a, b);
    const list = edges.get(k);
    if (list) list.push(t);
    else edges.set(k, [t]);
  };
  const removeEdge = (a: number, b: number, t: number) => {
    const k = edgeKey(a, b);
    const list = edges.get(k);
    if (!list) return;
    const i = list.indexOf(t);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) edges.delete(k);
  };
  for (let t = 0; t < tskin.length; t++) {
    addEdge(tv[t * 3], tv[t * 3 + 1], t);
    addEdge(tv[t * 3 + 1], tv[t * 3 + 2], t);
    addEdge(tv[t * 3 + 2], tv[t * 3], t);
    for (let c = 0; c < 3; c++)
      valence[tv[t * 3 + c]] = (valence[tv[t * 3 + c]] ?? 0) + 1;
  }

  const len2 = (a: number, b: number) => {
    const dx = vx[a * 3] - vx[b * 3];
    const dy = vx[a * 3 + 1] - vx[b * 3 + 1];
    const dz = vx[a * 3 + 2] - vx[b * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
  };

  /** Rang (0, 1, 2) de la plus longue arete : arete (c, c+1). Egalites departagees par les indices. */
  const longest = (t: number): number => {
    let best = 0;
    let bestLen = -1;
    let bestTie = -1;
    for (let c = 0; c < 3; c++) {
      const a = tv[t * 3 + c];
      const b = tv[t * 3 + ((c + 1) % 3)];
      const l = len2(a, b);
      const tie = Math.max(a, b) * SHIFT + Math.min(a, b);
      if (
        l > bestLen * (1 + 1e-9) ||
        (Math.abs(l - bestLen) <= bestLen * 1e-9 && tie > bestTie)
      ) {
        best = c;
        bestLen = l;
        bestTie = tie;
      }
    }
    return best;
  };

  // --- Sondes d'ecart, en cache par arete ---------------------------------
  // Pour une arete (a, b) d'un triangle de peau : ecart de la surface a 1/4,
  // 1/2 et 3/4 de l'arete, parametres interpoles lineairement.
  interface Probe {
    dev: number;
    mid: THREE.Vector3;
    mu: number;
    mv: number;
  }
  const probes = new Map<number, Probe>();
  const probe = (t: number, c: number): Probe | null => {
    const a = tv[t * 3 + c];
    const b = tv[t * 3 + ((c + 1) % 3)];
    const ua = tp[t * 6 + c * 2];
    const va = tp[t * 6 + c * 2 + 1];
    const ub = tp[t * 6 + ((c + 1) % 3) * 2];
    let vb = tp[t * 6 + ((c + 1) % 3) * 2 + 1];
    // Couture periodique : on prend le plus court chemin en theta.
    if (period > 0 && Math.abs(vb - va) > period / 2) vb += vb > va ? -period : period;
    if (
      !Number.isFinite(ua) ||
      !Number.isFinite(ub) ||
      !Number.isFinite(va) ||
      !Number.isFinite(vb)
    )
      return null;
    // Une arete issue d'un pole n'est pas coupee : toutes les meridiennes y
    // convergent, et la bissection y fabriquerait des aiguilles sans fin. Les
    // anneaux voisins, eux, se raffinent normalement.
    if (singular[a] || singular[b]) return null;
    const k = edgeKey(a, b);
    const cached = probes.get(k);
    if (cached) return crowdedAt(cached.mid) ? null : cached;
    const A = new THREE.Vector3(vx[a * 3], vx[a * 3 + 1], vx[a * 3 + 2]);
    const B = new THREE.Vector3(vx[b * 3], vx[b * 3 + 1], vx[b * 3 + 2]);
    const at = (s: number) => surface(ua + (ub - ua) * s, va + (vb - va) * s);
    const distToChord = (p: THREE.Vector3): number => {
      const ab = B.clone().sub(A);
      const l2 = Math.max(ab.lengthSq(), 1e-30);
      const t = Math.min(Math.max(p.clone().sub(A).dot(ab) / l2, 0), 1);
      return p.distanceTo(A.clone().addScaledVector(ab, t));
    };
    // Point de coupe : le milieu GEOMETRIQUE de l'arete sur la surface, pas
    // son milieu parametrique. Sur une falaise de relief (bord d'opercule,
    // crete), le milieu parametrique retombe presque sur une extremite : on
    // couperait sans jamais raccourcir l'arete. On cherche donc le parametre
    // ou le point est a egale distance des deux bouts.
    let sMid = 0.5;
    let mid = at(0.5);
    const balance = (p: THREE.Vector3) => p.distanceTo(A) - p.distanceTo(B);
    const total = A.distanceTo(B);
    if (Math.abs(balance(mid)) > 0.2 * total) {
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 14; k++) {
        const f = balance(mid);
        if (Math.abs(f) <= 0.05 * total) break;
        if (f < 0) lo = sMid;
        else hi = sMid;
        sMid = (lo + hi) / 2;
        mid = at(sMid);
      }
    }
    let dev = distToChord(mid);
    dev = Math.max(
      dev,
      distToChord(at(sMid / 2)),
      distToChord(at((1 + sMid) / 2)),
    );
    const out = {
      dev,
      mid: mid.clone(),
      mu: ua + (ub - ua) * sMid,
      mv: va + (vb - va) * sMid,
    };
    probes.set(k, out);
    return crowdedAt(out.mid) ? null : out;
  };

  const minEdge2 = options.minEdge * options.minEdge;
  const maxEdge2 =
    options.maxEdge && options.maxEdge > 0
      ? options.maxEdge * options.maxEdge
      : Infinity;
  /** Priorite d'un triangle de peau : ecart de sa plus longue arete, ou -1. */
  const priority = (t: number): number => {
    if (!alive[t] || !tskin[t] || frozen[t]) return -1;
    const c = longest(t);
    const a = tv[t * 3 + c];
    const b = tv[t * 3 + ((c + 1) % 3)];
    const l2 = len2(a, b);
    if (l2 < minEdge2) return -1;
    const pr = probe(t, c);
    if (!pr) return -1;
    if (l2 > maxEdge2) return 1e6 + l2;
    return pr.dev;
  };

  let count = tskin.length;
  let splits = 0;

  /** Coupe l'arete c du triangle t, et tous les triangles qui la partagent. */
  const splitEdge = (t: number, c: number): number[] => {
    const a = tv[t * 3 + c];
    const b = tv[t * 3 + ((c + 1) % 3)];
    const pr = probe(t, c)!;
    const m = vx.length / 3;
    vx.push(pr.mid.x, pr.mid.y, pr.mid.z);
    addVertex(m);
    const created: number[] = [];
    const around = [...(edges.get(edgeKey(a, b)) ?? [])];
    for (const n of around) {
      // Sommets du triangle n dans son ordre : (p, q, r) avec (p, q) = l'arete.
      let cn = -1;
      for (let k = 0; k < 3; k++) {
        const p = tv[n * 3 + k];
        const q = tv[n * 3 + ((k + 1) % 3)];
        if ((p === a && q === b) || (p === b && q === a)) cn = k;
      }
      if (cn < 0) continue;
      const i0 = cn;
      const i1 = (cn + 1) % 3;
      const i2 = (cn + 2) % 3;
      const p = tv[n * 3 + i0];
      const q = tv[n * 3 + i1];
      const r = tv[n * 3 + i2];
      const P = [tp[n * 6 + i0 * 2], tp[n * 6 + i0 * 2 + 1]];
      const Q = [tp[n * 6 + i1 * 2], tp[n * 6 + i1 * 2 + 1]];
      const R = [tp[n * 6 + i2 * 2], tp[n * 6 + i2 * 2 + 1]];
      // Parametres du nouveau sommet : ceux de la sonde, identiques pour
      // tous les triangles de l'arete — sinon le meme point porterait deux
      // jeux de parametres.
      const M = [pr.mu, pr.mv];
      const skin = tskin[n];
      removeEdge(p, q, n);
      removeEdge(q, r, n);
      removeEdge(r, p, n);
      alive[n] = 0;
      valence[p]--;
      valence[q]--;
      valence[r]--;
      const emit = (
        x: number,
        y: number,
        z: number,
        X: number[],
        Y: number[],
        Z: number[],
      ) => {
        const id = tskin.length;
        tv.push(x, y, z);
        tp.push(X[0], X[1], Y[0], Y[1], Z[0], Z[1]);
        tskin.push(skin);
        alive.push(1);
        frozen.push(0);
        valence[x] = (valence[x] ?? 0) + 1;
        valence[y] = (valence[y] ?? 0) + 1;
        valence[z] = (valence[z] ?? 0) + 1;
        addEdge(x, y, id);
        addEdge(y, z, id);
        addEdge(z, x, id);
        created.push(id);
      };
      emit(p, m, r, P, M, R);
      emit(m, q, r, M, Q, R);
      count += 1;
    }
    probes.delete(edgeKey(a, b));
    splits++;
    return created;
  };

  // --- Boucle LEPP, par ecart decroissant ---------------------------------
  let budgetHit = false;
  let tolerance = options.tolerance;
  for (let round = 0; round < 6; round++) {
    const heap = new Heap();
    for (let t = 0; t < tskin.length; t++) {
      const pr = priority(t);
      if (pr > tolerance) heap.push(pr, t);
    }
    while (heap.size > 0) {
      if (heap.peekKey() <= tolerance) break;
      if (count >= options.budget) {
        budgetHit = true;
        break;
      }
      const t0 = heap.pop();
      if (!alive[t0]) continue;
      const pr0 = priority(t0);
      if (pr0 <= tolerance) continue;
      // Chemin de plus longues aretes : on remonte jusqu'a une arete qui est la
      // plus longue de tous ses triangles de peau, et on la coupe.
      const stack = [t0];
      let guard = 0;
      while (stack.length > 0 && guard++ < 200) {
        const t = stack[stack.length - 1];
        if (!alive[t]) {
          stack.pop();
          continue;
        }
        const c = longest(t);
        const a = tv[t * 3 + c];
        const b = tv[t * 3 + ((c + 1) % 3)];
        if (!probe(t, c)) {
          stack.pop();
          continue;
        }
        let deferred = false;
        for (const n of edges.get(edgeKey(a, b)) ?? []) {
          if (n === t || !tskin[n]) continue;
          const cn = longest(n);
          const na = tv[n * 3 + cn];
          const nb = tv[n * 3 + ((cn + 1) % 3)];
          // Un voisin dont la plus longue arete ne peut pas etre coupee (issue
          // d'un pole, ou hors peau) n'arrete pas la propagation : l'arete
          // courante est coupee malgre lui, le maillage reste conforme.
          if (
            edgeKey(na, nb) !== edgeKey(a, b) &&
            stack.length < 60 &&
            probe(n, cn)
          ) {
            stack.push(n);
            deferred = true;
            break;
          }
        }
        if (deferred) continue;
        // Sommets opposes a l'arete : chacun gagnera un triangle.
        let crowded = false;
        for (const n of edges.get(edgeKey(a, b)) ?? []) {
          for (let k = 0; k < 3; k++) {
            const v = tv[n * 3 + k];
            if (v !== a && v !== b && (valence[v] ?? 0) >= MAX_VALENCE)
              crowded = true;
          }
        }
        if (crowded) {
          frozen[t] = 1;
          stack.pop();
          continue;
        }
        const created = splitEdge(t, c);
        stack.pop();
        for (const id of created) {
          const p = priority(id);
          if (p > tolerance) heap.push(p, id);
        }
      }
    }
    // Tolerance tenue sous le plancher : on la resserre et on reprend.
    if (budgetHit || !options.floor || count >= options.floor) break;
    tolerance /= 2;
  }

  // --- Ecart residuel et sortie -------------------------------------------
  const dbg = (globalThis as { __refineDebug?: number[][] }).__refineDebug;
  if (dbg) {
    for (let t = 0; t < tskin.length; t++) {
      if (alive[t] && tskin[t]) {
        const row: number[] = [];
        for (let c = 0; c < 3; c++)
          row.push(
            tp[t * 6 + c * 2],
            tp[t * 6 + c * 2 + 1],
            vx[tv[t * 3 + c] * 3],
            vx[tv[t * 3 + c] * 3 + 1],
            vx[tv[t * 3 + c] * 3 + 2],
            tv[t * 3 + c],
          );
        const pr = probe(t, longest(t));
        row.push(pr ? pr.dev : -1);
        dbg.push(row);
      }
    }
  }
  let worst = 0;
  const devs: number[] = [];
  const positions: number[] = [];
  for (let t = 0; t < tskin.length; t++) {
    if (!alive[t]) continue;
    for (let c = 0; c < 3; c++) {
      const id = tv[t * 3 + c];
      positions.push(vx[id * 3], vx[id * 3 + 1], vx[id * 3 + 2]);
    }
    if (tskin[t]) {
      const c = longest(t);
      const l2 = len2(tv[t * 3 + c], tv[t * 3 + ((c + 1) % 3)]);
      if (l2 >= minEdge2) {
        const pr = probe(t, c);
        if (pr) {
          worst = Math.max(worst, pr.dev);
          devs.push(pr.dev);
        }
      } else devs.push(0);
    }
  }
  devs.sort((x, y) => x - y);
  const pick = (q: number) =>
    devs.length
      ? devs[Math.min(devs.length - 1, Math.floor(q * devs.length))]
      : 0;
  const within = devs.length
    ? devs.filter((d) => d <= 0.002).length / devs.length
    : 1;
  return {
    positions,
    stats: {
      before,
      after: positions.length / 9,
      splits,
      worst,
      budgetHit,
      median: pick(0.5),
      p95: pick(0.95),
      within,
    },
  };
}
