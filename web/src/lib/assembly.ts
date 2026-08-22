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
 * Tout le mecanique du joint (alesage, canal, goujons, fente de bavette) se
 * ramene a une meme primitive : un contour ferme dans le plan, un ilot
 * optionnel, et une profondeur.
 */

import * as THREE from 'three';
import type { LureParams, PinAnchor, SocketMethod } from '../types/lure';
import { createSurfaceSampler, type SurfaceSampler } from './geometry';
import { autoPin, buildPin, getPin, type PinPart, type PinSpec } from './hardware';
import { MM_TO_CM, type ProfileSampler } from './profile';
import { bibTangLength } from './billTemplate';

const STATIONS = 112;
const ARC_SAMPLES = 40;

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

  triangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
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

const cw = (points: THREE.Vector2[]): THREE.Vector2[] =>
  signedArea(points) > 0 ? [...points].reverse() : points;

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

interface PlaneMapper {
  (t: number, n: number, x: number): THREE.Vector3;
}

/**
 * Remplit une region plane (contour + trous) a la cote `n`, en orientant les
 * triangles pour que leur normale suive `outward`.
 */
function triangulateChecked(
  contour: THREE.Vector2[],
  holes: THREE.Vector2[][],
): number[][] | null {
  const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
  // Invariant : un polygone a V sommets et H trous se triangule en
  // exactement V + 2H - 2 triangles. Tout autre resultat signale une
  // triangulation ratee, qui laisserait un trou beant dans la coque.
  const vertices = contour.length + holes.reduce((sum, hole) => sum + hole.length, 0);
  const expected = vertices + 2 * holes.length - 2;
  return faces.length === expected ? faces : null;
}

function emitPatch(
  mesh: MeshBuilder,
  contour: THREE.Vector2[],
  holes: THREE.Vector2[][],
  n: number,
  outward: 1 | -1,
  map: PlaneMapper,
): void {
  const outline = ccw(dedupe(contour));
  const rings = holes.map((hole) => cw(dedupe(hole)));
  if (outline.length < 3) return;

  const faces = triangulateChecked(outline, rings);
  if (!faces) return;
  const all = [...outline, ...rings.flat()];
  for (const [i0, i1, i2] of faces) {
    const a = map(all[i0].y, n, all[i0].x);
    const b = map(all[i1].y, n, all[i1].x);
    const c = map(all[i2].y, n, all[i2].x);
    // Contour en sens trigonometrique : la normale sort vers +n.
    if (outward > 0) mesh.triangle(a, b, c);
    else mesh.triangle(a, c, b);
  }
}

/** Paroi verticale le long d'un contour, entre deux cotes de profondeur. */
function emitWall(
  mesh: MeshBuilder,
  contour: THREE.Vector2[],
  nTop: number,
  nBottom: number,
  outward: 1 | -1,
  map: PlaneMapper,
): void {
  const points = dedupe(contour);
  if (points.length < 3) return;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const p0 = map(a.y, nTop, a.x);
    const p1 = map(b.y, nTop, b.x);
    const p2 = map(b.y, nBottom, b.x);
    const p3 = map(a.y, nBottom, a.x);
    if (outward > 0) mesh.quad(p0, p1, p2, p3);
    else mesh.quad(p0, p3, p2, p1);
  }
}

// ---------------------------------------------------------------------------
// Contours du logement de goupille
// ---------------------------------------------------------------------------

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
 * Union du logement circulaire et de sa rainure de sortie, dans une direction
 * quelconque : arc du disque hors de la rainure, puis les deux flancs.
 */
function seatOutline(
  center: THREE.Vector2,
  radius: number,
  direction: THREE.Vector2,
  reach: number,
  halfWidth: number,
): THREE.Vector2[] {
  const w = Math.min(halfWidth, radius * 0.8);
  const tangent = Math.asin(w / radius);
  const base = Math.atan2(direction.y, direction.x);
  const perpendicular = new THREE.Vector2(-direction.y, direction.x);
  const far = center.clone().addScaledVector(direction, reach);

  const points: THREE.Vector2[] = [far.clone().addScaledVector(perpendicular, w)];
  const steps = 72;
  for (let i = 0; i <= steps; i++) {
    const a = base + tangent + ((Math.PI * 2 - 2 * tangent) * i) / steps;
    points.push(
      new THREE.Vector2(center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius),
    );
  }
  points.push(far.clone().addScaledVector(perpendicular, -w));
  return points;
}

