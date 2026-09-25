/**
 * Import d'un maillage existant — modules W et AD.1.
 *
 * Le fichier arrive tel quel : un tas de triangles, sans garantie de sens, de
 * soudure ni d'orientation. Tout ce module sert a le ramener dans le repere de
 * travail de l'application — nez en -X, dos en +Y, axe longitudinal sur X —
 * et a dire franchement ce que le maillage permet et ce qu'il interdit.
 *
 * Seules les reparations SURES sont faites, et chacune est comptee dans le
 * rapport : soudure des sommets confondus, retrait des triangles d'aire
 * nulle et des doublons, propagation d'un sens coherent d'une face a sa
 * voisine, retournement d'une piece entiere dont le volume sort negatif,
 * rebouchage des petits trous. Une arete non-manifold, un grand trou ou une
 * surface sans epaisseur ne se reparent pas a l'aveugle : ils sont signales
 * avec l'operation qu'ils bloquent.
 */

import * as THREE from 'three';

export interface MeshDiagnosis {
  /** Nombre de facettes. */
  triangles: number;
  /** Sommets distincts apres soudure. */
  vertices: number;
  /** Aretes ouvertes : le maillage n'est pas ferme. */
  openEdges: number;
  /** Aretes vues plus de deux fois : topologie non-manifold. */
  nonManifold: number;
  /** Paires de triangles adjacents de sens contraire. */
  flipped: number;
  /** Triangles d'aire nulle. */
  degenerate: number;
  /** Triangles presents deux fois. */
  duplicates: number;
  /** Sommets confondus soudes a l'import. */
  welded: number;
  /** Vrai si toute arete orientee a son opposee, exactement une fois. */
  watertight: boolean;
  /** Volume signe, en unites du fichier au cube : negatif si retourne. */
  signedVolume: number;
}

/** Une reparation appliquee, et combien d'elements elle a touches. */
export interface MeshRepair {
  label: string;
  count: number;
}

/** Piece du fichier : un ensemble de facettes reliees entre elles. */
export interface MeshComponent {
  triangles: number;
  /** Volume en cm3, apres mise a l'echelle. */
  volume: number;
  /** Encombrement en cm, repere de travail. */
  min: [number, number, number];
  max: [number, number, number];
  role: 'body' | 'bib' | 'part';
}

/** Bavette detectee comme piece separee : ses cotes, relevees sur la piece. */
export interface DetectedBib {
  /** Longueur de la plaque, en mm. */
  lengthMm: number;
  /** Largeur, en mm. */
  widthMm: number;
  /** Epaisseur, en mm. */
  thicknessMm: number;
  /** Inclinaison sous l'horizontale, en degres. */
  angleDeg: number;
  /** Abscisse de son bord d'attaque, en mm depuis le nez. */
  fromNoseMm: number;
  /** Abscisse de son bord arriere — la racine, cote menton —, en mm depuis le nez. */
  rearFromNoseMm: number;
}

export interface MeshOrientation {
  /** Axe longitudinal d'origine : 0 = X, 1 = Y, 2 = Z. */
  axis: 0 | 1 | 2;
  /** Vrai si le nez a du etre retourne pour pointer vers -X. */
  flippedNose: boolean;
  /** Vrai si le dos a du etre retourne pour pointer vers +Y. */
  flippedBack: boolean;
  /** Quarts de tour autour de l'axe longitudinal (0 a 3). */
  roll: number;
  /** Vrai si le maillage a ete recale sur ses axes principaux d'inertie. */
  aligned: boolean;
  /** Comment l'orientation a ete trouvee, en clair. */
  note: string;
}

/** Corrections manuelles d'orientation, appliquees apres la detection. */
export interface OrientationOverride {
  axis?: 0 | 1 | 2;
  flipNose?: boolean;
  flipBack?: boolean;
  roll?: number;
  align?: boolean;
}

export interface ImportedMesh {
  name: string;
  /**
   * Maillage repare et mis en place, en cm. C'est l'ORIGINAL : il n'est
   * jamais decime, c'est lui que le banc d'essai mesure et que l'export
   * restitue.
   */
  positions: Float32Array;
  /** Le corps seul : l'original sans la bavette detachee, s'il y en a une. */
  body: Float32Array;
  /** Version allegee pour l'affichage, si la decimation a ete demandee. */
  display: Float32Array | null;
  /** Diagnostic du fichier tel qu'il est arrive, avant reparation. */
  before: MeshDiagnosis;
  /** Diagnostic apres reparation : c'est lui qui decide de ce qui est permis. */
  diagnosis: MeshDiagnosis;
  repairs: MeshRepair[];
  components: MeshComponent[];
  bib: DetectedBib | null;
  /** Encombrement en mm, apres mise en place. */
  bounds: { length: number; width: number; height: number };
  /** Volume en cm3, apres mise a l'echelle (somme signee des pieces). */
  volume: number;
  orientation: MeshOrientation;
  /** Facteur applique : unites du fichier vers mm. */
  unitToMm: number;
  /** Ce que ce maillage ne permet pas, et pourquoi. */
  limits: string[];
}

export interface ImportOptions {
  /** Longueur hors-tout imposee, en mm : l'emporte sur le facteur d'unite. */
  targetLengthMm?: number;
  /** Unites du fichier vers mm : 1 = mm (defaut), 10 = cm, 25,4 = pouce. */
  unitToMm?: number;
  orientation?: OrientationOverride;
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

/** Vrai si le tampon commence par un en-tete STL ASCII. */
function looksAscii(buffer: ArrayBuffer): boolean {
  const head = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 256));
  const text = new TextDecoder().decode(head).trim().toLowerCase();
  if (!text.startsWith('solid')) return false;
  // Un binaire peut commencer par « solid » : on tranche sur la taille, qui
  // est exactement 84 + 50 n pour un binaire.
  const view = new DataView(buffer);
  if (buffer.byteLength < 84) return true;
  const count = view.getUint32(80, true);
  return buffer.byteLength !== 84 + count * 50;
}

