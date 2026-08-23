/**
 * Assemblage en deux coques imprimables (male / femelle).
 *
 * Aucun booleen CSG n'est utilise. Mesure a l'appui sur ce maillage, un
 * booleen laisse pres d'une arete sur dix non appariee : ni solide STEP, ni
 * STL propre. Les coques sont donc construites directement dans la
 * parametrisation du loft.
 *
 * Principe : le plan de joint contient l'axe longitudinal du leurre, donc il
 * coupe chaque section en deux arcs. En reparametrant chaque arc sur un
 * nombre fixe d'echantillons, on obtient une grille reguliere — un maillage
 * ferme, sans T-jonction, dont le bord tombe exactement dans le plan.
 *
 * Les logements sont de deux natures :
 *
 *   - POCHE FERMEE : un contour dans le plan de joint, une profondeur. Le
 *     trou reste entoure de matiere (lest, bille, chambre).
 *   - PASSAGE TRAVERSANT : le logement rejoint la peau, de sorte que la
 *     grande boucle de la goupille ressort du corps. Deux geometries selon
 *     la sortie : par une extremite (le corps est tronque net et la face de
 *     coupe est percee) ou par un bord du plan de joint (l'arc de peau est
 *     rogne sur la largeur du passage, ce qui ouvre une bouche a la surface).
 */

import * as THREE from 'three';
import type { LureParams, PinAnchor, PinExit, SocketMethod } from '../types/lure';
import { createSurfaceSampler, type SurfaceSampler } from './geometry';
import { autoPin, buildPin, getPin, type PinPart, type PinSpec } from './hardware';
import { MM_TO_CM, type ProfileSampler } from './profile';
import { bibTangLength } from './billTemplate';

const STATIONS = 112;
const ARC_SAMPLES = 40;

/** Epaisseur de matiere conservee autour d'un logement, en cm. */
const WALL = 0.06;

export interface AssemblyResolution {
  stations: number;
  arcSamples: number;
}

export const ASSEMBLY_DISPLAY: AssemblyResolution = {
  stations: STATIONS,
  arcSamples: ARC_SAMPLES,
};

/** Resolution reduite pour l'export STEP, ou chaque facette coute cher. */
export const ASSEMBLY_STEP: AssemblyResolution = { stations: 64, arcSamples: 24 };

/** Angle de sortie du fil, en degres, pour chaque cote de sortie. */
const EXIT_ANGLE: Record<PinExit, number> = { nose: 0, belly: 90, tail: 180, back: 270 };

export const EXIT_LABEL: Record<PinExit, string> = {
  nose: 'Nez',
  belly: 'Ventre',
  tail: 'Queue',
  back: 'Dos',
};

const isLongitudinal = (exit: PinExit) => exit === 'nose' || exit === 'tail';

// ---------------------------------------------------------------------------
// Repere du plan de joint
// ---------------------------------------------------------------------------

interface JointFrame {
  /** Distance signee au plan de joint : > 0 du cote male. */
  normalOf: (y: number, z: number) => number;
  /** Coordonnee transverse, dans le plan. */
  transverseOf: (y: number, z: number) => number;
  /** Reconstruit (y, z) depuis (transverse, normale). */
  toWorld: (transverse: number, normal: number) => { y: number; z: number };
}

function jointFrame(angleDeg: number): JointFrame {
  const a = THREE.MathUtils.degToRad(angleDeg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return {
    transverseOf: (y, z) => y * cos + z * sin,
    normalOf: (y, z) => -y * sin + z * cos,
    toWorld: (t, n) => ({ y: t * cos - n * sin, z: t * sin + n * cos }),
  };
}

// ---------------------------------------------------------------------------
// Maillage
// ---------------------------------------------------------------------------

class MeshBuilder {
  private readonly positions: number[] = [];

  /**
   * `mirror` inverse le sens de tous les triangles. La coque femelle est
   * construite dans un repere de main opposee (la cote n y est comptee vers
   * -n) : sans ce miroir global, elle sortirait retournee.
   */
  constructor(private readonly mirror = false) {}

  triangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
    if (this.mirror) {
      const swap = b;
      b = c;
      c = swap;
    }
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    // Un triangle sans surface polluerait la topologie sans rien fermer.
    if (nx * nx + ny * ny + nz * nz < 1e-18) return;
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void {
    this.triangle(a, b, c);
    this.triangle(a, c, d);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.computeVertexNormals();
    return geometry;
  }
}

// ---------------------------------------------------------------------------
// Primitives planaires
// ---------------------------------------------------------------------------

/** Aire signee : sert a orienter les contours de maniere coherente. */
function signedArea(points: THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

const ccw = (points: THREE.Vector2[]): THREE.Vector2[] =>
  signedArea(points) < 0 ? [...points].reverse() : points;

/** Supprime les points consecutifs confondus, qui font echouer la triangulation. */
function dedupe(points: THREE.Vector2[], epsilon = 1e-5): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (!last || last.distanceTo(point) > epsilon) out.push(point);
  }
  while (out.length > 1 && out[0].distanceTo(out[out.length - 1]) <= epsilon) out.pop();
  return out;
}

/**
 * Triangulation verifiee : un polygone a V sommets et H trous se triangule en
 * exactement V + 2H - 2 triangles. Tout autre resultat signale une
 * triangulation ratee, qui laisserait un trou beant dans la coque.
 */
function triangulateChecked(
  contour: THREE.Vector2[],
  holes: THREE.Vector2[][],
): number[][] | null {
  const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
  const vertices = contour.length + holes.reduce((sum, hole) => sum + hole.length, 0);
  return faces.length === vertices + 2 * holes.length - 2 ? faces : null;
}

type Lift = (point: THREE.Vector2) => THREE.Vector3;
type Raise = (t: number, n: number, x: number) => THREE.Vector3;

/**
 * Contour normalise : dedoublonne et oriente en sens trigonometrique.
 *
 * Tout le reste du module travaille sur des contours normalises. C'est ce qui
 * rend le sens des parois deductible : sans cette convention, une paroi
 * pourrait etre emise dans le sens du contour ou dans l'autre selon la
 * primitive qui l'a produit, et les aretes ne s'apparieraient pas.
 */
const contourOf = (points: THREE.Vector2[]): THREE.Vector2[] => ccw(dedupe(points));

/**
 * Normalise un contour en conservant un marqueur par sommet.
 *
 * Le marqueur sert a reperer la bouche d'un passage debouchant : une arete
 * dont les deux extremites sont marquees ne recoit pas de paroi, puisque la
 * matiere s'y arrete deja.
 */
function ringMarked(
  points: THREE.Vector2[],
  open: boolean[],
): { outline: THREE.Vector2[]; skip: (index: number) => boolean } {
  const outline: THREE.Vector2[] = [];
  const marks: boolean[] = [];
  for (let i = 0; i < points.length; i++) {
    const last = outline[outline.length - 1];
    if (last && last.distanceTo(points[i]) <= 1e-5) continue;
    outline.push(points[i]);
    marks.push(open[i]);
  }
  while (outline.length > 1 && outline[0].distanceTo(outline[outline.length - 1]) <= 1e-5) {
    outline.pop();
    marks.pop();
  }
  if (signedArea(outline) < 0) {
    outline.reverse();
    marks.reverse();
  }
  return {
    outline,
    skip: (index) => marks[index] && marks[(index + 1) % marks.length],
  };
}

/**
 * Remplit une region plane. `outline` et `holes` sont deja normalises.
 * `flip` inverse le sens des triangles, donc la normale.
 */
function fill(
  mesh: MeshBuilder,
  outline: THREE.Vector2[],
  holes: THREE.Vector2[][],
  lift: Lift,
  flip: boolean,
): boolean {
  if (outline.length < 3) return false;
  const rings = holes.map((hole) => [...hole].reverse());
  const faces = triangulateChecked(outline, rings);
  if (!faces) return false;
  const all = [...outline, ...rings.flat()];
  for (const [i0, i1, i2] of faces) {
    const a = lift(all[i0]);
    const b = lift(all[i1]);
    const c = lift(all[i2]);
    if (flip) mesh.triangle(a, c, b);
    else mesh.triangle(a, b, c);
  }
  return true;
}

