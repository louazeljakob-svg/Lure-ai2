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
import { PINS, autoPin, buildPin, getPin, type PinPart, type PinSpec } from './hardware';
import { MM_TO_CM, type ProfileSampler } from './profile';
import { billSlotPlan, type BillRoomProbe, type BillSlotPlan } from './billTemplate';
import { buildDowelPins, planDowels, type DowelPlacement } from './dowels';
import {
  planThroughWire,
  throughWireBlocker,
  type ThroughWirePlan,
} from './throughWire';

const STATIONS = 112;
const ARC_SAMPLES = 40;

/** Epaisseur de matiere conservee autour d'un logement, en cm. */
const WALL = 0.06;

/**
 * Peau conservee entre la face exterieure du leurre et le fond d'un
 * logement : un demi-millimetre, quelle que soit la largeur locale du corps.
 */
const SKIN = 0.05;

/** Marge du contour de poche au-dela du puits, pour degager les rails. */
const LEDGE = 0.02;

/** Place a reserver autour d'une portee lors du controle de section. */
const LEDGE_ROOM = 0.1;

export interface AssemblyResolution {
  stations: number;
  arcSamples: number;
  /**
   * Cuit la trame d'ecailles dans la surface des coques.
   *
   * Faux a l'affichage : une ecaille d'un millimetre demanderait un maillage
   * dix fois plus dense, et l'editeur la montre en normal map. Vrai a
   * l'export, ou le relief doit exister pour de bon.
   */
  bakeScales?: boolean;
}

export const ASSEMBLY_DISPLAY: AssemblyResolution = {
  stations: STATIONS,
  arcSamples: ARC_SAMPLES,
};

/** Resolution reduite pour l'export STEP, ou chaque facette coute cher. */
export const ASSEMBLY_STEP: AssemblyResolution = { stations: 64, arcSamples: 24 };

/**
 * Resolution d'export STL : la trame d'ecailles y est cuite, et le maillage
 * s'epaissit assez pour la porter. La borne haute vaut mieux qu'un fichier
 * que la trancheuse mettra dix minutes a ouvrir.
 */
export function assemblyExport(params: LureParams): AssemblyResolution {
  if (!params.scales.enabled) return { ...ASSEMBLY_DISPLAY, bakeScales: true };
  const finest = Math.min(params.scales.width, params.scales.height) * MM_TO_CM;
  const lengthCm = params.length * MM_TO_CM;
  const girthCm = Math.PI * ((params.maxWidth + params.thickness) / 2) * MM_TO_CM;
  const step = Math.max(finest, 0.02) / 4;
  return {
    stations: Math.min(Math.max(Math.round(lengthCm / step), STATIONS), 720),
    arcSamples: Math.min(Math.max(Math.round(girthCm / step / 2), ARC_SAMPLES), 200),
    bakeScales: true,
  };
}

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
  /** Puits plus profond au fond de la poche : le logement de la boucle. */
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
  /** Demi-cote du canal de sortie, en cm. */
  channelHalf: number;
  seatRadius: number;
  seatDepth: number;
  method: SocketMethod;
  exit: PinExit;
  /** Faux si la portee sort du corps ou en chevauche une autre. */
  valid: boolean;
  problem: string | null;
  /** Vrai si la taille automatique a du descendre d'un cran pour tenir. */
  downsized: boolean;
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
  /** Plan du fil traversant, ou null si le montage n'est pas retenu. */
  throughWire: ThroughWirePlan | null;
  /** Goupilles modelisees, une par ancrage. */
  pins: PinPart[];
  sockets: SocketPlan[];
  /** Empreinte de bavette reellement creusee, apres arbitrage avec les portees. */
  billPlan: BillSlotPlan | null;
  /** Goupilles cylindriques d'assemblage, avec leur controle. */
  dowels: DowelPlacement[];
  /** Barreaux imprimes, poses a plat a cote des coques. */
  dowelPins: THREE.BufferGeometry | null;
  pinSpec: PinSpec;
  pinMass: number;
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
function bulgeOnArc(
  surface: SurfaceSampler,
  frame: JointFrame,
  station: Station,
  t: number,
  from: number,
  to: number,
): number {
  const at = (theta: number) => {
    const point = surface(station.p, theta);
    return {
      t: frame.transverseOf(point.y, point.z),
      n: Math.abs(frame.normalOf(point.y, point.z)),
    };
  };
  // La cote transverse est monotone d'un bord a l'autre de l'arc.
  let lo = from;
  let hi = to;
  const increasing = at(hi).t > at(lo).t;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid).t < t === increasing) lo = mid;
    else hi = mid;
  }
  return at((lo + hi) / 2).n;
}

function bulgeAtT(
  surface: SurfaceSampler,
  frame: JointFrame,
  station: Station,
  t: number,
): number {
  if (station.degenerate) return 0;
  return bulgeOnArc(surface, frame, station, t, station.theta1, station.theta2);
}

/**
 * Epaisseur de la coque la plus mince a cette cote transverse, en cm.
 *
 * Les deux demi-coques n'ont la meme epaisseur que si le plan de joint passe
 * par le centre de la section — vrai sur un joint vertical, faux des qu'il
 * s'incline. Un logement creuse a la meme profondeur des deux cotes doit
 * donc se regler sur la plus mince, sinon la paroi disparait d'un cote.
 */
