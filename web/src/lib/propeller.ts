/**
 * Helice rotative de queue — module AP.1.
 *
 * Trois pieces enfilees sur le fil traversant, qui leur sert d'axe :
 *
 *   corps | jeu | perle | jeu | moyeu d'helice | jeu | boucle de queue
 *
 * La boucle formee au bout du fil retient l'helice et porte l'hamecon
 * arriere. Rien n'est colle, rien n'est serre : l'helice tourne librement,
 * la perle l'ecarte du corps.
 *
 * Les jeux ne forment PAS une seconde table de tolerances. Ce sont ceux des
 * cylindres de retention du joint articule : l'helice tourne autour du fil
 * exactement comme la boucle d'oeillet tourne autour de son cylindre, c'est
 * donc le jeu de boucle qui s'applique — a l'alesage, entre helice et perle,
 * entre perle et corps.
 *
 * La rotation se verifie comme le joint articule : on rejoue le tour complet
 * par pas de 5 degres et on mesure, a chaque pas, ce que chaque sommet de
 * l'helice trouve devant lui — corps, perle, axe, hamecons.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LureParams, PropellerConfig } from '../types/lure';
import { MM_TO_CM, type ProfileSampler } from './profile';
import { sweepRotation, type JointHit, type SweepObstacle } from './jointCheck';
import { resolveMount } from './tackle';
import { getMaterial } from './materials';

export const defaultPropeller = (): PropellerConfig => ({
  enabled: false,
  blades: 1,
  diameter: 30,
  bladeAngle: 35,
  bladeThickness: 1.2,
  hubLength: 20,
  beadDiameter: 10,
  beadPrinted: true,
});

/** Pas du balayage de rotation, en degres (module AR). */
export const PROPELLER_SWEEP_STEP_DEG = 5;

/** Paroi minimale du moyeu autour de son alesage, en mm. */
const HUB_WALL_MM = 1.2;
/** Marge axiale entre les aretes de pale et les faces du moyeu, en mm. */
const BLADE_MARGIN_MM = 0.4;
/** Creux de pale au bout, en mm : la pale est legerement cuilleree. */
const CUP_MM = 0.9;
/** Densite d'une perle achetee (verre), en g/cm3 — estimation. */
export const BOUGHT_BEAD_DENSITY = 2.5;

/** Raison pour laquelle l'helice ne peut pas etre montee, ou null. */
export function propellerBlocker(params: LureParams): string | null {
  if (!params.propeller.enabled) return null;
  if (!params.throughWire.enabled) {
    return "L'helice tourne sur le fil traversant, qui lui sert d'axe : activez le montage traversant (onglet Assemblage).";
  }
  if (params.articulation.enabled) {
    return "Un leurre articule n'a pas de fil traversant d'un bout a l'autre : l'helice n'a pas d'axe.";
  }
  return null;
}

/**
 * Longueur de fil ajoutee derriere la pointe de queue, boucle non comprise,
 * en mm : trois jeux de boucle, la perle et le moyeu. Le montage traversant
 * s'en sert pour peser son fil sans connaitre le profil.
 */
export function propellerExtensionMm(params: LureParams): number {
  if (!params.propeller.enabled || propellerBlocker(params)) return 0;
  const fit = params.articulation.retentionLoopFit;
  const bore = params.throughWire.wireMm / 2 + fit / 2;
  const beadRadius = Math.max(params.propeller.beadDiameter / 2, bore + 0.5);
  return 3 * fit + 2 * beadRadius + Math.max(params.propeller.hubLength, 3);
}

export interface PropellerPlan {
  config: PropellerConfig;
  /** Jeu de fonctionnement retenu (diametral), en cm : le jeu de boucle des cylindres de retention. */
  fit: number;
  wireRadius: number;
  /** Rayon d'alesage de l'helice et de la perle, en cm. */
  boreRadius: number;
  hubRadius: number;
  /** Rayon hors-tout des pales, en cm. */
  radius: number;
  /** Pointe de queue du corps, sur l'axe, en cm. */
  xTail: number;
  bead: { center: number; radius: number };
  hub: { x0: number; x1: number };
  /** Boucle de queue formee au bout du fil : centre et rayon exterieur, en cm. */
  loop: { x: number; outer: number };
  /** Pas de l'helice (avance par tour), en cm. */
  pitch: number;
  /** Ouverture angulaire de chaque pale, en radians. */
  span: number;
  /** Avance axiale utile d'une pale, en cm. */
  advance: number;
  /** Longueur de fil ajoutee derriere la pointe de queue (boucle non comprise), en cm. */
  extensionCm: number;
}