// ---------------------------------------------------------------------------
// Description d'une poche du plan de joint
// ---------------------------------------------------------------------------

interface Pocket {
  outline: THREE.Vector2[];
  /** Profondeur creusee dans la matiere, en cm. */
  depth: number;
  /** Matiere laissee au niveau du joint : embase du goujon, ou collerette. */
  island?: THREE.Vector2[];
  /** Percage plus profond dans le fond : logement du goujon male. */
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
  /** Goupilles modelisees, une par ancrage. */
  pins: PinPart[];
  sockets: SocketPlan[];
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
    // Bissection sur l'intervalle, en tenant compte du bouclage a 2*PI.
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

/** Etendue transverse du plan de joint a une abscisse donnee. */
function faceRangeAt(
  surface: SurfaceSampler,
  frame: JointFrame,
  stations: Station[],
  x: number,
): [number, number] | null {
  let best: Station | null = null;
  let bestDistance = Infinity;
  for (const station of stations) {
    if (station.degenerate) continue;
    const distance = Math.abs(station.x - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = station;
    }
  }
  if (!best) return null;
  const a = surface(best.p, best.theta1);
  const b = surface(best.p, best.theta2);
  const t1 = frame.transverseOf(a.y, a.z);
  const t2 = frame.transverseOf(b.y, b.z);
  // Hors de la plage des stations, le corps n'existe pas.
  if (x < stations[0].x || x > stations[stations.length - 1].x) return null;
  return [Math.min(t1, t2), Math.max(t1, t2)];
}

/**
 * Fente d'insertion d'une bavette rapportee, tracee dans le plan de joint et
 * rognee pour rester dans la matiere.
 *
 * La fente suit l'angle de la bavette. Elle ne debouche pas : on la raccourcit
 * jusqu'a ce que ses quatre coins tiennent dans le joint avec une marge, et
 * les derniers dixiemes se reprennent a la lime au montage — exactement comme
 * on ajuste une bavette du commerce.
 */
function buildBillSlot(
  profile: ProfileSampler,
  params: LureParams,
  surface: SurfaceSampler,
  frame: JointFrame,
  stations: Station[],
): THREE.Vector2[] | null {
  const angle = THREE.MathUtils.degToRad(Math.min(Math.max(params.bibAngle, 5), 89));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Meme jeu d'insertion que celui expose dans les parametres de fabrication.
  const half = (params.billThickness * MM_TO_CM + params.fabrication.billFit * MM_TO_CM) / 2;
  const offset = Math.min(
    Math.max(params.billOffset * MM_TO_CM, 0),
    profile.lengthCm * 0.3,
  );
  const anchorP = Math.min(Math.max(offset / Math.max(profile.lengthCm, 1e-6) + 0.03, 0.03), 0.4);
  const anchor = profile.section(anchorP);
  const originX = profile.xAt(0) + offset;
  const originT = anchor.bottom * 0.55;
  const margin = 0.08; // 0,8 mm de peau conservee

  // u > 0 : vers l'avant et vers le bas, comme la bavette elle-meme.
  const along = (u: number, v: number) =>
    new THREE.Vector2(originX - u * cos + v * sin, originT - u * sin - v * cos);

  const fits = (u: number) =>
    [half, -half].every((v) => {
      const point = along(u, v);
      const range = faceRangeAt(surface, frame, stations, point.x);
      if (!range) return false;
      return point.y > range[0] + margin && point.y < range[1] - margin;
    });

  const search = (limit: number) => {
    let best = 0;
    for (let i = 1; i <= 24; i++) {
      const u = (limit * i) / 24;
      if (!fits(u)) break;
      best = u;
    }
    return best;
  };

  const front = search(bibTangLength(params) + profile.lengthCm * 0.06);
  const back = search(-(bibTangLength(params) * 1.1));
  if (front <= 0.05 || back >= -0.05) return null;

  return [along(back, half), along(front, half), along(front, -half), along(back, -half)];
}

function buildShell(
  surface: SurfaceSampler,
  frame: JointFrame,
  stations: Station[],
  pockets: Pocket[],
  tenonHoles: THREE.Vector2[][],
  maleSide: boolean,
  arcSamples: number,
): THREE.BufferGeometry {
  const mesh = new MeshBuilder();
  const map: PlaneMapper = (t, n, x) => {
    const signed = maleSide ? n : -n;
    const { y, z } = frame.toWorld(t, signed);
    return new THREE.Vector3(x, y, z);
  };

  // --- Peau exterieure ----------------------------------------------------
  const rings: THREE.Vector3[][] = [];
  const rims: { first: THREE.Vector2; last: THREE.Vector2 }[] = [];
  for (const station of stations) {
    const [from, to] = arcRange(surface, frame, station, maleSide);
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j <= arcSamples; j++) {
      const theta = from + ((to - from) * j) / arcSamples;
      ring.push(surface(station.p, theta).clone());
    }
    rings.push(ring);
    const first = ring[0];
    const last = ring[arcSamples];
    rims.push({
      first: new THREE.Vector2(station.x, frame.transverseOf(first.y, first.z)),
      last: new THREE.Vector2(station.x, frame.transverseOf(last.y, last.z)),
    });
  }