function parseBinaryStl(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const count = Math.min(view.getUint32(80, true), Math.floor((buffer.byteLength - 84) / 50));
  const out = new Float32Array(count * 9);
  let offset = 84;
  for (let i = 0; i < count; i++) {
    offset += 12; // normale du fichier : ignoree, on recalcule
    for (let k = 0; k < 9; k++) {
      out[i * 9 + k] = view.getFloat32(offset, true);
      offset += 4;
    }
    offset += 2; // attribute byte count
  }
  return out;
}

function parseAsciiStl(text: string): Float32Array {
  const out: number[] = [];
  const pattern = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    out.push(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  return new Float32Array(out.slice(0, out.length - (out.length % 9)));
}

/** OBJ : seuls les sommets et les faces nous interessent, triangulees en eventail. */
function parseObj(text: string): Float32Array {
  const points: number[][] = [];
  const out: number[] = [];
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'v') {
      points.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    } else if (parts[0] === 'f' && parts.length >= 4) {
      const index = (token: string) => {
        const raw = Number(token.split('/')[0]);
        return raw > 0 ? raw - 1 : points.length + raw;
      };
      for (let i = 2; i < parts.length - 1; i++) {
        const tri = [index(parts[1]), index(parts[i]), index(parts[i + 1])].map((p) => points[p]);
        if (tri.some((point) => !point)) continue;
        for (const point of tri) out.push(point[0], point[1], point[2]);
      }
    }
  }
  return new Float32Array(out);
}

/** Lit un fichier de maillage, en unites du fichier. */
export function readMeshFile(name: string, data: ArrayBuffer | string): Float32Array {
  if (typeof data === 'string') {
    return name.toLowerCase().endsWith('.obj') ? parseObj(data) : parseAsciiStl(data);
  }
  if (name.toLowerCase().endsWith('.obj')) {
    return parseObj(new TextDecoder().decode(data));
  }
  return looksAscii(data) ? parseAsciiStl(new TextDecoder().decode(data)) : parseBinaryStl(data);
}

// ---------------------------------------------------------------------------
// Topologie indexee
// ---------------------------------------------------------------------------

interface Indexed {
  points: Float64Array;
  tris: Uint32Array;
}

