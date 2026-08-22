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
import type { LureParams } from '../types/lure';
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

  const faces = THREE.ShapeUtils.triangulateShape(outline, rings);
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
 * Union du logement circulaire et de la rainure de sortie qui file vers le
 * nez : arc du disque hors de la rainure, puis les deux flancs de celle-ci.
 */
function socketOutline(
  center: THREE.Vector2,
  radius: number,
  exitX: number,
  halfWidth: number,
): THREE.Vector2[] {
  const w = Math.min(halfWidth, radius * 0.8);
  const tangent = Math.asin(w / radius);
  const points: THREE.Vector2[] = [new THREE.Vector2(exitX, center.y + w)];
  const from = Math.PI - tangent;
  const to = -Math.PI + tangent;
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const a = from - ((from - to) * i) / steps;
    points.push(
      new THREE.Vector2(center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius),
    );
  }
  points.push(new THREE.Vector2(exitX, center.y - w));
  return points;
}

// ---------------------------------------------------------------------------
// Description d'une poche du plan de joint
// ---------------------------------------------------------------------------

interface Pocket {
  outline: THREE.Vector2[];
  /** Profondeur creusee dans la matiere, en cm. */
  depth: number;
  /** Matiere laissee au centre (interieur de la boucle, methode B). */
  island?: THREE.Vector2[];
}

export interface AssemblyResult {
  male: THREE.BufferGeometry;
  female: THREE.BufferGeometry;
  /** Goujons d'alignement : solides distincts poses sur la coque male. */
  tenons: THREE.BufferGeometry | null;
  pin: PinPart;
  pinSpec: PinSpec;
  /** Direction d'ecartement pour la vue eclatee. */
  splitNormal: THREE.Vector3;
  /** Profondeur du logement, en mm, pour l'affichage. */
  socketDepthMm: number;
}

export function resolvePin(params: LureParams): PinSpec {
  const id =
    params.assembly.pin === 'auto'
      ? autoPin(params.length, params.assembly.roughWater)
      : params.assembly.pin;
  return getPin(id);
}