/**
 * Paroi d'un creux (poche, alesage, rainure) : normale tournee vers le vide.
 * `skip` masque les aretes sans matiere — la bouche d'un passage debouchant.
 */
function pocketWall(
  mesh: MeshBuilder,
  outline: THREE.Vector2[],
  nTop: number,
  nBottom: number,
  lift: Raise,
  skip?: (index: number) => boolean,
): void {
  for (let i = 0; i < outline.length; i++) {
    if (skip?.(i)) continue;
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    mesh.quad(
      lift(a.y, nTop, a.x),
      lift(a.y, nBottom, a.x),
      lift(b.y, nBottom, b.x),
      lift(b.y, nTop, b.x),
    );
  }
}

/** Paroi d'un plot (embase de goujon, collerette) : normale vers l'exterieur. */
function bossWall(
  mesh: MeshBuilder,
  outline: THREE.Vector2[],
  nTop: number,
  nBottom: number,
  lift: Raise,
): void {
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    mesh.quad(
      lift(a.y, nTop, a.x),
      lift(b.y, nTop, b.x),
      lift(b.y, nBottom, b.x),
      lift(a.y, nBottom, a.x),
    );
  }
}

function circleOutline(center: THREE.Vector2, radius: number, steps = 64): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    points.push(
      new THREE.Vector2(center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius),
    );
  }
  return points;
}

/**
 * Contour d'une capsule : rectangle arrondi dont les deux extremites sont des
 * demi-cercles de rayon `radius` centres sur a et b. Un a = b donne un cercle.
 */
function capsuleOutline(
  a: THREE.Vector2,
  b: THREE.Vector2,
  radius: number,
  steps = 28,
): THREE.Vector2[] {
  const axis = b.clone().sub(a);
  const angle = axis.lengthSq() > 1e-12 ? Math.atan2(axis.y, axis.x) : 0;
  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const phi = angle - Math.PI / 2 + (Math.PI * i) / steps;
    points.push(new THREE.Vector2(b.x + Math.cos(phi) * radius, b.y + Math.sin(phi) * radius));
  }
  for (let i = 0; i <= steps; i++) {
    const phi = angle + Math.PI / 2 + (Math.PI * i) / steps;
    points.push(new THREE.Vector2(a.x + Math.cos(phi) * radius, a.y + Math.sin(phi) * radius));
  }
  return dedupe(points);
}

// ---------------------------------------------------------------------------
// Description des logements
// ---------------------------------------------------------------------------

/** Poche fermee : le trou reste entoure de matiere sur tout son pourtour. */
interface Pocket {
  outline: THREE.Vector2[];
  /** Profondeur creusee dans la matiere, en cm. */
  depth: number;
  /**
   * Fond bombe : la profondeur suit une sphere ou une capsule de rayon
   * `depth` d'axe [a, b]. C'est la forme d'un logement de bille mobile.
   */
  dome?: { a: THREE.Vector2; b: THREE.Vector2 };
  /** Matiere laissee au niveau du joint : embase du goujon, ou collerette. */
  island?: THREE.Vector2[];
  /** Percage plus profond dans le fond : logement du goujon male. */
  bore?: { outline: THREE.Vector2[]; depth: number };
}

/**
 * Passage debouchant par un bord du plan de joint.
 *
 * `path` est le bord interieur de l'encoche, station de depart et station
 * d'arrivee comprises ; entre les deux, la peau est rognee sur la profondeur
 * du passage, ce qui ouvre la bouche a la surface du corps.
 */
interface SideExit {
  rail: 'lo' | 'hi';
  iStart: number;
  iEnd: number;
  path: THREE.Vector2[];
  depth: number;
  island?: THREE.Vector2[];
  bore?: { outline: THREE.Vector2[]; depth: number };
}

/** Passage debouchant par une extremite tronquee du corps. */
interface EndExit {
  end: 'front' | 'rear';
  /** Encoche dans la face de coupe : intervalle transverse et profondeur. */
  tLo: number;
  tHi: number;
  depth: number;
  /** Poche associee, dans le plan de joint, ouverte du cote de la coupe. */
  path: THREE.Vector2[];
  island?: THREE.Vector2[];
  bore?: { outline: THREE.Vector2[]; depth: number };
}

/** Portee de goupille engendree par un point d'ancrage. */
export interface SocketPlan {
  anchorId: string;
  spec: PinSpec;
  /** Centre dans le plan de joint, en coordonnees (x, transverse). */
  center: THREE.Vector2;
  /** Position 3D du centre, pour l'affichage des reperes. */
  world: THREE.Vector3;
  tenonRadius: number;
  tenonHeight: number;
  seatRadius: number;
  seatDepth: number;
  method: SocketMethod;
  exit: PinExit;
  /** Faux si la portee sort du corps ou en chevauche une autre. */
  valid: boolean;
  problem: string | null;
}

export interface AssemblyResult {
  male: THREE.BufferGeometry;
  female: THREE.BufferGeometry;
  /** Goujons : solides distincts poses sur la coque male, un par ancrage. */
  tenons: THREE.BufferGeometry | null;
  /** Volume des portees, rendu en surbrillance pour verification visuelle. */
  socketPreview: THREE.BufferGeometry | null;
  /** Billes mobiles, affichees dans leur logement. */
  rattles: { position: [number, number, number]; radius: number; mass: number }[];
  /** Goupilles modelisees, une par ancrage. */
  pins: PinPart[];
  sockets: SocketPlan[];
  pinSpec: PinSpec;
  pinMass: number;
  /** Volume de matiere retiree par les logements internes, en cm3. */
  cavityVolume: number;
  /** Direction d'ecartement pour la vue eclatee. */
  splitNormal: THREE.Vector3;
}

export function resolvePin(params: LureParams): PinSpec {
  const id =
    params.assembly.pin === 'auto'
      ? autoPin(params.length, params.assembly.roughWater)
      : params.assembly.pin;
  return getPin(id);
}

/** Goupille retenue pour un ancrage : la sienne, ou celle deduite du leurre. */
export function anchorPin(params: LureParams, anchor: PinAnchor): PinSpec {
  if (anchor.pin !== 'auto') return getPin(anchor.pin);
  return resolvePin(params);
}

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

interface Station {
  p: number;
  x: number;
  theta1: number;
  theta2: number;
  degenerate: boolean;
}

/** Localise les deux passages de la section deplacee a travers le plan. */
function findStation(
  surface: SurfaceSampler,
  frame: JointFrame,
  p: number,
  x: number,
): Station {
  const samples = 128;
  const normalAt = (theta: number) => {
    const point = surface(p, theta);
    return frame.normalOf(point.y, point.z);
  };
  // Convention stricte : le zero compte comme positif. Sans elle, sin(2*PI)
  // qui vaut -2.4e-16 ferait manquer le passage au dos.
  const positive = (value: number) => value >= 0;

  const signs: boolean[] = [];
  for (let i = 0; i < samples; i++) {
    signs.push(positive(normalAt((i / samples) * Math.PI * 2)));
  }

  const roots: number[] = [];
  for (let i = 0; i < samples && roots.length < 2; i++) {
    const next = (i + 1) % samples;
    if (signs[i] === signs[next]) continue;
    let lo = (i / samples) * Math.PI * 2;
    let hi = ((i + 1) / samples) * Math.PI * 2;
    const loPositive = signs[i];
    for (let step = 0; step < 34; step++) {
      const mid = (lo + hi) / 2;
      if (positive(normalAt(mid)) === loPositive) lo = mid;
      else hi = mid;
    }
    roots.push((lo + hi) / 2);
  }

  if (roots.length < 2) {
    return { p, x, theta1: 0, theta2: Math.PI, degenerate: true };
  }
  return { p, x, theta1: roots[0], theta2: roots[1], degenerate: false };
}

/** Sens de parcours de l'arc qui reste du cote demande. */
function arcRange(
  surface: SurfaceSampler,
  frame: JointFrame,
  station: Station,
  maleSide: boolean,
): [number, number] {
  const mid = (station.theta1 + station.theta2) / 2;
  const point = surface(station.p, mid);
  const onMale = frame.normalOf(point.y, point.z) > 0;
  return onMale === maleSide
    ? [station.theta1, station.theta2]
    : [station.theta2, station.theta1 + Math.PI * 2];
}