function shellThickness(
  surface: SurfaceSampler,
  frame: JointFrame,
  station: Station,
  t: number,
): number {
  if (station.degenerate) return 0;
  return Math.min(
    bulgeOnArc(surface, frame, station, t, station.theta1, station.theta2),
    bulgeOnArc(surface, frame, station, t, station.theta2, station.theta1 + Math.PI * 2),
  );
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
  // Plusieurs encoches peuvent partager une meme face de coupe : une goupille
  // de nez et la fente de bavette, par exemple. Le contour les traverse dans
  // l'ordre ou il descend la ligne de coupe.
  const frontExits = input.endExits
    .filter((exit) => exit.end === 'front')
    .sort((a, b) => b.tHi - a.tHi);
  const rearExits = input.endExits
    .filter((exit) => exit.end === 'rear')
    .sort((a, b) => a.tLo - b.tLo);

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
  for (const exit of rearExits) contour.push(...exit.path);
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
  for (const exit of frontExits) contour.push(...exit.path);

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
  const emitCut = (index: number, front: boolean, notches: EndExit[]) => {
    const ring = rings[index];
    const section: THREE.Vector2[] = [];
    const lo = 0;
    const hi = arcSamples;
    section.push(new THREE.Vector2(ring.t[lo], 0));
    for (const notch of [...notches].sort((a, b) => a.tLo - b.tLo)) {
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
  if (input.cutFront) emitCut(0, true, frontExits);
  if (input.cutRear) emitCut(stations.length - 1, false, rearExits);

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
  exit: { depth: number; bore?: { outline: THREE.Vector2[]; depth: number } },
  planar: (n: number) => Lift,
  lift: Raise,
  skip: (index: number) => boolean,
): void {
  const bore = exit.bore ? contourOf(exit.bore.outline) : null;
  fill(mesh, outline, bore ? [bore] : [], planar(exit.depth), true);
  pocketWall(mesh, outline, 0, exit.depth, lift, skip);
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
// Assemblage
// ---------------------------------------------------------------------------

interface AnchorPlan {
  anchor: PinAnchor;
  spec: PinSpec;
  center: THREE.Vector2;
  /** Rayon du puits qui recoit la petite boucle de la goupille. */
  seatRadius: number;
  /** Profondeur du puits : epaisseur locale moins la peau conservee. */
  seatDepth: number;
  /** Demi-cote du canal de sortie : deux fois le diametre du cable. */
  channelHalf: number;
  tenonRadius: number;
  exit: PinExit;
  valid: boolean;
  problem: string | null;
  /** Vrai si la taille automatique a du descendre d'un cran pour tenir. */
  downsized: boolean;
}

/**
 * Rayon de l'empreinte reellement creusee par un ancrage, en cm.
 *
 * C'est le contour de poche qui compte, pas le puits : il englobe le canal de
 * sortie et sa collerette. Cette meme expression sert a l'emission, de sorte
 * que le test de chevauchement mesure exactement ce qui sera produit.
 */
const pocketReach = (plan: AnchorPlan): number =>
  Math.hypot(plan.seatRadius, plan.channelHalf) + LEDGE;

/** Goujon : un pilier qui traverse les deux puits et enfile la petite boucle. */
interface TenonSolid {
  center: THREE.Vector2;
  radius: number;
  /** Cotes extremes dans le repere de la coque male. */
  from: number;
  to: number;
}

/** Position parametrique correspondant a une abscisse, par iterations. */
function pAtX(profile: ProfileSampler, x: number): number {
  const length = Math.max(profile.lengthCm, 1e-6);
  let p = (x + profile.lengthCm / 2) / length;
  for (let i = 0; i < 4; i++) {
    p = Math.min(Math.max(p - (profile.xAt(p) - x) / length, 0), 1);
  }
  return p;
}

/**
 * Epaisseur disponible sous une portee : la plus faible mesuree sur son
 * emprise, des deux cotes du joint. C'est elle qui fixe la profondeur du
 * puits, moins la peau conservee.
 */
function seatRoom(
  surface: SurfaceSampler,
  frame: JointFrame,
  profile: ProfileSampler,
  x: number,
  t: number,
  radius: number,
  tMin: number,
  tMax: number,
): number {
  let room = Infinity;
  for (const dx of [-radius, 0, radius]) {
    const station = findStation(surface, frame, pAtX(profile, x + dx), x + dx);
    if (station.degenerate) return 0;
    for (const dt of [-radius * 0.8, 0, radius * 0.8]) {
      const probe = Math.min(Math.max(t + dt, tMin + 1e-3), tMax - 1e-3);
      room = Math.min(room, shellThickness(surface, frame, station, probe));
    }
  }
  return room;
}

/**
 * Epaisseur disponible sur toute la largeur d'une encoche de face de coupe.
 *
 * Mesurer au seul centre ne suffit pas : la coque s'amincit vers les bords de
 * l'encoche, et un fond plus profond que la peau ferait ressortir les coins
 * hors de la section.
 */
function notchRoom(
  surface: SurfaceSampler,
  frame: JointFrame,
  station: Station,
  tLo: number,
  tHi: number,
): number {
  let room = Infinity;
  for (let i = 0; i <= 4; i++) {
    room = Math.min(room, shellThickness(surface, frame, station, tLo + ((tHi - tLo) * i) / 4));
  }
  return room;
}

/** Vrai si un disque mord dans un polygone, contact tangent compris. */
function polygonMeetsDisc(
  polygon: THREE.Vector2[],
  centre: THREE.Vector2,
  radius: number,
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > centre.y !== b.y > centre.y) {
      const x = ((b.x - a.x) * (centre.y - a.y)) / (b.y - a.y) + a.x;
      if (centre.x < x) inside = !inside;
    }
    // Distance du centre au segment : un disque peut mordre un bord sans que
    // son centre soit dedans.
    const seg = new THREE.Vector2().subVectors(b, a);
    const len2 = seg.lengthSq();
    const s =
      len2 < 1e-12
        ? 0
        : Math.min(Math.max(new THREE.Vector2().subVectors(centre, a).dot(seg) / len2, 0), 1);
    if (new THREE.Vector2(a.x + seg.x * s, a.y + seg.y * s).distanceTo(centre) < radius) return true;
  }
  return inside;
}

/**
 * Ramene le chemin d'une encoche du cote matiere du plan de coupe.
 *
 * L'empreinte de la bavette est un pave incline : son fond est un plan
 * perpendiculaire a la plaque, pas au corps. Quand la coupe recule — un
 * passage de goupille de nez peut la repousser — un coin de ce fond ressort
 * devant la face de coupe et le contour se croise. On rabat donc le chemin
 * sur le plan : l'empreinte reste l'intersection exacte de la plaque et de
 * la coque, et la bande ouverte dans la face de coupe suit ce qu'il en reste.
 */
function clipEndPath(
  path: THREE.Vector2[],
  xCut: number,
  front: boolean,
): THREE.Vector2[] | null {
  const EPS = 1e-9;
  const inside = (p: THREE.Vector2) => (front ? p.x >= xCut - EPS : p.x <= xCut + EPS);
  const meet = (a: THREE.Vector2, b: THREE.Vector2) => {
    const span = b.x - a.x;
    const s = Math.abs(span) < EPS ? 0 : (xCut - a.x) / span;
    return new THREE.Vector2(xCut, a.y + (b.y - a.y) * s);
  };
  const out: THREE.Vector2[] = [];
  const push = (p: THREE.Vector2) => {
    const last = out[out.length - 1];
    if (last && last.distanceTo(p) < 1e-7) return;
    out.push(p);
  };
  for (let i = 0; i < path.length; i++) {
    const cur = path[i];
    if (i > 0 && inside(path[i - 1]) !== inside(cur)) push(meet(path[i - 1], cur));
    if (inside(cur)) push(cur);
  }
  // Deux points de suite sur le plan feraient une paroi la ou la face de
  // coupe est deja ouverte : on ne garde que l'extremite de la bande.
  const onCut = (p: THREE.Vector2) => Math.abs(p.x - xCut) < 1e-7;
  while (out.length > 2 && onCut(out[0]) && onCut(out[1])) out.shift();
  while (out.length > 2 && onCut(out[out.length - 1]) && onCut(out[out.length - 2])) out.pop();
  if (out.length < 3) return null;
  if (!onCut(out[0]) || !onCut(out[out.length - 1])) return null;
  // Le contour de la coque descend le bord haut avant d'atteindre la face
  // avant, et remonte le bord bas a l'arriere : le sens ne se devine pas.
  if (front ? out[0].y <= out[out.length - 1].y : out[0].y >= out[out.length - 1].y) return null;
  return out;
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

/**
 * Sonde d'epaisseur pour l'empreinte de bavette : la matiere disponible par
 * coque sur toute la largeur de la bande, peau comprise. C'est la meme mesure
 * que pour une encoche de passage, au meme endroit.
 */
function roomProbe(
  surface: SurfaceSampler,
  frame: JointFrame,
  profile: ProfileSampler,
): BillRoomProbe {
  return (x, tLo, tHi) => {
    const station = findStation(surface, frame, pAtX(profile, x), x);
    if (station.degenerate) return 0;
    const [tMin, tMax] = stationRange(surface, frame, station);
    if (tLo < tMin || tHi > tMax) return 0;
    return notchRoom(surface, frame, station, tLo, tHi);
  };
}

/**
 * Empreinte de bavette d'un leurre, mesuree sur la vraie surface.
 *
 * Le gabarit imprime, la masse et la fente creusee viennent tous de cet
 * appel : le trait d'enfoncement du DXF ne peut pas diverger de la fente.
 */
export function billPlanFor(
  profile: ProfileSampler,
  params: LureParams,
): BillSlotPlan | null {
  return buildAssembly(profile, params).billPlan;
}

export function buildAssembly(
  profile: ProfileSampler,
  params: LureParams,
  resolution: AssemblyResolution = ASSEMBLY_DISPLAY,
): AssemblyResult {
  const surface = createSurfaceSampler(profile, params, resolution.bakeScales === true);
  const frame = jointFrame(params.assembly.planeAngle);
  const fabrication = params.fabrication;

  // --- Cotes de chaque ancrage --------------------------------------------
  // Troncature d'une pointe : la station la plus avancee ou la section entoure
  // encore le canal. Elle decide aussi si une sortie par la pointe est tenable.
  const pointCut = (centerT: number, w: number, front: boolean): number | null => {
    const steps = 60;
    for (let i = 1; i <= steps; i++) {
      const p = front
        ? (0.3 * i) / steps
        : profile.bodyEnd - ((profile.bodyEnd * 0.3) * i) / steps;
      const station = findStation(surface, frame, p, profile.xAt(p));
      if (station.degenerate) continue;
      const [tMin, tMax] = stationRange(surface, frame, station);
      const fits =
        tMin + SKIN <= centerT - w &&
        centerT + w <= tMax - SKIN &&
        notchRoom(surface, frame, station, centerT - w, centerT + w) >= w + SKIN;
      if (fits) return p;
    }
    return null;
  };

  const plans: AnchorPlan[] = [];
  /**
   * Cote d'un ancrage pour une taille de goupille donnee.
   *
   * Rien n'est fige : la position se deduit de la longueur de la goupille,
   * le canal de son diametre de fil, la profondeur du puits de l'epaisseur
   * locale du corps. Changer de taille recalcule tout.
   */
  const sizeAnchor = (anchor: PinAnchor, spec: PinSpec) => {
    const wire = spec.wire * MM_TO_CM;
    const halfPin = (spec.length * MM_TO_CM) / 2;

    // Placement automatique : la position se deduit de la taille de goupille,
    // jamais d'un reglage libre. Nez et queue sont en retrait de la pointe
    // d'une demi-longueur de goupille et centres en hauteur ; ventre et dos
    // gardent leur position sur l'axe et se decalent d'une demi-longueur
    // depuis la face correspondante.
    let p: number;
    if (anchor.exit === 'nose') p = pAtX(profile, profile.xAt(0) + halfPin);
    else if (anchor.exit === 'tail') p = pAtX(profile, profile.xAt(profile.bodyEnd) - halfPin);
    else p = anchor.position;
    p = Math.min(Math.max(p, 0.02), profile.bodyEnd - 0.02);
    const x = profile.xAt(p);
    const station = findStation(surface, frame, p, x);

    // Canal de sortie : au moins deux fois le diametre du cable, quelle que
    // soit la taille de goupille. La regle est proportionnelle, jamais une
    // cote figee.
    const sweepRadius = Math.max(
      ((spec.wire + fabrication.sweepExtra) * MM_TO_CM) / 2,
      wire,
    );
    const channelHalf = anchor.method === 'channel' ? sweepRadius : wire;

    const loopOuter = (spec.loopWidth * MM_TO_CM) / 2;
    const loopCenterRadius = loopOuter - wire / 2;
    const loopInner = Math.max(loopOuter - spec.wire * MM_TO_CM, wire * 0.3);
    const tenonRadius = Math.max(loopInner - (fabrication.tenonFit * MM_TO_CM) / 2, 0.045);
    const seatRadius =
      anchor.method === 'bore'
        ? loopOuter + (fabrication.boreClearance * MM_TO_CM) / 2
        : loopCenterRadius + sweepRadius + fabrication.channelOffset * MM_TO_CM;

    let t = 0;
    let seatDepth = channelHalf;
    let valid = true;
    let problem: string | null = null;

    if (station.degenerate) {
      valid = false;
      problem = 'Ancrage hors du corps.';
    } else {
      const [tMin, tMax] = stationRange(surface, frame, station);
      t =
        anchor.exit === 'belly'
          ? tMin + halfPin
          : anchor.exit === 'back'
            ? tMax - halfPin
            : (tMin + tMax) / 2;
      // La collerette du puits demande un peu plus que le rayon de portee.
      const outer = seatRadius + LEDGE_ROOM;
      const low = tMin + outer + SKIN;
      const high = tMax - outer - SKIN;
      if (low > high) {
        valid = false;
        problem =
          `La portee de ${spec.loopWidth} mm demande ${(outer * 20).toFixed(1)} mm de hauteur et la section ` +
          `n en offre que ${((tMax - tMin) * 10).toFixed(1)} mm. Prenez une taille en dessous.`;
      } else {
        t = Math.min(Math.max(t, low), high);
        // Profondeur du puits : epaisseur locale moins 0,5 mm de peau,
        // mesuree sur toute l'emprise et sur la plus mince des deux coques.
        // Elle suit donc la largeur du corps au lieu d'etre figee.
        //
        // Un garde-fou : le puits ne descend jamais plus bas que sa propre
        // largeur. Au-dela il ne loge rien de plus et il ne reste qu'une
        // coquille de 0,5 mm — sur une cuiller large, la regle nue creuserait
        // dix millimetres de puits pour un fil d'un millimetre.
        const room = seatRoom(surface, frame, profile, x, t, seatRadius, tMin, tMax);
        const usable = Math.min(room - SKIN, seatRadius * 2);
        seatDepth = anchor.depth > 0 ? Math.min(anchor.depth * MM_TO_CM, room - SKIN) : usable;
        if (seatDepth < channelHalf) {
          valid = false;
          problem =
            `Coque trop mince : le canal demande ${(channelHalf * 20).toFixed(1)} mm et la peau n en laisse que ` +
            `${(Math.max(room - SKIN, 0) * 20).toFixed(1)} mm. Prenez une taille de goupille en dessous.`;
        }
      }
    }

    const center = new THREE.Vector2(x, t);
    // Une sortie par la pointe suppose que la pointe soit assez epaisse pour
    // entourer le canal : autant le savoir avant de retenir cette taille.
    if (valid && isLongitudinal(anchor.exit) && pointCut(center.y, channelHalf, anchor.exit === 'nose') === null) {
      valid = false;
      problem = 'La pointe est trop fine pour laisser sortir cette goupille.';
    }

    return {
      anchor,
      spec,
      center,
      seatRadius,
      seatDepth,
      channelHalf,
      tenonRadius,
      exit: anchor.exit,
      valid,
      problem,
      downsized: false,
    };
  };

  // Un fil traversant forme LUI-MEME ses boucles de nez et de queue : il n'y
  // a alors plus de goupille en 8 a ces deux endroits, et donc plus de puits.
  // Les ancrages ventraux et dorsaux, eux, restent des oeillets a part
  // entiere — voir la note du panneau Assemblage.
  const wireTakesEnds = params.throughWire.enabled && !throughWireBlocker(params);

  /**
   * Sorties ventrales du montage traversant.
   *
   * Elles ne sont PAS formees sur le fil : une boucle ventrale sortie du plan
   * de joint fendrait l'assemblage sur toute sa hauteur. Chaque sortie pose
   * donc un oeillet ventral a part entiere, a la cote du fil — et son mode de
   * rupture reste l'arrachement, ce que le simulateur dit ancrage par
   * ancrage plutot que de promettre un montage uniformement traversant.
   */
  const bellyAnchors: PinAnchor[] = wireTakesEnds
    ? params.throughWire.bellyPositions
        .slice(0, Math.max(Math.round(params.throughWire.bellyExits), 0))
        .map((position, index) => ({
          id: `wire-belly-${index}`,
          position: Math.min(Math.max(position, 0.12), 0.9),
          height: -0.6,
          exit: 'belly' as PinExit,
          depth: 0,
          pin: 'auto' as const,
          method: 'channel' as SocketMethod,
        }))
    : [];

  for (const anchor of [...params.assembly.anchors, ...bellyAnchors]) {
    const wanted = anchorPin(params, anchor);
    let plan = sizeAnchor(anchor, wanted);
    // Taille automatique : plutot qu'un message d'erreur, on descend le
    // catalogue jusqu'a la premiere goupille que le corps accepte. C'est
    // le propre du placement automatique — l'utilisateur n'a rien a regler.
    if (!plan.valid && anchor.pin === 'auto') {
      let index = PINS.findIndex((pin) => pin.id === wanted.id);
      let fitted = false;
      while (index > 0 && !fitted) {
        index -= 1;
        const smaller = sizeAnchor(anchor, PINS[index]);
        if (smaller.valid) {
          plan = { ...smaller, downsized: true };
          fitted = true;
        }
      }
      // Catalogue epuise : le corps est trop fin ici pour la plus petite
      // goupille. Inutile de conseiller une taille en dessous, il n'y en a pas.
      if (!fitted && wanted.id !== PINS[0].id) {
        plan.problem =
          'Aucune taille du catalogue ne tient a cet endroit : la section y est trop ' +
          'mince. Deplacez l ancrage ou epaississez le corps.';
      }
    }

    // Chevauchement : on compare les EMPREINTES reellement creusees, pas les
    // rayons de portee. Le contour d'une poche deborde du puits — il englobe
    // le canal de sortie et sa collerette —, et deux poches dont les puits
    // s'evitent peuvent tres bien se recouvrir. Le maillage s'ouvrait alors
    // sans que rien ne le signale.
    for (const other of plans) {
      if (!other.valid) continue;
      if (other.center.distanceTo(plan.center) < pocketReach(other) + pocketReach(plan) + SKIN) {
        plan.valid = false;
        plan.problem = 'Chevauchement avec une autre portee.';
      }
    }

    plans.push(plan);
  }

  // --- Troncature des extremites ------------------------------------------
  // Une sortie par le nez ou par la queue perce la pointe : le corps y est
  // coupe net, juste la ou la section devient trop mince pour entourer le
  // passage. La coupe mesure quelques dixiemes de millimetre.
  let pStart = 0;
  let pEnd = profile.bodyEnd;
  let cutFront = false;
  let cutRear = false;
  for (const plan of plans) {
    if (!plan.valid || !isLongitudinal(plan.exit)) continue;
    const front = plan.exit === 'nose';
    const cut = pointCut(plan.center.y, plan.channelHalf, front);
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
  // --- Fente de bavette : empreinte de la plaque ---------------------------
  // Le trace suit l'inclinaison de la bavette dans le plan vertical : il n'a
  // de sens que si le plan de joint est lui aussi vertical. La coupe imposee
  // par un passage de goupille de nez est connue : l'empreinte se mesure
  // depuis cette face-la, jamais depuis une pointe deja retiree.
  const bill =
    params.hasBib && params.billMode === 'polycarbonate' && params.assembly.planeAngle < 25
      ? billSlotPlan(profile, params, roomProbe(surface, frame, profile), pStart)
      : null;
  if (bill) {
    pStart = Math.max(pStart, bill.cutP);
    cutFront = true;
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
  // La portee doit tenir ENTIEREMENT en arriere de la coupe : si la coupe a
  // ete reculee par un autre logement, l'ancrage recule d'autant.
  const recale = (plan: AnchorPlan) => {
    const front = plan.exit === 'nose';
    const xCut = front ? stations[0].x : stations[stations.length - 1].x;
    const outer = plan.seatRadius + LEDGE_ROOM;
    const reach = Math.sqrt(Math.max(outer * outer - plan.channelHalf ** 2, 0)) + SKIN;
    plan.center.x = front
      ? Math.max(plan.center.x, xCut + reach)
      : Math.min(plan.center.x, xCut - reach);

    const station = stationAt(stations, plan.center.x);
    if (!station) {
      plan.valid = false;
      plan.problem = 'Ancrage hors du corps.';
      return;
    }
    const [tMin, tMax] = stationRange(surface, frame, station);
    const low = tMin + outer + SKIN;
    const high = tMax - outer - SKIN;
    if (low > high) {
      plan.valid = false;
      plan.problem = `La portee de ${plan.spec.loopWidth} mm ne tient pas si pres de la pointe.`;
      return;
    }
    plan.center.y = Math.min(Math.max(plan.center.y, low), high);
    const room = shellThickness(surface, frame, station, plan.center.y);
    plan.seatDepth = Math.min(plan.seatDepth, room - SKIN);
    if (plan.seatDepth < plan.channelHalf) {
      plan.valid = false;
      plan.problem =
        `Pointe trop mince : le canal de ${(plan.channelHalf * 20).toFixed(1)} mm n y tient pas. ` +
        'Prenez une taille de goupille en dessous.';
    }
  };
  for (const plan of plans) {
    if (!plan.valid || !isLongitudinal(plan.exit)) continue;
    recale(plan);
  }

  // --- Arbitrage entre la fente de bavette et les portees de pointe --------
  // Les deux visent la meme tete : la fente monte du menton vers l'arriere,
  // la portee est au centre. On rentre la plaque juste assez pour ne pas
  // mordre dans une portee ; si deux millimetres n'y suffisent pas, une
  // goupille de taille automatique descend d'un cran, et en dernier recours
  // c'est la fente qui l'emporte — l'ancrage fautif est alors signale.
  let billInsertion = bill ? bill.insertion : 0;
  if (bill) {
    const xCut = stations[0].x;
    const centre = bill.centreAt(xCut);
    const footprint = (insertion: number) => [
      new THREE.Vector2(xCut, centre + bill.halfBand),
      bill.along(-insertion, -bill.halfPlate),
      bill.along(-insertion, bill.halfPlate),
      new THREE.Vector2(xCut, centre - bill.halfBand),
    ];
    const hits = (insertion: number, plan: AnchorPlan) =>
      polygonMeetsDisc(footprint(insertion), plan.center, plan.seatRadius + LEDGE + SKIN);
    const clashing = () =>
      plans.filter(
        (plan) => plan.valid && isLongitudinal(plan.exit) && hits(billInsertion, plan),
      );

    const FLOOR = 0.2;
    while (billInsertion > FLOOR && clashing().length > 0) {
      billInsertion = Math.max(FLOOR, billInsertion - 0.02);
    }
    for (const plan of clashing()) {
      let index = plan.anchor.pin === 'auto' ? PINS.findIndex((pin) => pin.id === plan.spec.id) : 0;
      let saved = false;
      while (index > 0 && !saved) {
        index -= 1;
        const smaller = sizeAnchor(plan.anchor, PINS[index]);
        if (!smaller.valid) continue;
        recale(smaller);
        if (!smaller.valid || hits(billInsertion, smaller)) continue;
        Object.assign(plan, smaller, { downsized: true });
        saved = true;
      }
      if (!saved) {
        plan.valid = false;
        plan.problem =
          'La portee tombe dans la fente de bavette. Sortez cette goupille par le dos ou ' +
          'le ventre, ou reduisez la bavette.';
      }
    }
  }

  // --- Logements engendres par les ancrages --------------------------------
  const pockets: Pocket[] = [];
  const maleSides: SideExit[] = [];
  const femaleSides: SideExit[] = [];
  const maleEnds: EndExit[] = [];
  const femaleEnds: EndExit[] = [];
  const posts: TenonSolid[] = [];
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
  /** Encoches deja placees dans une face de coupe, pour eviter qu'elles se touchent. */
  const notched: { end: 'front' | 'rear'; tLo: number; tHi: number }[] = [];
  const freeNotch = (end: 'front' | 'rear', tLo: number, tHi: number): boolean => {
    for (const other of notched) {
      if (other.end === end && tLo <= other.tHi + SKIN && other.tLo - SKIN <= tHi) return false;
    }
    notched.push({ end, tLo, tHi });
    return true;
  };

  for (const plan of plans) {
    if (!plan.valid) continue;
    if (wireTakesEnds && isLongitudinal(plan.exit)) {
      plan.valid = false;
      plan.problem =
        'Le montage traversant forme lui-meme cette boucle : la goupille en 8 est inutile ici.';
      continue;
    }
    const { center, seatRadius: R, seatDepth, channelHalf: w } = plan;
    const well = { outline: circleOutline(center, R, 48), depth: seatDepth };

    if (isLongitudinal(plan.exit)) {
      const front = plan.exit === 'nose';
      const xCut = front ? stations[0].x : stations[stations.length - 1].x;
      const outer = Math.hypot(R, w) + LEDGE;
      const s = Math.sqrt(Math.max(outer * outer - w * w, (outer * 0.2) ** 2));
      const tLo = center.y - w;
      const tHi = center.y + w;
      if (!freeNotch(front ? 'front' : 'rear', tLo, tHi)) {
        plan.valid = false;
        plan.problem = 'Deux passages sortent au meme endroit de la pointe.';
        continue;
      }
      const jointX = front ? center.x - s : center.x + s;
      const angleHi = Math.atan2(w, front ? -s : s);
      const angleLo = Math.atan2(-w, front ? -s : s);
      const path = front
        ? [
            new THREE.Vector2(xCut, tHi),
            new THREE.Vector2(jointX, tHi),
            ...arcPoints(center, outer, angleHi, angleLo),
            new THREE.Vector2(jointX, tLo),
            new THREE.Vector2(xCut, tLo),
          ]
        : [
            new THREE.Vector2(xCut, tLo),
            new THREE.Vector2(jointX, tLo),
            ...arcPoints(center, outer, angleLo, angleHi - Math.PI * 2),
            new THREE.Vector2(jointX, tHi),
            new THREE.Vector2(xCut, tHi),
          ];
      const common = {
        end: front ? ('front' as const) : ('rear' as const),
        tLo,
        tHi,
        depth: w,
        path,
        bore: well,
      };
      maleEnds.push(common);
      femaleEnds.push(common);
    } else {
      const rail: 'lo' | 'hi' = plan.exit === 'belly' ? 'lo' : 'hi';
      let iStart = 0;
      while (iStart < stations.length - 1 && stations[iStart + 1].x <= center.x - w) iStart++;
      let iEnd = stations.length - 1;
      while (iEnd > 0 && stations[iEnd - 1].x >= center.x + w) iEnd--;
      if (iEnd < iStart + 2) {
        const middle = Math.round((iStart + iEnd) / 2);
        iStart = middle - 1;
        iEnd = middle + 1;
      }
      const aLo = center.x - stations[iStart].x;
      const aHi = stations[iEnd].x - center.x;
      // Le contour du puits doit passer au large des rails, sinon le percage
      // profond mordrait sur la paroi de la rainure.
      const outer = Math.hypot(R, Math.max(aLo, aHi)) + LEDGE;
      if (iStart < 1 || iEnd > stations.length - 2 || !reserve(iStart, iEnd)) {
        plan.valid = false;
        plan.problem = 'Le passage de sortie ne tient pas ici : deplacez l ancrage.';
        continue;
      }
      // La bouche s'ouvre la ou la peau atteint la cote du canal.
      let room = Infinity;
      for (let i = iStart; i <= iEnd; i++) {
        const dx = stations[i].x - center.x;
        const edge =
          center.y +
          (rail === 'lo' ? -1 : 1) * Math.sqrt(Math.max(outer * outer - dx * dx, 0));
        const inner = edge + (rail === 'lo' ? 1 : -1) * 2 * SKIN;
        room = Math.min(room, bulgeAtT(surface, frame, stations[i], inner));
      }
      if (room < w) {
        plan.valid = false;
        plan.problem = 'La coque est trop mince ici pour ouvrir le passage : deplacez l ancrage.';
        continue;
      }
      const sLo = Math.sqrt(Math.max(outer * outer - aLo * aLo, 1e-6));
      const sHi = Math.sqrt(Math.max(outer * outer - aHi * aHi, 1e-6));
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
        path: arcPoints(center, outer, angleStart, sweep),
        depth: w,
        bore: well,
      };
      maleSides.push(common);
      femaleSides.push(common);
    }

    // Goujon : un seul pilier traversant les deux puits, qui enfile la petite
    // boucle. Il s'arrete a un jeu d'emboitement du fond de la femelle.
    posts.push({
      center,
      radius: plan.tenonRadius,
      from: -(seatDepth - (fabrication.tenonFit * MM_TO_CM)),
      to: seatDepth,
    });
    previews.push({ center, radius: R, depth: seatDepth });
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

  // --- Fente de bavette, identique dans les deux coques --------------------
  let billResult: BillSlotPlan | null = bill;
  if (bill) {
    const xCut = stations[0].x;
    const centre = bill.centreAt(xCut);
    const path = clipEndPath(
      [
        new THREE.Vector2(xCut, centre + bill.halfBand),
        bill.along(-billInsertion, -bill.halfPlate),
        bill.along(-billInsertion, bill.halfPlate),
        new THREE.Vector2(xCut, centre - bill.halfBand),
      ],
      xCut,
      true,
    );
    billResult = null;
    if (path) {
      const tHi = path[0].y;
      const tLo = path[path.length - 1].y;
      const depth = Math.min(
        bill.depth,
        notchRoom(surface, frame, stations[0], tLo, tHi) - SKIN,
      );
      const [tMin, tMax] = stations[0].degenerate
        ? [0, 0]
        : stationRange(surface, frame, stations[0]);
      if (
        depth > 0.05 &&
        tHi - tLo > 0.02 &&
        tMin + SKIN <= tLo &&
        tHi <= tMax - SKIN &&
        freeNotch('front', tLo, tHi)
      ) {
        const exit: EndExit = { end: 'front', tLo, tHi, depth, path };
        maleEnds.push(exit);
        femaleEnds.push(exit);
        billResult = { ...bill, depth, insertion: billInsertion };
      }
    }
  }

  // --- Logements de billes mobiles ----------------------------------------
  const rattles: AssemblyResult['rattles'] = [];
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
  // --- Goupilles cylindriques d'assemblage --------------------------------
  // Elles alignent les deux coques pendant le collage. Leur logement est un
  // simple percage debouchant sur la face de joint : rien a voir avec le
  // logement en forme de 8, qui recoit la quincaillerie et reste intact.
  const dowelObstacles = [
    ...plans
      .filter((plan) => plan.valid)
      .map((plan) => ({
        center: plan.center,
        radius: pocketReach(plan),
        label: `la portee de ${EXIT_LABEL[plan.exit].toLowerCase()}`,
      })),
    ...rattles.map((ball) => ({
      center: new THREE.Vector2(ball.position[0], ball.position[1]),
      radius: ball.radius + WALL,
      label: 'un logement de bille',
    })),
  ];
  if (params.chamber.enabled) {
    const from = fitCavity(
      stationAt(stations, profile.xAt(params.chamber.fromPosition)) ?? stations[0],
      params.chamber.fromHeight,
      (params.chamber.diameter * MM_TO_CM) / 2,
    );
    const to = fitCavity(
      stationAt(stations, profile.xAt(params.chamber.toPosition)) ?? stations[0],
      params.chamber.toHeight,
      (params.chamber.diameter * MM_TO_CM) / 2,
    );
    for (const point of [from, to]) {
      if (point) {
        dowelObstacles.push({
          center: point,
          radius: (params.chamber.diameter * MM_TO_CM) / 2 + WALL,
          label: 'la chambre de bruit',
        });
      }
    }
  }

  const dowels = planDowels(
    profile,
    params,
    (x, t) => {
      const station = stationAt(stations, x);
      if (!station || station.degenerate) return 0;
      return shellThickness(surface, frame, station, t);
    },
    dowelObstacles,
  );

  for (const dowel of dowels) {
    if (!dowel.valid) continue;
    // Chanfrein d'entree : une collerette plus large sur la premiere fraction
    // de la profondeur, de quoi engager le barreau sans forcer.
    pockets.push({
      outline: circleOutline(dowel.center, dowel.bore + dowel.chamfer, 32),
      depth: dowel.chamfer,
      bore: {
        outline: circleOutline(dowel.center, dowel.bore, 32),
        depth: dowel.depth,
      },
    });
  }

  // --- Canal du montage traversant (module P) ------------------------------
  //
  // Une gorge demi-ronde dans chaque plan de joint : refermees l'une sur
  // l'autre, les deux gorges forment le passage du fil. C'est exactement la
  // mecanique des canaux de goupille, deja prouvee etanche — un montage
  // traversant n'a aucune raison de reinventer un percage.
  //
  // Le canal est pose APRES les ancrages et AVANT la construction des coques,
  // sans quoi il serait genere puis jamais emis : l'erreur classique de ce
  // fichier.
  let throughWirePlan: ThroughWirePlan | null = null;
  if (wireTakesEnds) {
    throughWirePlan = planThroughWire(params, profile.lengthCm);
    const r = throughWirePlan.channelRadius;
    // Le canal doit rester DANS la silhouette du plan de joint, avec sa
    // paroi. Pres des pointes la section se referme : au-dela d'un certain x
    // il n'y a plus la place d'un canal, et une poche qui deborde du contour
    // est ecartee en silence par la triangulation — le canal existerait alors
    // dans le code et nulle part dans la piece.
    const room = r + WALL;
    const fits = (station: Station): boolean => {
      if (station.degenerate) return false;
      const [tMin, tMax] = stationRange(surface, frame, station);
      return tMin + room < 0 && 0 < tMax - room;
    };
    let first = 0;
    while (first < stations.length && !fits(stations[first])) first++;
    let last = stations.length - 1;
    while (last > first && !fits(stations[last])) last--;

    const x0 = Math.max(throughWirePlan.from.x, stations[Math.min(first, last)].x + r);
    const x1 = Math.min(throughWirePlan.to.x, stations[last].x - r);
    if (last > first && x1 - x0 > r) {
      const a = new THREE.Vector2(x0, 0);
      const b = new THREE.Vector2(x1, 0);
      pockets.push({ outline: capsuleOutline(a, b, r), depth: r, dome: { a, b } });

      // Sorties de nez et de queue : une encoche rectangulaire dans la face
      // de coupe, exactement a la cote du canal, qui vient s'y raccorder.
      // C'est la meme mecanique que la fente de bavette — celle qui est
      // prouvee etanche sur toute la matrice.
      const endNotch = (end: 'front' | 'rear'): boolean => {
        const station = end === 'front' ? stations[0] : stations[stations.length - 1];
        if (station.degenerate) return false;
        const xCut = station.x;
        const inner = end === 'front' ? x0 : x1;
        const [tMin, tMax] = stationRange(surface, frame, station);
        if (tMin + SKIN > -r || r > tMax - SKIN) return false;
        if (!freeNotch(end, -r, r)) return false;
        const depth = Math.min(r, notchRoom(surface, frame, station, -r, r) - SKIN);
        if (depth <= 0.02) return false;
        const path =
          end === 'front'
            ? [
                new THREE.Vector2(xCut, r),
                new THREE.Vector2(inner, r),
                new THREE.Vector2(inner, -r),
                new THREE.Vector2(xCut, -r),
              ]
            : [
                new THREE.Vector2(xCut, -r),
                new THREE.Vector2(inner, -r),
                new THREE.Vector2(inner, r),
                new THREE.Vector2(xCut, r),
              ];
        const clipped = clipEndPath(path, xCut, end === 'front');
        if (!clipped) return false;
        const exit: EndExit = {
          end,
          tLo: Math.min(clipped[0].y, clipped[clipped.length - 1].y),
          tHi: Math.max(clipped[0].y, clipped[clipped.length - 1].y),
          depth,
          path: clipped,
        };
        maleEnds.push(exit);
        femaleEnds.push(exit);
        return true;
      };
      throughWirePlan.noseExit = endNotch('front');
      throughWirePlan.tailExit = endNotch('rear');
    }
  }

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
  const tenons = buildTenonSolids(posts, frame);
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
    throughWire: throughWirePlan,
    sockets: plans.map((plan) => {
      const world = frame.toWorld(plan.center.y, 0);
      return {
        anchorId: plan.anchor.id,
        spec: plan.spec,
        center: plan.center,
        world: new THREE.Vector3(plan.center.x, world.y, world.z),
        tenonRadius: plan.tenonRadius,
        channelHalf: plan.channelHalf,
        seatRadius: plan.seatRadius,
        seatDepth: plan.seatDepth,
        method: plan.anchor.method,
        exit: plan.exit,
        valid: plan.valid,
        problem: plan.problem,
        downsized: plan.downsized,
      };
    }),
    billPlan: billResult,
    dowels,
    dowelPins: buildDowelPins(dowels),
    pinSpec: plans[0]?.spec ?? fallback,
    pinMass: pins.reduce((sum, pin) => sum + pin.mass, 0),
    splitNormal: new THREE.Vector3(0, normal.y, normal.z).normalize(),
  };
}

/**
 * Portees seules, sans construire les coques : l'interface a besoin de savoir
 * quel ancrage est invalide a chaque frappe de slider, ce qui serait trop
 * couteux en reconstruisant tout le maillage.
 */
/**
 * Cotes de l'assemblage sans les maillages : de quoi renseigner l'interface
 * a chaque frappe, et placer la bavette fantome exactement dans sa fente.
 */

/**
 * Raison pour laquelle le corps ne peut pas etre coupe en deux coques, ou
 * null s'il le peut.
 *
 * Le decoupeur en deux coques repose sur deux invariants, et deux
 * nouveautes du module O les cassent chacune de leur cote. Plutot que de
 * produire des coques qui ne se refermeraient pas — le test montre huit a
 * deux cent soixante-quatre aretes libres selon le cas — on refuse la
 * combinaison et on dit pourquoi.
 */
export const assemblyActive = (params: LureParams): boolean =>
  params.assembly.enabled && assemblyBlocker(params) === null;

export function assemblyBlocker(params: LureParams): string | null {
  if (!params.assembly.enabled) return null;

  // Invariant 1 : chaque section est coupee en deux par le plan de joint.
  // Un joint horizontal partage le corps dos / ventre ; l'inclinaison de
  // tete deplace justement les sections vers le haut ou vers le bas, donc a
  // travers ce plan. Au-dela d'un certain angle, le plan ne traverse plus la
  // section du nez et la coque s'ouvre.
  if (Math.abs(params.noseAngle) > 0.5 && params.assembly.planeAngle > 45) {
    return `Un joint horizontal partage le corps dos / ventre, et l'inclinaison de tete (${params.noseAngle.toFixed(0)} deg) deplace les sections avant en travers de ce plan : le plan ne coupe plus chaque section en deux et les coques ne se referment pas. Passez le joint en vertical, ou ramenez l'angle de nez a zero.`;
  }

  // Invariant 2 : une station est un anneau a X constant. La face de popper
  // recule la peau SELON X, et d'une valeur qui depend de la position du
  // point dans la section : l'anneau n'est plus plan, et tout le contour du
  // plan de joint est construit dessus.
  if (params.popperFace.enabled && params.popperFace.depth > 0.05) {
    return "La face de popper recule la peau selon l'axe du leurre, d'une valeur qui change d'un point a l'autre de la section. Le decoupeur en deux coques suppose au contraire des sections planes : il ne sait pas construire le plan de joint sur une section creusee. Imprimez ce corps en une piece, ou desactivez la face de popper.";
  }

  return null;
}

export function assemblyPlans(
  profile: ProfileSampler,
  params: LureParams,
): { sockets: SocketPlan[]; billPlan: BillSlotPlan | null } {
  if (!assemblyActive(params)) return { sockets: [], billPlan: null };
  const result = buildAssembly(profile, params, { stations: 40, arcSamples: 10 });
  result.male.dispose();
  result.female.dispose();
  result.tenons?.dispose();
  result.socketPreview?.dispose();
  for (const pin of result.pins) pin.geometry.dispose();
  return { sockets: result.sockets, billPlan: result.billPlan };
}

export function socketPlans(profile: ProfileSampler, params: LureParams): SocketPlan[] {
  return assemblyPlans(profile, params).sockets;
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
  tenons: TenonSolid[],
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
    // Le pilier part du fond du puits male et traverse jusqu'au fond du puits
    // femelle, a un jeu d'emboitement pres.
    bossWall(mesh, outline, tenon.from, tenon.to, lift);
    fill(mesh, outline, [], (point) => lift(point.y, tenon.from, point.x), true);
    fill(mesh, outline, [], (point) => lift(point.y, tenon.to, point.x), false);
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