/** Diametre des goujons : proportionnel a la largeur du corps si laisse a 0. */
export function tenonRadius(params: LureParams): number {
  const auto = params.maxWidth * 0.22;
  const diameter = params.assembly.tenonDiameter > 0 ? params.assembly.tenonDiameter : auto;
  return Math.max(diameter, 1.2) * MM_TO_CM * 0.5;
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
  const half = (params.billThickness * MM_TO_CM + 0.02) / 2;
  const anchor = profile.section(0.07);
  const originX = profile.xAt(0.045);
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

/**
 * Abscisse de la station la plus avant ou la largeur du plan de joint
 * depasse `minHalfWidth`. C'est la que la rainure de sortie peut deboucher
 * sans percer la peau.
 */
function frontExit(
  surface: SurfaceSampler,
  frame: JointFrame,
  stations: Station[],
  minHalfWidth: number,
): number {
  for (const station of stations) {
    if (station.degenerate) continue;
    const a = surface(station.p, station.theta1);
    const t1 = frame.transverseOf(a.y, a.z);
    const b = surface(station.p, station.theta2);
    const t2 = frame.transverseOf(b.y, b.z);
    if (Math.abs(t1 - t2) / 2 >= minHalfWidth) return station.x;
  }
  return stations[Math.floor(stations.length / 4)].x;
}

function buildShell(
  surface: SurfaceSampler,
  frame: JointFrame,
  stations: Station[],
  pockets: Pocket[],
  tenonHoles: THREE.Vector2[][],
  tenonDepth: number,
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
  const holes = [...pockets.map((pocket) => pocket.outline), ...tenonHoles];
  emitPatch(mesh, contour, holes, 0, -1, map);

  // --- Poches : logement de goupille, fente de bavette --------------------
  for (const pocket of pockets) {
    emitWall(mesh, pocket.outline, 0, pocket.depth, 1, map);
    emitPatch(mesh, pocket.outline, pocket.island ? [pocket.island] : [], pocket.depth, -1, map);
    if (pocket.island) {
      // L'ilot central reste en matiere : c'est lui qui retient la boucle.
      emitWall(mesh, pocket.island, 0, pocket.depth, -1, map);
      emitPatch(mesh, pocket.island, [], 0, -1, map);
    }
  }

  // --- Logements de goujons (coque femelle) -------------------------------
  for (const hole of tenonHoles) {
    emitWall(mesh, hole, 0, tenonDepth, 1, map);
    emitPatch(mesh, hole, [], tenonDepth, -1, map);
  }

  return mesh.build();
}

/** Goujons males : cylindres fermes poses sur le plan de joint. */
function buildTenonSolids(
  centers: THREE.Vector2[],
  radius: number,
  height: number,
  frame: JointFrame,
): THREE.BufferGeometry | null {
  if (centers.length === 0) return null;
  const mesh = new MeshBuilder();
  const map: PlaneMapper = (t, n, x) => {
    const { y, z } = frame.toWorld(t, n);
    return new THREE.Vector3(x, y, z);
  };
  const steps = 40;
  for (const center of centers) {
    const outline = circleOutline(center, radius, steps);
    // Le goujon sort de la matiere male : il occupe -height a 0.
    emitWall(mesh, outline, -height, 0, 1, map);
    emitPatch(mesh, outline, [], -height, 1, map);
    emitPatch(mesh, outline, [], 0, -1, map);
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
  const spec = resolvePin(params);

  const stations: Station[] = [];
  for (let i = 0; i <= resolution.stations; i++) {
    const p = (i / resolution.stations) * profile.bodyEnd;
    stations.push(findStation(surface, frame, p, profile.xAt(p)));
  }

  // --- Logement de goupille ------------------------------------------------
  const wireRadius = (spec.wire * MM_TO_CM) / 2;
  const loopRadius = (spec.loopWidth * MM_TO_CM) / 2;
  const channelOffsetCm = params.assembly.channelOffset * MM_TO_CM;
  const grooveHalfWidth = wireRadius + channelOffsetCm;
  // Le logement de goupille se place juste derriere le nez. Avec une bavette
  // rapportee, il doit reculer derriere la fente d'insertion : deux poches qui
  // se recouvrent ne formeraient pas un contour valide, et physiquement la
  // goupille passe bien derriere la bavette.
  const slot =
    params.hasBib && params.billMode === 'polycarbonate'
      ? buildBillSlot(profile, params, surface, frame, stations)
      : null;
  const slotRear = slot ? Math.max(...slot.map((point) => point.x)) : -Infinity;
  const center = new THREE.Vector2(
    Math.max(
      profile.xAt(0) + loopRadius + profile.lengthCm * 0.07,
      slotRear + loopRadius + grooveHalfWidth + profile.lengthCm * 0.03,
    ),
    0,
  );
  // La rainure de sortie doit rester strictement dans le plan de joint : un
  // trou qui deborde du contour invalide la triangulation, et la peau du nez
  // serait percee. On s'arrete donc a la premiere station ou le joint est
  // assez large, et les derniers millimetres de fil sont simplement pinces
  // entre les deux coques — ce qui est aussi ce qui empeche la goupille de
  // tourner une fois collee.
  const slotHalfWidth = Math.max(wireRadius * 1.2, grooveHalfWidth);
  const exitX = frontExit(surface, frame, stations, slotHalfWidth * 1.8);

  const pocket: Pocket =
    params.assembly.socketMethod === 'bore'
      ? {
          // Methode A : alesage simple, jeu diametral sur le cercle de la
          // goupille. Toute la matiere du disque part.
          outline: socketOutline(
            center,
            loopRadius + (params.assembly.boreClearance * MM_TO_CM) / 2,
            exitX,
            slotHalfWidth,
          ),
          depth: wireRadius,
        }
      : {
          // Methode B : le canal suit la silhouette reelle du fil. Seule la
          // bande le long du trace est evidee ; la matiere interieure a la
          // boucle reste, et retient la goupille.
          outline: socketOutline(center, loopRadius + grooveHalfWidth, exitX, slotHalfWidth),
          depth: grooveHalfWidth,
          island: circleOutline(center, Math.max(loopRadius - grooveHalfWidth, wireRadius * 0.5), 56),
        };

  // --- Goujons d'alignement ------------------------------------------------
  const radius = tenonRadius(params);
  const count = Math.max(1, Math.round(params.assembly.tenonCount));
  const tenonCenters: THREE.Vector2[] = [];
  for (let i = 0; i < count; i++) {
    // Repartis derriere le logement de goupille, sur l'axe.
    const t = 0.42 + (i / Math.max(count, 1)) * 0.42;
    tenonCenters.push(new THREE.Vector2(profile.xAt(t), 0));
  }
  const tenonHeight = Math.max(radius * 1.6, 0.15);
  const clearance = params.assembly.tenonClearance * MM_TO_CM;
  const tenonHoles = tenonCenters.map((c) => circleOutline(c, radius + clearance, 40));

  // Bavette rapportee : la fente d'insertion est une poche de plus, taillee
  // dans les deux coques puisque la plaque traverse le plan de joint.
  const pockets: Pocket[] = [pocket];
  if (slot) {
    pockets.push({
      outline: slot,
      depth: Math.max((params.bibWidth * MM_TO_CM) / 2, 0.15),
    });
  }

  const male = buildShell(surface, frame, stations, pockets, [], tenonHeight, true, resolution.arcSamples);
  const female = buildShell(surface, frame, stations, pockets, tenonHoles, tenonHeight, false, resolution.arcSamples);
  const tenons = buildTenonSolids(tenonCenters, radius, tenonHeight, frame);

  const origin = frame.toWorld(0, 0);
  const pin = buildPin(
    spec,
    new THREE.Vector3(center.x, origin.y, origin.z),
    THREE.MathUtils.degToRad(params.assembly.planeAngle),
  );

  const normal = frame.toWorld(0, 1);
  return {
    male,
    female,
    tenons,
    pin,
    pinSpec: spec,
    splitNormal: new THREE.Vector3(0, normal.y, normal.z).normalize(),
    socketDepthMm: pocket.depth * 10,
  };
}