/** Volume signe d'une soupe de triangles, par la somme des tetraedres. */
export function signedVolume(positions: ArrayLike<number>): number {
  let volume = 0;
  for (let k = 0; k + 8 < positions.length; k += 9) {
    const ax = positions[k], ay = positions[k + 1], az = positions[k + 2];
    const bx = positions[k + 3], by = positions[k + 4], bz = positions[k + 5];
    const cx = positions[k + 6], cy = positions[k + 7], cz = positions[k + 8];
    volume +=
      (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}

function triVolume(points: Float64Array, a: number, b: number, c: number): number {
  const ax = points[a * 3], ay = points[a * 3 + 1], az = points[a * 3 + 2];
  const bx = points[b * 3], by = points[b * 3 + 1], bz = points[b * 3 + 2];
  const cx = points[c * 3], cy = points[c * 3 + 1], cz = points[c * 3 + 2];
  return (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
}

/**
 * Soude les sommets confondus et ecarte les triangles d'aire nulle.
 *
 * C'est la reparation la plus sure : deux sommets a la meme place SONT le
 * meme sommet, et un triangle sans surface ne ferme rien. La cle de soudure
 * est numerique — une grille de pas `epsilon` — pour tenir sur des fichiers
 * de plusieurs centaines de milliers de facettes.
 */
function weld(raw: Float32Array, epsilon: number): Indexed & { welded: number; degenerate: number } {
  const map = new Map<string, number>();
  const points: number[] = [];
  const count = raw.length / 3;
  const ids = new Uint32Array(count);
  for (let k = 0; k < count; k++) {
    const x = raw[k * 3], y = raw[k * 3 + 1], z = raw[k * 3 + 2];
    const key = `${Math.round(x / epsilon)},${Math.round(y / epsilon)},${Math.round(z / epsilon)}`;
    let found = map.get(key);
    if (found === undefined) {
      found = points.length / 3;
      map.set(key, found);
      points.push(x, y, z);
    }
    ids[k] = found;
  }
  const P = new Float64Array(points);
  const tris: number[] = [];
  let degenerate = 0;
  for (let t = 0; t + 2 < count; t += 3) {
    const a = ids[t], b = ids[t + 1], c = ids[t + 2];
    if (a === b || b === c || a === c) {
      degenerate++;
      continue;
    }
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < epsilon ** 4) {
      degenerate++;
      continue;
    }
    tris.push(a, b, c);
  }
  return { points: P, tris: new Uint32Array(tris), welded: count - points.length / 3, degenerate };
}

/** Cle numerique d'une arete orientee. */
const edgeKey = (a: number, b: number, n: number): number => a * n + b;

/** Etat topologique du maillage, arete par arete. */
function diagnoseIndexed(mesh: Indexed, extra: { welded: number; degenerate: number; duplicates: number }): MeshDiagnosis {
  const n = mesh.points.length / 3;
  const directed = new Map<number, number>();
  const undirected = new Map<number, number>();
  const { tris } = mesh;
  for (let t = 0; t < tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = tris[t + e];
      const b = tris[t + ((e + 1) % 3)];
      const key = edgeKey(a, b, n);
      directed.set(key, (directed.get(key) ?? 0) + 1);
      const u = edgeKey(Math.min(a, b), Math.max(a, b), n);
      undirected.set(u, (undirected.get(u) ?? 0) + 1);
    }
  }
  let openEdges = 0;
  let nonManifold = 0;
  let flipped = 0;
  for (const count of undirected.values()) {
    if (count === 1) openEdges++;
    else if (count > 2) nonManifold++;
  }
  for (const [key, count] of directed) {
    if (count > 1) flipped += count - 1;
    else {
      const a = Math.floor(key / n);
      const b = key - a * n;
      const opposite = directed.get(edgeKey(b, a, n)) ?? 0;
      // Deux faces qui partagent une arete dans le meme sens se voient ici :
      // l'arete orientee existe, son opposee non, mais l'arete n'est pas un bord.
      if (opposite === 0 && (undirected.get(edgeKey(Math.min(a, b), Math.max(a, b), n)) ?? 0) === 2) {
        flipped += 0.5;
      }
    }
  }
  let volume = 0;
  for (let t = 0; t < tris.length; t += 3) volume += triVolume(mesh.points, tris[t], tris[t + 1], tris[t + 2]);
  flipped = Math.round(flipped);
  return {
    triangles: tris.length / 3,
    vertices: n,
    openEdges,
    nonManifold,
    flipped,
    degenerate: extra.degenerate,
    duplicates: extra.duplicates,
    welded: extra.welded,
    watertight: openEdges === 0 && nonManifold === 0 && flipped === 0,
    signedVolume: volume,
  };
}

/** Retire les triangles presents deux fois, dans un sens ou dans l'autre. */
function removeDuplicates(mesh: Indexed): { mesh: Indexed; removed: number } {
  const seen = new Map<string, number>();
  const keep = new Uint8Array(mesh.tris.length / 3).fill(1);
  let removed = 0;
  for (let t = 0; t < mesh.tris.length; t += 3) {
    const sorted = [mesh.tris[t], mesh.tris[t + 1], mesh.tris[t + 2]].sort((a, b) => a - b);
    const key = sorted.join(',');
    const previous = seen.get(key);
    if (previous === undefined) {
      seen.set(key, t / 3);
      continue;
    }
    // Deux faces confondues de sens contraire s'annulent : c'est une cloison
    // sans epaisseur, on retire les deux. De meme sens, c'est un doublon.
    const same =
      (mesh.tris[t] === mesh.tris[previous * 3] && mesh.tris[t + 1] === mesh.tris[previous * 3 + 1]) ||
      (mesh.tris[t] === mesh.tris[previous * 3 + 1] && mesh.tris[t + 1] === mesh.tris[previous * 3 + 2]) ||
      (mesh.tris[t] === mesh.tris[previous * 3 + 2] && mesh.tris[t + 1] === mesh.tris[previous * 3]);
    keep[t / 3] = 0;
    removed++;
    if (!same && keep[previous]) {
      keep[previous] = 0;
      removed++;
    }
  }
  if (removed === 0) return { mesh, removed };
  const tris: number[] = [];
  for (let t = 0; t < keep.length; t++) if (keep[t]) tris.push(mesh.tris[t * 3], mesh.tris[t * 3 + 1], mesh.tris[t * 3 + 2]);
  return { mesh: { points: mesh.points, tris: new Uint32Array(tris) }, removed };
}

/** Composantes connexes par sommet partage : un tableau triangle -> piece. */
function componentsOf(mesh: Indexed): { of: Int32Array; count: number } {
  const n = mesh.points.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const { tris } = mesh;
  for (let t = 0; t < tris.length; t += 3) {
    const a = find(tris[t]);
    const b = find(tris[t + 1]);
    const c = find(tris[t + 2]);
    parent[b] = a;
    parent[find(c)] = a;
  }
  const label = new Map<number, number>();
  const of = new Int32Array(tris.length / 3);
  for (let t = 0; t < of.length; t++) {
    const root = find(tris[t * 3]);
    let id = label.get(root);
    if (id === undefined) {
      id = label.size;
      label.set(root, id);
    }
    of[t] = id;
  }
  return { of, count: label.size };
}

/**
 * Propage un sens de parcours coherent de proche en proche.
 *
 * Deux faces qui partagent une arete doivent la parcourir en sens contraire.
 * Sur une piece manifold, cette regle fixe le sens de toutes les faces des
 * qu'on fixe celui d'une seule : c'est donc une reparation sure. Chaque
 * piece est ensuite retournee en bloc si son volume sort negatif. Une piece
 * non orientable (ruban de Mobius, faces croisees) est laissee telle quelle
 * et comptee.
 */
function orient(mesh: Indexed): { flipped: number; reversedParts: number; conflicts: number } {
  const n = mesh.points.length / 3;
  const { tris } = mesh;
  const count = tris.length / 3;
  // Aretes non orientees -> les deux triangles qui la portent (manifold seul).
  const owners = new Map<number, number[]>();
  for (let t = 0; t < count; t++) {
    for (let e = 0; e < 3; e++) {
      const a = tris[t * 3 + e];
      const b = tris[t * 3 + ((e + 1) % 3)];
      const key = edgeKey(Math.min(a, b), Math.max(a, b), n);
      const list = owners.get(key);
      if (list) list.push(t);
      else owners.set(key, [t]);
    }
  }
  const has = (t: number, a: number, b: number) => {
    for (let e = 0; e < 3; e++) {
      if (tris[t * 3 + e] === a && tris[t * 3 + ((e + 1) % 3)] === b) return true;
    }
    return false;
  };
  const flip = new Int8Array(count).fill(-1);
  let conflicts = 0;
  const queue: number[] = [];
  for (let seed = 0; seed < count; seed++) {
    if (flip[seed] !== -1) continue;
    flip[seed] = 0;
    queue.push(seed);
    while (queue.length) {
      const t = queue.pop()!;
      for (let e = 0; e < 3; e++) {
        const a = tris[t * 3 + e];
        const b = tris[t * 3 + ((e + 1) % 3)];
        const list = owners.get(edgeKey(Math.min(a, b), Math.max(a, b), n));
        if (!list || list.length !== 2) continue;
        const other = list[0] === t ? list[1] : list[0];
        // Arete parcourue dans le meme sens par les deux : l'une doit tourner.
        const same = has(other, a, b);
        const wanted = (flip[t] ^ (same ? 1 : 0)) as 0 | 1;
        if (flip[other] === -1) {
          flip[other] = wanted;
          queue.push(other);
        } else if (flip[other] !== wanted) {
          conflicts++;
        }
      }
    }
  }
  let flipped = 0;
  for (let t = 0; t < count; t++) {
    if (flip[t] === 1) {
      const swap = tris[t * 3 + 1];
      tris[t * 3 + 1] = tris[t * 3 + 2];
      tris[t * 3 + 2] = swap;
      flipped++;
    }
  }
  // Chaque piece fermee doit enfermer un volume positif.
  const parts = componentsOf(mesh);
  const volumes = new Float64Array(parts.count);
  for (let t = 0; t < count; t++) {
    volumes[parts.of[t]] += triVolume(mesh.points, tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]);
  }
  let reversedParts = 0;
  for (let c = 0; c < parts.count; c++) if (volumes[c] < 0) reversedParts++;
  if (reversedParts > 0) {
    for (let t = 0; t < count; t++) {
      if (volumes[parts.of[t]] >= 0) continue;
      const swap = tris[t * 3 + 1];
      tris[t * 3 + 1] = tris[t * 3 + 2];
      tris[t * 3 + 2] = swap;
    }
  }
  return { flipped, reversedParts, conflicts: Math.floor(conflicts / 2) };
}

