/**
 * Import d'un maillage existant — module W.
 *
 * Le fichier arrive tel quel : un tas de triangles, sans garantie de sens, de
 * soudure ni d'orientation. Tout ce module sert a le ramener dans le repere de
 * travail de l'application — nez en -X, dos en +Y, axe longitudinal sur X —
 * et a dire franchement ce que le maillage permet et ce qu'il interdit.
 *
 * Rien n'est repare en silence. Une soudure de sommets confondus ou un
 * retournement global sont surs, et faits ; une arete non-manifold ou une
 * auto-intersection ne le sont pas, et sont signalees avec l'operation
 * qu'elles bloquent.
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
  /** Sommets confondus soudes a l'import. */
  welded: number;
  /** Vrai si toute arete orientee a son opposee, exactement une fois. */
  watertight: boolean;
  /** Volume signe, en cm3 : negatif si le maillage est retourne. */
  signedVolume: number;
}

export interface ImportedMesh {
  name: string;
  /** Positions soudees et reparees, en cm. */
  positions: Float32Array;
  diagnosis: MeshDiagnosis;
  /** Encombrement en mm, apres mise en place. */
  bounds: { length: number; width: number; height: number };
  /** Volume en cm3, apres mise a l'echelle. */
  volume: number;
  /** Orientation retenue, et comment elle a ete trouvee. */
  orientation: {
    /** Axe longitudinal d'origine : 0 = X, 1 = Y, 2 = Z. */
    axis: 0 | 1 | 2;
    /** Vrai si le nez a du etre retourne pour pointer vers -X. */
    flippedNose: boolean;
    /** Vrai si le dos a du etre retourne pour pointer vers +Y. */
    flippedBack: boolean;
    /** Comment l'orientation a ete devinee, en clair. */
    note: string;
  };
  /** Ce que ce maillage ne permet pas, et pourquoi. */
  limits: string[];
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

function parseBinaryStl(buffer: ArrayBuffer): number[] {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  const out: number[] = [];
  let offset = 84;
  for (let i = 0; i < count && offset + 50 <= buffer.byteLength; i++) {
    offset += 12; // normale du fichier : ignoree, on recalcule
    for (let k = 0; k < 9; k++) {
      out.push(view.getFloat32(offset, true));
      offset += 4;
    }
    offset += 2; // attribute byte count
  }
  return out;
}

function parseAsciiStl(text: string): number[] {
  const out: number[] = [];
  const pattern = /vertex\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    out.push(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  return out;
}

/** OBJ : seuls les sommets et les faces nous interessent, triangulees en eventail. */
function parseObj(text: string): number[] {
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
        for (const p of [index(parts[1]), index(parts[i]), index(parts[i + 1])]) {
          const point = points[p];
          if (point) out.push(point[0], point[1], point[2]);
        }
      }
    }
  }
  return out;
}

/**
 * Lit un fichier de maillage. Les longueurs des fichiers 3D sont en
 * millimetres par convention ; l'application travaille en centimetres.
 */
export function readMeshFile(name: string, data: ArrayBuffer | string): number[] {
  if (typeof data === 'string') {
    return name.toLowerCase().endsWith('.obj') ? parseObj(data) : parseAsciiStl(data);
  }
  if (name.toLowerCase().endsWith('.obj')) {
    return parseObj(new TextDecoder().decode(data));
  }
  return looksAscii(data) ? parseAsciiStl(new TextDecoder().decode(data)) : parseBinaryStl(data);
}

// ---------------------------------------------------------------------------
// Diagnostic et reparation
// ---------------------------------------------------------------------------

/** Volume signe d'un maillage triangule, par la somme des tetraedres. */
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

/**
 * Soude les sommets confondus et ecarte les triangles d'aire nulle.
 *
 * C'est la seule reparation vraiment sure : deux sommets a la meme place
 * SONT le meme sommet, et un triangle sans surface ne ferme rien. Le reste
 * — retournements locaux, non-manifold — est diagnostique, pas corrige.
 */
function weld(raw: number[], epsilon: number): { positions: number[]; welded: number; degenerate: number } {
  const map = new Map<string, number>();
  const points: number[] = [];
  const index: number[] = [];
  const key = (x: number, y: number, z: number) =>
    `${Math.round(x / epsilon)},${Math.round(y / epsilon)},${Math.round(z / epsilon)}`;
  for (let k = 0; k + 2 < raw.length; k += 3) {
    const id = key(raw[k], raw[k + 1], raw[k + 2]);
    let found = map.get(id);
    if (found === undefined) {
      found = points.length / 3;
      map.set(id, found);
      points.push(raw[k], raw[k + 1], raw[k + 2]);
    }
    index.push(found);
  }
  const positions: number[] = [];
  let degenerate = 0;
  for (let t = 0; t + 2 < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    if (a === b || b === c || a === c) {
      degenerate++;
      continue;
    }
    const ax = points[a * 3], ay = points[a * 3 + 1], az = points[a * 3 + 2];
    const bx = points[b * 3], by = points[b * 3 + 1], bz = points[b * 3 + 2];
    const cx = points[c * 3], cy = points[c * 3 + 1], cz = points[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-20) {
      degenerate++;
      continue;
    }
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  }
  const welded = raw.length / 3 - points.length / 3;
  return { positions, welded, degenerate };
}