/**
 * Cotes du montage, deduites des reglages et des jeux existants.
 *
 * Tout est exprime dans le repere du leurre : x vers l'arriere, axe du fil
 * sur y = z = 0 (le canal traversant court dans le plan de joint, a mi-
 * hauteur de la pointe de queue).
 */
export function planPropeller(params: LureParams, profile: ProfileSampler): PropellerPlan {
  const config = params.propeller;
  const fit = params.articulation.retentionLoopFit * MM_TO_CM;
  const wireRadius = (params.throughWire.wireMm * MM_TO_CM) / 2;
  const boreRadius = wireRadius + fit / 2;
  const hubRadius = boreRadius + HUB_WALL_MM * MM_TO_CM;
  const radius = Math.max((config.diameter * MM_TO_CM) / 2, hubRadius + 0.2);
  // Pointe de queue reellement imprimee : les coques sont coupees la ou la
  // section loge le canal du fil avec sa peau (meme regle que le constructeur
  // de coques). La perle s'appuie sur cette face-la.
  const channelReach = ((params.throughWire.wireMm + params.throughWire.clearanceMm) * MM_TO_CM) / 2 + 0.05;
  let pTail = profile.bodyEnd;
  for (let i = 1; i <= 60; i++) {
    const p = profile.bodyEnd - (profile.bodyEnd * 0.3 * i) / 60;
    const s = profile.section(p);
    if (Math.min(s.top, -s.bottom, s.halfWidth) >= channelReach) {
      pTail = p;
      break;
    }
  }
  const xTail = profile.xAt(pTail);
  const beadRadius = Math.max((config.beadDiameter * MM_TO_CM) / 2, boreRadius + 0.05);
  const beadCenter = xTail + fit + beadRadius;
  const hubLength = Math.max(config.hubLength * MM_TO_CM, 0.3);
  const x0 = beadCenter + beadRadius + fit;
  const x1 = x0 + hubLength;
  const loopOuter = (params.throughWire.loopMm * MM_TO_CM) / 2;
  const loopX = x1 + fit + loopOuter;

  // Pas geometrique d'une helicoide : l'angle de pale est donne a 70 % du
  // rayon, comme sur toute helice. Plus l'angle est faible, plus la pale
  // s'enroule autour du moyeu pour la meme avance.
  const beta = THREE.MathUtils.degToRad(Math.min(Math.max(config.bladeAngle, 5), 80));
  const pitch = 2 * Math.PI * 0.7 * radius * Math.tan(beta);
  // L'epaisseur se prend normale a la pale : son empreinte axiale vaut au
  // plus une demi-epaisseur de chaque cote (au saumon, ou la pale est la
  // plus couchee). C'est elle qui borne l'avance utile dans le moyeu.
  const halfAxial = (config.bladeThickness * MM_TO_CM) / 2;
  const room = hubLength - 2 * BLADE_MARGIN_MM * MM_TO_CM - 2 * halfAxial - CUP_MM * MM_TO_CM;
  const maxSpan = config.blades === 1 ? THREE.MathUtils.degToRad(320) : THREE.MathUtils.degToRad(165);
  const span = Math.min(Math.max((2 * Math.PI * Math.max(room, 0.05)) / pitch, THREE.MathUtils.degToRad(30)), maxSpan);
  const advance = (pitch * span) / (2 * Math.PI);

  return {
    config,
    fit,
    wireRadius,
    boreRadius,
    hubRadius,
    radius,
    xTail,
    bead: { center: beadCenter, radius: beadRadius },
    hub: { x0, x1 },
    loop: { x: loopX, outer: loopOuter },
    pitch,
    span,
    advance,
    extensionCm: x1 + fit - xTail,
  };
}

// ---------------------------------------------------------------------------
// Geometries
// ---------------------------------------------------------------------------

class Builder {
  positions: number[] = [];
  indices: number[] = [];
  add(x: number, y: number, z: number): number {
    this.positions.push(x, y, z);
    return this.positions.length / 3 - 1;
  }
  quad(a: number, b: number, c: number, d: number) {
    this.indices.push(a, b, c, a, c, d);
  }
  tri(a: number, b: number, c: number) {
    this.indices.push(a, b, c);
  }
  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    return geometry;
  }
}