/** Plus grand trou rebouche automatiquement, en nombre d'aretes. */
const SMALL_HOLE = 32;

/**
 * Rebouche les petits trous par un eventail depuis leur barycentre.
 *
 * Un trou de quelques aretes est presque toujours un defaut d'export — un
 * triangle perdu, un sommet mal soude. Au-dela, le trou est une vraie
 * ouverture (nageoire en simple face, piece coupee) : le reboucher serait
 * inventer une surface. Il est laisse et signale.
 */
function fillSmallHoles(mesh: Indexed): { mesh: Indexed; filled: number; left: number; leftEdges: number } {
  const n = mesh.points.length / 3;
  const { tris } = mesh;
  const directed = new Set<number>();
  for (let t = 0; t < tris.length; t += 3) {
    for (let e = 0; e < 3; e++) directed.add(edgeKey(tris[t + e], tris[t + ((e + 1) % 3)], n));
  }
  // Bord : arete orientee sans opposee. Le trou se parcourt en sens inverse.
  const next = new Map<number, number[]>();
  let boundary = 0;
  for (const key of directed) {
    const a = Math.floor(key / n);
    const b = key - a * n;
    if (directed.has(edgeKey(b, a, n))) continue;
    boundary++;
    const list = next.get(b);
    if (list) list.push(a);
    else next.set(b, [a]);
  }
  if (boundary === 0) return { mesh, filled: 0, left: 0, leftEdges: 0 };
  const points = Array.from(mesh.points);
  const added: number[] = [];
  const used = new Set<string>();
  let filled = 0;
  let left = 0;
  let leftEdges = 0;
  for (const [start, targets] of next) {
    for (const first of targets) {
      if (used.has(`${start}>${first}`)) continue;
      const loop = [start];
      let current = first;
      let ok = true;
      used.add(`${start}>${first}`);
      while (current !== start) {
        loop.push(current);
        const options = next.get(current) ?? [];
        // Un sommet ou plusieurs bords se croisent rend le trou ambigu.
        if (options.length !== 1 || loop.length > 4096) {
          ok = false;
          break;
        }
        used.add(`${current}>${options[0]}`);
        current = options[0];
      }
      if (!ok || loop.length < 3) {
        left++;
        leftEdges += loop.length;
        continue;
      }
      if (loop.length > SMALL_HOLE) {
        left++;
        leftEdges += loop.length;
        continue;
      }
      let cx = 0, cy = 0, cz = 0;
      for (const v of loop) {
        cx += mesh.points[v * 3];
        cy += mesh.points[v * 3 + 1];
        cz += mesh.points[v * 3 + 2];
      }
      const centre = points.length / 3;
      points.push(cx / loop.length, cy / loop.length, cz / loop.length);
      for (let i = 0; i < loop.length; i++) {
        added.push(loop[i], loop[(i + 1) % loop.length], centre);
      }
      filled++;
    }
  }
  if (filled === 0) return { mesh, filled, left, leftEdges };
  const merged = new Uint32Array(tris.length + added.length);
  merged.set(tris);
  merged.set(added, tris.length);
  return { mesh: { points: new Float64Array(points), tris: merged }, filled, left, leftEdges };
}

// ---------------------------------------------------------------------------
// Mise en place
// ---------------------------------------------------------------------------

/** Etendue d'un nuage de points sur chaque axe. */
function extents(positions: ArrayLike<number>): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k + 2 < positions.length; k += 3) {
    for (let a = 0; a < 3; a++) {
      const value = positions[k + a];
      if (value < min[a]) min[a] = value;
      if (value > max[a]) max[a] = value;
    }
  }
  return { min, max };
}

/** Applique une rotation propre (matrice 3x3, lignes) a tous les points. */
function rotate(points: Float64Array, m: number[]): void {
  for (let k = 0; k < points.length; k += 3) {
    const x = points[k], y = points[k + 1], z = points[k + 2];
    points[k] = m[0] * x + m[1] * y + m[2] * z;
    points[k + 1] = m[3] * x + m[4] * y + m[5] * z;
    points[k + 2] = m[6] * x + m[7] * y + m[8] * z;
  }
}

