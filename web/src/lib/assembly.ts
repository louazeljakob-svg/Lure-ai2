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
import { warpArc } from './anatomy';
import { articulationPlan, type ArticulationPlan } from './articulation';
import { PINS, autoPin, buildPin, getPin, type PinPart, type PinSpec } from './hardware';
import { MM_TO_CM, type ProfileSampler } from './profile';
import {
  billSlotPlan,
  type BillRangeProbe,
  type BillRoomProbe,
  type BillSlotPlan,
} from './billTemplate';
import { buildDowelPins, planDowels, type DowelPlacement } from './dowels';
import { planScrews, type ScrewPlan } from './screws';
import { softTailSlot } from './insert';
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
    // Un triangle dont deux sommets sont confondus polluerait la topologie
    // sans rien fermer. Un triangle PLAT a trois sommets distincts, lui, est
    // necessaire : quand trois points du contour sont alignes — un ventre
    // rectiligne sur quelques stations —, la triangulation le produit et ses
    // aretes sont celles qu'attend la peau voisine. L'ecarter ouvrirait la
    // coque le long de l'alignement.
    const wx = c.x - b.x;
    const wy = c.y - b.y;
    const wz = c.z - b.z;
    const tiny = 1e-18;
    if (
      ux * ux + uy * uy + uz * uz < tiny ||
      vx * vx + vy * vy + vz * vz < tiny ||
      wx * wx + wy * wy + wz * wz < tiny
    ) {
      return;
    }
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
   * `depth` d'axe [a, b]. C'est la forme de la chambre de bruit.
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
  /**
   * Puits plus profonds au fond de la poche.
   *
   * Un passage de goupille n'en a qu'un — le logement de la boucle. Un
   * passage de vis en a deux : le lamage de tete et la portee d'ecrou, a des
   * cotes differentes, dans une meme fente.
   */
  bores?: { outline: THREE.Vector2[]; depth: number }[];
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
  /** Puits plus profonds au fond de la poche. */
  bores?: { outline: THREE.Vector2[]; depth: number }[];
  /** Profil de l'encoche dans la face de coupe, (t, n), bornes comprises. */
  profile?: THREE.Vector2[];
  /** Logement de charniere d'une face en V : il remplace la poche simple. */
  hinge?: HingeSpec;
}

/**
 * Logement de charniere dans une face de joint en V (demi-coque de segment).
 *
 * Deux caissons fendus dans le plan de joint : la fente de la quincaillerie
 * (bande `slot`, profondeur `slotDepth` hors du plan) et la portee du
 * cylindre de retention (bande `seat`, plus haute et moins profonde). Les
 * deux s'ouvrent sur la face en V et reculent de `reach` dans le segment.
 * Les caissons englobent le secteur balaye par la quincaillerie : ils ne
 * peuvent que degager davantage, jamais coincer.
 */
interface HingeSpec {
  /** Abscisse de la ligne de coupe dans le plan de joint. */
  x0: number;
  /** +1 si le segment est en arriere de la coupe, -1 s'il est devant. */
  dir: 1 | -1;
  reach: number;
  slot: [number, number];
  slotDepth: number;
  seat: [number, number] | null;
  seatDepth: number;
}

/** Face de joint en V : x = x0 - |n| . tan, pour les points de la ligne de coupe. */
interface VFace {
  x0: number;
  tan: number;
}

/**
 * Fente de bavette debouchant au menton, sans tronquer le nez.
 *
 * La plaque entre par le ventre : sur les quelques millimetres ou la tete est
 * plus mince que la plaque, la bande est ouverte de part en part — c'est la
 * bouche. Des que la tete peut porter la fente, une poche fermee prend le
 * relais jusqu'au fond plat. Le nez, lui, reste entier : rien n'est coupe
 * au-dela de l'emprise de la plaque.
 */
interface ChinSlot {
  /** Premiere station ou la bande mord dans la matiere. */
  iStart: number;
  /** Station ou la poche fermee commence : la bouche s'y termine. */
  iEnd: number;
  /** Arete haute de la bande, station par station de `iStart` a `iEnd`. */
  topT: number[];
  /** Arete basse de la bande a la station `iEnd`. */
  baseT: number;
  /** Profondeur laterale de la poche, par coque. */
  depth: number;
  /** Les deux coins du fond ferme, dans le plan de joint. */
  back: [THREE.Vector2, THREE.Vector2];
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
  /** Billes libres de la chambre de bruit, pour la masse et l'affichage. */
  rattles: { position: [number, number, number]; radius: number; mass: number }[];
  /** Plan du fil traversant, ou null si le montage n'est pas retenu. */
  throughWire: ThroughWirePlan | null;
  /** Goupilles modelisees, une par ancrage. */
  pins: PinPart[];
  sockets: SocketPlan[];
  /** Empreinte de bavette reellement creusee, apres arbitrage avec les portees. */
  billPlan: BillSlotPlan | null;
  /** Pourquoi la fente de bavette est absente ou reduite, le cas echeant. */
  billProblem: string | null;
  /** Goupilles cylindriques d'assemblage, avec leur controle. */
  dowels: DowelPlacement[];
  /** Vis d'assemblage et leur controle (module U). */
  screws: ScrewPlan[];
  /** Ergots d'alignement coniques, places ou refuses avec leur raison. */
  pegs: PegPlacement[];
  /**
   * Joint d'un leurre articule en demi-coques, portee du cylindre recalee sur
   * la matiere reellement disponible ; null si le leurre n'est pas articule.
   */
  jointPlan: ArticulationPlan | null;
  /** Pourquoi le logement de charniere n'a pas pu etre creuse, le cas echeant. */
  jointProblem: string | null;
  /** Pourquoi la fente de la queue rapportee n'a pas pu etre creusee. */
  tailSlotProblem: string | null;
  /** Gorge de colle : troncons creuses et interruptions, ou null si inactive. */
  glueGroove: GlueGrooveReport | null;
  /** Barreaux imprimes, poses a plat a cote des coques. */
  dowelPins: THREE.BufferGeometry | null;
  pinSpec: PinSpec;
  pinMass: number;
  /** Direction d'ecartement pour la vue eclatee. */
  splitNormal: THREE.Vector3;
}

export interface PegPlacement {
  /** Centre dans le plan de joint, en cm. */
  center: THREE.Vector2;
  /** Distance au nez, en mm. */
  fromNoseMm: number;
  valid: boolean;
  problem: string | null;
}