/** Solide de revolution autour de l'axe x, profil (x, r) parcouru de l'avant vers l'arriere puis ferme. */
function revolve(builder: Builder, profile: [number, number][], segments: number) {
  const rings: number[][] = profile.map(([x, r]) => {
    const ring: number[] = [];
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      ring.push(builder.add(x, r * Math.cos(a), r * Math.sin(a)));
    }
    return ring;
  });
  for (let i = 0; i < rings.length; i++) {
    const a = rings[i];
    const b = rings[(i + 1) % rings.length];
    for (let j = 0; j < segments; j++) {
      const k = (j + 1) % segments;
      builder.quad(a[j], a[k], b[k], b[j]);
    }
  }
}

/**
 * Moyeu : tube de l'alesage au rayon de moyeu, faces planes. Profil ferme
 * parcouru dans le sens qui oriente les normales vers l'exterieur.
 */
function buildHub(builder: Builder, plan: PropellerPlan, segments: number) {
  const { x0, x1 } = plan.hub;
  const chamfer = Math.min(0.03, (x1 - x0) / 6);
  revolve(
    builder,
    [
      [x0, plan.boreRadius],
      [x0, plan.hubRadius - chamfer],
      [x0 + chamfer, plan.hubRadius],
      [x1 - chamfer, plan.hubRadius],
      [x1, plan.hubRadius - chamfer],
      [x1, plan.boreRadius],
    ],
    segments,
  );
}

/**
 * Pale : une lame helicoidale en coussin ferme, comme la caudale — les deux
 * faces partagent leur contour au bord d'attaque, au bord de fuite et au
 * saumon, ou l'epaisseur tombe a zero selon une racine carree (bord rond,
 * pas d'arete vive). Le pied est noye dans le moyeu et ferme par une bande.
 */
function buildBlade(builder: Builder, plan: PropellerPlan, phase: number, NS: number, NR: number) {
  const { hubRadius, radius, pitch, span, advance } = plan;
  const rootIn = hubRadius - 0.03;
  const t = plan.config.bladeThickness * MM_TO_CM;
  const cup = CUP_MM * MM_TO_CM;
  const xStart = plan.hub.x0 + BLADE_MARGIN_MM * MM_TO_CM + cup +
    (plan.hub.x1 - plan.hub.x0 - 2 * BLADE_MARGIN_MM * MM_TO_CM - cup - advance) / 2;

  // Contour : le saumon s'arrondit vers les deux bords, le pied reste large.
  const tipOf = (s: number) => rootIn + (radius - rootIn) * Math.pow(Math.sin(Math.PI * (0.1 + 0.8 * s)), 0.55);
  const point = (s: number, rho: number, side: -1 | 0 | 1): [number, number, number] => {
    const r = rootIn + (tipOf(s) - rootIn) * rho;
    const phi = phase + s * span;
    const x0 = xStart + (s * span * pitch) / (2 * Math.PI) - cup * rho * rho;
    // Angle local de l'helicoide : raide au pied, couche au saumon.
    const beta = Math.atan(pitch / (2 * Math.PI * Math.max(r, 1e-4)));
    // Epaisseur : pleine au pied, nulle aux trois bords libres, portee sur la
    // NORMALE a la pale (composante axiale cos beta, tangentielle sin beta).
    const edge = Math.sqrt(Math.max(Math.sin(Math.PI * s), 0)) * Math.sqrt(Math.max(1 - Math.pow(rho, 4), 0));
    const h = side * (t / 2) * edge;
    const x = x0 + h * Math.cos(beta);
    const dphi = (-h * Math.sin(beta)) / Math.max(r, 1e-4);
    return [x, r * Math.cos(phi + dphi), r * Math.sin(phi + dphi)];
  };

  // Grille : ligne s = 0 et s = 1, et colonne rho = 1, partagees entre les
  // deux faces (epaisseur nulle).
  const shared = new Map<string, number>();
  const vertex = (i: number, j: number, side: -1 | 1): number => {
    const s = i / NS;
    const rho = j / NR;
    const onEdge = i === 0 || i === NS || j === NR;
    if (onEdge) {
      const key = `${i}:${j}`;
      const found = shared.get(key);
      if (found !== undefined) return found;
      const [x, y, z] = point(s, rho, 0);
      const index = builder.add(x, y, z);
      shared.set(key, index);
      return index;
    }
    const [x, y, z] = point(s, rho, side);
    return builder.add(x, y, z);
  };
  const front: number[][] = [];
  const back: number[][] = [];
  for (let i = 0; i <= NS; i++) {
    front.push([]);
    back.push([]);
    for (let j = 0; j <= NR; j++) {
      front[i].push(vertex(i, j, -1));
      back[i].push(vertex(i, j, 1));
    }
  }
  for (let i = 0; i < NS; i++) {
    for (let j = 0; j < NR; j++) {
      // Face avant (x decroissant) et face arriere : orientations opposees.
      const f = [front[i][j], front[i + 1][j], front[i + 1][j + 1], front[i][j + 1]];
      const b = [back[i][j], back[i][j + 1], back[i + 1][j + 1], back[i + 1][j]];
      emitQuad(builder, f);
      emitQuad(builder, b);
    }
    // Bande de pied : relie les deux faces le long de rho = 0.
    emitQuad(builder, [front[i][0], back[i][0], back[i + 1][0], front[i + 1][0]]);
  }
}