/** Axes principaux d'inertie de la surface : trois vecteurs propres, ordre decroissant. */
function principalAxes(mesh: Indexed): number[][] {
  const { points, tris } = mesh;
  let area = 0;
  const c = [0, 0, 0];
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const centres: number[] = [];
  const weights: number[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, d = tris[t + 2] * 3;
    const ux = points[b] - points[a], uy = points[b + 1] - points[a + 1], uz = points[b + 2] - points[a + 2];
    const vx = points[d] - points[a], vy = points[d + 1] - points[a + 1], vz = points[d + 2] - points[a + 2];
    const w = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    const m = [0, 1, 2].map((k) => (points[a + k] + points[b + k] + points[d + k]) / 3);
    centres.push(...m);
    weights.push(w);
    area += w;
    for (let k = 0; k < 3; k++) c[k] += m[k] * w;
  }
  for (let k = 0; k < 3; k++) c[k] /= Math.max(area, 1e-12);
  for (let i = 0; i < weights.length; i++) {
    const d = [0, 1, 2].map((k) => centres[i * 3 + k] - c[k]);
    for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) cov[r * 3 + s] += d[r] * d[s] * weights[i];
  }
  // Jacobi : trois rotations suffisent largement pour une matrice 3x3.
  const A = cov.slice();
  const V = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 24; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = A[p * 3 + q];
      if (Math.abs(apq) < 1e-18) continue;
      const theta = (A[q * 3 + q] - A[p * 3 + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cs = 1 / Math.sqrt(t * t + 1);
      const sn = t * cs;
      for (let k = 0; k < 3; k++) {
        const akp = A[k * 3 + p], akq = A[k * 3 + q];
        A[k * 3 + p] = cs * akp - sn * akq;
        A[k * 3 + q] = sn * akp + cs * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = A[p * 3 + k], aqk = A[q * 3 + k];
        A[p * 3 + k] = cs * apk - sn * aqk;
        A[q * 3 + k] = sn * apk + cs * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k * 3 + p], vkq = V[k * 3 + q];
        V[k * 3 + p] = cs * vkp - sn * vkq;
        V[k * 3 + q] = sn * vkp + cs * vkq;
      }
    }
  }
  const axes = [0, 1, 2]
    .map((k) => ({ value: A[k * 3 + k], v: [V[k], V[3 + k], V[6 + k]] }))
    .sort((a, b) => b.value - a.value)
    .map((item) => item.v);
  return axes;
}

/** Aire des tranches a quelques abscisses : sert a reconnaitre la tete. */
function sliceAreas(mesh: Indexed, stations: number[]): number[] {
  const { points, tris } = mesh;
  const areas = stations.map(() => 0);
  for (let t = 0; t < tris.length; t += 3) {
    const ids = [tris[t], tris[t + 1], tris[t + 2]];
    const xs = ids.map((v) => points[v * 3]);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    for (let s = 0; s < stations.length; s++) {
      const x = stations[s];
      if (x < lo || x > hi) continue;
      const cut: number[][] = [];
      for (let e = 0; e < 3; e++) {
        const a = ids[e], b = ids[(e + 1) % 3];
        const da = points[a * 3] - x, db = points[b * 3] - x;
        if (da >= 0 === db >= 0) continue;
        const u = da / (da - db);
        cut.push([
          points[a * 3 + 1] + u * (points[b * 3 + 1] - points[a * 3 + 1]),
          points[a * 3 + 2] + u * (points[b * 3 + 2] - points[a * 3 + 2]),
        ]);
      }
      if (cut.length !== 2) continue;
      // Green : chaque segment apporte sa part d'aire, quel que soit l'ordre
      // des segments, pourvu qu'il soit oriente par la normale de la face —
      // la matiere a gauche, l'exterieur a droite.
      const [a, b, c] = ids.map((v) => [points[v * 3 + 1], points[v * 3 + 2]]);
      const ux = points[ids[1] * 3] - points[ids[0] * 3];
      const uy = b[0] - a[0], uz = b[1] - a[1];
      const vx = points[ids[2] * 3] - points[ids[0] * 3];
      const vy = c[0] - a[0], vz = c[1] - a[1];
      const normalY = uz * vx - ux * vz;
      const normalZ = ux * vy - uy * vx;
      let [P, Q] = cut;
      const su = Q[0] - P[0], sv = Q[1] - P[1];
      if (sv * normalY - su * normalZ < 0) [P, Q] = [Q, P];
      areas[s] += (P[0] * Q[1] - Q[0] * P[1]) / 2;
    }
  }
  return areas;
}

/**
 * Devine le sens du corps, et le ramene dans le repere de travail.
 *
 * L'axe longitudinal est le plus long ; parmi les deux autres, la hauteur est
 * la plus grande — un poisson est plus haut qu'epais. Le nez est
 * l'extremite la plus PLEINE : dans le premier sixieme il y a la tete,
 * dans le dernier le pedoncule et une caudale mince. Le dos est cote
 * oppose a la bavette quand il y en a une, sinon la moitie la plus
 * detaillee (la dorsale y porte ses rayons). Tout est corrigeable.
 */