  for (let i = 0; i < stations.length - 1; i++) {
    for (let j = 0; j < arcSamples; j++) {
      if (maleSide) mesh.quad(rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j]);
      else mesh.quad(rings[i][j], rings[i + 1][j], rings[i + 1][j + 1], rings[i][j + 1]);
    }
  }

  // --- Plan de joint ------------------------------------------------------
  // Contour : un bord du nez a la queue, l'autre en sens inverse.
  const contour = [...rims.map((r) => r.first), ...rims.map((r) => r.last).reverse()];

  // Une poche dont le trou ferait echouer la triangulation du joint est
  // ecartee AVANT emission : mieux vaut une coque pleine et fermee qu'une
  // coque trouee. Les portees concernees sont deja signalees en rouge.
  const kept: Pocket[] = [];
  const holes: THREE.Vector2[][] = [];
  const outlineOf = ccw(dedupe(contour));
  for (const pocket of [...pockets, ...tenonHoles.map((outline) => ({ outline, depth: 0 }))]) {
    const candidate = [...holes, cw(dedupe(pocket.outline))];
    if (!triangulateChecked(outlineOf, candidate)) continue;
    holes.push(cw(dedupe(pocket.outline)));
    if (pocket.depth > 0) kept.push(pocket);
  }
  emitPatch(mesh, contour, holes, 0, -1, map);

  // --- Poches : portees de goupille, alesages, fente de bavette -----------
  for (const pocket of kept) {
    emitWall(mesh, pocket.outline, 0, pocket.depth, 1, map);
    const floorHoles: THREE.Vector2[][] = [];
    if (pocket.island) floorHoles.push(pocket.island);
    if (pocket.bore) floorHoles.push(pocket.bore.outline);
    emitPatch(mesh, pocket.outline, floorHoles, pocket.depth, -1, map);

    if (pocket.island) {
      // L'ilot reste en matiere : c'est l'embase qui retient la boucle.
      emitWall(mesh, pocket.island, 0, pocket.depth, -1, map);
      emitPatch(mesh, pocket.island, [], 0, -1, map);
    }
    if (pocket.bore) {
      // Alesage femelle, en vis-a-vis exact du goujon male.
      emitWall(mesh, pocket.bore.outline, pocket.depth, pocket.bore.depth, 1, map);
      emitPatch(mesh, pocket.bore.outline, [], pocket.bore.depth, -1, map);
    }
  }

  return mesh.build();
}