export interface GlueGrooveReport {
  /** Nombre de troncons creuses. */
  segments: number;
  /** Longueur totale creusee, par coque, en mm. */
  lengthMm: number;
  /** Interruptions, chacune avec sa position et sa raison. */
  interruptions: string[];
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

/**
 * Epaisseur de coque tabulee pour une station : les deux arcs echantillonnes
 * une fois, puis interpoles. Les placements automatiques (ergots, gorge de
 * colle) sondent des dizaines de hauteurs par station ; une bisection a
 * chaque sonde rendait le curseur lourd.
 */
function thicknessTable(
  surface: SurfaceSampler,
  frame: JointFrame,
  station: Station,
): (t: number) => number {
  if (station.degenerate) return () => 0;
  const arcs = [
    [station.theta1, station.theta2],
    [station.theta2, station.theta1 + Math.PI * 2],
  ].map(([from, to]) => {
    const samples: { t: number; n: number }[] = [];
    for (let k = 0; k <= 96; k++) {
      const point = surface(station.p, from + ((to - from) * k) / 96);
      samples.push({
        t: frame.transverseOf(point.y, point.z),
        n: Math.abs(frame.normalOf(point.y, point.z)),
      });
    }
    return samples.sort((a, b) => a.t - b.t);
  });
  const at = (samples: { t: number; n: number }[], t: number) => {
    if (t <= samples[0].t || t >= samples[samples.length - 1].t) return 0;
    let lo = 0;
    let hi = samples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = samples[lo];
    const b = samples[hi];
    const f = (t - a.t) / Math.max(b.t - a.t, 1e-12);
    return a.n + (b.n - a.n) * f;
  };
  return (t) => Math.min(at(arcs[0], t), at(arcs[1], t));
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
  warp: boolean,
): Ring {
  const [from, to] = arcRange(surface, frame, station, maleSide);
  const points: THREE.Vector3[] = [];
  const t: number[] = [];
  const n: number[] = [];
  for (let j = 0; j <= arcSamples; j++) {
    // Corps anatomique : les echantillons se resserrent aux deux bords de
    // l'arc, la ou le plan de joint tranche la crete dorsale et la carene.
    const s = j / arcSamples;
    const theta = from + (to - from) * (warp && j > 0 && j < arcSamples ? warpArc(s) : s);
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

/**
 * Premier echantillon, depuis le bord bas, dont la cote transverse atteint
 * `t`. La bouche de la fente de bavette est donc toujours au moins aussi
 * haute que la bande de la plaque : la plaque ne peut pas y coincer.
 */
function rankAtT(ring: Ring, t: number, arcSamples: number): number | null {
  for (let j = 1; j <= arcSamples - 2; j++) if (ring.t[j] >= t) return j;
  return null;
}

// ---------------------------------------------------------------------------
// Construction d'une coque
// ---------------------------------------------------------------------------

interface ShellInput {
  /** Resserre les echantillons d'arc aux bords du plan de joint (corps anatomique). */
  warp: boolean;
  stations: Station[];
  pockets: Pocket[];
  sideExits: SideExit[];
  endExits: EndExit[];
  /** Extremites reellement tronquees : une face de coupe y est necessaire. */
  cutFront: boolean;
  cutRear: boolean;
  arcSamples: number;
  chinSlots: ChinSlot[];
  /** Ergots coniques : plot sur la coque male, logement en vis-a-vis sur la femelle. */
  pegs: PegSolid[];
  /** Face de joint en V a l'avant de la coque (segment arriere). */
  vFront?: VFace;
  /** Face de joint en V a l'arriere de la coque (segment avant). */
  vRear?: VFace;
}

/** Ergot d'alignement, en coordonnees du plan de joint. */
interface PegSolid {
  center: THREE.Vector2;
  /** Rayon a la base, en cm. */
  base: number;
  /** Rayon au sommet, en cm. */
  top: number;
  /** Hauteur hors du plan de joint, en cm. */
  height: number;
  /** Jeu radial et axial du logement femelle, en cm. */
  clearance: number;
}

/**
 * Paroi reglee entre deux contours de meme nombre de sommets.
 *
 * `boss` = vrai pour un plot (normale vers l'exterieur du plot), faux pour
 * un logement (normale vers le vide du logement). C'est la generalisation
 * conique de `bossWall` et `pocketWall`.
 */
function taperWall(
  mesh: MeshBuilder,
  upper: THREE.Vector2[],
  nUpper: number,
  lower: THREE.Vector2[],
  nLower: number,
  lift: Raise,
  boss: boolean,
): void {
  for (let i = 0; i < upper.length; i++) {
    const j = (i + 1) % upper.length;
    const aT = lift(upper[i].y, nUpper, upper[i].x);
    const bT = lift(upper[j].y, nUpper, upper[j].x);
    const aB = lift(lower[i].y, nLower, lower[i].x);
    const bB = lift(lower[j].y, nLower, lower[j].x);
    if (boss) mesh.quad(aT, bT, bB, aB);
    else mesh.quad(aT, aB, bB, bT);
  }
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
  // Sur un segment articule, la ligne de coupe du plan de joint est l'arete
  // du V : tout point pose sur elle est reporte sur la face inclinee, a sa
  // cote n. La face de coupe, les parois du logement et le bord de peau
  // tombent ainsi exactement sur le meme plan.
  const snap = (x: number, n: number): number => {
    const a = Math.abs(n);
    if (input.vRear && Math.abs(x - input.vRear.x0) < 1e-9) return input.vRear.x0 - a * input.vRear.tan;
    if (input.vFront && Math.abs(x - input.vFront.x0) < 1e-9) return input.vFront.x0 - a * input.vFront.tan;
    return x;
  };
  const lift = (t: number, n: number, x: number): THREE.Vector3 => {
    const { y, z } = frame.toWorld(t, maleSide ? n : -n);
    return new THREE.Vector3(snap(x, n), y, z);
  };
  /** Releve un point (x, t) du plan de joint a la cote n. */
  const planar = (n: number): Lift => (point) => lift(point.y, n, point.x);
  /** Releve un point (t, n) d'une section transversale a l'abscisse x. */
  const cross = (x: number): Lift => (point) => lift(point.x, point.y, x);

  const rings = stations.map((station) =>
    buildRing(surface, frame, station, maleSide, arcSamples, input.warp),
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

  // --- Bouches de fente de bavette ----------------------------------------
  // Le rang de rognage suit l'arete haute de la bande, station par station :
  // la bouche est une fente inclinee, pas une fenetre rectangulaire. On le
  // rend croissant, car la bande ne peut que monter en s'enfoncant.
  interface ChinCut {
    slot: ChinSlot;
    rank: number[];
  }
  const chinCuts: ChinCut[] = [];
  const chinStrip = new Set<number>();
  for (const slot of input.chinSlots) {
    if (slot.iStart < 1 || slot.iEnd <= slot.iStart || slot.iEnd >= stations.length) continue;
    // Un fond qui deborde devant la bouche donnerait une poche croisee.
    const xMouth = stations[slot.iEnd].x;
    if (slot.back[0].x < xMouth - 1e-9 || slot.back[1].x < xMouth - 1e-9) continue;
    const rank: number[] = [];
    let ok = true;
    for (let k = 0; ok && k <= slot.iEnd - slot.iStart; k++) {
      const ring = rings[slot.iStart + k];
      const found = rankAtT(ring, slot.topT[k], arcSamples);
      if (found === null || ring.t[found] <= ring.t[0] + 1e-4) ok = false;
      else rank.push(Math.max(found, rank[k - 1] ?? 1));
    }
    if (ok) {
      const ring = rings[slot.iEnd];
      const last = rank[rank.length - 1];
      if (
        ring.n[last] < slot.depth + 1e-4 ||
        slot.baseT <= ring.t[0] + 1e-4 ||
        slot.baseT >= ring.t[last] - 1e-4
      ) {
        ok = false;
      }
    }
    if (!ok) continue;
    chinCuts.push({ slot, rank });
    for (let i = slot.iStart; i < slot.iEnd; i++) chinStrip.add(i);
  }

  // --- Peau ----------------------------------------------------------------
  for (let i = 0; i < stations.length - 1; i++) {
    if (chinStrip.has(i)) continue;
    const a = rings[i];
    const b = rings[i + 1];
    const start = Math.max(a.clipStart, b.clipStart);
    const end = Math.min(a.clipEnd, b.clipEnd);
    for (let j = start; j < end; j++) {
      mesh.quad(a.points[j], b.points[j], b.points[j + 1], a.points[j + 1]);
    }
  }

  // --- Peau et parois au droit d'une fente de bavette ----------------------
  for (const { slot, rank } of chinCuts) {
    const jointAt = (i: number, j: number) => lift(rings[i].t[j], 0, stations[i].x);
    for (let k = 0; k < slot.iEnd - slot.iStart; k++) {
      const i = slot.iStart + k;
      const a = rings[i];
      const b = rings[i + 1];
      const sa = rank[k];
      const sb = rank[k + 1];
      const end = Math.min(a.clipEnd, b.clipEnd);
      for (let j = Math.max(sa, sb); j < end; j++) {
        mesh.quad(a.points[j], b.points[j], b.points[j + 1], a.points[j + 1]);
      }
      // Les deux stations ne rognent pas au meme rang : l'eventail referme le
      // decalage sans laisser de T-jonction.
      for (let j = sa; j < sb; j++) mesh.triangle(a.points[j], b.points[sb], a.points[j + 1]);
      for (let j = sb; j < sa; j++) mesh.triangle(a.points[sa], b.points[j], b.points[j + 1]);
      // Paroi haute de la bouche : du plan de joint a la peau, normale vers
      // le vide de la fente. A la derniere station elle se scinde a la cote
      // du fond de poche, sinon l'arete ne s'apparierait pas avec la face de
      // reprise de matiere.
      const a0 = jointAt(i, sa);
      const a1 = a.points[sa];
      const b0 = jointAt(i + 1, sb);
      const b1 = b.points[sb];
      if (k === slot.iEnd - slot.iStart - 1) {
        const bm = lift(b.t[sb], slot.depth, stations[i + 1].x);
        mesh.triangle(a0, b0, bm);
        mesh.triangle(a0, bm, b1);
        mesh.triangle(a0, b1, a1);
      } else {
        mesh.quad(a0, b0, b1, a1);
      }
    }

    // Face avant de la bouche : la matiere s'arrete la, la fente s'ouvre.
    const head = rings[slot.iStart];
    const front: THREE.Vector2[] = [new THREE.Vector2(head.t[0], 0)];
    for (let j = 0; j <= rank[0]; j++) front.push(new THREE.Vector2(head.t[j], head.n[j]));
    front.push(new THREE.Vector2(head.t[rank[0]], 0));
    fill(mesh, contourOf(front), [], cross(stations[slot.iStart].x), false);

    // Face arriere : la matiere reprend, moins la section de la poche.
    const tail = rings[slot.iEnd];
    const last = rank[rank.length - 1];
    const back: THREE.Vector2[] = [new THREE.Vector2(tail.t[0], 0)];
    for (let j = 0; j <= last; j++) back.push(new THREE.Vector2(tail.t[j], tail.n[j]));
    back.push(new THREE.Vector2(tail.t[last], slot.depth));
    back.push(new THREE.Vector2(slot.baseT, slot.depth));
    back.push(new THREE.Vector2(slot.baseT, 0));
    fill(mesh, contourOf(back), [], cross(stations[slot.iEnd].x), true);

    // Poche fermee : fond plat, parois sur tout le pourtour sauf la bouche.
    const path = [
      new THREE.Vector2(stations[slot.iEnd].x, tail.t[last]),
      slot.back[0],
      slot.back[1],
      new THREE.Vector2(stations[slot.iEnd].x, slot.baseT),
    ];
    const marked = ringMarked(
      path,
      path.map((_, i) => i === 0 || i === path.length - 1),
    );
    emitCavity(mesh, marked.outline, { depth: slot.depth }, planar, lift, marked.skip);
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
    // La fente de bavette detourne le contour du ventre : il monte a l'arete
    // haute de la bande, la suit jusqu'a la poche, en fait le tour, puis
    // redescend au ventre. Tout ce qui est entre les deux est ouvert.
    const chin = chinCuts.find((candidate) => candidate.slot.iStart === i);
    if (chin) {
      contour.push(rimLo(i));
      for (let k = 0; k <= chin.slot.iEnd - chin.slot.iStart; k++) {
        const station = chin.slot.iStart + k;
        contour.push(new THREE.Vector2(stations[station].x, rings[station].t[chin.rank[k]]));
      }
      contour.push(chin.slot.back[0], chin.slot.back[1]);
      contour.push(new THREE.Vector2(stations[chin.slot.iEnd].x, chin.slot.baseT));
      contour.push(rimLo(chin.slot.iEnd));
      i = chin.slot.iEnd + 1;
      continue;
    }
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
  // Ergots : sur la male, un cone tronque qui sort du plan de joint ; sur la
  // femelle, son logement conique, majore du jeu sur toutes les faces.
  const PEG_STEPS = 40;
  const pegRings: { base: THREE.Vector2[]; top: THREE.Vector2[]; peg: PegSolid }[] = [];
  for (const peg of input.pegs) {
    const grow = maleSide ? 0 : peg.clearance;
    const base = contourOf(circleOutline(peg.center, peg.base + grow, PEG_STEPS));
    const top = contourOf(circleOutline(peg.center, peg.top + grow, PEG_STEPS));
    if (base.length !== PEG_STEPS || top.length !== PEG_STEPS) continue;
    if (!triangulateChecked(outlineOf, [...holes, [...base].reverse()])) continue;
    holes.push(base);
    pegRings.push({ base, top, peg });
  }

  fill(mesh, outlineOf, holes, planar(0), true);

  for (const { base, top, peg } of pegRings) {
    if (maleSide) {
      // Le plot monte vers -n, hors de la matiere de la coque male.
      taperWall(mesh, top, -peg.height, base, 0, lift, true);
      fill(mesh, top, [], planar(-peg.height), true);
    } else {
      const depth = peg.height + peg.clearance;
      taperWall(mesh, base, 0, top, depth, lift, false);
      fill(mesh, top, [], planar(depth), true);
    }
  }

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
      if (notch.profile) {
        section.push(...notch.profile);
        continue;
      }
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
    if (exit.hinge) {
      emitHinge(mesh, exit.hinge, planar, lift);
      continue;
    }
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
  exit: { depth: number; bores?: { outline: THREE.Vector2[]; depth: number }[] },
  planar: (n: number) => Lift,
  lift: Raise,
  skip: (index: number) => boolean,
): void {
  const wells = (exit.bores ?? []).map((well) => ({
    outline: contourOf(well.outline),
    depth: well.depth,
  }));
  fill(mesh, outline, wells.map((well) => well.outline), planar(exit.depth), true);
  pocketWall(mesh, outline, 0, exit.depth, lift, skip);
  for (const well of wells) {
    pocketWall(mesh, well.outline, exit.depth, well.depth, lift);
    fill(mesh, well.outline, [], planar(well.depth), true);
  }
}

/**
 * Logement de charniere : parois, fonds et contremarches des deux caissons.
 *
 * Chaque arete verticale est coupee a toutes les cotes ou une paroi voisine
 * change de hauteur : c'est ce qui evite les jonctions en T entre la fente
 * (profonde) et la portee du cylindre (moins profonde).
 */
function emitHinge(
  mesh: MeshBuilder,
  hinge: HingeSpec,
  planar: (n: number) => Lift,
  lift: Raise,
): void {
  const { x0, dir, reach, slot, slotDepth: hA, seat, seatDepth: hB } = hinge;
  const xb = x0 + dir * reach;
  const V = (x: number, t: number) => new THREE.Vector2(x, t);
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const wall = (outline: THREE.Vector2[], levels: (a: THREE.Vector2, b: THREE.Vector2) => number[] | null) => {
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      const cuts = levels(a, b);
      if (!cuts) continue;
      for (let k = 0; k + 1 < cuts.length; k++) {
        mesh.quad(
          lift(a.y, cuts[k], a.x),
          lift(a.y, cuts[k + 1], a.x),
          lift(b.y, cuts[k + 1], b.x),
          lift(b.y, cuts[k], b.x),
        );
      }
    }
  };
  const mouth = (a: THREE.Vector2, b: THREE.Vector2) => same(a.x, x0) && same(b.x, x0);
  const inSlot = (a: THREE.Vector2, b: THREE.Vector2) =>
    a.y >= slot[0] - 1e-9 && a.y <= slot[1] + 1e-9 && b.y >= slot[0] - 1e-9 && b.y <= slot[1] + 1e-9;

  if (!seat) {
    const box = contourOf([V(x0, slot[0]), V(xb, slot[0]), V(xb, slot[1]), V(x0, slot[1])]);
    wall(box, (a, b) => (mouth(a, b) ? null : [0, hA]));
    fill(mesh, box, [], planar(hA), true);
    return;
  }

  // Contour du plan de joint : un rectangle sur la bande de la portee, coupe
  // aux bornes de la fente sur son fond.
  const outer = contourOf([
    V(x0, seat[0]),
    V(xb, seat[0]),
    V(xb, slot[0]),
    V(xb, slot[1]),
    V(xb, seat[1]),
    V(x0, seat[1]),
  ]);
  wall(outer, (a, b) => {
    if (mouth(a, b)) return null;
    if (same(a.x, xb) && same(b.x, xb) && inSlot(a, b)) return [0, hB, hA];
    return [0, hB];
  });
  // Contremarches entre le fond de la fente et celui de la portee.
  const slotBox = contourOf([V(x0, slot[0]), V(xb, slot[0]), V(xb, slot[1]), V(x0, slot[1])]);
  wall(slotBox, (a, b) =>
    same(a.y, b.y) && (same(a.y, slot[0]) || same(a.y, slot[1])) ? [hB, hA] : null,
  );
  fill(mesh, slotBox, [], planar(hA), true);
  for (const band of [
    [seat[0], slot[0]],
    [slot[1], seat[1]],
  ] as const) {
    if (band[1] - band[0] < 1e-6) continue;
    const box = contourOf([V(x0, band[0]), V(xb, band[0]), V(xb, band[1]), V(x0, band[1])]);
    fill(mesh, box, [], planar(hB), true);
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

/** Demi-emprise d'une portee le long du corps, collerette comprise. */
const outerReach = (plan: AnchorPlan): number => pocketReach(plan);

/** Goujon : un pilier qui traverse les deux puits et enfile la petite boucle. */
interface TenonSolid {
  center: THREE.Vector2;
  radius: number;
  /** Cotes extremes dans le repere de la coque male. */
  from: number;
  to: number;
}

/** Deux maillages non indexes bout a bout : deux solides fermes dans un fichier. */
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const chunks: number[] = [];
  for (const part of parts) {
    const position = part.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < position.count * 3; i++) chunks.push(position.array[i] as number);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(chunks, 3));
  geometry.computeVertexNormals();
  return geometry;
}

interface VJointFrame {
  /** Stations d'arete du V, segment avant et segment arriere. */
  pA: number;
  pB: number;
  /** Abscisses exactes de ces stations : les lignes de coupe du plan de joint. */
  xFront: number;
  xRear: number;
  tanFront: number;
  tanRear: number;
  /** Etendue des zones ou la peau est recalee sur une face en V. */
  zoneStart: number;
  zoneEnd: number;
  xZoneStart: number;
  xZoneEnd: number;
  surface: SurfaceSampler;
}

/**
 * Repere des faces en V d'un leurre articule, et peau recalee dessus.
 *
 * Pres du joint, chaque colonne de peau s'arrete la ou elle rencontre sa
 * face : x = x0 - |z| . tan. Le point est cherche par iterations, a 1e-12
 * pres, pour que l'anneau de la derniere station tombe EXACTEMENT sur le
 * plan de la face — c'est la condition d'un solide ferme.
 */
function planVJoint(
  profile: ProfileSampler,
  base: SurfaceSampler,
  plan: ArticulationPlan,
): VJointFrame {
  const exact = (x: number): number => {
    let lo = 0;
    let hi = profile.bodyEnd;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (profile.xAt(mid) < x) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const pA = exact(plan.xJoint);
  const pB = exact(plan.xJoint + plan.clearance);
  const xFront = profile.xAt(pA);
  const xRear = profile.xAt(pB);
  const tanFront = Math.tan(plan.faceAngle);
  const tanRear = Math.tan(plan.rearAngle);
  let half = 0;
  for (const p of [pA, pB]) {
    for (let k = 0; k < 64; k++) half = Math.max(half, Math.abs(base(p, (k / 64) * Math.PI * 2).z));
  }
  half *= 1.1;
  const zoneStart = exact(xFront - half * tanFront - 0.05);
  const zoneEnd = exact(xRear + 0.05);
  const solve = (theta: number, x0: number, tan: number, guess: number): number => {
    let p = guess;
    for (let i = 0; i < 60; i++) {
      const next = exact(x0 - Math.abs(base(p, theta).z) * tan);
      if (Math.abs(next - p) < 1e-14) return next;
      p = next;
    }
    return p;
  };
  const front = new Map<number, number>();
  const rear = new Map<number, number>();
  const surface: SurfaceSampler = (p, theta) => {
    if (p > zoneStart && p <= pA + 1e-12) {
      let face = front.get(theta);
      if (face === undefined) {
        face = solve(theta, xFront, tanFront, pA);
        front.set(theta, face);
      }
      const s = (p - zoneStart) / (pA - zoneStart);
      return base(zoneStart + s * (face - zoneStart), theta);
    }
    if (p >= pB - 1e-12 && p < zoneEnd) {
      let face = rear.get(theta);
      if (face === undefined) {
        face = solve(theta, xRear, tanRear, pB);
        rear.set(theta, face);
      }
      const s = (zoneEnd - p) / (zoneEnd - pB);
      return base(zoneEnd - s * (zoneEnd - face), theta);
    }
    return base(p, theta);
  };
  return {
    pA,
    pB,
    xFront,
    xRear,
    tanFront,
    tanRear,
    zoneStart,
    zoneEnd,
    xZoneStart: profile.xAt(zoneStart),
    xZoneEnd: profile.xAt(zoneEnd),
    surface,
  };
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

/**
 * Distance d'un point a un polygone ferme, en cm : zero s'il est dedans.
 */
function polygonDistance(polygon: THREE.Vector2[], point: THREE.Vector2): number {
  if (polygon.length < 2) return Infinity;
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y) {
      const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < x) inside = !inside;
    }
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const len2 = sx * sx + sy * sy;
    const s = len2 < 1e-12 ? 0 : Math.min(Math.max(((point.x - a.x) * sx + (point.y - a.y) * sy) / len2, 0), 1);
    best = Math.min(best, Math.hypot(a.x + sx * s - point.x, a.y + sy * s - point.y));
  }
  return inside ? 0 : best;
}

/** Vrai si aucun couple d'aretes non voisines ne se coupe. */
function simplePolygon(polygon: THREE.Vector2[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = polygon[j];
      const d = polygon[(j + 1) % n];
      if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x)) continue;
      if (Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) continue;
      const d1 = cross(c, d, a);
      const d2 = cross(c, d, b);
      const d3 = cross(a, b, c);
      const d4 = cross(a, b, d);
      if (d1 * d2 < 0 && d3 * d4 < 0) return false;
    }
  }
  return true;
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
/** Etendue du corps dans le plan de joint, a une abscisse ; null hors du corps. */
function rangeProbe(
  surface: SurfaceSampler,
  frame: JointFrame,
  profile: ProfileSampler,
): BillRangeProbe {
  return (x) => {
    const station = findStation(surface, frame, pAtX(profile, x), x);
    if (station.degenerate) return null;
    return stationRange(surface, frame, station);
  };
}

export function billPlanFor(
  profile: ProfileSampler,
  params: LureParams,
): BillSlotPlan | null {
  return buildAssembly(profile, params).billPlan;
}

export function buildAssembly(
  profile: ProfileSampler,
  params: LureParams,
  requested: AssemblyResolution = ASSEMBLY_DISPLAY,
): AssemblyResult {
  // Un corps anatomique porte des details de quelques dixiemes de
  // millimetre : ses coques s'echantillonnent plus finement que la goutte
  // historique, qui garde exactement sa resolution d'avant.
  const resolution: AssemblyResolution = profile.anatomy
    ? {
        ...requested,
        stations: Math.round(requested.stations * 2.2),
        arcSamples: Math.round(requested.arcSamples * 2.4),
      }
    : requested;
  const skin = createSurfaceSampler(profile, params, resolution.bakeScales === true);
  // Leurre articule en demi-coques : chaque segment est coupe dans le plan de
  // joint, et ses stations proches du joint sont recalees sur la face en V.
  const jointPlan =
    params.articulation.enabled && params.assembly.planeAngle < 5
      ? articulationPlan(profile, params)
      : null;
  const vJoint = jointPlan ? planVJoint(profile, skin, jointPlan) : null;
  const surface = vJoint ? vJoint.surface : skin;
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
  // Queue rapportee : le bout de queue arrondi est tronque la ou la lame sort,
  // et la fente se prend en sandwich entre les coques, comme la bavette.
  const tailSlot = softTailSlot(profile, params);
  if (tailSlot && !cutRear) {
    pEnd = Math.min(pEnd, tailSlot.pCut);
    cutRear = true;
  }

  // Une seule fente pour les deux modes (module AE) : la plaque imprimee se
  // prend en sandwich entre les deux coques exactement comme la plaque en
  // polycarbonate.
  const placement =
    params.hasBib && params.assembly.planeAngle < 25
      ? billSlotPlan(
          profile,
          params,
          roomProbe(surface, frame, profile),
          rangeProbe(surface, frame, profile),
          cutFront ? profile.xAt(pStart) : -Infinity,
        )
      : null;
  const bill = placement?.plan ?? null;
  // La fente ne tronque plus le nez : elle debouche au menton, sur sa seule
  // emprise. `cutP` ne designe donc plus une coupe, mais la station ou la
  // tete devient assez epaisse pour porter la poche fermee.
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
  // Un corps qui commence par une section pleine — le fond d'une cuvette de
  // popper — recoit une face de coupe au nez, meme sans passage de goupille.
  if (profile.openFront && pStart <= 0) cutFront = true;
  const stations: Station[] = [];
  const warp = profile.anatomy ?? null;
  // Stations supplementaires sur l'emprise de la fente de bavette : la bouche
  // et le fond ferme doivent tomber sur des stations, quelle que soit la
  // resolution demandee — sinon une resolution grossiere refuserait une fente
  // que la resolution fine accepte.
  const extra: number[] = [];
  if (bill) {
    const x0 = bill.mouth.x - 0.4;
    const x1 = Math.max(
      bill.along(bill.depthU(bill.insertion), -bill.halfPlate).x,
      bill.along(bill.depthU(bill.insertion), bill.halfPlate).x,
    ) + 0.05;
    for (let x = x0; x <= x1; x += 0.04) {
      const p = pAtX(profile, x);
      if (p > pStart + 1e-4 && p < pEnd - 1e-4) extra.push(p);
    }
  }
  // Pres d'une face en V, la peau change de station a chaque colonne : on y
  // resserre les stations pour que la face garde sa finesse.
  if (vJoint) {
    for (const [a, b] of [
      [vJoint.zoneStart, vJoint.pA],
      [vJoint.pB, vJoint.zoneEnd],
    ]) {
      for (let k = 1; k < 16; k++) extra.push(a + ((b - a) * k) / 16);
    }
  }
  // Un leurre articule a deux listes de stations, bout a bout : le segment
  // avant s'arrete a l'arete de son V, l'arriere repart de la sienne.
  const ranges: [number, number][] = vJoint
    ? [
        [pStart, vJoint.pA],
        [vJoint.pB, pEnd],
      ]
    : [[pStart, pEnd]];
  let split = -1;
  for (const [ra, rb] of ranges) {
    const count = vJoint
      ? Math.max(Math.round((resolution.stations * (rb - ra)) / Math.max(pEnd - pStart, 1e-6)), 16)
      : resolution.stations;
    const t0 = warp ? warp.stationOf(ra) : 0;
    const t1 = warp ? warp.stationOf(rb) : 1;
    const base: number[] = [];
    for (let i = 0; i <= count; i++) {
      // Repartition du corps entier : serree a la tete et au pedoncule.
      const p = warp
        ? i === 0
          ? ra
          : i === count
            ? rb
            : warp.stationAt(t0 + ((t1 - t0) * i) / count)
        : ra + ((rb - ra) * i) / count;
      base.push(p);
    }
    const inside = extra.filter((p) => p > ra + 1e-5 && p < rb - 1e-5);
    const merged = [...base, ...inside].sort((a, b) => a - b);
    for (let i = 0; i < merged.length; i++) {
      const p = merged[i];
      if (i > 0 && p - merged[i - 1] < 2e-5) continue;
      stations.push(findStation(surface, frame, p, profile.xAt(p)));
    }
    if (split < 0) split = stations.length;
  }
  if (!vJoint) split = stations.length;

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
  // Enfoncement demande : il n'est jamais rogne en silence. Seul le mode
  // automatique — la plaque entre jusqu'a buter — se retire devant une
  // portee, comme avant.
  const billRequested = (params.billInsertion ?? 0) > 0;
  if (bill) {
    const footprint = (insertion: number) => [
      bill.along(bill.depthU(0) + 0.1, -bill.halfPlate),
      bill.along(bill.depthU(insertion), -bill.halfPlate),
      bill.along(bill.depthU(insertion), bill.halfPlate),
      bill.along(bill.depthU(0) + 0.1, bill.halfPlate),
    ];
    const hits = (insertion: number, plan: AnchorPlan) =>
      polygonMeetsDisc(footprint(insertion), plan.center, plan.seatRadius + LEDGE + SKIN);
    const clashing = () =>
      plans.filter(
        (plan) => plan.valid && isLongitudinal(plan.exit) && hits(billInsertion, plan),
      );

    const FLOOR = 0.2;
    while (!billRequested && billInsertion > FLOOR && clashing().length > 0) {
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

  // Une bouche ouverte dans la peau ne doit pas tomber sur une nageoire :
  // la nageoire deborde du contour de section la ou la bouche la trancherait,
  // et la face de coupe se recouperait. On le signale au lieu de produire une
  // coque ouverte.
  const anatomy = params.anatomy;
  const finOnRail = (x0: number, x1: number, rail: 'lo' | 'hi'): string | null => {
    if (vJoint && x1 >= vJoint.xZoneStart - 0.15 && x0 <= vJoint.xZoneEnd + 0.15) {
      return 'la face du joint articule';
    }
    if (!anatomy || params.assembly.planeAngle > 45) return null;
    const fins =
      rail === 'lo'
        ? [
            { fin: anatomy.pelvicFin, label: 'la nageoire ventrale' },
            { fin: anatomy.analFin, label: 'la nageoire anale' },
          ]
        : [{ fin: anatomy.dorsalFin, label: 'la nageoire dorsale' }];
    const margin = 0.1;
    for (const { fin, label } of fins) {
      if (!fin.enabled || fin.size <= 0) continue;
      const a = profile.xAt(fin.from) - margin;
      const b = profile.xAt(fin.to) + margin;
      if (x1 >= a && x0 <= b) return label;
    }
    return null;
  };

  // Deux bouches ne peuvent pas se chevaucher : elles partagent les memes
  // stations et les faces de coupe se recouperaient.
  const taken: [number, number][] = [];
  const reserve = (iStart: number, iEnd: number): boolean => {
    if (vJoint && iStart < split && iEnd >= split - 1) return false;
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
        bores: [well],
        path,
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
      // Emprise exacte, independante de la resolution des stations.
      const clash = finOnRail(center.x - outerReach(plan), center.x + outerReach(plan), rail);
      if (clash) {
        plan.valid = false;
        plan.problem =
          `Ancrage a ${((center.x - profile.xAt(0)) * 10).toFixed(0)} mm du nez : sa sortie ` +
          `tombe sur ${clash}. Deplacez-le le long du corps.`;
        continue;
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
        bores: [well],
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
  // La plaque sort par le menton. La bouche est bornee a la bande : elle
  // court de la station ou la bande perce le ventre jusqu'a celle ou la tete
  // peut porter une poche fermee. Au-dela, la poche suit l'emprise exacte de
  // la plaque jusqu'a son fond ferme. Rien d'autre n'est retire : le nez et
  // le dessus de la tete restent entiers sur les deux coques.
  const chinSlots: ChinSlot[] = [];
  let billResult: BillSlotPlan | null = null;
  let billProblem: string | null = placement?.problem ?? null;
  if (bill) {
    const topOf = (x: number) => bill.centreAt(x) + bill.halfBand;
    const baseOf = (x: number) => bill.centreAt(x) - bill.halfBand;
    const rangeOf = (station: Station): [number, number] =>
      station.degenerate ? [0, 0] : stationRange(surface, frame, station);
    const refuse = (why: string) => {
      billProblem = why;
    };

    // Fond ferme de la poche : un plan perpendiculaire a la plaque.
    const back: [THREE.Vector2, THREE.Vector2] = [
      bill.along(bill.depthU(billInsertion), -bill.halfPlate),
      bill.along(bill.depthU(billInsertion), bill.halfPlate),
    ];
    const xBack = Math.min(back[0].x, back[1].x);

    // Station ou la poche se ferme : la bande y est entierement dans la tete,
    // avec sa peau, et la coque assez epaisse pour la largeur de la plaque.
    let iEnd = -1;
    for (let i = 1; i < stations.length - 1 && stations[i].x <= xBack + 1e-9; i++) {
      const station = stations[i];
      if (station.degenerate || station.x < bill.mouth.x - 0.5) continue;
      const [tMin, tMax] = rangeOf(station);
      const tLo = baseOf(station.x);
      const tHi = topOf(station.x);
      if (tLo < tMin + WALL || tHi > tMax - SKIN) continue;
      if (notchRoom(surface, frame, station, tLo, tHi) < bill.depth + SKIN) continue;
      iEnd = i;
      break;
    }

    if (iEnd < 1) {
      refuse(
        `La fente de bavette ne trouve pas de station ou se fermer entre la bouche et le fond ` +
          `(${((bill.mouth.x - profile.xAt(0)) / MM_TO_CM).toFixed(1)} mm du nez). Reculez l ancrage ` +
          'ou reduisez l enfoncement.',
      );
    } else {
      const tail = stations[iEnd];
      const [tMin, tMax] = rangeOf(tail);
      const baseT = baseOf(tail.x);
      const topT = topOf(tail.x);

      // Vers l'avant, la bande descend et le ventre remonte : elles se
      // croisent. C'est la que la bouche commence.
      let iStart = iEnd;
      while (iStart > 1) {
        const previous = stations[iStart - 1];
        const [lo] = rangeOf(previous);
        if (previous.degenerate || topOf(previous.x) <= lo + 1e-3) break;
        iStart -= 1;
      }

      const topT_ = [];
      for (let i = iStart; i <= iEnd; i++) topT_.push(topOf(stations[i].x));

      if (iStart <= 1 && cutFront) {
        refuse(
          'La bouche de la fente atteint la coupe du passage de goupille de nez : reculez ' +
            'l ancrage de bavette ou sortez la goupille de nez par le dos.',
        );
      } else if (
        iEnd - iStart >= 1 &&
        baseT >= tMin + WALL &&
        topT <= tMax - SKIN &&
        reserve(iStart, iEnd)
      ) {
        chinSlots.push({ iStart, iEnd, topT: topT_, baseT, depth: bill.depth, back });
        billResult = {
          ...bill,
          insertion: billInsertion,
          root: bill.along(bill.depthU(billInsertion), 0),
        };
      } else {
        refuse(
          `La bouche de la fente de bavette (${((bill.mouth.x - profile.xAt(0)) / MM_TO_CM).toFixed(1)} mm ` +
            'du nez) croise un autre passage ouvert dans le ventre. Deplacez l un des deux.',
        );
      }
    }
  }

  // --- Chambre de bruit : tube creuse dans le plan de joint ----------------
  const rattles: AssemblyResult['rattles'] = [];
  const STAINLESS = 7.9;

  const fitCavity = (station: Station, height: number, radius: number): THREE.Vector2 | null => {
    if (station.degenerate) return null;
    const [tMin, tMax] = stationRange(surface, frame, station);
    if (Math.min(maxBulge(surface, frame, station), (tMax - tMin) / 2) - WALL < radius) return null;
    const wanted = height >= 0 ? height * tMax : -height * tMin;
    const t = Math.min(Math.max(wanted, tMin + radius + WALL), tMax - radius - WALL);
    return new THREE.Vector2(station.x, t);
  };

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
    warp: profile.anatomy !== undefined,
    pegs: [] as PegSolid[],
    stations,
    pockets,
    cutFront,
    cutRear,
    arcSamples: resolution.arcSamples,
    chinSlots,
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

  // --- Passages de vis d'assemblage (module U) -----------------------------
  //
  // La vis entre par le ventre, monte dans le plan de symetrie et se serre
  // dans un ecrou captif. Tout tient dans UNE fente debouchant au ventre :
  //   - la fente elle-meme, a la cote du percage de passage ;
  //   - un puits plus profond a la bouche, pour noyer la tete ;
  //   - un puits hexagonal a la profondeur de l'ecrou, qui l'empeche de
  //     tourner au serrage.
  // Les trois sont a cheval sur le joint : chaque demi-coque en porte la
  // moitie, et c'est le serrage qui plaque les deux ensemble.
  const screwPlans = planScrews(
    profile,
    params,
    dowelObstacles.map((item) => ({ center: item.center, radius: item.radius, label: item.label })),
  );
  const LEDGE_X = 0.02;
  for (const screw of screwPlans) {
    if (!screw.valid) continue;
    const station = stationAt(stations, screw.x);
    if (!station || station.degenerate) {
      screw.valid = false;
      screw.problem = 'La vis tombe hors du corps a cet endroit.';
      continue;
    }
    const [tMin, tMax] = stationRange(surface, frame, station);
    // La fente est a la cote du LAMAGE de tete : c'est la plus grande des
    // trois, et une poche a fond unique ne peut pas etre plus profonde a la
    // bouche qu'au fond. Le percage et l'ecrou y sont donc au large en
    // travers ; c'est la largeur en X, elle, qui suit les trois etages — et
    // c'est elle qui tient l'ecrou : un hexagone dans une fente a la cote de
    // son entre-plats ne peut pas tourner.
    const wHead = screw.headSeat.radius;
    const wNut = screw.nut.across / 2;
    const halfX = Math.max(wHead, wNut, screw.boreRadius) + LEDGE_X;
    let iStart = 0;
    while (iStart < stations.length - 1 && stations[iStart + 1].x <= screw.x - halfX) iStart++;
    let iEnd = stations.length - 1;
    while (iEnd > 0 && stations[iEnd - 1].x >= screw.x + halfX) iEnd--;
    if (iEnd < iStart + 2) {
      const middle = Math.round((iStart + iEnd) / 2);
      iStart = middle - 1;
      iEnd = middle + 1;
    }
    const clash = finOnRail(screw.x - halfX, screw.x + halfX, 'lo');
    if (clash) {
      screw.valid = false;
      screw.problem =
        `Vis a ${((screw.x - profile.xAt(0)) / MM_TO_CM).toFixed(0)} mm : la tete entre par ` +
        `le ventre au droit de ${clash}. Deplacez la vis le long du corps.`;
      continue;
    }
    if (iStart < 1 || iEnd > stations.length - 2 || !reserve(iStart, iEnd)) {
      screw.valid = false;
      screw.problem =
        `Vis a ${((screw.x - profile.xAt(0)) / MM_TO_CM).toFixed(0)} mm : un autre passage ` +
        'occupe deja le ventre ici. Deplacez-la le long du corps.';
      continue;
    }
    // Hauteur a laquelle la coque atteint la cote du lamage : en dessous, la
    // bouche est deja ouverte de part en part et le contour de la poche n'a
    // rien a y faire.
    // ... mesuree sur TOUTES les stations de la bouche : aux deux bords la
    // coque est plus mince, et c'est la que le contour ressortirait.
    let tOpen = tMin;
    for (let i = iStart; i <= iEnd; i++) {
      const probe = stations[i];
      if (probe.degenerate) continue;
      const [lo, hi] = stationRange(surface, frame, probe);
      let found = hi;
      for (let k = 1; k <= 80; k++) {
        const t = lo + ((hi - lo) * k) / 80;
        if (shellThickness(surface, frame, probe, t) >= wHead) {
          found = t;
          break;
        }
      }
      tOpen = Math.max(tOpen, found);
    }
    const tStart = Math.max(tOpen + LEDGE_X * 2, screw.bearingY);
    const top = Math.min(screw.nut.toY, tMax - SKIN);
    if (tStart >= screw.nut.fromY - LEDGE_X || top <= tStart) {
      screw.valid = false;
      screw.problem =
        `Vis a ${((screw.x - profile.xAt(0)) / MM_TO_CM).toFixed(0)} mm : le corps n est pas ` +
        `assez epais au ventre pour noyer une tete de ${(wHead * 20).toFixed(1)} mm. ` +
        'Passez au diametre inferieur, ou deplacez la vis vers une section plus large.';
      continue;
    }
    // Les deux extremites du chemin tombent EXACTEMENT sur les stations
    // frontieres : c'est la que la face de coupe verticale de la bouche est
    // emise, et un chemin qui s'arreterait avant laisserait un trou.
    const path = [
      new THREE.Vector2(stations[iStart].x, tStart),
      new THREE.Vector2(screw.x - screw.boreRadius, tStart),
      new THREE.Vector2(screw.x - screw.boreRadius, screw.nut.fromY),
      new THREE.Vector2(screw.x - wNut, screw.nut.fromY),
      new THREE.Vector2(screw.x - wNut, top),
      new THREE.Vector2(screw.x + wNut, top),
      new THREE.Vector2(screw.x + wNut, screw.nut.fromY),
      new THREE.Vector2(screw.x + screw.boreRadius, screw.nut.fromY),
      new THREE.Vector2(screw.x + screw.boreRadius, tStart),
      new THREE.Vector2(stations[iEnd].x, tStart),
    ];
    const exit: SideExit = {
      rail: 'lo',
      iStart,
      iEnd,
      path,
      depth: wHead,
    };
    maleSides.push(exit);
    femaleSides.push(exit);
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

  // --- Fente de la queue rapportee ------------------------------------------
  let tailSlotProblem: string | null = null;
  if (tailSlot && cutRear) {
    const last = stations[stations.length - 1];
    const xCut = last.x;
    const tLo = tailSlot.centreY - tailSlot.halfBand;
    const tHi = tailSlot.centreY + tailSlot.halfBand;
    const [lo, hi] = stationRange(surface, frame, last);
    let room = notchRoom(surface, frame, last, tLo, tHi);
    for (const station of stations) {
      if (station.x < tailSlot.xRoot || station.x > xCut) continue;
      room = Math.min(room, notchRoom(surface, frame, station, tLo, tHi));
    }
    if (tLo < lo + SKIN || tHi > hi - SKIN || room < tailSlot.depth + SKIN) {
      tailSlotProblem =
        `La fente de la queue rapportee (${((tailSlot.depth * 2) / MM_TO_CM).toFixed(2)} mm jeu compris) ` +
        'percerait le pedoncule : amincissez la lame ou reculez sa racine.';
    } else if (freeNotch('rear', tLo, tHi)) {
      const path = [
        new THREE.Vector2(xCut, tLo),
        new THREE.Vector2(tailSlot.xRoot, tLo),
        new THREE.Vector2(tailSlot.xRoot, tHi),
        new THREE.Vector2(xCut, tHi),
      ];
      const exit: EndExit = { end: 'rear', tLo, tHi, depth: tailSlot.depth, path };
      maleEnds.push(exit);
      femaleEnds.push(exit);
    } else {
      tailSlotProblem = 'La fente de la queue rapportee croise une sortie de goupille de queue.';
    }
  }

  // --- Obstacles du plan de joint -----------------------------------------
  // Tout ce qui est deja creuse ou ouvert dans la face de joint, sous forme de
  // polygones : les ergots et la gorge de colle s'en ecartent, et chaque
  // ecart est dit, jamais tu.
  const tables = new Map<Station, (t: number) => number>();
  const thicknessAt = (station: Station, t: number): number => {
    let table = tables.get(station);
    if (!table) {
      table = thicknessTable(surface, frame, station);
      tables.set(station, table);
    }
    return table(t);
  };
  const rangeCache = new Map<Station, [number, number]>();
  const rangeAt = (station: Station): [number, number] => {
    let range = rangeCache.get(station);
    if (!range) {
      range = stationRange(surface, frame, station);
      rangeCache.set(station, range);
    }
    return range;
  };
  const obstacles: { polygon: THREE.Vector2[]; label: string }[] = [];
  const nearStation = (x: number) => stationAt(stations, x);
  const rimAt = (i: number, rail: 'lo' | 'hi') => {
    const [lo, hi] = rangeAt(stations[i]);
    return new THREE.Vector2(stations[i].x, rail === 'lo' ? lo : hi);
  };
  for (const pocket of pockets) obstacles.push({ polygon: pocket.outline, label: 'un logement' });
  if (vJoint) {
    const a = vJoint.xZoneStart - 0.1;
    const b = vJoint.xZoneEnd + 0.1;
    obstacles.push({
      polygon: [new THREE.Vector2(a, -50), new THREE.Vector2(b, -50), new THREE.Vector2(b, 50), new THREE.Vector2(a, 50)],
      label: 'le joint articule',
    });
  }
  for (const exit of maleSides) {
    const rim: THREE.Vector2[] = [];
    for (let i = exit.iEnd; i >= exit.iStart; i--) rim.push(rimAt(i, exit.rail));
    obstacles.push({
      polygon: [...exit.path, ...rim],
      label: exit.rail === 'lo' ? 'un passage ventral' : 'un passage dorsal',
    });
  }
  for (const exit of maleEnds) {
    obstacles.push({ polygon: exit.path, label: exit.end === 'front' ? 'la sortie de nez' : 'la sortie de queue' });
  }
  for (const slot of chinSlots) {
    const band: THREE.Vector2[] = [];
    for (let k = 0; k <= slot.iEnd - slot.iStart; k++) {
      band.push(new THREE.Vector2(stations[slot.iStart + k].x, slot.topT[k]));
    }
    obstacles.push({
      polygon: [
        rimAt(slot.iStart, 'lo'),
        ...band,
        slot.back[0],
        slot.back[1],
        new THREE.Vector2(stations[slot.iEnd].x, slot.baseT),
        rimAt(slot.iEnd, 'lo'),
      ],
      label: 'la fente de bavette',
    });
  }
  const clearanceTo = (point: THREE.Vector2): { distance: number; label: string } => {
    let best = { distance: Infinity, label: '' };
    for (const obstacle of obstacles) {
      const d = polygonDistance(obstacle.polygon, point);
      if (d < best.distance) best = { distance: d, label: obstacle.label };
    }
    return best;
  };
  const fromNose = (x: number) => (x - profile.xAt(0)) / MM_TO_CM;

  // --- Gorge de colle : geometrie des rails --------------------------------
  const groove = params.assembly.glueGroove;
  const grooveOn = groove.enabled;
  const gWidth = groove.width * MM_TO_CM;
  const gDepth = groove.depth * MM_TO_CM;
  const gInset = groove.inset * MM_TO_CM;

  // --- Ergots coniques -------------------------------------------------------
  const pegConfig = params.assembly.pegs;
  const pegSolids: PegSolid[] = [];
  const pegPlacements: PegPlacement[] = [];
  if (pegConfig.enabled && pegConfig.count > 0) {
    const base = (pegConfig.diameter * MM_TO_CM) / 2;
    const height = pegConfig.height * MM_TO_CM;
    const clearance = pegConfig.clearance * MM_TO_CM;
    const top = Math.max(base - height * Math.tan(THREE.MathUtils.degToRad(pegConfig.taper)), base * 0.4);
    const keepOut = base + clearance + 0.08;
    const rimKeep = (grooveOn ? gInset + gWidth : 0) + base + clearance + 0.1;
    interface Candidate {
      center: THREE.Vector2;
      score: number;
    }
    const candidates: Candidate[] = [];
    const reasons = new Map<string, number>();
    const note = (why: string) => reasons.set(why, (reasons.get(why) ?? 0) + 1);
    const SAMPLES = 90;
    for (let k = 0; k <= SAMPLES; k++) {
      const p = 0.1 + ((profile.bodyEnd - 0.2) * k) / SAMPLES;
      const station = nearStation(profile.xAt(p));
      if (!station || station.degenerate) continue;
      const [lo, hi] = rangeAt(station);
      if (hi - lo < 2 * rimKeep) {
        note('section trop basse');
        continue;
      }
      // Le logement femelle doit garder sa peau : on cherche la hauteur ou
      // la coque est la plus epaisse, entre les deux rails.
      let bestT = (lo + hi) / 2;
      let bestRoom = -1;
      for (let j = 0; j <= 8; j++) {
        const t = lo + rimKeep + ((hi - lo - 2 * rimKeep) * j) / 8;
        const room = thicknessAt(station, t);
        if (room > bestRoom) {
          bestRoom = room;
          bestT = t;
        }
      }
      if (bestRoom < height + clearance + SKIN) {
        note('coque trop mince pour le logement');
        continue;
      }
      const center = new THREE.Vector2(station.x, bestT);
      const near = clearanceTo(center);
      if (near.distance < keepOut) {
        note(near.label);
        continue;
      }
      candidates.push({ center, score: near.distance });
    }
    const chosen: THREE.Vector2[] = [];
    if (candidates.length > 0) {
      const xs = candidates.map((c) => c.center.x);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      for (let n = 0; n < pegConfig.count; n++) {
        const target =
          pegConfig.count === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * n) / (pegConfig.count - 1);
        let pick: Candidate | null = null;
        for (const c of candidates) {
          if (chosen.some((other) => other.distanceTo(c.center) < 4 * base)) continue;
          if (!pick || Math.abs(c.center.x - target) < Math.abs(pick.center.x - target)) pick = c;
        }
        if (pick) chosen.push(pick.center);
      }
    }
    chosen.sort((a, b) => a.x - b.x);
    for (const center of chosen) {
      pegSolids.push({ center, base, top, height, clearance });
      pegPlacements.push({ center, fromNoseMm: fromNose(center.x), valid: true, problem: null });
      obstacles.push({ polygon: circleOutline(center, base + clearance, 24), label: 'un ergot' });
    }
    for (let n = chosen.length; n < pegConfig.count; n++) {
      const why = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'place insuffisante';
      pegPlacements.push({
        center: new THREE.Vector2(0, 0),
        fromNoseMm: 0,
        valid: false,
        problem:
          `Ergot ${n + 1} sur ${pegConfig.count} : aucune place libre le long du corps ` +
          `(motif le plus frequent : ${why}). Reduisez le nombre ou le diametre des ergots.`,
      });
    }
  }

  // --- Gorge de colle ---------------------------------------------------------
  let grooveReport: GlueGrooveReport | null = null;
  if (grooveOn) {
    const interruptions: string[] = [];
    let segments = 0;
    let length = 0;
    for (const rail of ['hi', 'lo'] as const) {
      // Rail, normale interieure et retrait local, station par station.
      const rim: (THREE.Vector2 | null)[] = stations.map((station, i) =>
        station.degenerate ? null : rimAt(i, rail),
      );
      const normal: (THREE.Vector2 | null)[] = rim.map((point, i) => {
        if (!point) return null;
        const a = rim[Math.max(i - 1, 0)] ?? point;
        const b = rim[Math.min(i + 1, rim.length - 1)] ?? point;
        const dx = b.x - a.x;
        const dt = b.y - a.y;
        const len = Math.hypot(dx, dt);
        if (len < 1e-9) return null;
        return rail === 'hi' ? new THREE.Vector2(dt / len, -dx / len) : new THREE.Vector2(-dt / len, dx / len);
      });
      // Retrait : au moins le reglage, davantage la ou la coque est mince —
      // sous une nageoire dorsale, par exemple.
      const inset: number[] = rim.map((point, i) => {
        const n = normal[i];
        if (!point || !n) return Infinity;
        const [lo, hi] = rangeAt(stations[i]);
        for (let extra = 0; extra <= 0.4; extra += 0.02) {
          const d = gInset + extra;
          const probe = (offset: number) => {
            const t = point.y + n.y * offset;
            return t > lo && t < hi ? thicknessAt(stations[i], t) : 0;
          };
          if (Math.min(probe(d), probe(d + gWidth / 2), probe(d + gWidth)) >= gDepth + SKIN) return d;
        }
        return Infinity;
      });
      // Lissage : un retrait qui saute d'une station a l'autre ferait un
      // sillon en baionnette. Maximum glissant, puis moyenne glissante.
      const W = 4;
      const widened = inset.map((_, i) => {
        let m = 0;
        for (let k = Math.max(i - W, 0); k <= Math.min(i + W, inset.length - 1); k++) m = Math.max(m, inset[k]);
        return m;
      });
      const smooth = widened.map((_, i) => {
        let sum = 0;
        let count = 0;
        for (let k = Math.max(i - W, 0); k <= Math.min(i + W, widened.length - 1); k++) {
          if (!Number.isFinite(widened[k])) return Infinity;
          sum += widened[k];
          count++;
        }
        return sum / count;
      });

      // Blocage station par station, puis troncons continus.
      let run: number[] = [];
      let lastWhy = '';
      /** Troncon de gorge : un ruban entre deux decalages du rail. */
      const emit = (run: number[]) => {
        if (run.length < 5) return;
        const outer: THREE.Vector2[] = [];
        const inner: THREE.Vector2[] = [];
        for (const i of run) {
          const point = rim[i]!;
          const n = normal[i]!;
          outer.push(point.clone().addScaledVector(n, smooth[i]));
          inner.push(point.clone().addScaledVector(n, smooth[i] + gWidth));
        }
        // La ou le rail tourne plus serre que le decalage, le ruban se
        // replierait sur lui-meme : on coupe le troncon a cet endroit plutot
        // que de le perdre en entier.
        const tangent = (k: number) => {
          const a = rim[run[Math.max(k - 1, 0)]]!;
          const b = rim[run[Math.min(k + 1, run.length - 1)]]!;
          return new THREE.Vector2(b.x - a.x, b.y - a.y);
        };
        for (let k = 0; k + 1 < run.length; k++) {
          const t = tangent(k);
          const forwardOuter = new THREE.Vector2().subVectors(outer[k + 1], outer[k]).dot(t);
          const forwardInner = new THREE.Vector2().subVectors(inner[k + 1], inner[k]).dot(t);
          if (forwardOuter <= 0 || forwardInner <= 0) {
            emit(run.slice(0, k));
            emit(run.slice(k + 2));
            return;
          }
        }
        const strip = [...outer, ...[...inner].reverse()];
        if (!simplePolygon(strip)) {
          const middle = Math.floor(run.length / 2);
          emit(run.slice(0, middle));
          emit(run.slice(middle + 1));
          return;
        }
        pockets.push({ outline: strip, depth: gDepth });
        obstacles.push({ polygon: strip, label: 'la gorge de colle' });
        segments++;
        for (let k = 1; k < run.length; k++) length += outer[k].distanceTo(outer[k - 1]);
      };
      const flush = (why: string, at: number) => {
        emit(run);
        if (why && run.length > 0) {
          interruptions.push(`${rail === 'hi' ? 'Dos' : 'Ventre'} a ${fromNose(stations[at].x).toFixed(0)} mm : ${why}`);
        }
        run = [];
      };
      for (let i = 0; i < stations.length; i++) {
        const point = rim[i];
        const n = normal[i];
        // Deux segments : la gorge s'arrete de part et d'autre du joint.
        if (vJoint && i === split) flush('', i);
        let why = '';
        if (!point || !n || !Number.isFinite(smooth[i])) why = 'coque trop mince';
        else {
          const [lo, hi] = rangeAt(stations[i]);
          if (hi - lo < 2 * (smooth[i] + gWidth) + 0.1) why = 'section trop basse';
          else if (vJoint && stations[i].x > vJoint.xZoneStart - 0.1 && stations[i].x < vJoint.xZoneEnd + 0.1) {
            why = 'coque trop mince';
          }
          else {
            const mid = point.clone().addScaledVector(n, smooth[i] + gWidth / 2);
            const near = clearanceTo(mid);
            if (near.distance < gWidth / 2 + 0.06) why = `interrompue au droit de ${near.label}`;
          }
        }
        if (why) {
          if (why !== lastWhy && why !== 'section trop basse' && why !== 'coque trop mince') flush(why, i);
          else flush('', i);
          lastWhy = why;
        } else {
          run.push(i);
          lastWhy = '';
        }
      }
      flush('', stations.length - 1);
    }
    grooveReport = { segments, lengthMm: length / MM_TO_CM, interruptions };
  }

  shared.pegs = pegSolids;

  // --- Logements de charniere (leurre articule en demi-coques) ------------
  let jointProblem: string | null = null;
  let jointResult: ArticulationPlan | null = jointPlan;
  const hingeExits: { front: EndExit | null; rear: EndExit | null } = { front: null, rear: null };
  if (vJoint && jointPlan) {
    const slotBand: [number, number] = [jointPlan.slot.from, jointPlan.slot.to];
    const hA = Math.min(jointPlan.slot.halfFloor, jointPlan.halfWidth * 0.65);
    const hB = jointPlan.pin ? jointPlan.pin.seat : 0;
    const reachFront = Math.max(jointPlan.slot.depth, hA * vJoint.tanFront + 0.1);
    const reachRear = Math.max(jointPlan.slot.depth, hA * vJoint.tanRear + 0.1);
    // Matiere disponible au droit du logement, sur toute sa longueur : c'est
    // elle qui borne la portee du cylindre en hauteur.
    const thickness = (from: number, to: number, t: number) => {
      let room = Infinity;
      for (const station of stations) {
        if (station.degenerate || station.x < Math.min(from, to) - 1e-9 || station.x > Math.max(from, to) + 1e-9) continue;
        room = Math.min(room, shellThickness(surface, frame, station, t));
      }
      return room;
    };
    const fits = (t: number, depth: number) =>
      thickness(vJoint.xFront - reachFront, vJoint.xFront, t) >= depth + SKIN &&
      thickness(vJoint.xRear, vJoint.xRear + reachRear, t) >= depth + SKIN;
    let slotOk = true;
    for (let k = 0; k <= 8 && slotOk; k++) {
      if (!fits(slotBand[0] + ((slotBand[1] - slotBand[0]) * k) / 8, hA)) slotOk = false;
    }
    let seat: [number, number] | null = null;
    if (jointPlan.pin) {
      let lo = Math.max(jointPlan.pin.from, slotBand[0] - 2);
      let hi = Math.min(jointPlan.pin.to, slotBand[1] + 2);
      while (lo < slotBand[0] && !fits(lo, hB)) lo += 0.01;
      while (hi > slotBand[1] && !fits(hi, hB)) hi -= 0.01;
      // Le cylindre doit porter au-dessus ET au-dessous de la fente.
      if (slotBand[0] - lo >= 0.1 && hi - slotBand[1] >= 0.1) seat = [lo, hi];
    }
    if (!slotOk) {
      jointProblem =
        `La fente de charniere (${((hA * 2) / MM_TO_CM).toFixed(1)} mm de large) ne tient pas dans ` +
        'les demi-coques au droit du joint : reduisez la hauteur de fente ou elargissez le corps.';
    } else if (jointPlan.pin && !seat) {
      jointProblem =
        'Le cylindre de retention ne trouve pas de portee au-dessus et au-dessous de la fente : ' +
        'reduisez la hauteur de fente pour lui laisser de la matiere.';
    } else {
      const make = (x0: number, dir: 1 | -1, reach: number, end: 'front' | 'rear'): EndExit => {
        const band = seat ?? slotBand;
        const xb = x0 + dir * reach;
        const V = (x: number, t: number) => new THREE.Vector2(x, t);
        const pathUp = [
          V(x0, band[0]),
          V(xb, band[0]),
          ...(seat ? [V(xb, slotBand[0]), V(xb, slotBand[1])] : []),
          V(xb, band[1]),
          V(x0, band[1]),
        ];
        const profile = seat
          ? [
              V(seat[0], 0),
              V(seat[0], hB),
              V(slotBand[0], hB),
              V(slotBand[0], hA),
              V(slotBand[1], hA),
              V(slotBand[1], hB),
              V(seat[1], hB),
              V(seat[1], 0),
            ]
          : [V(slotBand[0], 0), V(slotBand[0], hA), V(slotBand[1], hA), V(slotBand[1], 0)];
        return {
          end,
          tLo: band[0],
          tHi: band[1],
          depth: hA,
          path: end === 'rear' ? pathUp : [...pathUp].reverse(),
          profile,
          hinge: { x0, dir, reach, slot: slotBand, slotDepth: hA, seat, seatDepth: hB },
        };
      };
      hingeExits.rear = make(vJoint.xFront, -1, reachFront, 'rear');
      hingeExits.front = make(vJoint.xRear, 1, reachRear, 'front');
      if (jointPlan.pin && seat) {
        jointResult = { ...jointPlan, pin: { ...jointPlan.pin, from: seat[0], to: seat[1] } };
      }
    }
  }

  const buildHalf = (maleSide: boolean): THREE.BufferGeometry => {
    const sides = maleSide ? maleSides : femaleSides;
    const ends = maleSide ? maleEnds : femaleEnds;
    if (!vJoint) {
      return buildShell(surface, frame, { ...shared, sideExits: sides, endExits: ends }, maleSide);
    }
    // Deux segments : chacun recoit ses stations, ses logements et sa face en
    // V, puis les deux demi-coques d'un meme cote sortent dans un seul fichier.
    const xCutFront = vJoint.xFront;
    const inFront = (x: number) => x < xCutFront;
    const bbox = (outline: THREE.Vector2[]) => [
      Math.min(...outline.map((v) => v.x)),
      Math.max(...outline.map((v) => v.x)),
    ];
    const frontShell = buildShell(
      surface,
      frame,
      {
        ...shared,
        stations: stations.slice(0, split),
        pockets: pockets.filter((pocket) => bbox(pocket.outline)[1] < xCutFront),
        pegs: pegSolids.filter((peg) => inFront(peg.center.x)),
        chinSlots: chinSlots.filter((slot) => slot.iEnd < split),
        sideExits: sides.filter((exit) => exit.iEnd < split),
        endExits: [
          ...ends.filter((exit) => exit.end === 'front'),
          ...(hingeExits.rear ? [hingeExits.rear] : []),
        ],
        cutFront,
        cutRear: true,
        vRear: { x0: vJoint.xFront, tan: vJoint.tanFront },
      },
      maleSide,
    );
    const rearShell = buildShell(
      surface,
      frame,
      {
        ...shared,
        stations: stations.slice(split),
        pockets: pockets.filter((pocket) => bbox(pocket.outline)[0] > vJoint.xRear),
        pegs: pegSolids.filter((peg) => peg.center.x > vJoint.xRear),
        chinSlots: [],
        sideExits: sides
          .filter((exit) => exit.iStart >= split)
          .map((exit) => ({ ...exit, iStart: exit.iStart - split, iEnd: exit.iEnd - split })),
        endExits: [
          ...ends.filter((exit) => exit.end === 'rear'),
          ...(hingeExits.front ? [hingeExits.front] : []),
        ],
        cutFront: true,
        cutRear,
        vFront: { x0: vJoint.xRear, tan: vJoint.tanRear },
      },
      maleSide,
    );
    const merged = mergeParts([frontShell, rearShell]);
    frontShell.dispose();
    rearShell.dispose();
    return merged;
  };
  const male = buildHalf(true);
  const female = buildHalf(false);
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
    billProblem,
    dowels,
    screws: screwPlans,
    pegs: pegPlacements,
    glueGroove: grooveReport,
    jointPlan: jointResult,
    jointProblem,
    tailSlotProblem,
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

  // Un leurre articule se coupe en demi-coques segment par segment : la face
  // en V est verticale, le plan de joint doit l'etre aussi.
  if (params.articulation.enabled && params.assembly.planeAngle >= 5) {
    return "Un leurre articule se coupe en demi-coques dans son plan de symetrie : la face en V du joint est verticale, le plan de joint doit l'etre aussi. Ramenez l'orientation du joint a 0 deg.";
  }

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
  // Un corps anatomique creuse sa cuvette avec le loft lui-meme : chaque
  // station y reste un anneau plan, et les coques se construisent. Seul le
  // recul axial du profil historique est incompatible.
  if (!params.anatomy && params.popperFace.enabled && params.popperFace.depth > 0.05) {
    return "La face de popper recule la peau selon l'axe du leurre, d'une valeur qui change d'un point a l'autre de la section. Le decoupeur en deux coques suppose au contraire des sections planes : il ne sait pas construire le plan de joint sur une section creusee. Imprimez ce corps en une piece, ou desactivez la face de popper.";
  }

  return null;
}

/** Resolution des calculs d'interface : portees, fente, volume des coques. */
export const ASSEMBLY_PREVIEW: AssemblyResolution = { stations: 40, arcSamples: 10 };

/**
 * Assemblage leger, calcule UNE fois par reglage et partage : l'interface y
 * lit les portees et la fente, la physique le volume des coques, la vue 3D
 * les reperes. Trois calculs identiques rendaient le curseur lourd.
 */
export function assemblyPreview(profile: ProfileSampler, params: LureParams): AssemblyResult | null {
  return assemblyActive(params) ? buildAssembly(profile, params, ASSEMBLY_PREVIEW) : null;
}

/** Libere les maillages d'un resultat d'assemblage. */
export function disposeAssembly(result: AssemblyResult | null): void {
  if (!result) return;
  result.male.dispose();
  result.female.dispose();
  result.tenons?.dispose();
  result.socketPreview?.dispose();
  result.dowelPins?.dispose();
  for (const pin of result.pins) pin.geometry.dispose();
}

export function assemblyPlans(
  profile: ProfileSampler,
  params: LureParams,
  preview?: AssemblyResult | null,
): { sockets: SocketPlan[]; billPlan: BillSlotPlan | null } {
  if (!assemblyActive(params)) return { sockets: [], billPlan: null };
  if (preview) return { sockets: preview.sockets, billPlan: preview.billPlan };
  const result = buildAssembly(profile, params, ASSEMBLY_PREVIEW);
  disposeAssembly(result);
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