/** Quadrangle eventuellement degenere (deux sommets partages) : on saute les triangles nuls. */
function emitQuad(builder: Builder, q: number[]) {
  const [a, b, c, d] = q;
  if (a !== b && b !== c && a !== c) builder.tri(a, b, c);
  if (a !== c && c !== d && a !== d) builder.tri(a, c, d);
}

/**
 * Helice imprimee : moyeu alese et une ou deux pales. Pale et moyeu sont deux
 * solides fermes qui se recouvrent au pied — la trancheuse les fusionne,
 * comme les tenons et la coque male.
 */
export function buildPropeller(plan: PropellerPlan): THREE.BufferGeometry {
  const hub = new Builder();
  buildHub(hub, plan, 24);
  const solids = [hub.build()];
  const blades = plan.config.blades;
  const NS = blades === 1 ? 22 : 16;
  const NR = blades === 1 ? 9 : 8;
  for (let k = 0; k < blades; k++) {
    const blade = new Builder();
    buildBlade(blade, plan, (k * 2 * Math.PI) / blades, NS, NR);
    solids.push(blade.build());
  }
  // Chaque solide est oriente seul : un signe global laisserait une pale a
  // l'envers si le moyeu dominait le volume.
  for (const solid of solids) orientOutward(solid);
  const merged = mergeGeometries(solids, false)!;
  for (const solid of solids) solid.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** Perle d'espacement : sphere percee de part en part a la cote de l'alesage. */
export function buildBead(plan: PropellerPlan): THREE.BufferGeometry {
  const builder = new Builder();
  const R = plan.bead.radius;
  const rb = plan.boreRadius;
  const alpha = Math.asin(Math.min(rb / R, 0.95));
  const ARC = 16;
  const profile: [number, number][] = [];
  // Arc exterieur de l'avant vers l'arriere, puis retour par l'alesage.
  for (let i = 0; i <= ARC; i++) {
    const a = Math.PI - alpha - ((Math.PI - 2 * alpha) * i) / ARC;
    profile.push([plan.bead.center + R * Math.cos(a), R * Math.sin(a)]);
  }
  revolve(builder, profile, 28);
  const geometry = builder.build();
  orientOutward(geometry);
  return geometry;
}

/**
 * Oriente les normales vers l'exterieur, solide par solide : un volume signe
 * negatif retourne tous les triangles. Les pieces sont convexes par
 * morceaux ; le signe global suffit a les remettre dans le bon sens.
 */
function orientOutward(geometry: THREE.BufferGeometry) {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.getIndex();
  if (!index) return;
  const arr = index.array as Uint16Array | Uint32Array;
  let volume = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < arr.length; i += 3) {
    a.fromBufferAttribute(pos, arr[i]);
    b.fromBufferAttribute(pos, arr[i + 1]);
    c.fromBufferAttribute(pos, arr[i + 2]);
    volume += a.dot(b.clone().cross(c)) / 6;
  }
  if (volume < 0) {
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = t;
    }
    index.needsUpdate = true;
    geometry.computeVertexNormals();
  }
}

// ---------------------------------------------------------------------------
// Masse et inertie
// ---------------------------------------------------------------------------

export interface SpinProperties {
  volumeCm3: number;
  massG: number;
  /** Centre de masse sur l'axe, en cm. */
  x: number;
  /** Moment d'inertie autour de l'axe du fil, en g.mm2. */
  axialInertia: number;
}

/**
 * Volume, centre et moment d'inertie axial d'un maillage ferme, par
 * integration sur les tetraedres signes formes avec un point de l'axe.
 */