/** Etat topologique du maillage, arete par arete. */
export function diagnose(
  positions: ArrayLike<number>,
  welded: number,
  degenerate: number,
  epsilon: number,
): MeshDiagnosis {
  const ids = new Map<string, number>();
  const key = (k: number) =>
    `${Math.round(positions[k] / epsilon)},${Math.round(positions[k + 1] / epsilon)},${Math.round(
      positions[k + 2] / epsilon,
    )}`;
  const id = (k: number) => {
    const name = key(k);
    let found = ids.get(name);
    if (found === undefined) {
      found = ids.size;
      ids.set(name, found);
    }
    return found;
  };
  const directed = new Map<string, number>();
  for (let k = 0; k + 8 < positions.length; k += 9) {
    const a = id(k), b = id(k + 3), c = id(k + 6);
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const name = `${u}>${v}`;
      directed.set(name, (directed.get(name) ?? 0) + 1);
    }
  }
  let openEdges = 0;
  let nonManifold = 0;
  let flipped = 0;
  for (const [name, count] of directed) {
    if (count > 1) {
      // La meme arete parcourue deux fois dans le MEME sens : les deux
      // triangles qui la portent tournent a l'envers l'un de l'autre.
      flipped += count - 1;
      nonManifold += count - 1;
      continue;
    }
    const [u, v] = name.split('>');
    if ((directed.get(`${v}>${u}`) ?? 0) !== 1) openEdges++;
  }
  const volume = signedVolume(positions);
  return {
    triangles: positions.length / 9,
    vertices: ids.size,
    openEdges,
    nonManifold,
    flipped,
    degenerate,
    welded,
    watertight: openEdges === 0 && nonManifold === 0,
    signedVolume: volume,
  };
}

// ---------------------------------------------------------------------------
// Mise en place
// ---------------------------------------------------------------------------

/** Etendue du maillage sur chaque axe. */
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

/**
 * Devine le sens du corps, et le ramene dans le repere de travail.
 *
 * L'axe longitudinal est le plus long : sur un leurre, aucune ambiguite. Le
 * nez est l'extremite la plus EFFILEE — moins de matiere dans le premier
 * dixieme que dans le dernier — parce qu'une queue de poisson porte une
 * caudale et un nez non. Le dos est le cote le plus bombe : la moitie qui
 * contient le plus de volume au-dela de l'axe median.
 *
 * Les deux sont des suppositions, annoncees comme telles et corrigeables.
 */
function place(positions: number[]): ImportedMesh['orientation'] {
  const { min, max } = extents(positions);
  const span = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  let axis: 0 | 1 | 2 = 0;
  if (span[1] > span[axis]) axis = 1;
  if (span[2] > span[axis]) axis = 2;
  // Amene l'axe long sur X, en gardant un repere direct.
  if (axis === 1) {
    for (let k = 0; k + 2 < positions.length; k += 3) {
      const x = positions[k];
      positions[k] = positions[k + 1];
      positions[k + 1] = -x;
    }
  } else if (axis === 2) {
    for (let k = 0; k + 2 < positions.length; k += 3) {
      const x = positions[k];
      positions[k] = positions[k + 2];
      positions[k + 2] = -x;
    }
  }

  const box = extents(positions);
  const length = box.max[0] - box.min[0];
  // Matiere dans le premier et le dernier dixieme, par comptage de sommets.
  let head = 0;
  let tail = 0;
  for (let k = 0; k + 2 < positions.length; k += 3) {
    const t = (positions[k] - box.min[0]) / Math.max(length, 1e-9);
    if (t < 0.1) head++;
    else if (t > 0.9) tail++;
  }
  const flippedNose = head > tail;
  if (flippedNose) {
    for (let k = 0; k + 2 < positions.length; k += 3) {
      positions[k] = -positions[k];
      positions[k + 2] = -positions[k + 2];
    }
  }

  const after = extents(positions);
  const middle = (after.max[1] + after.min[1]) / 2;
  let above = 0;
  let below = 0;
  for (let k = 0; k + 2 < positions.length; k += 3) {
    if (positions[k + 1] > middle) above++;
    else below++;
  }
  const flippedBack = below > above;
  if (flippedBack) {
    for (let k = 0; k + 2 < positions.length; k += 3) {
      positions[k + 1] = -positions[k + 1];
      positions[k + 2] = -positions[k + 2];
    }
  }

  // Recentrage sur l'origine.
  const final = extents(positions);
  const centre = [
    (final.max[0] + final.min[0]) / 2,
    (final.max[1] + final.min[1]) / 2,
    (final.max[2] + final.min[2]) / 2,
  ];
  for (let k = 0; k + 2 < positions.length; k += 3) {
    positions[k] -= centre[0];
    positions[k + 1] -= centre[1];
    positions[k + 2] -= centre[2];
  }

  return {
    axis,
    flippedNose,
    flippedBack,
    note:
      `Axe longitudinal ${'XYZ'[axis]} (le plus long). ` +
      `Nez ${flippedNose ? 'retourne' : 'deja'} vers -X d apres l extremite la plus effilee. ` +
      `Dos ${flippedBack ? 'retourne' : 'deja'} vers +Y d apres la moitie la plus bombee.`,
  };
}

