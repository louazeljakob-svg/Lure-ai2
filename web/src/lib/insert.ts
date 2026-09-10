/**
 * Coque a paroi mince et insert interne — module O.2.
 *
 * Deux choses distinctes, souvent confondues :
 *
 *  - La CAVITE est mesuree, pas devinee. On decale la surface reelle vers
 *    l'interieur d'une epaisseur de paroi et on integre le volume obtenu.
 *    C'est ce volume qui dit si l'insert tient, et c'est lui qui remplace
 *    l'estimation « volume x (1 - taux de remplissage) » partout ou elle
 *    servait.
 *
 *  - L'INSERT est une piece a part entiere. Il sort de l'export sous son
 *    propre nom, avec son propre materiau, et sa masse comme son bras de
 *    levier entrent dans la flottaison. Un insert dont la masse ne comptait
 *    pas serait un decor, pas une piece.
 */

import * as THREE from 'three';
import type { LureParams } from '../types/lure';
import { createSurfaceSampler, type Resolution } from './geometry';
import { MM_TO_CM, type ProfileSampler } from './profile';
import { getMaterial } from './materials';

/** Volume signe d'un maillage ferme, par la somme des tetraedres. */
function meshVolume(geometry: THREE.BufferGeometry): number {
  const pos = geometry.getAttribute('position');
  const index = geometry.index;
  const count = index ? index.count : pos.count;
  const at = (t: number) => (index ? index.getX(t) : t);
  let volume = 0;
  for (let f = 0; f < count; f += 3) {
    const a = at(f);
    const b = at(f + 1);
    const c = at(f + 2);
    volume +=
      pos.getX(a) * (pos.getY(b) * pos.getZ(c) - pos.getZ(b) * pos.getY(c)) -
      pos.getY(a) * (pos.getX(b) * pos.getZ(c) - pos.getZ(b) * pos.getX(c)) +
      pos.getZ(a) * (pos.getX(b) * pos.getY(c) - pos.getY(b) * pos.getX(c));
  }
  return Math.abs(volume / 6);
}

export interface CavityMeasure {
  /** Volume interne disponible, en cm3. */
  volumeCm3: number;
  /** Demi-hauteur et demi-largeur au milieu de la cavite, en cm. */
  halfHeight: number;
  halfWidth: number;
  /** Longueur utile de la cavite, en cm. */
  lengthCm: number;
}

/**
 * Mesure la cavite d'une coque a paroi mince.
 *
 * La surface interne n'est pas emise dans le maillage exporte : sur une piece
 * imprimee, la paroi ne se modelise pas, elle se declare au trancheur par un
 * nombre de perimetres. En revanche son VOLUME doit etre juste, parce que
 * c'est lui qui porte la flottaison et le controle d'encombrement de
 * l'insert. On le mesure donc sur la vraie surface decalee vers l'interieur.
 */