export function buildAssembly(
  profile: ProfileSampler,
  params: LureParams,
  resolution: AssemblyResolution = ASSEMBLY_DISPLAY,
): AssemblyResult {
  const surface = createSurfaceSampler(profile, params);
  const frame = jointFrame(params.assembly.planeAngle);
  const fabrication = params.fabrication;

  const stations: Station[] = [];
  for (let i = 0; i <= resolution.stations; i++) {
    const p = (i / resolution.stations) * profile.bodyEnd;
    stations.push(findStation(surface, frame, p, profile.xAt(p)));
  }

  // --- Portees engendrees par les ancrages ---------------------------------
  const plans: SocketPlan[] = [];
  const malePockets: Pocket[] = [];
  const femalePockets: Pocket[] = [];
  const tenonCircles: { center: THREE.Vector2; radius: number; height: number }[] = [];
  const pins: PinPart[] = [];
  const previews: { center: THREE.Vector2; radius: number; depth: number }[] = [];

  for (const anchor of params.assembly.anchors) {
    const spec = anchorPin(params, anchor);
    const position = Math.min(Math.max(anchor.position, 0.02), profile.bodyEnd - 0.02);
    const x = profile.xAt(position);
    const range = faceRangeAt(surface, frame, stations, x);

    // Cotes deduites de la goupille : le goujon traverse la petite boucle.
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
    const seatDepth = anchor.method === 'bore' ? wireRadius : sweepRadius;
    // Methode B : la collerette conserve la matiere interieure a la boucle.
    const collarRadius =
      anchor.method === 'bore'
        ? tenonRadius
        : Math.max(loopCenterRadius - sweepRadius - channelOffset, tenonRadius);

    let t = 0;
    let valid = true;
    let problem: string | null = null;
    if (!range) {
      valid = false;
      problem = 'Ancrage hors du corps.';
    } else {
      const [tMin, tMax] = range;
      t = anchor.height >= 0 ? anchor.height * tMax : -anchor.height * tMin;
      const margin = 0.05;
      const low = tMin + seatRadius + margin;
      const high = tMax - seatRadius - margin;
      if (low > high) {
        valid = false;
        problem = `La portee de ${spec.loopWidth} mm ne tient pas dans la section a cet endroit.`;
      } else if (t < low || t > high) {
        t = Math.min(Math.max(t, low), high);
      }
    }

    const center = new THREE.Vector2(x, t);
    for (const other of plans) {
      if (other.center.distanceTo(center) < other.seatRadius + seatRadius) {
        valid = false;
        problem = 'Chevauchement avec une autre portee.';
      }
    }

    // Rainure de sortie : direction reglable, rognee pour rester dans la peau.
    const angle = THREE.MathUtils.degToRad(anchor.axisAngle);
    const direction = new THREE.Vector2(-Math.cos(angle), -Math.sin(angle));
    const slotHalf = Math.max(wireRadius * 1.25, seatDepth);
    const reach = valid
      ? maxReach(surface, frame, stations, center, direction, slotHalf, seatRadius)
      : 0;
    const outline = valid
      ? seatOutline(center, seatRadius, direction, reach, slotHalf)
      : [];

    // Le contour doit tenir ENTIER dans le plan de joint : verifier le seul
    // centre laisse passer les portees qui debordent la ou la section se
    // retrecit, et un trou hors contour casse la triangulation.
    if (valid) {
      const margin = 0.1;
      for (const point of outline) {
        const range = faceRangeAt(surface, frame, stations, point.x);
        if (!range || point.y <= range[0] + margin || point.y >= range[1] - margin) {
          valid = false;
          problem = 'La portee deborde de la coque a cet endroit : reculez l ancrage ou prenez une goupille plus petite.';
          break;
        }
      }
    }

    const world = frame.toWorld(t, 0);
    plans.push({
      anchorId: anchor.id,
      spec,
      center,
      world: new THREE.Vector3(x, world.y, world.z),
      tenonRadius,
      tenonHeight,
      seatRadius,
      seatDepth,
      method: anchor.method,
      valid,
      problem,
    });

    if (!valid) continue;

    malePockets.push({
      outline,
      depth: seatDepth,
      island: circleOutline(center, collarRadius, 48),
    });
    femalePockets.push({
      outline,
      depth: seatDepth,
      bore: {
        outline: circleOutline(center, tenonRadius + (fabrication.tenonFit * MM_TO_CM) / 2, 48),
        depth: seatDepth + tenonHeight,
      },
    });
    tenonCircles.push({ center, radius: tenonRadius, height: tenonHeight });
    previews.push({ center, radius: seatRadius, depth: seatDepth });

    pins.push(
      buildPin(
        spec,
        new THREE.Vector3(x, world.y, world.z),
        THREE.MathUtils.degToRad(params.assembly.planeAngle),
        anchor.axisAngle,
      ),
    );
  }

  // --- Fente de bavette rapportee -----------------------------------------
  const slot =
    params.hasBib && params.billMode === 'polycarbonate'
      ? buildBillSlot(profile, params, surface, frame, stations)
      : null;
  if (slot) {
    const depth = Math.max((params.bibWidth * MM_TO_CM) / 2, 0.15);
    malePockets.push({ outline: slot, depth });
    femalePockets.push({ outline: slot, depth });
  }

  const male = buildShell(surface, frame, stations, malePockets, [], true, resolution.arcSamples);
  const female = buildShell(surface, frame, stations, femalePockets, [], false, resolution.arcSamples);
  const tenons = buildTenonSolids(tenonCircles, frame);
  const socketPreview = buildSocketPreview(previews, frame);

  const normal = frame.toWorld(0, 1);
  const fallback = resolvePin(params);
  return {
    male,
    female,
    tenons,
    socketPreview,
    pins,
    sockets: plans,
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
export function socketPlans(profile: ProfileSampler, params: LureParams): SocketPlan[] {
  if (!params.assembly.enabled) return [];
  return buildAssembly(profile, params, { stations: 40, arcSamples: 8 }).sockets;
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
  const a = surface(position, station.theta1);
  const t1 = frame.transverseOf(a.y, a.z);
  const b = surface(position, station.theta2);
  const t2 = frame.transverseOf(b.y, b.z);
  const tMax = Math.max(t1, t2);
  const tMin = Math.min(t1, t2);

  const t = frame.transverseOf(point.y, point.z);
  let height = 0;
  if (t >= 0 && tMax > 1e-6) height = t / tMax;
  else if (t < 0 && tMin < -1e-6) height = -t / tMin;
  return { position, height: Math.min(Math.max(height, -1), 1) };
}

/** Goupille retenue pour un ancrage : la sienne, ou celle deduite du leurre. */
export function anchorPin(params: LureParams, anchor: PinAnchor): PinSpec {
  if (anchor.pin !== 'auto') return getPin(anchor.pin);
  return resolvePin(params);
}

/** Longueur de rainure possible avant de percer la peau. */
function maxReach(
  surface: SurfaceSampler,
  frame: JointFrame,
  stations: Station[],
  center: THREE.Vector2,
  direction: THREE.Vector2,
  halfWidth: number,
  seatRadius: number,
): number {
  const perpendicular = new THREE.Vector2(-direction.y, direction.x);
  // 1,2 mm de matiere conservee : une poche trop proche du bord fait echouer
  // la triangulation la ou le contour se pince, vers les pointes.
  const margin = 0.12;
  const fits = (reach: number) =>
    [halfWidth, -halfWidth].every((v) => {
      const point = center
        .clone()
        .addScaledVector(direction, reach)
        .addScaledVector(perpendicular, v);
      const range = faceRangeAt(surface, frame, stations, point.x);
      if (!range) return false;
      return point.y > range[0] + margin && point.y < range[1] - margin;
    });

  let best = seatRadius * 1.05;
  const limit = seatRadius * 6;
  for (let i = 1; i <= 32; i++) {
    const reach = seatRadius + ((limit - seatRadius) * i) / 32;
    if (!fits(reach)) break;
    best = reach;
  }
  return best;
}

/** Goujons males : cylindres fermes poses sur le plan de joint. */
function buildTenonSolids(
  tenons: { center: THREE.Vector2; radius: number; height: number }[],
  frame: JointFrame,
): THREE.BufferGeometry | null {
  if (tenons.length === 0) return null;
  const mesh = new MeshBuilder();
  const map: PlaneMapper = (t, n, x) => {
    const { y, z } = frame.toWorld(t, n);
    return new THREE.Vector3(x, y, z);
  };
  for (const tenon of tenons) {
    const outline = circleOutline(tenon.center, tenon.radius, 40);
    // Le goujon sort de la coque male : il occupe -height a 0.
    emitWall(mesh, outline, -tenon.height, 0, 1, map);
    emitPatch(mesh, outline, [], -tenon.height, 1, map);
    emitPatch(mesh, outline, [], 0, -1, map);
  }
  return mesh.build();
}

/**
 * Volume des portees, materialise pour l'affichage : un disque plat centre sur
 * le plan de joint, que l'on rend en surbrillance pour verifier la position et
 * la forme du logement avant export.
 */
function buildSocketPreview(
  seats: { center: THREE.Vector2; radius: number; depth: number }[],
  frame: JointFrame,
): THREE.BufferGeometry | null {
  if (seats.length === 0) return null;
  const mesh = new MeshBuilder();
  const map: PlaneMapper = (t, n, x) => {
    const { y, z } = frame.toWorld(t, n);
    return new THREE.Vector3(x, y, z);
  };
  for (const seat of seats) {
    const outline = circleOutline(seat.center, seat.radius, 48);
    emitWall(mesh, outline, -seat.depth, seat.depth, 1, map);
    emitPatch(mesh, outline, [], seat.depth, 1, map);
    emitPatch(mesh, outline, [], -seat.depth, -1, map);
  }
  return mesh.build();
}