function place(mesh: Indexed, override: OrientationOverride): MeshOrientation {
  const { points } = mesh;
  const notes: string[] = [];
  let aligned = false;
  if (override.align) {
    const axes = principalAxes(mesh);
    // Repere direct : le troisieme axe est le produit des deux premiers.
    const [e1, e2] = axes;
    const e3 = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    rotate(points, [...e1, ...e2, ...e3]);
    aligned = true;
    notes.push('Recale sur les axes principaux d inertie.');
  }

  let box = extents(points);
  let span = [0, 1, 2].map((a) => box.max[a] - box.min[a]);
  let axis: 0 | 1 | 2 = 0;
  if (span[1] > span[axis]) axis = 1;
  if (span[2] > span[axis]) axis = 2;
  if (override.axis !== undefined) axis = override.axis;
  // Amene l'axe long sur X par une rotation propre.
  if (axis === 1) rotate(points, [0, 1, 0, -1, 0, 0, 0, 0, 1]);
  else if (axis === 2) rotate(points, [0, 0, 1, 0, 1, 0, -1, 0, 0]);
  notes.push(`Axe longitudinal ${'XYZ'[axis]}${override.axis !== undefined ? ' (impose)' : ' (le plus long)'}.`);

  // Hauteur sur Y : un quart de tour autour de X si l'epaisseur l'emporte.
  box = extents(points);
  span = [0, 1, 2].map((a) => box.max[a] - box.min[a]);
  let roll = span[2] > span[1] * 1.02 ? 1 : 0;
  if (override.roll !== undefined) roll = ((override.roll % 4) + 4) % 4;
  for (let r = 0; r < roll; r++) rotate(points, [1, 0, 0, 0, 0, -1, 0, 1, 0]);
  if (roll) notes.push(`${roll} quart(s) de tour autour de l axe pour mettre la hauteur sur Y.`);

  // Les indices se lisent sur la PIECE PRINCIPALE : une bavette qui depasse
  // devant le nez ferait croire a une extremite mince.
  const parts = componentsOf(mesh);
  const size = new Float64Array(parts.count);
  for (let t = 0; t < parts.of.length; t++) size[parts.of[t]]++;
  let main = 0;
  for (let c = 1; c < parts.count; c++) if (size[c] > size[main]) main = c;
  const mainTris: number[] = [];
  for (let t = 0; t < parts.of.length; t++) {
    if (parts.of[t] === main) mainTris.push(mesh.tris[t * 3], mesh.tris[t * 3 + 1], mesh.tris[t * 3 + 2]);
  }
  const body: Indexed = { points, tris: new Uint32Array(mainTris) };
  const bodyBox = () => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const v of mainTris) {
      for (let a = 0; a < 3; a++) {
        const value = points[v * 3 + a];
        if (value < min[a]) min[a] = value;
        if (value > max[a]) max[a] = value;
      }
    }
    return { min, max };
  };

  // Nez : l'extremite la plus pleine du corps.
  box = bodyBox();
  const length = box.max[0] - box.min[0];
  const stations: number[] = [];
  for (let i = 0; i < 12; i++) stations.push(box.min[0] + length * (0.02 + (0.9 * i) / 11));
  const areas = sliceAreas(body, stations);
  const head = areas.slice(0, 3).reduce((sum, a) => sum + Math.abs(a), 0);
  const tail = areas.slice(-3).reduce((sum, a) => sum + Math.abs(a), 0);
  let flippedNose = tail > head;
  if (override.flipNose) flippedNose = !flippedNose;
  if (flippedNose) rotate(points, [-1, 0, 0, 0, 1, 0, 0, 0, -1]);
  notes.push(
    `Nez ${flippedNose ? 'retourne' : 'deja'} vers -X${override.flipNose ? ' (corrige a la main)' : ' d apres l extremite la plus pleine du corps'}.`,
  );

  // Dos : oppose a la bavette detachee s'il y en a une ; sinon le cote qui
  // porte le plus de matiere MINCE dans le plan de symetrie — nageoire
  // dorsale, arete du dos — face a un ventre plus plein.
  box = bodyBox();
  const middle = (box.max[1] + box.min[1]) / 2;
  let bibSide = 0;
  for (let t = 0; t < parts.of.length; t++) {
    if (parts.of[t] === main) continue;
    const v = mesh.tris[t * 3] * 3;
    if (points[v] < box.min[0] + (box.max[0] - box.min[0]) * 0.3) bibSide += points[v + 1] > middle ? 1 : -1;
  }
  const BINS = 40;
  const bodySpan = Math.max(box.max[0] - box.min[0], 1e-9);
  const binOf = (x: number) => Math.min(Math.max(Math.floor(((x - box.min[0]) / bodySpan) * BINS), 0), BINS - 1);
  const lo = new Float64Array(BINS).fill(Infinity);
  const hi = new Float64Array(BINS).fill(-Infinity);
  const wide = new Float64Array(BINS);
  for (const v of mainTris) {
    const b = binOf(points[v * 3]);
    lo[b] = Math.min(lo[b], points[v * 3 + 1]);
    hi[b] = Math.max(hi[b], points[v * 3 + 1]);
    wide[b] = Math.max(wide[b], Math.abs(points[v * 3 + 2]));
  }
  let crestUp = 0;
  let crestDown = 0;
  const seen = new Uint8Array(points.length / 3);
  for (const v of mainTris) {
    if (seen[v]) continue;
    seen[v] = 1;
    const b = binOf(points[v * 3]);
    // Pointes exclues : le nez et la caudale ne disent rien du dos.
    if (b < 4 || b > BINS - 8) continue;
    const centre = (lo[b] + hi[b]) / 2;
    const half = (hi[b] - lo[b]) / 2;
    const dy = points[v * 3 + 1] - centre;
    if (Math.abs(points[v * 3 + 2]) < 0.12 * wide[b] && Math.abs(dy) > 0.45 * half) {
      if (dy > 0) crestUp++;
      else crestDown++;
    }
  }
  const cue = bibSide !== 0 ? 'bib' : crestUp !== crestDown ? 'crest' : 'none';
  let flippedBack = cue === 'bib' ? bibSide > 0 : cue === 'crest' ? crestDown > crestUp : false;
  if (override.flipBack) flippedBack = !flippedBack;
  if (flippedBack) rotate(points, [1, 0, 0, 0, -1, 0, 0, 0, -1]);
  notes.push(
    `Dos ${flippedBack ? 'retourne' : 'deja'} vers +Y${
      override.flipBack
        ? ' (corrige a la main)'
        : cue === 'bib'
          ? ' d apres la bavette, cote ventre'
          : cue === 'crest'
            ? ' d apres les cretes minces du plan de symetrie (dorsale, arete du dos)'
            : ' faute d indice : verifiez-le'
    }.`,
  );

  // Recentrage sur l'origine.
  box = extents(points);
  const centre = [0, 1, 2].map((a) => (box.max[a] + box.min[a]) / 2);
  for (let k = 0; k < points.length; k += 3) {
    points[k] -= centre[0];
    points[k + 1] -= centre[1];
    points[k + 2] -= centre[2];
  }
  return { axis, flippedNose, flippedBack, roll, aligned, note: notes.join(' ') };
}