/** Etendue transverse du plan de joint a une station donnee. */
function stationRange(
  surface: SurfaceSampler,
  frame: JointFrame,
  station: Station,
): [number, number] {
  const a = surface(station.p, station.theta1);
  const b = surface(station.p, station.theta2);
  const t1 = frame.transverseOf(a.y, a.z);
  const t2 = frame.transverseOf(b.y, b.z);
  return [Math.min(t1, t2), Math.max(t1, t2)];
}

/**
 * Epaisseur de la demi-coque a une cote transverse donnee, en cm.
 *
 * C'est cette mesure qui borne la profondeur d'un logement debouchant : la
 * ou la coque est plus mince que le logement, la matiere disparait
 * entierement et la bouche s'ouvre plus large que prevu.
 */
function bulgeAtT(
  surface: SurfaceSampler,
  frame: JointFrame,
  station: Station,
  t: number,
): number {
  if (station.degenerate) return 0;
  const at = (theta: number) => {
    const point = surface(station.p, theta);
    return { t: frame.transverseOf(point.y, point.z), n: Math.abs(frame.normalOf(point.y, point.z)) };
  };
  // La cote transverse est monotone d'un bord a l'autre de l'arc.
  let lo = station.theta1;
  let hi = station.theta2;
  const increasing = at(hi).t > at(lo).t;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid).t < t === increasing) lo = mid;
    else hi = mid;
  }
  return at((lo + hi) / 2).n;
}

/** Epaisseur maximale de la demi-coque a cette station, en cm. */
function maxBulge(surface: SurfaceSampler, frame: JointFrame, station: Station): number {
  let best = 0;
  for (let i = 0; i <= 24; i++) {
    const theta = station.theta1 + ((station.theta2 - station.theta1) * i) / 24;
    const point = surface(station.p, theta);
    best = Math.max(best, Math.abs(frame.normalOf(point.y, point.z)));
  }
  return best;
}