export function spinProperties(geometry: THREE.BufferGeometry, density: number): SpinProperties {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.getIndex();
  const count = index ? index.count : pos.count;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let volume = 0;
  let mx = 0;
  let iyz = 0;
  for (let i = 0; i < count; i += 3) {
    a.fromBufferAttribute(pos, index ? index.getX(i) : i);
    b.fromBufferAttribute(pos, index ? index.getX(i + 1) : i + 1);
    c.fromBufferAttribute(pos, index ? index.getX(i + 2) : i + 2);
    const v = a.dot(b.clone().cross(c)) / 6;
    volume += v;
    mx += (v * (a.x + b.x + c.x)) / 4;
    // Integrale de y^2 + z^2 sur le tetraedre (O, a, b, c).
    const sq = (p: 'y' | 'z') =>
      (a[p] * a[p] + b[p] * b[p] + c[p] * c[p] + a[p] * b[p] + a[p] * c[p] + b[p] * c[p]) / 10;
    iyz += v * (sq('y') + sq('z'));
  }
  const vol = Math.abs(volume);
  const mass = vol * density;
  return {
    volumeCm3: vol,
    massG: mass,
    x: volume !== 0 ? mx / volume : 0,
    // g.cm2 -> g.mm2
    axialInertia: Math.abs(iyz) * density * 100,
  };
}

export interface PropellerParts {
  plan: PropellerPlan;
  propeller: THREE.BufferGeometry;
  bead: THREE.BufferGeometry;
  propellerMass: SpinProperties;
  beadMass: SpinProperties;
}

/** Helice et perle, avec leurs masses. La matiere de l'helice est celle du corps, imprimee pleine. */
export function propellerParts(params: LureParams, profile: ProfileSampler): PropellerParts {
  const plan = planPropeller(params, profile);
  const propeller = buildPropeller(plan);
  const bead = buildBead(plan);
  const density = getMaterial(params.material).density;
  return {
    plan,
    propeller,
    bead,
    propellerMass: spinProperties(propeller, density),
    beadMass: spinProperties(bead, params.propeller.beadPrinted ? density : BOUGHT_BEAD_DENSITY),
  };
}

// ---------------------------------------------------------------------------
// Balayage de rotation (module AP.1)
// ---------------------------------------------------------------------------

export interface PropellerSweep {
  /** Nombre de positions testees (72 au pas de 5 degres). */
  steps: number;
  stepDeg: number;
  /** Plus petit jeu rencontre sur le tour, par obstacle, en mm. */
  minGapMm: Record<string, number>;
  hits: JointHit[];
}

/** Rayon d'encombrement d'un hamecon qui pend : environ la moitie de son ouverture. */
const hookRadius = (spanMm: number) => spanMm * 0.3 * MM_TO_CM;

/**
 * Obstacles fixes vus par l'helice : pointe du corps, perle, fil, hamecons.
 *
 * Chaque obstacle rend la distance SIGNEE d'un point a sa surface (negative
 * dedans). Le corps est teste sur sa vraie section (surellipse), la perle
 * comme une sphere, le fil comme un cylindre, un hamecon comme une capsule
 * qui part de son point d'accroche dans la direction ou il pend en nage.
 */