/**
 * Reduction de maillage par regroupement de sommets sur une grille.
 *
 * Ce n'est pas une decimation par erreur quadratique : c'est plus grossier,
 * mais c'est robuste sur un maillage sale, et l'original reste conserve pour
 * l'export. Un maillage d'edition n'a pas besoin d'etre exact, il a besoin
 * d'etre fluide.
 */
export function decimate(positions: ArrayLike<number>, targetTriangles: number): Float32Array {
  const count = positions.length / 9;
  if (count <= targetTriangles) return new Float32Array(positions as ArrayLike<number>);
  const { min, max } = extents(positions);
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  // Une grille dont le pas croit comme la racine cubique du rapport voulu.
  let step = (diagonal / 100) * Math.cbrt(count / Math.max(targetTriangles, 1));
  let out: number[] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const result = weld(Array.from(positions as ArrayLike<number>).map((v) => v), step);
    out = result.positions;
    if (out.length / 9 <= targetTriangles) break;
    step *= 1.6;
  }
  return new Float32Array(out);
}

/**
 * Importe un maillage : lecture, soudure, diagnostic, mise en place et mise
 * a l'echelle. `targetLengthMm` impose la longueur hors-tout reelle ; sans
 * elle, le fichier est suppose en millimetres.
 */
export function importMesh(
  name: string,
  data: ArrayBuffer | string,
  options: { targetLengthMm?: number; scale?: number } = {},
): ImportedMesh {
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
  const positions = welded.positions;
  const orientation = place(positions);

  // Un maillage ferme mais retourne se reconnait a son volume negatif ; le
  // retourner est sur, et c'est la seule facon d'en tirer une masse.
  let volume = signedVolume(positions);
  if (volume < 0) {
    for (let k = 0; k + 8 < positions.length; k += 9) {
      for (let a = 0; a < 3; a++) {
        const swap = positions[k + 3 + a];
        positions[k + 3 + a] = positions[k + 6 + a];
        positions[k + 6 + a] = swap;
      }
    }
    volume = -volume;
  }

  // Mise a l'echelle. Les fichiers 3D sont en mm, l'application en cm.
  const placed = extents(positions);
  const lengthUnits = placed.max[0] - placed.min[0];
  const factor =
    options.targetLengthMm && lengthUnits > 1e-9
      ? (options.targetLengthMm / 10) / lengthUnits
      : (options.scale ?? 0.1);
  for (let k = 0; k < positions.length; k++) positions[k] *= factor;

  const final = extents(positions);
  const diagnosis = diagnose(positions, welded.welded, welded.degenerate, epsilon * factor);

  const limits: string[] = [];
  if (diagnosis.openEdges > 0) {
    limits.push(
      `Maillage non etanche : ${diagnosis.openEdges} aretes ouvertes. Volume, masse et verdict ` +
        'de flottabilite sont approximatifs ; le creusage en coque et la decoupe en demi-coques ' +
        'sont bloques — ils produiraient une piece ouverte.',
    );
  }
  if (diagnosis.nonManifold > 0) {
    limits.push(
      `Topologie non-manifold : ${diagnosis.nonManifold} aretes partagees par plus de deux faces. ` +
        'La decoupe en demi-coques et en segments articules est bloquee : aucune de ces ' +
        'operations ne sait ou est l interieur.',
    );
  }
  if (diagnosis.flipped > 0) {
    limits.push(
      `${diagnosis.flipped} faces sont orientees a l envers de leurs voisines. Le sens global a ` +
        'ete corrige si le volume etait negatif, mais les retournements locaux demandent une ' +
        'reparation dans un mailleur.',
    );
  }
  if (diagnosis.triangles > 200000) {
    limits.push(
      `${diagnosis.triangles} facettes : l edition en direct sera lente. Utilisez la reduction ` +
        'de maillage — l original est conserve pour l export.',
    );
  }

  return {
    name,
    positions: new Float32Array(positions),
    diagnosis,
    bounds: {
      length: (final.max[0] - final.min[0]) * 10,
      width: (final.max[2] - final.min[2]) * 10,
      height: (final.max[1] - final.min[1]) * 10,
    },
    volume: Math.abs(signedVolume(positions)),
    orientation,
    limits,
  };
}

/** Geometrie Three.js prete a afficher. */
export function toGeometry(mesh: ImportedMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