/**
 * Reduction de maillage par regroupement de sommets sur une grille.
 *
 * Ce n'est pas une decimation par erreur quadratique : c'est plus grossier,
 * mais robuste sur un maillage sale. Elle ne sert qu'a l'AFFICHAGE : le
 * banc d'essai, l'industrialisation et l'export partent toujours de
 * l'original.
 */
export function decimate(positions: Float32Array, targetTriangles: number): Float32Array {
  const count = positions.length / 9;
  if (count <= targetTriangles) return positions;
  const { min, max } = extents(positions);
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  let step = (diagonal / 100) * Math.cbrt(count / Math.max(targetTriangles, 1));
  let out = positions;
  for (let attempt = 0; attempt < 8; attempt++) {
    const result = weld(positions, step);
    const soup = new Float32Array(result.tris.length * 3);
    for (let i = 0; i < result.tris.length; i++) {
      soup[i * 3] = result.points[result.tris[i] * 3];
      soup[i * 3 + 1] = result.points[result.tris[i] * 3 + 1];
      soup[i * 3 + 2] = result.points[result.tris[i] * 3 + 2];
    }
    out = soup;
    if (out.length / 9 <= targetTriangles) break;
    step *= 1.4;
  }
  return out;
}

/** Soupe de triangles depuis la forme indexee. */
function toSoup(mesh: Indexed, factor: number): Float32Array {
  const out = new Float32Array(mesh.tris.length * 3);
  for (let i = 0; i < mesh.tris.length; i++) {
    const v = mesh.tris[i] * 3;
    out[i * 3] = mesh.points[v] * factor;
    out[i * 3 + 1] = mesh.points[v + 1] * factor;
    out[i * 3 + 2] = mesh.points[v + 2] * factor;
  }
  return out;
}

/** Pieces du fichier, et la bavette s'il y en a une de detachee. */
function classify(
  mesh: Indexed,
  factor: number,
): { components: MeshComponent[]; bib: DetectedBib | null; body: Float32Array } {
  const parts = componentsOf(mesh);
  const { points, tris } = mesh;
  const stats = Array.from({ length: parts.count }, () => ({
    triangles: 0,
    volume: 0,
    min: [Infinity, Infinity, Infinity] as [number, number, number],
    max: [-Infinity, -Infinity, -Infinity] as [number, number, number],
    vertices: [] as number[],
  }));
  for (let t = 0; t < parts.of.length; t++) {
    const s = stats[parts.of[t]];
    s.triangles++;
    s.volume += triVolume(points, tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]) * factor ** 3;
    for (let e = 0; e < 3; e++) {
      const v = tris[t * 3 + e];
      s.vertices.push(v);
      for (let a = 0; a < 3; a++) {
        const value = points[v * 3 + a] * factor;
        if (value < s.min[a]) s.min[a] = value;
        if (value > s.max[a]) s.max[a] = value;
      }
    }
  }
  let main = 0;
  for (let c = 1; c < stats.length; c++) if (Math.abs(stats[c].volume) > Math.abs(stats[main].volume)) main = c;
  const body = stats[main];
  const length = body.max[0] - body.min[0];
  const bodyMid = (body.max[1] + body.min[1]) / 2;
  let bib: DetectedBib | null = null;
  let bibIndex = -1;
  stats.forEach((s, c) => {
    if (c === main || bib) return;
    const cx = (s.min[0] + s.max[0]) / 2;
    const cy = (s.min[1] + s.max[1]) / 2;
    if (cx > body.min[0] + length * 0.3 || cy > bodyMid) return;
    // Plaque : sa plus petite dimension, mesuree dans le plan de profil a
    // travers l'axe principal de la piece, reste petite devant la largeur.
    let mx = 0, my = 0;
    for (const v of s.vertices) {
      mx += points[v * 3] * factor;
      my += points[v * 3 + 1] * factor;
    }
    mx /= s.vertices.length;
    my /= s.vertices.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const v of s.vertices) {
      const dx = points[v * 3] * factor - mx;
      const dy = points[v * 3 + 1] * factor - my;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ux = Math.cos(angle), uy = Math.sin(angle);
    let along0 = Infinity, along1 = -Infinity, across0 = Infinity, across1 = -Infinity;
    for (const v of s.vertices) {
      const dx = points[v * 3] * factor - mx;
      const dy = points[v * 3 + 1] * factor - my;
      const a = dx * ux + dy * uy;
      const b = -dx * uy + dy * ux;
      along0 = Math.min(along0, a);
      along1 = Math.max(along1, a);
      across0 = Math.min(across0, b);
      across1 = Math.max(across1, b);
    }
    const plateLength = along1 - along0;
    const thickness = across1 - across0;
    const width = s.max[2] - s.min[2];
    if (thickness > 0.35 * Math.min(width, plateLength)) return;
    bibIndex = c;
    // L'angle se compte sous l'horizontale, bavette pointant vers l'avant.
    let tilt = (Math.atan2(Math.abs(uy), Math.abs(ux)) * 180) / Math.PI;
    if (tilt > 89) tilt = 89;
    bib = {
      lengthMm: plateLength * 10,
      widthMm: width * 10,
      thicknessMm: thickness * 10,
      angleDeg: tilt,
      fromNoseMm: (s.min[0] - body.min[0]) * 10,
      rearFromNoseMm: (s.max[0] - body.min[0]) * 10,
    };
  });
  const components: MeshComponent[] = stats.map((s, c) => ({
    triangles: s.triangles,
    volume: s.volume,
    min: s.min,
    max: s.max,
    role: c === main ? 'body' : c === bibIndex ? 'bib' : 'part',
  }));
  // Le corps, sans la bavette detachee : c'est lui qu'on industrialise, la
  // bavette etant remplacee par sa plaque dans la fente commune.
  const kept: number[] = [];
  for (let t = 0; t < parts.of.length; t++) {
    if (parts.of[t] === bibIndex) continue;
    kept.push(tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]);
  }
  return { components, bib, body: toSoup({ points, tris: new Uint32Array(kept) }, factor) };
}