/** Station la plus proche d'une abscisse, ou `null` hors du corps. */
function stationAt(stations: Station[], x: number): Station | null {
  if (stations.length === 0) return null;
  if (x < stations[0].x || x > stations[stations.length - 1].x) return null;
  let best = stations[0];
  let bestDistance = Infinity;
  for (const station of stations) {
    if (station.degenerate) continue;
    const distance = Math.abs(station.x - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = station;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Anneaux de peau
// ---------------------------------------------------------------------------

/**
 * Arc de peau d'une station, dans le repere local de la coque.
 *
 * Convention : l'echantillon 0 est TOUJOURS le bord de plus petit t. Les deux
 * coques parcourent leur section en sens oppose autour du corps ; sans cette
 * normalisation, le bord de la peau et le contour du plan de joint seraient
 * decrits en sens contraires sur l'une des deux, et leurs aretes ne
 * s'apparieraient pas.
 */
interface Ring {
  points: THREE.Vector3[];
  t: number[];
  n: number[];
  /** Arc reellement emis : bornes incluses. */
  clipStart: number;
  clipEnd: number;
}

function buildRing(
  surface: SurfaceSampler,
  frame: JointFrame,
  station: Station,
  maleSide: boolean,
  arcSamples: number,
): Ring {
  const [from, to] = arcRange(surface, frame, station, maleSide);
  const points: THREE.Vector3[] = [];
  const t: number[] = [];
  const n: number[] = [];
  for (let j = 0; j <= arcSamples; j++) {
    const theta = from + ((to - from) * j) / arcSamples;
    const point = surface(station.p, theta).clone();
    points.push(point);
    t.push(frame.transverseOf(point.y, point.z));
    n.push(Math.abs(frame.normalOf(point.y, point.z)));
  }
  if (t[0] > t[arcSamples]) {
    points.reverse();
    t.reverse();
    n.reverse();
  }
  return { points, t, n, clipStart: 0, clipEnd: arcSamples };
}

/**
 * Premier echantillon, depuis le bord donne, ou la peau atteint la cote
 * `depth` en s'etant deja ecartee du bord vers l'interieur.
 *
 * La double condition compte : sur un joint incline, la peau peut repasser
 * brievement au-dela du bord avant de remonter. Prendre un tel echantillon
 * pour bouche donnerait une face de coupe qui se recoupe.
 *
 * Retourne `null` si la coque n'atteint jamais cette cote : le passage ne
 * peut pas deboucher proprement a cet endroit.
 */
function sampleAtDepth(ring: Ring, fromIndex: number, depth: number, arcSamples: number): number | null {
  const step = fromIndex === 0 ? 1 : -1;
  const rim = ring.t[fromIndex];
  for (let k = 1; k <= arcSamples; k++) {
    const j = fromIndex + step * k;
    if (j < 0 || j > arcSamples) break;
    const inward = step > 0 ? ring.t[j] > rim : ring.t[j] < rim;
    if (inward && ring.n[j] >= depth) return j;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Construction d'une coque
// ---------------------------------------------------------------------------

interface ShellInput {
  stations: Station[];
  pockets: Pocket[];
  sideExits: SideExit[];
  endExits: EndExit[];
  /** Extremites reellement tronquees : une face de coupe y est necessaire. */
  cutFront: boolean;
  cutRear: boolean;
  arcSamples: number;
}

function buildShell(
  surface: SurfaceSampler,
  frame: JointFrame,
  input: ShellInput,
  maleSide: boolean,
): THREE.BufferGeometry {
  const { stations, arcSamples } = input;
  // Tout est emis avec l'orientation de la coque male ; la femelle, batie
  // dans un repere de main opposee, est retournee d'un bloc a l'arrivee.
  const mesh = new MeshBuilder(!maleSide);
  const lift = (t: number, n: number, x: number): THREE.Vector3 => {
    const { y, z } = frame.toWorld(t, maleSide ? n : -n);
    return new THREE.Vector3(x, y, z);
  };
  /** Releve un point (x, t) du plan de joint a la cote n. */
  const planar = (n: number): Lift => (point) => lift(point.y, n, point.x);
  /** Releve un point (t, n) d'une section transversale a l'abscisse x. */
  const cross = (x: number): Lift => (point) => lift(point.x, point.y, x);

  const rings = stations.map((station) =>
    buildRing(surface, frame, station, maleSide, arcSamples),
  );

  // --- Rognage de la peau au droit de chaque bouche -----------------------
  interface Mouth {
    exit: SideExit;
    /** Rang d'echantillon de la bouche, commun a toute la largeur. */
    sample: number;
  }
  const mouths: Mouth[] = [];
  const openExits: SideExit[] = [];
  const rimIndex = (rail: 'lo' | 'hi') => (rail === 'lo' ? 0 : arcSamples);

  for (const exit of input.sideExits) {
    // Un seul rang d'echantillons pour toute la bouche : si les stations
    // rognaient leur arc a des rangs differents, le bord de la peau et la
    // levre du passage ne tomberaient pas sur les memes sommets.
    const rim = rimIndex(exit.rail);
    let depthRank = 1;
    let reachable = true;
    for (let i = exit.iStart; i <= exit.iEnd; i++) {
      const found = sampleAtDepth(rings[i], rim, exit.depth, arcSamples);
      if (found === null) reachable = false;
      else depthRank = Math.max(depthRank, Math.abs(found - rim));
    }
    depthRank = Math.min(depthRank, arcSamples - 2);
    const sample = exit.rail === 'lo' ? depthRank : arcSamples - depthRank;

    // La bouche doit rester du bon cote du bord ET sous le bord interieur de
    // l'encoche sur toute sa largeur, sinon la face de coupe se recoupe.
    for (let i = exit.iStart; i <= exit.iEnd && reachable; i++) {
      const ring = rings[i];
      if (ring.n[sample] < exit.depth) reachable = false;
      const inner = i === exit.iStart ? exit.path[0] : exit.path[exit.path.length - 1];
      if (i === exit.iStart || i === exit.iEnd) {
        const gap = exit.rail === 'lo' ? inner.y - ring.t[sample] : ring.t[sample] - inner.y;
        if (gap <= 1e-3) reachable = false;
      }
    }
    // Un passage qui ne peut pas deboucher proprement est simplement ignore :
    // la coque reste pleine a cet endroit, et fermee.
    if (!reachable) continue;
    openExits.push(exit);
    mouths.push({ exit, sample });

    // Les stations strictement interieures perdent leur bord : c'est la
    // bouche du passage. Les stations frontieres restent entieres, la face
    // de coupe verticale se charge de la transition.
    for (let i = exit.iStart + 1; i < exit.iEnd; i++) {
      const ring = rings[i];
      if (exit.rail === 'lo') ring.clipStart = Math.max(ring.clipStart, sample);
      else ring.clipEnd = Math.min(ring.clipEnd, sample);
    }
  }

  // --- Peau ----------------------------------------------------------------
  for (let i = 0; i < stations.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    const start = Math.max(a.clipStart, b.clipStart);
    const end = Math.min(a.clipEnd, b.clipEnd);
    for (let j = start; j < end; j++) {
      mesh.quad(a.points[j], b.points[j], b.points[j + 1], a.points[j + 1]);
    }
  }

  // --- Contour du plan de joint -------------------------------------------
  const rimLo = (i: number) => new THREE.Vector2(stations[i].x, rings[i].t[0]);
  const rimHi = (i: number) => new THREE.Vector2(stations[i].x, rings[i].t[arcSamples]);

  const loExits = openExits.filter((exit) => exit.rail === 'lo');
  const hiExits = openExits.filter((exit) => exit.rail === 'hi');
  const frontExit = input.endExits.find((exit) => exit.end === 'front');
  const rearExit = input.endExits.find((exit) => exit.end === 'rear');

  const contour: THREE.Vector2[] = [];
  for (let i = 0; i < stations.length; ) {
    const exit = loExits.find((candidate) => candidate.iStart === i);
    if (exit) {
      contour.push(rimLo(i), ...exit.path, rimLo(exit.iEnd));
      i = exit.iEnd + 1;
    } else {
      contour.push(rimLo(i));
      i += 1;
    }
  }
  // Face de coupe arriere : l'encoche du passage y est inseree a l'endroit
  // ou le contour passe du bord bas au bord haut.
  if (rearExit) contour.push(...rearExit.path);
  for (let i = stations.length - 1; i >= 0; ) {
    const exit = hiExits.find((candidate) => candidate.iEnd === i);
    if (exit) {
      contour.push(rimHi(i), ...[...exit.path].reverse(), rimHi(exit.iStart));
      i = exit.iStart - 1;
    } else {
      contour.push(rimHi(i));
      i -= 1;
    }
  }
  if (frontExit) contour.push(...frontExit.path);

  // --- Poches fermees ------------------------------------------------------
  const outlineOf = contourOf(contour);
  const kept: { pocket: Pocket; outline: THREE.Vector2[] }[] = [];
  const holes: THREE.Vector2[][] = [];
  for (const pocket of input.pockets) {
    const outline = contourOf(pocket.outline);
    // Une poche dont le trou ferait echouer la triangulation est ecartee
    // AVANT emission : mieux vaut une coque pleine qu'une coque trouee.
    if (!triangulateChecked(outlineOf, [...holes, [...outline].reverse()])) continue;
    holes.push(outline);
    kept.push({ pocket, outline });
  }
  fill(mesh, outlineOf, holes, planar(0), true);

  for (const { pocket, outline } of kept) {
    if (pocket.dome) {
      emitDome(mesh, pocket, lift);
      continue;
    }
    const island = pocket.island ? contourOf(pocket.island) : null;
    const bore = pocket.bore ? contourOf(pocket.bore.outline) : null;
    pocketWall(mesh, outline, 0, pocket.depth, lift);
    fill(
      mesh,
      outline,
      [island, bore].filter(Boolean) as THREE.Vector2[][],
      planar(pocket.depth),
      true,
    );
    if (island) {
      bossWall(mesh, island, 0, pocket.depth, lift);
      fill(mesh, island, [], planar(0), true);
    }
    if (bore && pocket.bore) {
      pocketWall(mesh, bore, pocket.depth, pocket.bore.depth, lift);
      fill(mesh, bore, [], planar(pocket.bore.depth), true);
    }
  }

  // --- Passages debouchant par un bord ------------------------------------
  for (const { exit, sample } of mouths) {
    const mouth: THREE.Vector2[] = [];
    for (let i = exit.iStart; i <= exit.iEnd; i++) {
      mouth.push(new THREE.Vector2(stations[i].x, rings[i].t[sample]));
    }

    // Fond : borde par le chemin de l'encoche cote matiere, par la bouche
    // cote peau. Les deux extremites sont reprises par les faces de coupe.
    const reversed = [...mouth].reverse();
    const marked = ringMarked(
      [...exit.path, ...reversed],
      [
        ...exit.path.map((_, i) => i === 0 || i === exit.path.length - 1),
        ...reversed.map(() => true),
      ],
    );
    emitCavity(mesh, marked.outline, exit, planar, lift, marked.skip);

    // Levre de la bouche : la matiere qui reste au-dessus du passage.
    for (let i = exit.iStart; i < exit.iEnd; i++) {
      const k = i - exit.iStart;
      const ringA = rings[i];
      const ringB = rings[i + 1];
      const a0 = lift(mouth[k].y, exit.depth, mouth[k].x);
      const a1 = ringA.points[sample];
      const b1 = ringB.points[sample];
      const b0 = lift(mouth[k + 1].y, exit.depth, mouth[k + 1].x);
      // La levre regarde vers le vide du passage, donc a l'oppose du bord.
      if (exit.rail === 'lo') mesh.quad(a0, b0, b1, a1);
      else mesh.quad(a0, a1, b1, b0);
    }

    // Faces de coupe verticales aux deux stations frontieres.
    for (const border of [exit.iStart, exit.iEnd] as const) {
      const k = border - exit.iStart;
      const ring = rings[border];
      const rim = rimIndex(exit.rail);
      const step = rim === 0 ? 1 : -1;
      const top = border === exit.iStart ? exit.path[0] : exit.path[exit.path.length - 1];
      const section: THREE.Vector2[] = [new THREE.Vector2(ring.t[rim], 0)];
      section.push(new THREE.Vector2(top.y, 0));
      section.push(new THREE.Vector2(top.y, exit.depth));
      section.push(new THREE.Vector2(mouth[k].y, exit.depth));
      for (let j = sample; j !== rim; j -= step) {
        section.push(new THREE.Vector2(ring.t[j], ring.n[j]));
      }
      // La coque restante est en amont de iStart et en aval de iEnd : sa
      // face de coupe regarde donc vers +x d'un cote, vers -x de l'autre.
      fill(mesh, contourOf(section), [], cross(stations[border].x), border === exit.iEnd);
    }
  }

  // --- Faces de coupe des extremites --------------------------------------
  const emitCut = (index: number, front: boolean, notch: EndExit | undefined) => {
    const ring = rings[index];
    const section: THREE.Vector2[] = [];
    const lo = 0;
    const hi = arcSamples;
    section.push(new THREE.Vector2(ring.t[lo], 0));
    if (notch) {
      section.push(new THREE.Vector2(notch.tLo, 0));
      section.push(new THREE.Vector2(notch.tLo, notch.depth));
      section.push(new THREE.Vector2(notch.tHi, notch.depth));
      section.push(new THREE.Vector2(notch.tHi, 0));
    }
    section.push(new THREE.Vector2(ring.t[hi], 0));
    const step = hi > lo ? -1 : 1;
    for (let j = hi + step; j !== lo; j += step) {
      section.push(new THREE.Vector2(ring.t[j], ring.n[j]));
    }
    fill(mesh, contourOf(section), [], cross(stations[index].x), front);
  };
  if (input.cutFront) emitCut(0, true, frontExit);
  if (input.cutRear) emitCut(stations.length - 1, false, rearExit);

  // --- Poches des passages par une extremite ------------------------------
  for (const exit of input.endExits) {
    // Le chemin part et revient sur la ligne de coupe : le fond se referme
    // de lui-meme, l'arete de fermeture est la bouche.
    const marked = ringMarked(
      exit.path,
      exit.path.map((_, i) => i === 0 || i === exit.path.length - 1),
    );
    emitCavity(mesh, marked.outline, exit, planar, lift, marked.skip);
  }

  return mesh.build();
}

/**
 * Fond, parois, embase et alesage d'un passage debouchant.
 *
 * `skip` masque les aretes de la bouche : la matiere s'y arrete deja, c'est
 * la face de coupe qui referme le maillage a cet endroit.
 */
function emitCavity(
  mesh: MeshBuilder,
  outline: THREE.Vector2[],
  exit: { depth: number; island?: THREE.Vector2[]; bore?: { outline: THREE.Vector2[]; depth: number } },
  planar: (n: number) => Lift,
  lift: Raise,
  skip: (index: number) => boolean,
): void {
  const island = exit.island ? contourOf(exit.island) : null;
  const bore = exit.bore ? contourOf(exit.bore.outline) : null;
  fill(
    mesh,
    outline,
    [island, bore].filter(Boolean) as THREE.Vector2[][],
    planar(exit.depth),
    true,
  );
  pocketWall(mesh, outline, 0, exit.depth, lift, skip);
  if (island) {
    bossWall(mesh, island, 0, exit.depth, lift);
    fill(mesh, island, [], planar(0), true);
  }
  if (bore && exit.bore) {
    pocketWall(mesh, bore, exit.depth, exit.bore.depth, lift);
    fill(mesh, bore, [], planar(exit.bore.depth), true);
  }
}

/**
 * Fond bombe d'un logement de bille : anneaux concentriques d'une capsule,
 * du bord (cote 0) au sommet (cote = rayon). Le premier anneau est le contour
 * meme de la poche, donc le raccord avec le plan de joint est exact.
 */
function emitDome(mesh: MeshBuilder, pocket: Pocket, lift: Raise): void {
  const dome = pocket.dome!;
  const radius = pocket.depth;
  const steps = 9;
  const rings: { points: THREE.Vector2[]; n: number }[] = [];
  for (let k = 0; k <= steps; k++) {
    const phi = (k / steps) * (Math.PI / 2);
    rings.push({
      points: capsuleOutline(dome.a, dome.b, radius * Math.cos(phi)),
      n: radius * Math.sin(phi),
    });
  }
  const count = rings[0].points.length;
  const at = (list: THREE.Vector2[], i: number) =>
    list[Math.min(Math.floor((i * list.length) / count), list.length - 1)];

  for (let k = 0; k < steps; k++) {
    const lower = rings[k];
    const upper = rings[k + 1];
    for (let i = 0; i < count; i++) {
      const a0 = at(lower.points, i);
      const a1 = at(lower.points, (i + 1) % count);
      const b0 = at(upper.points, i);
      const b1 = at(upper.points, (i + 1) % count);
      // Normale vers le vide de la poche, comme une paroi de creux.
      mesh.quad(
        lift(a0.y, lower.n, a0.x),
        lift(b0.y, upper.n, b0.x),
        lift(b1.y, upper.n, b1.x),
        lift(a1.y, lower.n, a1.x),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Bavette rapportee
// ---------------------------------------------------------------------------

/** Les deux rails de la fente d'insertion, en fonction de l'abscisse. */
interface SlotRails {
  /** Bord haut de la fente a l'abscisse x. */
  top: (x: number) => number;
  /** Bord bas de la fente a l'abscisse x. */
  bottom: (x: number) => number;
  /** Extremite arriere : les deux coins, du haut vers le bas. */
  rear: [THREE.Vector2, THREE.Vector2];
  /** Abscisse de la racine (cote corps) et de la pointe. */
  rootX: number;
  tipX: number;
  half: number;
}

/**
 * Fente d'insertion d'une bavette rapportee, tracee dans le plan de joint.
 *
 * La fente doit DEBOUCHER : une bavette qui ne ressort pas du corps ne sert a
 * rien. Elle est donc prolongee vers l'avant jusqu'a percer le bord du plan
 * de joint, et c'est ce percement qui devient la bouche du logement.
 */
function billRails(profile: ProfileSampler, params: LureParams): SlotRails {
  const angle = THREE.MathUtils.degToRad(Math.min(Math.max(params.bibAngle, 5), 89));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const half = (params.billThickness * MM_TO_CM + params.fabrication.billFit * MM_TO_CM) / 2;
  const offset = Math.min(Math.max(params.billOffset * MM_TO_CM, 0), profile.lengthCm * 0.3);
  const anchorP = Math.min(Math.max(offset / Math.max(profile.lengthCm, 1e-6) + 0.03, 0.03), 0.4);
  const originX = profile.xAt(0) + offset;
  const originT = profile.section(anchorP).bottom * 0.55;

  // u > 0 : vers l'avant et vers le bas, comme la bavette elle-meme.
  const along = (u: number, v: number) =>
    new THREE.Vector2(originX - u * cos + v * sin, originT - u * sin - v * cos);

  // v = +half donne le rail bas, v = -half le rail haut : la bascule vient du
  // signe de cos dans l'expression de t.
  const railT = (x: number, v: number) => {
    const u = (originX + v * sin - x) / cos;
    return originT - u * sin - v * cos;
  };

  const back = -bibTangLength(params) * 1.15;
  return {
    top: (x) => railT(x, -half),
    bottom: (x) => railT(x, half),
    rear: [along(back, -half), along(back, half)],
    rootX: along(back, 0).x,
    tipX: along(bibTangLength(params) + profile.lengthCm * 0.35, 0).x,
    half,
  };
}

// ---------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------

interface AnchorPlan {
  anchor: PinAnchor;
  spec: PinSpec;
  center: THREE.Vector2;
  tenonRadius: number;
  tenonHeight: number;
  seatRadius: number;
  seatDepth: number;
  collarRadius: number;
  boreRadius: number;
  exit: PinExit;
  valid: boolean;
  problem: string | null;
}

/** Arc de cercle allant de l'angle `from` a l'angle `to`, dans le sens donne. */
function arcPoints(
  center: THREE.Vector2,
  radius: number,
  from: number,
  to: number,
  steps = 56,
): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    points.push(
      new THREE.Vector2(center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius),
    );
  }
  return points;
}

export function buildAssembly(
  profile: ProfileSampler,
  params: LureParams,
  resolution: AssemblyResolution = ASSEMBLY_DISPLAY,
): AssemblyResult {
  const surface = createSurfaceSampler(profile, params);
  const frame = jointFrame(params.assembly.planeAngle);
  const fabrication = params.fabrication;

  // --- Cotes de chaque ancrage --------------------------------------------
  const plans: AnchorPlan[] = [];
  for (const anchor of params.assembly.anchors) {
    const spec = anchorPin(params, anchor);
    const position = Math.min(Math.max(anchor.position, 0.02), profile.bodyEnd - 0.02);
    const x = profile.xAt(position);
    const station = findStation(surface, frame, position, x);

    const wireRadius = (spec.wire * MM_TO_CM) / 2;
    const loopOuter = (spec.loopWidth * MM_TO_CM) / 2;
    const loopCenterRadius = loopOuter - wireRadius;
    const loopInner = Math.max(loopOuter - spec.wire * MM_TO_CM, wireRadius * 0.6);
    const tenonRadius = Math.max(loopInner - (fabrication.tenonFit * MM_TO_CM) / 2, 0.045);
    const tenonHeight =
      anchor.depth > 0 ? anchor.depth * MM_TO_CM : Math.max(tenonRadius * 2, 0.12);

    const sweepRadius = (spec.wire * MM_TO_CM + fabrication.sweepExtra * MM_TO_CM) / 2;
    const channelOffset = fabrication.channelOffset * MM_TO_CM;
    const seatRadius =
      anchor.method === 'bore'
        ? loopOuter + (fabrication.boreClearance * MM_TO_CM) / 2
        : loopCenterRadius + sweepRadius + channelOffset;
    // La profondeur vaut le demi-cote du canal : les deux coques mises face a
    // face forment alors un passage carre qui laisse filer le fil.
    const seatDepth =
      anchor.method === 'bore'
        ? wireRadius + (fabrication.boreClearance * MM_TO_CM) / 2
        : sweepRadius;
    const collarRadius =
      anchor.method === 'bore'
        ? tenonRadius
        : Math.max(loopCenterRadius - sweepRadius - channelOffset, tenonRadius);

    let t = 0;
    let valid = true;
    let problem: string | null = null;
    if (station.degenerate) {
      valid = false;
      problem = 'Ancrage hors du corps.';
    } else {
      const [tMin, tMax] = stationRange(surface, frame, station);
      t = anchor.height >= 0 ? anchor.height * tMax : -anchor.height * tMin;
      const low = tMin + seatRadius + WALL;
      const high = tMax - seatRadius - WALL;
      if (low > high) {
        valid = false;
        problem = `La portee de ${spec.loopWidth} mm ne tient pas dans la section a cet endroit.`;
      } else {
        t = Math.min(Math.max(t, low), high);
      }
      if (valid && maxBulge(surface, frame, station) < seatDepth + WALL) {
        valid = false;
        problem = 'La coque est trop mince ici pour loger la goupille.';
      }
    }

    const center = new THREE.Vector2(x, t);
    for (const other of plans) {
      if (other.valid && other.center.distanceTo(center) < other.seatRadius + seatRadius + WALL) {
        valid = false;
        problem = 'Chevauchement avec une autre portee.';
      }
    }

    plans.push({
      anchor,
      spec,
      center,
      tenonRadius,
      tenonHeight,
      seatRadius,
      seatDepth,
      collarRadius,
      boreRadius: tenonRadius + (fabrication.tenonFit * MM_TO_CM) / 2,
      exit: anchor.exit,
      valid,
      problem,
    });
  }

  // --- Troncature des extremites ------------------------------------------
  // Une sortie par le nez ou par la queue perce la pointe : le corps y est
  // coupe net, juste la ou la section devient trop mince pour entourer le
  // passage. La coupe mesure quelques dixiemes de millimetre.
  const cutFor = (plan: AnchorPlan, front: boolean): number | null => {
    const w = plan.seatDepth;
    const limit = front ? 0.3 : profile.bodyEnd;
    const steps = 60;
    for (let i = 1; i <= steps; i++) {
      const p = front
        ? (limit * i) / steps
        : profile.bodyEnd - ((profile.bodyEnd - profile.bodyEnd * 0.7) * i) / steps;
      const station = findStation(surface, frame, p, profile.xAt(p));
      if (station.degenerate) continue;
      const [tMin, tMax] = stationRange(surface, frame, station);
      const fits =
        tMin + WALL <= plan.center.y - w &&
        plan.center.y + w <= tMax - WALL &&
        maxBulge(surface, frame, station) >= w + WALL;
      if (fits) return p;
    }
    return null;
  };

  let pStart = 0;
  let pEnd = profile.bodyEnd;
  let cutFront = false;
  let cutRear = false;
  for (const plan of plans) {
    if (!plan.valid || !isLongitudinal(plan.exit)) continue;
    const front = plan.exit === 'nose';
    const cut = cutFor(plan, front);
    if (cut === null) {
      plan.valid = false;
      plan.problem = 'La pointe est trop fine pour laisser sortir cette goupille.';
      continue;
    }
    if (front) {
      pStart = Math.max(pStart, cut);
      cutFront = true;
    } else {
      pEnd = Math.min(pEnd, cut);
      cutRear = true;
    }
  }
  if (pEnd - pStart < 0.2) {
    pStart = 0;
    pEnd = profile.bodyEnd;
    cutFront = false;
    cutRear = false;
    for (const plan of plans) {
      if (isLongitudinal(plan.exit)) {
        plan.valid = false;
        plan.problem = 'Sortie longitudinale impossible sur un corps aussi court.';
      }
    }
  }

  // --- Stations ------------------------------------------------------------
  const stations: Station[] = [];
  for (let i = 0; i <= resolution.stations; i++) {
    const p = pStart + ((pEnd - pStart) * i) / resolution.stations;
    stations.push(findStation(surface, frame, p, profile.xAt(p)));
  }

  // --- Recalage des portees longitudinales ---------------------------------
  // La portee doit tenir ENTIEREMENT en arriere de la coupe : si l'ancrage a
  // ete pose trop pres de la pointe, on le recule juste ce qu'il faut, puis
  // on verifie que la section l'accepte encore a sa nouvelle abscisse.
  for (const plan of plans) {
    if (!plan.valid || !isLongitudinal(plan.exit)) continue;
    const front = plan.exit === 'nose';
    const xCut = front ? stations[0].x : stations[stations.length - 1].x;
    const reach = Math.sqrt(Math.max(plan.seatRadius ** 2 - plan.seatDepth ** 2, 0)) + WALL;
    plan.center.x = front
      ? Math.max(plan.center.x, xCut + reach)
      : Math.min(plan.center.x, xCut - reach);

    const station = stationAt(stations, plan.center.x);
    if (!station) {
      plan.valid = false;
      plan.problem = 'Ancrage hors du corps.';
      continue;
    }
    const [tMin, tMax] = stationRange(surface, frame, station);
    const low = tMin + plan.seatRadius + WALL;
    const high = tMax - plan.seatRadius - WALL;
    if (low > high || maxBulge(surface, frame, station) < plan.seatDepth + WALL) {
      plan.valid = false;
      plan.problem = `La portee de ${plan.spec.loopWidth} mm ne tient pas si pres de la pointe.`;
      continue;
    }
    plan.center.y = Math.min(Math.max(plan.center.y, low), high);
  }

  // --- Logements engendres par les ancrages --------------------------------
  const pockets: Pocket[] = [];
  const maleSides: SideExit[] = [];
  const femaleSides: SideExit[] = [];
  const maleEnds: EndExit[] = [];
  const femaleEnds: EndExit[] = [];
  const tenonCircles: { center: THREE.Vector2; radius: number; height: number }[] = [];
  const previews: { center: THREE.Vector2; radius: number; depth: number }[] = [];
  const pins: PinPart[] = [];

  // Deux bouches ne peuvent pas se chevaucher : elles partagent les memes
  // stations et les faces de coupe se recouperaient.
  const taken: [number, number][] = [];
  const reserve = (iStart: number, iEnd: number): boolean => {
    for (const [a, b] of taken) if (iStart <= b + 1 && a - 1 <= iEnd) return false;
    taken.push([iStart, iEnd]);
    return true;
  };

  const rimLoAt = (index: number): number => {
    const station = stations[index];
    if (station.degenerate) return 0;
    return stationRange(surface, frame, station)[0];
  };

  for (const plan of plans) {
    if (!plan.valid) continue;
    const { center, seatRadius: R, seatDepth: d } = plan;
    const island =
      plan.collarRadius > 0.02 ? circleOutline(center, plan.collarRadius, 40) : undefined;
    const bore = {
      outline: circleOutline(center, plan.boreRadius, 40),
      depth: d + plan.tenonHeight,
    };

    if (isLongitudinal(plan.exit)) {
      const front = plan.exit === 'nose';
      const xCut = front ? stations[0].x : stations[stations.length - 1].x;
      const s = Math.sqrt(Math.max(R * R - d * d, (R * 0.2) ** 2));
      const tLo = center.y - d;
      const tHi = center.y + d;
      const jointX = front ? center.x - s : center.x + s;
      // Le grand arc contourne la portee du cote oppose a la sortie.
      const angleHi = Math.atan2(d, front ? -s : s);
      const angleLo = Math.atan2(-d, front ? -s : s);
      const path = front
        ? [
            new THREE.Vector2(xCut, tHi),
            new THREE.Vector2(jointX, tHi),
            ...arcPoints(center, R, angleHi, angleLo),
            new THREE.Vector2(jointX, tLo),
            new THREE.Vector2(xCut, tLo),
          ]
        : [
            new THREE.Vector2(xCut, tLo),
            new THREE.Vector2(jointX, tLo),
            ...arcPoints(center, R, angleLo, angleHi - Math.PI * 2),
            new THREE.Vector2(jointX, tHi),
            new THREE.Vector2(xCut, tHi),
          ];
      const common = { end: front ? ('front' as const) : ('rear' as const), tLo, tHi, depth: d, path };
      maleEnds.push({ ...common, island });
      femaleEnds.push({ ...common, bore });
    } else {
      const rail: 'lo' | 'hi' = plan.exit === 'belly' ? 'lo' : 'hi';
      let iStart = 0;
      while (iStart < stations.length - 1 && stations[iStart + 1].x <= center.x - d) iStart++;
      let iEnd = stations.length - 1;
      while (iEnd > 0 && stations[iEnd - 1].x >= center.x + d) iEnd--;
      if (iEnd < iStart + 2) {
        const middle = Math.round((iStart + iEnd) / 2);
        iStart = middle - 1;
        iEnd = middle + 1;
      }
      const aLo = center.x - stations[iStart].x;
      const aHi = stations[iEnd].x - center.x;
      if (
        iStart < 1 ||
        iEnd > stations.length - 2 ||
        Math.max(aLo, aHi) > R * 0.9 ||
        !reserve(iStart, iEnd)
      ) {
        plan.valid = false;
        plan.problem = 'Le passage de sortie ne tient pas ici : deplacez l ancrage.';
        continue;
      }
      // La bouche s'ouvre la ou la peau atteint la cote du canal. Si la
      // coque est deja plus mince que cela au bord interieur de l'encoche,
      // le passage mange plus de matiere que prevu et le maillage se croise.
      let room = Infinity;
      for (let i = iStart; i <= iEnd; i++) {
        const dx = stations[i].x - center.x;
        const edge = center.y + (rail === 'lo' ? -1 : 1) * Math.sqrt(Math.max(R * R - dx * dx, 0));
        const inner = edge + (rail === 'lo' ? 1 : -1) * 2 * WALL;
        room = Math.min(room, bulgeAtT(surface, frame, stations[i], inner));
      }
      if (room < d) {
        plan.valid = false;
        plan.problem = 'La coque est trop mince ici pour ouvrir le passage : reculez l ancrage.';
        continue;
      }
      const sLo = Math.sqrt(Math.max(R * R - aLo * aLo, 1e-6));
      const sHi = Math.sqrt(Math.max(R * R - aHi * aHi, 1e-6));
      const sign = rail === 'lo' ? -1 : 1;
      const angleStart = Math.atan2(sign * sLo, -aLo);
      const angleEnd = Math.atan2(sign * sHi, aHi);
      // Contourner par le cote oppose a la sortie : sinon l'arc traverse la
      // rainure et le contour se recoupe.
      const sweep = rail === 'lo' ? angleEnd - Math.PI * 2 : angleEnd + Math.PI * 2;
      const common = {
        rail,
        iStart,
        iEnd,
        path: arcPoints(center, R, angleStart, sweep),
        depth: d,
      };
      maleSides.push({ ...common, island });
      femaleSides.push({ ...common, bore });
    }

    tenonCircles.push({ center, radius: plan.tenonRadius, height: plan.tenonHeight });
    previews.push({ center, radius: R, depth: d });
    const world = frame.toWorld(center.y, 0);
    pins.push(
      buildPin(
        plan.spec,
        new THREE.Vector3(center.x, world.y, world.z),
        THREE.MathUtils.degToRad(params.assembly.planeAngle),
        EXIT_ANGLE[plan.exit],
      ),
    );
  }

  // --- Fente de bavette rapportee, debouchante -----------------------------
  // Le trace de la fente suit l'inclinaison de la bavette dans le plan
  // vertical : il n'a de sens que si le plan de joint est lui aussi vertical.
  // Sur un joint incline ou horizontal, la plaque se prend simplement entre
  // les deux coques et aucune fente n'est creusee (avertissement cote
  // simulation).
  if (params.hasBib && params.billMode === 'polycarbonate' && params.assembly.planeAngle < 25) {
    const slot = buildBillSlot(profile, params, surface, frame, stations, rimLoAt, reserve);
    if (slot?.kind === 'side') {
      maleSides.push(slot.exit);
      femaleSides.push(slot.exit);
    } else if (slot?.kind === 'pocket') {
      pockets.push(slot.pocket);
    }
  }

  // --- Logements de billes mobiles ----------------------------------------
  const rattles: AssemblyResult['rattles'] = [];
  let cavityVolume = 0;
  const clearance = (fabrication.rattleFit * MM_TO_CM) / 2;
  const STAINLESS = 7.9;

  const fitCavity = (station: Station, height: number, radius: number): THREE.Vector2 | null => {
    if (station.degenerate) return null;
    const [tMin, tMax] = stationRange(surface, frame, station);
    if (Math.min(maxBulge(surface, frame, station), (tMax - tMin) / 2) - WALL < radius) return null;
    const wanted = height >= 0 ? height * tMax : -height * tMin;
    const t = Math.min(Math.max(wanted, tMin + radius + WALL), tMax - radius - WALL);
    return new THREE.Vector2(station.x, t);
  };

  for (const item of params.rattles) {
    const p = Math.min(Math.max(item.position, 0.03), profile.bodyEnd - 0.03);
    const station = stationAt(stations, profile.xAt(p));
    if (!station) continue;
    const radius = (item.ball * MM_TO_CM) / 2 + clearance;
    const center = fitCavity(station, item.height, radius);
    if (!center) continue;
    pockets.push({
      outline: capsuleOutline(center, center, radius),
      depth: radius,
      dome: { a: center, b: center },
    });
    const world = frame.toWorld(center.y, 0);
    const ballRadius = (item.ball * MM_TO_CM) / 2;
    rattles.push({
      position: [center.x, world.y, world.z],
      radius: ballRadius,
      mass: (4 / 3) * Math.PI * ballRadius ** 3 * STAINLESS,
    });
    // Les deux coques creusent chacune une demi-sphere.
    cavityVolume += (4 / 3) * Math.PI * radius ** 3;
  }

  const chamber = params.chamber;
  if (chamber.enabled) {
    const radius = (chamber.diameter * MM_TO_CM) / 2;
    const pA = Math.min(Math.max(chamber.fromPosition, 0.03), profile.bodyEnd - 0.03);
    const pB = Math.min(Math.max(chamber.toPosition, 0.03), profile.bodyEnd - 0.03);
    const stationA = stationAt(stations, profile.xAt(pA));
    const stationB = stationAt(stations, profile.xAt(pB));
    const a = stationA ? fitCavity(stationA, chamber.fromHeight, radius) : null;
    const b = stationB ? fitCavity(stationB, chamber.toHeight, radius) : null;
    if (a && b && a.distanceTo(b) > radius * 0.3) {
      pockets.push({ outline: capsuleOutline(a, b, radius), depth: radius, dome: { a, b } });
      const length = a.distanceTo(b);
      cavityVolume += Math.PI * radius * radius * length + (4 / 3) * Math.PI * radius ** 3;
      const ballRadius = (chamber.ball * MM_TO_CM) / 2;
      const count = Math.max(1, Math.min(Math.round(chamber.balls), 6));
      for (let i = 0; i < count; i++) {
        const u = count === 1 ? 0.5 : 0.2 + (0.6 * i) / (count - 1);
        const point = a.clone().lerp(b, u);
        const world = frame.toWorld(point.y, 0);
        rattles.push({
          position: [point.x, world.y, world.z],
          radius: ballRadius,
          mass: (4 / 3) * Math.PI * ballRadius ** 3 * STAINLESS,
        });
      }
    }
  }

  // --- Coques ---------------------------------------------------------------
  const shared = {
    stations,
    pockets,
    cutFront,
    cutRear,
    arcSamples: resolution.arcSamples,
  };
  const male = buildShell(
    surface,
    frame,
    { ...shared, sideExits: maleSides, endExits: maleEnds },
    true,
  );
  const female = buildShell(
    surface,
    frame,
    { ...shared, sideExits: femaleSides, endExits: femaleEnds },
    false,
  );
  const tenons = buildTenonSolids(tenonCircles, frame);
  const socketPreview = buildSocketPreview(previews, frame);

  const normal = frame.toWorld(0, 1);
  const fallback = resolvePin(params);
  return {
    male,
    female,
    tenons,
    socketPreview,
    rattles,
    pins,
    sockets: plans.map((plan) => {
      const world = frame.toWorld(plan.center.y, 0);
      return {
        anchorId: plan.anchor.id,
        spec: plan.spec,
        center: plan.center,
        world: new THREE.Vector3(plan.center.x, world.y, world.z),
        tenonRadius: plan.tenonRadius,
        tenonHeight: plan.tenonHeight,
        seatRadius: plan.seatRadius,
        seatDepth: plan.seatDepth,
        method: plan.anchor.method,
        exit: plan.exit,
        valid: plan.valid,
        problem: plan.problem,
      };
    }),
    pinSpec: plans[0]?.spec ?? fallback,
    pinMass: pins.reduce((sum, pin) => sum + pin.mass, 0),
    cavityVolume,
    splitNormal: new THREE.Vector3(0, normal.y, normal.z).normalize(),
  };
}

/**
 * Fente d'insertion de la bavette rapportee.
 *
 * Elle DOIT deboucher : une bavette qui ne ressort pas du corps ne sert a
 * rien. Le trace est prolonge vers l'avant jusqu'a percer le bord du plan de
 * joint, et ce percement devient la bouche du logement — identique dans les
 * deux coques, comme sur la vue en coupe de reference.
 */
function buildBillSlot(
  profile: ProfileSampler,
  params: LureParams,
  surface: SurfaceSampler,
  frame: JointFrame,
  stations: Station[],
  rimLoAt: (index: number) => number,
  reserve: (iStart: number, iEnd: number) => boolean,
): { kind: 'side'; exit: SideExit } | { kind: 'pocket'; pocket: Pocket } | null {
  const rails = billRails(profile, params);
  const rear = rails.rear;
  const rearX = rear[0].x;

  // Stations reellement traversees par la fente.
  const inside = (index: number) => {
    const station = stations[index];
    if (station.degenerate) return false;
    const [tMin, tMax] = stationRange(surface, frame, station);
    return rails.top(station.x) < tMax - WALL && rails.bottom(station.x) > tMin;
  };

  let iRear = stations.length - 1;
  while (iRear > 0 && stations[iRear].x > rearX) iRear--;
  if (iRear < 3) return null;

  // iStart : premiere station (la plus avant) ou le rail haut repasse
  // au-dessus du bord — c'est la que la fente commence a mordre dans la
  // matiere. iEnd : premiere station, en reculant, ou le rail bas est lui
  // aussi rentre dans le corps ; au-dela, la fente est une poche ordinaire.
  let iStart = -1;
  for (let i = 0; i <= iRear; i++) {
    if (rails.top(stations[i].x) > rimLoAt(i) + WALL) {
      iStart = i;
      break;
    }
  }
  let iEnd = -1;
  for (let i = Math.max(iStart, 0) + 1; i <= iRear; i++) {
    if (rails.bottom(stations[i].x) >= rimLoAt(i) + WALL) {
      iEnd = i;
      break;
    }
  }

  // Profondeur : la largeur de la bavette, bornee par l'epaisseur disponible
  // le long de la fente, puis par l'epaisseur au bord interieur de la bouche
  // — au-dela, le logement percerait la peau sur toute la largeur.
  let depth = Math.max((params.bibWidth * MM_TO_CM) / 2, 0.12);
  for (let i = Math.max(iStart, 0); i <= iRear; i++) {
    if (stations[i].degenerate) continue;
    depth = Math.min(depth, maxBulge(surface, frame, stations[i]) - WALL);
  }
  if (iStart >= 0 && iEnd > iStart) {
    for (let i = iStart; i <= iEnd; i++) {
      const x = stations[i].x;
      const inner = (i === iEnd ? rails.bottom(x) : rails.top(x)) - 2 * WALL;
      depth = Math.min(depth, bulgeAtT(surface, frame, stations[i], inner));
    }
  }
  if (depth < 0.05) return null;

  const railPath = (from: number, to: number, top: boolean): THREE.Vector2[] => {
    const points: THREE.Vector2[] = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const x = from + ((to - from) * i) / steps;
      points.push(new THREE.Vector2(x, top ? rails.top(x) : rails.bottom(x)));
    }
    return points;
  };

  if (iStart >= 1 && iEnd > iStart + 1 && iEnd < iRear - 1 && inside(iRear) && reserve(iStart, iEnd)) {
    const xStart = stations[iStart].x;
    const xEnd = stations[iEnd].x;
    const path = [
      ...railPath(xStart, rearX, true),
      rear[0],
      rear[1],
      ...railPath(rearX, xEnd, false),
    ];
    return { kind: 'side', exit: { rail: 'lo', iStart, iEnd, path, depth } };
  }

  // Repli : la fente ne rencontre pas le bord (bavette tres inclinee, corps
  // tres epais). Elle reste une poche fermee, a ouvrir a la lime au montage.
  const front = Math.max(rails.tipX, stations[1].x);
  if (rearX - front < 0.1) return null;
  const outline = [
    ...railPath(front, rearX, true),
    rear[0],
    rear[1],
    ...railPath(rearX, front, false),
  ];
  return { kind: 'pocket', pocket: { outline, depth } };
}

/**
 * Portees seules, sans construire les coques : l'interface a besoin de savoir
 * quel ancrage est invalide a chaque frappe de slider, ce qui serait trop
 * couteux en reconstruisant tout le maillage.
 */
export function socketPlans(profile: ProfileSampler, params: LureParams): SocketPlan[] {
  if (!params.assembly.enabled) return [];
  const result = buildAssembly(profile, params, { stations: 40, arcSamples: 10 });
  result.male.dispose();
  result.female.dispose();
  result.tenons?.dispose();
  result.socketPreview?.dispose();
  for (const pin of result.pins) pin.geometry.dispose();
  return result.sockets;
}

/**
 * Convertit un point clique sur la surface en coordonnees d'ancrage.
 *
 * On stocke une position parametrique, pas un (x, y, z) brut : l'ancrage suit
 * alors la forme quand on la retaille au slider.
 */
export function worldToAnchor(
  profile: ProfileSampler,
  params: LureParams,
  point: THREE.Vector3,
): { position: number; height: number } {
  const frame = jointFrame(params.assembly.planeAngle);
  const surface = createSurfaceSampler(profile, params);
  const raw = (point.x - profile.xAt(0)) / Math.max(profile.lengthCm, 1e-6);
  const position = Math.min(Math.max(raw, 0.02), Math.max(profile.bodyEnd - 0.03, 0.05));

  const station = findStation(surface, frame, position, profile.xAt(position));
  const [tMin, tMax] = stationRange(surface, frame, station);
  const t = frame.transverseOf(point.y, point.z);
  let height = 0;
  if (t >= 0 && tMax > 1e-6) height = t / tMax;
  else if (t < 0 && tMin < -1e-6) height = -t / tMin;
  return { position, height: Math.min(Math.max(height, -1), 1) };
}

/** Sortie la plus naturelle pour un ancrage place a une position donnee. */
export function suggestExit(position: number, height: number): PinExit {
  if (position < 0.2) return 'nose';
  if (position > 0.8) return 'tail';
  return height >= 0 ? 'back' : 'belly';
}

/** Goujons males : cylindres fermes poses sur le plan de joint. */
function buildTenonSolids(
  tenons: { center: THREE.Vector2; radius: number; height: number }[],
  frame: JointFrame,
): THREE.BufferGeometry | null {
  if (tenons.length === 0) return null;
  const mesh = new MeshBuilder();
  const lift = (t: number, n: number, x: number) => {
    const { y, z } = frame.toWorld(t, n);
    return new THREE.Vector3(x, y, z);
  };
  for (const tenon of tenons) {
    const outline = contourOf(circleOutline(tenon.center, tenon.radius, 40));
    // Le goujon sort de la coque male : il occupe -height a 0.
    bossWall(mesh, outline, -tenon.height, 0, lift);
    fill(mesh, outline, [], (point) => lift(point.y, -tenon.height, point.x), true);
    fill(mesh, outline, [], (point) => lift(point.y, 0, point.x), false);
  }
  return mesh.build();
}

/**
 * Volume des portees, materialise pour l'affichage : sans cet apercu le
 * logement reste invisible puisqu'il est creuse dans le plan de joint.
 */
function buildSocketPreview(
  seats: { center: THREE.Vector2; radius: number; depth: number }[],
  frame: JointFrame,
): THREE.BufferGeometry | null {
  if (seats.length === 0) return null;
  const mesh = new MeshBuilder();
  const lift = (t: number, n: number, x: number) => {
    const { y, z } = frame.toWorld(t, n);
    return new THREE.Vector3(x, y, z);
  };
  for (const seat of seats) {
    const outline = contourOf(circleOutline(seat.center, seat.radius, 48));
    bossWall(mesh, outline, -seat.depth, seat.depth, lift);
    fill(mesh, outline, [], (point) => lift(point.y, seat.depth, point.x), false);
    fill(mesh, outline, [], (point) => lift(point.y, -seat.depth, point.x), true);
  }
  return mesh.build();
}