export function propellerObstacles(params: LureParams, profile: ProfileSampler, plan: PropellerPlan): SweepObstacle[] {
  const obstacles: SweepObstacle[] = [];
  const bodyEnd = profile.bodyEnd;
  const pAtX = (x: number): number => {
    let lo = 0;
    let hi = bodyEnd;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (profile.xAt(mid) < x) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  obstacles.push({
    label: 'corps (pointe de queue)',
    remedy: 'Grossissez la perle ou raccourcissez les pales vers l avant.',
    distance: (x, y, z) => {
      if (x > plan.xTail) return x - plan.xTail;
      const p = pAtX(x);
      const s = profile.section(p);
      const cy = s.offset;
      const dy = y - cy;
      const half = dy >= 0 ? Math.max(s.top, 1e-4) : Math.max(-s.bottom, 1e-4);
      const n = (dy >= 0 ? s.nUpper : s.nLower) ?? 2;
      const w = Math.max(s.halfWidth, 1e-4);
      const q = Math.pow(Math.abs(dy) / half, n) + Math.pow(Math.abs(z) / w, n);
      // Distance approchee : ecart radial au contour de la section.
      const r = Math.hypot(dy, z);
      return r * (1 - Math.pow(q, -1 / n));
    },
  });
  obstacles.push({
    label: 'perle d espacement',
    remedy: 'Augmentez la longueur du moyeu ou reduisez l angle de pale.',
    distance: (x, y, z) => Math.hypot(x - plan.bead.center, y, z) - plan.bead.radius,
  });
  obstacles.push({
    label: 'axe (fil traversant)',
    remedy: 'L alesage doit laisser le jeu de boucle autour du fil : verifiez le diametre de fil.',
    distance: (x, y, z) => {
      if (x < plan.xTail || x > plan.loop.x) return Infinity;
      return Math.hypot(y, z) - plan.wireRadius;
    },
  });
  // Boucle de queue : un tore dans le plan vertical, qui retient l'helice.
  obstacles.push({
    label: 'boucle de queue',
    remedy: 'Allongez le fil derriere le moyeu : la boucle doit rester derriere l helice.',
    distance: (x, y, z) => {
      const ringR = plan.loop.outer - plan.wireRadius;
      const dx = x - plan.loop.x;
      const inPlane = Math.hypot(dx, y);
      return Math.hypot(inPlane - ringR, z) - plan.wireRadius;
    },
  });

  for (const mount of params.mounts) {
    const resolved = resolveMount(params.catalogue, mount);
    const hook = resolved.hook;
    if (!hook && !resolved.ring) continue;
    const onAxle = mount.anchorId === PROPELLER_ANCHOR;
    const reach = resolved.reachMm * MM_TO_CM;
    let ax: number;
    let ay: number;
    let bx: number;
    let by: number;
    if (onAxle) {
      // Hamecon de queue : accroche a la boucle, il traine derriere l'helice.
      ax = plan.loop.x + plan.loop.outer;
      ay = 0;
      bx = ax + reach;
      by = 0;
    } else {
      const p = Math.min(Math.max(mount.position, 0.02), bodyEnd - 0.01);
      const s = profile.section(p);
      ax = profile.xAt(p);
      ay = mount.height < 0 ? s.bottom * -mount.height : s.top * mount.height;
      const sign = mount.height <= 0 ? -1 : 1;
      bx = ax;
      by = ay + sign * reach;
    }
    const radius = hook ? hookRadius(hook.spanMm) : (resolved.ring!.spanMm * MM_TO_CM) / 2;
    obstacles.push({
      label: `${mount.label}${hook ? ` (${hook.series} ${hook.size})` : ''}`,
      remedy: onAxle
        ? 'Allongez le fil derriere le moyeu ou prenez un hamecon plus court.'
        : 'Avancez ce support ou reduisez le diametre d helice.',
      distance: (x, y, z) => {
        const vx = bx - ax;
        const vy = by - ay;
        const len2 = vx * vx + vy * vy;
        const t = len2 > 0 ? Math.min(Math.max(((x - ax) * vx + (y - ay) * vy) / len2, 0), 1) : 0;
        return Math.hypot(x - (ax + t * vx), y - (ay + t * vy), z) - radius;
      },
    });
  }
  return obstacles;
}

/** Identifiant d'ancrage des supports montes sur la boucle de queue, derriere l'helice. */
export const PROPELLER_ANCHOR = 'axe-helice';

/**
 * Rejoue un tour complet d'helice, par pas de 5 degres, contre le corps, la
 * perle, l'axe et les hamecons. Meme machinerie que le joint articule : les
 * sommets de la piece mobile tournent autour de l'axe, chaque obstacle fixe
 * mesure sa penetration, la premiere interference par couple est retenue.
 */
export function propellerSweep(
  params: LureParams,
  profile: ProfileSampler,
  parts: Pick<PropellerParts, 'plan' | 'propeller'>,
  stepDeg = PROPELLER_SWEEP_STEP_DEG,
): PropellerSweep {
  const pos = parts.propeller.getAttribute('position') as THREE.BufferAttribute;
  const points: [number, number, number][] = [];
  for (let i = 0; i < pos.count; i++) points.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  const obstacles = propellerObstacles(params, profile, parts.plan);
  const result = sweepRotation({
    part: 'Helice',
    points,
    obstacles,
    stepDeg,
    turnDeg: 360,
  });
  const minGapMm: Record<string, number> = {};
  for (const [label, gap] of Object.entries(result.minGap)) minGapMm[label] = gap / MM_TO_CM;
  return { steps: result.steps, stepDeg, minGapMm, hits: result.hits };
}