export function measureCavity(
  profile: ProfileSampler,
  params: LureParams,
  resolution: Resolution,
): CavityMeasure {
  const wall = params.shell.wallMm * MM_TO_CM;
  const surface = createSurfaceSampler(profile, params);

  const positions: number[] = [];
  const indices: number[] = [];
  const nStations = resolution.lengthSegments;
  const nRadial = resolution.radialSegments;
  const cols = nRadial + 1;

  let halfHeight = 0;
  let halfWidth = 0;
  let first = 1;
  let last = 0;

  for (let i = 0; i <= nStations; i++) {
    const p = (i / nStations) * profile.bodyEnd;
    const section = profile.section(p);
    const centreY = (section.top + section.bottom) / 2 + section.offset;
    let alive = false;
    for (let j = 0; j <= nRadial; j++) {
      const theta = (j / nRadial) * Math.PI * 2;
      const point = surface(p, theta);
      // Retrait vers le centre de la section : c'est la definition d'une
      // paroi d'epaisseur constante sur un corps de revolution deforme.
      const dy = point.y - centreY;
      const radial = Math.hypot(dy, point.z);
      const shrink = radial > 1e-6 ? Math.max(radial - wall, 0) / radial : 0;
      if (shrink > 0) alive = true;
      positions.push(point.x, centreY + dy * shrink, point.z * shrink);
    }
    if (alive) {
      if (first > last) first = i;
      last = i;
      const inner = Math.max((section.top - section.bottom) / 2 - wall, 0);
      halfHeight = Math.max(halfHeight, inner);
      halfWidth = Math.max(halfWidth, Math.max(section.halfWidth - wall, 0));
    }
  }

  for (let i = 0; i < nStations; i++) {
    for (let j = 0; j < nRadial; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = (i + 1) * cols + j;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }
  // Bouchons : la cavite est un volume ferme, sinon son volume n'a pas de sens.
  const capFront = positions.length / 3;
  positions.push(profile.xAt(0), 0, 0);
  const capRear = positions.length / 3;
  positions.push(profile.xAt(profile.bodyEnd), 0, 0);
  for (let j = 0; j < nRadial; j++) {
    indices.push(capFront, j + 1, j);
    const base = nStations * cols;
    indices.push(capRear, base + j, base + j + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const volumeCm3 = meshVolume(geometry);
  geometry.dispose();

  return {
    volumeCm3,
    halfHeight,
    halfWidth,
    lengthCm: ((last - first) / Math.max(nStations, 1)) * profile.lengthCm,
  };
}

// ---------------------------------------------------------------------------
// L'insert
// ---------------------------------------------------------------------------

export interface InsertPart {
  geometry: THREE.BufferGeometry;
  volumeCm3: number;
  massG: number;
  /** Centre, dans le repere du leurre, en cm. */
  centre: { x: number; y: number };
  /** Encombrement reel, en mm. */
  size: { length: number; height: number; thickness: number };
}

/**
 * Plaque, feuille galbee ou volume, selon la forme demandee.
 *
 * Une grille reguliere suffit : l'insert est une piece mince, et sa forme
 * utile tient dans un rectangle galbe. Le maillage est ferme sur ses six
 * faces, sans quoi il ne serait pas exportable.
 */
export function buildInsert(
  profile: ProfileSampler,
  params: LureParams,
  cavity: CavityMeasure,
): InsertPart | null {
  const cfg = params.insert;
  if (!cfg.enabled) return null;

  const clear = cfg.clearance * MM_TO_CM;
  const halfLength = Math.max((cfg.length * profile.lengthCm) / 2 - clear, 0.05);
  const halfHeight = Math.max(cfg.height * cavity.halfHeight - clear, 0.03);
  const halfThick = Math.max((cfg.thickness * MM_TO_CM) / 2, 0.01);
  const centreX = profile.xAt(cfg.position);
  const section = profile.section(cfg.position);
  const centreY =
    (section.top + section.bottom) / 2 +
    section.offset +
    cfg.offset * Math.max(cavity.halfHeight - halfHeight, 0);
  const angle = (cfg.rotation * Math.PI) / 180;

  // Galbe : la feuille se cintre dans le plan de profil, ce qui lui donne le
  // reflet qu'une plaque plate n'a pas.
  const bow = cfg.form === 'plate' ? 0 : halfThick * (cfg.form === 'volume' ? 6 : 3);

  const nU = 24;
  const nV = 10;
  const positions: number[] = [];
  const indices: number[] = [];

  const place = (u: number, v: number, side: number) => {
    const x0 = u * halfLength;
    const y0 = v * halfHeight;
    // Le galbe suit la longueur : maximum au centre, nul aux extremites.
    const z0 = side * halfThick + bow * (1 - u * u);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    positions.push(centreX + x0 * cos - y0 * sin, centreY + x0 * sin + y0 * cos, z0);
  };

  const cols = nV + 1;
  for (const side of [1, -1]) {
    for (let i = 0; i <= nU; i++) {
      for (let j = 0; j <= nV; j++) {
        place((i / nU) * 2 - 1, (j / nV) * 2 - 1, side);
      }
    }
  }
  const back = (nU + 1) * cols;
  for (let i = 0; i < nU; i++) {
    for (let j = 0; j < nV; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = (i + 1) * cols + j;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
      // Face arriere : winding inverse.
      indices.push(back + a, back + d, back + b, back + a, back + c, back + d);
    }
  }
  // Chants : les quatre bords ferment la piece.
  //
  // Le sens compte. Le chant doit emettre chaque arete de bord de la face
  // avant A L'ENVERS, sinon la meme arete dirigee sort deux fois dans le meme
  // sens et le solide n'est pas ferme. Le bord de la face avant tourne dans
  // cet ordre : (nU, nV) vers -j, puis vers -i, puis vers +j, puis vers +i.
  const edge = (a: number, b: number) => {
    indices.push(a, back + a, back + b, a, back + b, b);
  };
  for (let j = nV; j > 0; j--) edge(nU * cols + j, nU * cols + j - 1);
  for (let i = nU; i > 0; i--) edge(i * cols, (i - 1) * cols);
  for (let j = 0; j < nV; j++) edge(j, j + 1);
  for (let i = 0; i < nU; i++) edge(i * cols + nV, (i + 1) * cols + nV);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const volumeCm3 = meshVolume(geometry);
  const density = getMaterial(cfg.material).density;
  return {
    geometry,
    volumeCm3,
    massG: volumeCm3 * density,
    centre: { x: centreX, y: centreY },
    size: {
      length: halfLength * 2 * 10,
      height: halfHeight * 2 * 10,
      thickness: halfThick * 2 * 10,
    },
  };
}

/**
 * Raison pour laquelle l'insert ne peut pas etre produit, ou null.
 *
 * On bloque plutot que de generer une piece qui ne rentrerait pas : un insert
 * plus grand que sa cavite est une piece a jeter, pas un avertissement.
 */
export function insertBlocker(params: LureParams, cavity: CavityMeasure): string | null {
  if (!params.insert.enabled) return null;
  if (!params.shell.enabled) {
    return "L'insert demande une coque a paroi mince : sans cavite definie, il n'y a nulle part ou le loger. Activez « Coque a paroi mince ».";
  }
  const clear = params.insert.clearance * MM_TO_CM;
  const halfThick = (params.insert.thickness * MM_TO_CM) / 2;
  if (halfThick + clear > cavity.halfWidth) {
    return `L'insert (${params.insert.thickness.toFixed(1)} mm avec ${params.insert.clearance.toFixed(2)} mm de jeu) est plus epais que la cavite (${(cavity.halfWidth * 20).toFixed(1)} mm de large). Amincissez-le ou elargissez le corps.`;
  }
  if (cavity.volumeCm3 < 0.1) {
    return `La paroi de ${params.shell.wallMm.toFixed(1)} mm ne laisse pratiquement aucune cavite (${cavity.volumeCm3.toFixed(2)} cm3). Amincissez la paroi ou grossissez le corps.`;
  }
  return null;
}


// ---------------------------------------------------------------------------
// Queue souple rapportee — module O.4
// ---------------------------------------------------------------------------


/**
 * Ou la queue souple prend appui.
 *
 * Une fente ne se creuse pas dans la pointe : sur un corps effile, il n'y a
 * la qu'un millimetre de matiere. On remonte donc le long du pedoncule
 * jusqu'a trouver la premiere section assez large pour la lame ET son jeu,
 * et c'est CETTE section qui devient la racine. La profondeur d'insertion
 * reellement obtenue en decoule, et elle est affichee telle quelle.
 */
export interface SoftTailRoot {
  /** Station de la racine, dans le repere parametrique du corps. */
  p: number;
  x: number;
  y: number;
  /** Largeur disponible a cette station, en mm. */
  widthMm: number;
  /** Profondeur d'insertion reellement obtenue, en mm. */
  insertionMm: number;
}

export function softTailRoot(
  profile: ProfileSampler,
  params: LureParams,
): SoftTailRoot | null {
  const cfg = params.softTail;
  // Le montage sur tenon n'a pas besoin de largeur : le tenon est un plot
  // rond, il tient dans n'importe quelle section. Seule la fente en demande.
  const need = cfg.method === 'slot' ? (cfg.baseThickness + cfg.clearance * 2) / 0.6 : 0;
  const tipX = profile.xAt(profile.bodyEnd);
  // On cherche jusqu'a la borne du reglage, pas jusqu'a la valeur courante :
  // l'insertion demandee est un MINIMUM, et sur un corps effile il faut
  // parfois s'enfoncer davantage pour trouver de la matiere. La profondeur
  // reellement obtenue est renvoyee et affichee.
  const maxInsertCm = 20 * MM_TO_CM;
  const minInsertCm = cfg.insertion * MM_TO_CM;

  const steps = 96;
  for (let i = 0; i <= steps; i++) {
    const p = profile.bodyEnd * (1 - (i / steps) * 0.45);
    const insertionCm = tipX - profile.xAt(p);
    if (insertionCm > maxInsertCm) break;
    if (insertionCm < minInsertCm) continue;
    const section = profile.section(p);
    const widthMm = section.halfWidth * 20;
    if (widthMm < need) continue;
    return {
      p,
      x: profile.xAt(p),
      y: (section.top + section.bottom) / 2 + section.offset,
      widthMm,
      insertionMm: insertionCm * 10,
    };
  }
  return null;
}

export interface SoftTailPart {
  geometry: THREE.BufferGeometry;
  volumeCm3: number;
  massG: number;
  /** Centre de la piece, dans le repere du leurre, en cm. */
  centre: { x: number; y: number };
  /** Cotes reelles, en mm. */
  size: { length: number; height: number; base: number; tip: number };
  /** Longueur reellement visible, hors partie inseree, en mm. */
  freeLength: number;
}

/**
 * Nageoire caudale rapportee.
 *
 * Piece MINCE et distincte : elle s'amincit de la base vers l'extremite,
 * ce qui est exactement ce qui la fait onduler, et s'evase ou se resserre
 * selon le reglage. Sa base est enfoncee dans le corps sur la profondeur
 * d'insertion demandee — c'est cette partie-la qui disparait dans la fente
 * ou sur le tenon, et qui ne compte donc pas dans la longueur visible.
 */
export function buildSoftTail(
  profile: ProfileSampler,
  params: LureParams,
): SoftTailPart | null {
  const cfg = params.softTail;
  if (!cfg.enabled) return null;

  const root = softTailRoot(profile, params);
  if (!root) return null;

  const lengthCm = cfg.length * MM_TO_CM;
  const insertCm = Math.min(root.insertionMm * MM_TO_CM, lengthCm * 0.6);
  const halfBase = (cfg.height * MM_TO_CM) / 2;
  const halfTip = halfBase * Math.max(cfg.spread, 0.1);
  const tBase = (cfg.baseThickness * MM_TO_CM) / 2;
  const tTip = Math.min((cfg.tipThickness * MM_TO_CM) / 2, tBase);

  // La base part de la racine trouvee, la ou il y a de la matiere.
  const rootX = root.x;
  const rootY = root.y;

  const nU = 20;
  const nV = 12;
  const cols = nV + 1;
  const positions: number[] = [];
  const indices: number[] = [];

  for (const side of [1, -1]) {
    for (let i = 0; i <= nU; i++) {
      const u = i / nU;
      const x = rootX + u * lengthCm;
      const half = halfBase + (halfTip - halfBase) * u;
      const thick = tBase + (tTip - tBase) * u;
      for (let j = 0; j <= nV; j++) {
        const v = (j / nV) * 2 - 1;
        // Bord arrondi : la piece n'a pas d'arete vive sur son pourtour.
        const round = Math.sqrt(Math.max(1 - v * v, 0));
        positions.push(x, rootY + v * half, side * thick * (0.35 + 0.65 * round));
      }
    }
  }

  const back = (nU + 1) * cols;
  for (let i = 0; i < nU; i++) {
    for (let j = 0; j < nV; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = (i + 1) * cols + j;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
      indices.push(back + a, back + d, back + b, back + a, back + c, back + d);
    }
  }
  // Meme regle que pour l'insert : le chant emet chaque arete de bord de la
  // face avant a l'envers, sinon la piece n'est pas fermee.
  const edge = (a: number, b: number) => {
    indices.push(a, back + a, back + b, a, back + b, b);
  };
  for (let j = nV; j > 0; j--) edge(nU * cols + j, nU * cols + j - 1);
  for (let i = nU; i > 0; i--) edge(i * cols, (i - 1) * cols);
  for (let j = 0; j < nV; j++) edge(j, j + 1);
  for (let i = 0; i < nU; i++) edge(i * cols + nV, (i + 1) * cols + nV);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const volumeCm3 = meshVolume(geometry);
  return {
    geometry,
    volumeCm3,
    massG: volumeCm3 * getMaterial(cfg.material).density,
    centre: { x: rootX + lengthCm * 0.55, y: rootY },
    size: {
      length: cfg.length,
      height: cfg.height,
      base: cfg.baseThickness,
      tip: cfg.tipThickness,
    },
    freeLength: cfg.length - insertCm * 10,
  };
}

/** Raison pour laquelle la queue souple ne peut pas etre montee, ou null. */
export function softTailBlocker(profile: ProfileSampler, params: LureParams): string | null {
  const cfg = params.softTail;
  if (!cfg.enabled) return null;
  if (profile.hasFin) {
    return "Le corps porte deja une nageoire caudale moulee. Une queue souple rapportee la doublerait : reglez la forme de queue sur « effilee » avant de la monter.";
  }
  if (!softTailRoot(profile, params)) {
    const need = cfg.baseThickness + cfg.clearance * 2;
    return `La fente demandee (${need.toFixed(2)} mm avec son jeu) ne trouve pas de section assez large sur les ${cfg.insertion.toFixed(1)} mm de pedoncule autorises : le corps s'y effile trop. Amincissez la lame, augmentez la profondeur d'insertion, ou passez au montage sur tenon, qui n'a pas besoin de largeur.`;
  }
  return null;
}