/**
 * Importe un maillage : lecture, soudure, reparations sures, diagnostic, mise
 * en place et mise a l'echelle. `targetLengthMm` impose la longueur
 * hors-tout reelle ; sinon `unitToMm` convertit les unites du fichier.
 */
export function importMesh(name: string, data: ArrayBuffer | string, options: ImportOptions = {}): ImportedMesh {
  const raw = readMeshFile(name, data);
  if (raw.length < 9) {
    throw new Error('Fichier illisible : aucun triangle trouve.');
  }
  const box = extents(raw);
  const diagonal = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  // Tolerance de soudure proportionnelle a la piece : un millionieme de sa
  // diagonale, jamais une constante en millimetres.
  const epsilon = Math.max(diagonal * 1e-6, 1e-9);

  const welded = weld(raw, epsilon);
  const before = diagnoseIndexed(welded, { welded: welded.welded, degenerate: welded.degenerate, duplicates: 0 });

  const repairs: MeshRepair[] = [];
  if (welded.welded > 0) repairs.push({ label: 'Sommets confondus soudes', count: welded.welded });
  if (welded.degenerate > 0) repairs.push({ label: 'Triangles d aire nulle retires', count: welded.degenerate });
  const unique = removeDuplicates(welded);
  if (unique.removed > 0) repairs.push({ label: 'Triangles en double retires', count: unique.removed });
  let mesh = unique.mesh;
  const oriented = orient(mesh);
  if (oriented.flipped > 0) repairs.push({ label: 'Faces remises dans le sens de leurs voisines', count: oriented.flipped });
  if (oriented.reversedParts > 0) {
    repairs.push({ label: 'Pieces entieres retournees (volume negatif)', count: oriented.reversedParts });
  }
  const holes = fillSmallHoles(mesh);
  mesh = holes.mesh;
  if (holes.filled > 0) repairs.push({ label: `Petits trous rebouches (${SMALL_HOLE} aretes au plus)`, count: holes.filled });
  const repaired = removeDuplicates(mesh);
  mesh = repaired.mesh;
  const diagnosis = diagnoseIndexed(mesh, {
    welded: welded.welded,
    degenerate: welded.degenerate,
    duplicates: unique.removed,
  });

  const orientation = place(mesh, options.orientation ?? {});

  // Mise a l'echelle. Les fichiers 3D sont en mm par convention, sauf avis
  // contraire ; l'application travaille en cm.
  const placed = extents(mesh.points);
  const lengthUnits = placed.max[0] - placed.min[0];
  const unitToMm =
    options.targetLengthMm && lengthUnits > 1e-9
      ? options.targetLengthMm / lengthUnits
      : (options.unitToMm ?? 1);
  const factor = unitToMm / 10;
  const positions = toSoup(mesh, factor);
  const final = extents(positions);
  const { components, bib, body } = classify(mesh, factor);

  const limits: string[] = [];
  if (diagnosis.openEdges > 0) {
    limits.push(
      `Maillage non etanche : ${diagnosis.openEdges} aretes ouvertes apres rebouchage des petits trous` +
        (holes.left > 0 ? ` (${holes.left} ouverture(s) de plus de ${SMALL_HOLE} aretes, laissees telles quelles)` : '') +
        '. Volume, masse et verdict de flottabilite sont des estimations ; la decoupe en demi-coques ' +
        'est bloquee la ou un rayon ne trouve pas de paroi — une nageoire en simple face, sans ' +
        'epaisseur, en est la cause la plus frequente.',
    );
  }
  if (diagnosis.nonManifold > 0) {
    limits.push(
      `Topologie non-manifold : ${diagnosis.nonManifold} aretes partagees par plus de deux faces. ` +
        'Elles ne se reparent pas sans choisir a votre place quelle face garder : le sens des faces ' +
        'n a pas pu y etre propage. Le banc d essai reste utilisable ; la decoupe de la caudale ' +
        'par un plan est bloquee si elle traverse une de ces aretes.',
    );
  }
  if (oriented.conflicts > 0) {
    limits.push(
      `${oriented.conflicts} faces ne peuvent pas etre orientees de facon coherente (surface non ` +
        'orientable ou faces croisees). Le volume de ces zones est incertain.',
    );
  }
  if (diagnosis.triangles > 400000) {
    limits.push(
      `${diagnosis.triangles.toLocaleString('fr-FR')} facettes : activez l affichage allege pour ` +
        'l edition — l original reste la reference du banc d essai et de l export.',
    );
  }

  return {
    name,
    positions,
    body,
    display: null,
    before,
    diagnosis,
    repairs,
    components,
    bib,
    bounds: {
      length: (final.max[0] - final.min[0]) * 10,
      width: (final.max[2] - final.min[2]) * 10,
      height: (final.max[1] - final.min[1]) * 10,
    },
    volume: Math.abs(signedVolume(positions)),
    orientation,
    unitToMm,
    limits,
  };
}

/** Geometrie Three.js prete a afficher : la version allegee si elle existe. */
export function toGeometry(mesh: ImportedMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.display ?? mesh.positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
