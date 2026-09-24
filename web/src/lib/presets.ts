/**
 * Formes de base de la galerie et bornes des reglages.
 *
 * Chaque preset est un jeu complet de parametres : il n'y a aucun modele 3D
 * stocke, seulement des nombres que le generateur transforme en maillage.
 */

import type {
  Anatomy,
  FinConfig,
  GlueGrooveConfig,
  HollowConfig,
  LureParams,
  PegConfig,
  PinExit,
  ProfileKnot,
  ShapeId,
  TackleMount,
} from '../types/lure';
import { cloneLivery } from './liveries';
import { seedCatalogue } from './tackle';
import { defaultThroughWire } from './throughWire';

export interface Range {
  min: number;
  max: number;
  step: number;
}

/** Bornes partagees par les sliders, la validation et l'import de projets. */
export const LIMITS = {
  length: { min: 30, max: 260, step: 1 },
  maxWidth: { min: 6, max: 80, step: 0.5 },
  thickness: { min: 6, max: 90, step: 0.5 },
  bellyPosition: { min: 0.2, max: 0.75, step: 0.01 },
  dorsalCurve: { min: -1, max: 1, step: 0.02 },
  ventralCurve: { min: -1, max: 1, step: 0.02 },
  noseSharpness: { min: 0.25, max: 1.4, step: 0.01 },
  noseAngle: { min: -40, max: 40, step: 1 },
  tailTaper: { min: 0.4, max: 2.2, step: 0.01 },
  crossSection: { min: 1.4, max: 3.4, step: 0.05 },
  mouthCup: { min: 0, max: 1, step: 0.02 },
  bibAngle: { min: 10, max: 85, step: 1 },
  bibLength: { min: 5, max: 60, step: 0.5 },
  bibWidth: { min: 5, max: 50, step: 0.5 },
  tailSize: { min: 0.4, max: 1.8, step: 0.02 },
  infill: { min: 0, max: 100, step: 5 },
  hardwareMass: { min: 0, max: 20, step: 0.1 },
  ballastMass: { min: 0.1, max: 30, step: 0.1 },
  ballastPosition: { min: 0.05, max: 0.95, step: 0.01 },
  ballastHeight: { min: -1, max: 1, step: 0.05 },
  patternScale: { min: 3, max: 26, step: 1 },
  ribPitch: { min: 0.8, max: 6, step: 0.1 },
  shellWall: { min: 0.8, max: 4, step: 0.1 },
  popperDiameter: { min: 0.25, max: 0.95, step: 0.01 },
  softTailLength: { min: 8, max: 90, step: 1 },
  softTailHeight: { min: 6, max: 80, step: 1 },
  softTailBase: { min: 0.4, max: 4, step: 0.05 },
  softTailTip: { min: 0.15, max: 3, step: 0.05 },
  softTailSpread: { min: 0.4, max: 3, step: 0.05 },
  softTailInsertion: { min: 2, max: 20, step: 0.5 },
  softTailClearance: { min: 0.05, max: 1, step: 0.05 },
  popperDepth: { min: 0.5, max: 12, step: 0.1 },
  popperAngle: { min: -30, max: 60, step: 1 },
  popperLip: { min: 0, max: 3, step: 0.05 },
  popperOffset: { min: -1, max: 1, step: 0.05 },
  insertLength: { min: 0.1, max: 0.9, step: 0.01 },
  insertHeight: { min: 0.1, max: 0.95, step: 0.01 },
  insertThickness: { min: 0.2, max: 3, step: 0.05 },
  insertPosition: { min: 0.1, max: 0.9, step: 0.01 },
  insertOffset: { min: -1, max: 1, step: 0.05 },
  insertRotation: { min: -45, max: 45, step: 1 },
  insertClearance: { min: 0.1, max: 1.5, step: 0.05 },
  ribHeight: { min: 0.1, max: 1.5, step: 0.05 },
  ribZone: { min: 0, max: 1, step: 0.01 },
  ribSlant: { min: -45, max: 45, step: 1 },
  zoneLength: { min: 0, max: 0.4, step: 0.01 },
  paintBlend: { min: 0, max: 1, step: 0.02 },
  gillPosition: { min: 0.12, max: 0.5, step: 0.01 },
  gillSize: { min: 1, max: 14, step: 0.5 },
  gillRelief: { min: -2, max: 2, step: 0.05 },
  eyePosition: { min: 0.03, max: 0.3, step: 0.01 },
  eyeSize: { min: 1.5, max: 14, step: 0.5 },
  eyeRelief: { min: -2, max: 2, step: 0.05 },
  billThickness: { min: 0.5, max: 3, step: 0.1 },
  ballastDensity: { min: 7, max: 11.4, step: 0.05 },
  planeAngle: { min: 0, max: 90, step: 1 },
  tenonCount: { min: 1, max: 4, step: 1 },
  segments: { min: 2, max: 5, step: 1 },
  tenonDiameter: { min: 0, max: 8, step: 0.1 },
  tenonClearance: { min: 0, max: 0.4, step: 0.01 },
  boreClearance: { min: 0, max: 0.4, step: 0.01 },
  channelOffset: { min: 0.05, max: 1, step: 0.05 },
  sweepExtra: { min: 0, max: 1, step: 0.05 },
  tenonFit: { min: 0, max: 0.5, step: 0.01 },
  billFit: { min: 0, max: 0.5, step: 0.01 },
  billOffset: { min: 0, max: 30, step: 0.5 },
  billInsertion: { min: 0, max: 30, step: 0.5 },
  billFillet: { min: 0, max: 4, step: 0.1 },
  billTwist: { min: -30, max: 30, step: 1 },
  anchorPosition: { min: 0.02, max: 0.97, step: 0.005 },
  anchorHeight: { min: -1, max: 1, step: 0.02 },
  anchorDepth: { min: 0, max: 8, step: 0.1 },
  rattleBall: { min: 2, max: 12, step: 0.5 },
  chamberDiameter: { min: 3, max: 20, step: 0.5 },
  chamberBalls: { min: 1, max: 6, step: 1 },
  // --- Decals ------------------------------------------------------------
  decalDepth: { min: 0.1, max: 3, step: 0.05 },
  decalSoftness: { min: 0, max: 100, step: 1 },
  decalOpacity: { min: 0, max: 100, step: 1 },
  decalPosition: { min: 0, max: 1, step: 0.005 },
  decalHeight: { min: -1, max: 1, step: 0.02 },
  decalRotation: { min: -180, max: 180, step: 1 },
  decalSize: { min: 1, max: 120, step: 0.5 },
  // --- Ecailles ----------------------------------------------------------
  scaleWidth: { min: 0.5, max: 8, step: 0.1 },
  scaleHeight: { min: 0.5, max: 8, step: 0.1 },
  scaleSpacing: { min: 0, max: 2, step: 0.05 },
  scaleDepth: { min: 0.05, max: 1, step: 0.01 },
  scaleRounding: { min: 0, max: 100, step: 1 },
  scaleMargin: { min: 0, max: 40, step: 1 },
  // --- Articulation ------------------------------------------------------
  eyeCount: { min: 1, max: 4, step: 1 },
  jointSwing: { min: 0, max: 90, step: 0.5 },
  jointFaceAngle: { min: 0, max: 90, step: 0.5 },
  jointClearance: { min: 0, max: 2, step: 0.05 },
  jointMass: { min: 0, max: 10, step: 0.01 },
  eyeLoop: { min: 1, max: 10, step: 0.1 },
  eyeWire: { min: 0.5, max: 3, step: 0.05 },
  eyeLength: { min: 3, max: 30, step: 0.5 },
  slotHeight: { min: 0.5, max: 8, step: 0.1 },
  slotDepth: { min: 1, max: 20, step: 0.5 },
  slotWidth: { min: 2, max: 60, step: 0.5 },
  jointFit: { min: 0.05, max: 1.5, step: 0.05 },
  retentionDiameter: { min: 1.5, max: 5, step: 0.1 },
  retentionSeatFit: { min: 0.05, max: 0.4, step: 0.01 },
  retentionLoopFit: { min: 0.1, max: 0.5, step: 0.01 },
  retentionChamfer: { min: 0.2, max: 1, step: 0.05 },
  // --- Assemblage visse ---------------------------------------------------
  screwCount: { min: 1, max: 3, step: 1 },
  nutFit: { min: 0, max: 0.4, step: 0.01 },
  // --- Atelier -----------------------------------------------------------
  perimeters: { min: 1, max: 6, step: 1 },
  layerHeight: { min: 0.05, max: 0.4, step: 0.01 },
  socketTolerance: { min: 0, max: 0.5, step: 0.01 },
  shrinkage: { min: 0, max: 3, step: 0.05 },
  // --- Goupilles d'assemblage --------------------------------------------
  dowelCount: { min: 2, max: 6, step: 1 },
  dowelDiameter: { min: 1.5, max: 5, step: 0.1 },
  dowelEngagement: { min: 2, max: 10, step: 0.1 },
  dowelClearance: { min: 0.05, max: 0.4, step: 0.01 },
  dowelChamfer: { min: 0.2, max: 1, step: 0.05 },
  // --- Gorge de colle, ergots, creusage (modules AB, AD) -------------------
  grooveWidth: { min: 0.4, max: 2, step: 0.05 },
  grooveDepth: { min: 0.2, max: 1, step: 0.05 },
  grooveInset: { min: 0.4, max: 3, step: 0.05 },
  pegCount: { min: 1, max: 4, step: 1 },
  pegDiameter: { min: 1.5, max: 6, step: 0.1 },
  pegHeight: { min: 0.8, max: 5, step: 0.1 },
  pegTaper: { min: 0, max: 20, step: 0.5 },
  pegClearance: { min: 0.05, max: 0.4, step: 0.01 },
  hollowWall: { min: 0.8, max: 4, step: 0.1 },
  // --- Anatomie (module AB) ----------------------------------------------
  anatomyJaw: { min: 0.02, max: 0.3, step: 0.005 },
  anatomyPeduncle: { min: 0.4, max: 0.97, step: 0.005 },
  anatomyNoseCap: { min: 0, max: 0.25, step: 0.005 },
  anatomyNoseShape: { min: 0.35, max: 1, step: 0.01 },
  anatomyJawDepth: { min: 0, max: 0.06, step: 0.001 },
  anatomyOpercle: { min: 0, max: 0.06, step: 0.001 },
  anatomyOrbit: { min: 0, max: 2, step: 0.05 },
  anatomyLateral: { min: 0, max: 0.4, step: 0.01 },
  finPosition: { min: 0.02, max: 0.98, step: 0.005 },
  finSize: { min: 0, max: 0.6, step: 0.005 },
  finRays: { min: 0, max: 30, step: 1 },
  caudalRays: { min: 4, max: 30, step: 1 },
  // --- Rainures de collant ------------------------------------------------
  inlayDepth: { min: 0.1, max: 1, step: 0.01 },
  inlayMargin: { min: 0, max: 1, step: 0.05 },
  inlayCorner: { min: 0, max: 5, step: 0.1 },
} as const satisfies Record<string, Range>;

export interface ShapePreset {
  id: ShapeId;
  label: string;
  tagline: string;
  description: string;
  params: LureParams;
}

const ballast = (
  position: number,
  height: number,
  mass: number,
  seed: string,
  shape: 'sphere' | 'cylinder' = 'sphere',
) => ({
  id: `${seed}-${position}`,
  position,
  height,
  mass,
  shape,
});

/**
 * Ancrages par defaut : les trois points d'attache d'un leurre classique.
 * Le fil sort vers le nez, vers le ventre et vers la queue.
 */
const defaultAnchors = (): LureParams['assembly']['anchors'] => [
  { id: 'nez', position: 0.1, height: 0, exit: 'nose', depth: 0, pin: 'auto', method: 'bore' },
  { id: 'ventre', position: 0.44, height: -0.5, exit: 'belly', depth: 0, pin: 'auto', method: 'bore' },
  { id: 'queue', position: 0.86, height: 0, exit: 'tail', depth: 0, pin: 'auto', method: 'bore' },
];

/** Assemblage par defaut : joint vertical, alesage simple, trois ancrages. */
const assembly = (
  overrides: Partial<LureParams['assembly']> = {},
): LureParams['assembly'] => ({
  enabled: true,
  planeAngle: 0,
  socketMethod: 'bore',
  pin: 'auto',
  roughWater: false,
  anchors: defaultAnchors(),
  glueGroove: defaultGlueGroove(),
  pegs: defaultPegs(),
  hollow: defaultHollow(),
  ...overrides,
});

/** Jeux de fabrication par defaut, a reajuster apres mesure sur machine. */
const fabrication = (): LureParams['fabrication'] => ({
  boreClearance: 0.05,
  channelOffset: 0.25,
  sweepExtra: 0.2,
  tenonFit: 0.15,
  // Empreinte de la bavette majoree de ce seul jeu, sur toutes les dimensions.
  billFit: 0.05,
  // Volontairement large : c'est ce jeu qui laisse la bille claquer.
});

/** Chambre a billes desactivee par defaut, pre-reglee sur le tiers arriere. */
/** Nervures : absentes par defaut, sauf sur l'archetype qui les porte. */
export const defaultRibs = (): LureParams['ribs'] => ({
  enabled: false,
  pitch: 2,
  height: 0.4,
  profile: 'round',
  from: 0.15,
  to: 0.9,
  slant: 0,
});

export const defaultPopperFace = (): LureParams['popperFace'] => ({
  enabled: false,
  diameter: 0.62,
  depth: 4,
  angle: 18,
  lipRadius: 0.8,
  offset: 0.1,
});

export const defaultSoftTail = (): LureParams['softTail'] => ({
  enabled: false,
  length: 34,
  height: 26,
  baseThickness: 1.6,
  tipThickness: 0.5,
  spread: 1.5,
  method: 'slot',
  insertion: 6,
  clearance: 0.25,
  material: 'resin',
});

export const defaultShell = (): LureParams['shell'] => ({
  enabled: false,
  wallMm: 1.6,
  transparency: 0.55,
});

export const defaultInsert = (): LureParams['insert'] => ({
  enabled: false,
  form: 'curved',
  length: 0.45,
  height: 0.5,
  thickness: 0.6,
  position: 0.5,
  offset: 0.1,
  rotation: 0,
  clearance: 0.4,
  material: 'petg',
});

const chamber = (): LureParams['chamber'] => ({
  enabled: false,
  diameter: 7,
  fromPosition: 0.55,
  fromHeight: -0.25,
  toPosition: 0.78,
  toHeight: -0.25,
  ball: 4,
  balls: 2,
});

/** Goupilles d'assemblage desactivees, pre-reglees sur des barreaux de 3 mm. */
const dowels = (): LureParams['dowels'] => ({
  enabled: false,
  diameter: 3,
  engagement: 4,
  clearance: 0.15,
  chamfer: 0.4,
  pins: [],
  count: 3,
});

/** Articulation desactivee, pre-reglee sur un joint de swimbait classique. */
const articulation = (
  overrides: Partial<LureParams['articulation']> = {},
): LureParams['articulation'] => ({
  enabled: false,
  hardware: 'pin',
  eyeCount: 2,
  segments: 2,
  positionMm: 0,
  swing: 40,
  faceAngle: 45,
  clearance: 0.6,
  eyeMass: 0,
  pinMass: 0,
  showHardware: true,
  // Une boucle de 5 mm laisse passer le cylindre de retention de 3 mm avec
  // son quart de millimetre de jeu ; une fente de 6 mm laisse passer la
  // boucle. Ces trois cotes vont ensemble : c'est le test de collision qui
  // les a mises d'accord.
  eyeLoop: 5,
  eyeWire: 1.25,
  eyeLength: 12,
  slotHeight: 6,
  slotDepth: 5,
  slotWidth: 23,
  jointFit: 0.35,
  retentionDiameter: 3,
  retentionSeatFit: 0.15,
  retentionLoopFit: 0.25,
  retentionChamfer: 0.4,
  ...overrides,
});

/** Trame d'ecailles desactivee, reglee sur une ecaille de vairon. */
const scales = (): LureParams['scales'] => ({
  enabled: false,
  baked: false,
  fit: 'wrapped',
  shape: 'diamond',
  width: 1.2,
  height: 2.6,
  spacing: 0,
  depth: 0.3,
  rounding: 0,
  style: 'raised',
  marginTop: 0,
  marginBottom: 0,
});

/** Reference vide : aucune photo tant que l'utilisateur n'en depose pas. */
export const emptyReference = (): LureParams['outlineReference'] => ({
  src: '',
  opacity: 60,
  x: 0,
  y: 0,
  scale: 1,
  visible: true,
  locked: false,
});

/** Reglages d'atelier par defaut : FDM, trois parois, couche de 0,2 mm. */
const print = (): LureParams['print'] => ({
  process: 'fdm',
  perimeters: 3,
  layerHeight: 0.2,
  socketTolerance: 0.1,
  shrinkage: 0,
  finish: 'smooth',
  preview: 'medium',
});

// ---------------------------------------------------------------------------
// Anatomie
// ---------------------------------------------------------------------------

const knots = (pairs: [number, number][]): ProfileKnot[] => pairs.map(([u, v]) => ({ u, v }));

const fin = (from: number, to: number, size: number, rays: number, enabled = true): FinConfig => ({
  enabled,
  from,
  to,
  size,
  rays,
});

/** Gorge de colle : 0,8 mm de large, 0,4 mm de fond par coque, a 0,9 mm de la peau. */
export const defaultGlueGroove = (): GlueGrooveConfig => ({
  enabled: true,
  width: 0.8,
  depth: 0.4,
  inset: 0.9,
});

/** Deux ergots coniques de 3 mm, 8 degres de depouille, 0,15 mm de jeu radial. */
export const defaultPegs = (): PegConfig => ({
  enabled: true,
  count: 2,
  diameter: 3,
  height: 2.2,
  taper: 8,
  clearance: 0.15,
});

/** Creusage desactive par defaut, paroi de 1,6 mm quand on l'active. */
export const defaultHollow = (): HollowConfig => ({ enabled: false, wall: 1.6 });

/** Copie profonde d'une anatomie : ses courbes sont des tableaux d'objets. */
export const cloneAnatomy = (anatomy: Anatomy | null): Anatomy | null =>
  anatomy
    ? {
        ...anatomy,
        dorsal: anatomy.dorsal.map((k) => ({ ...k })),
        ventral: anatomy.ventral.map((k) => ({ ...k })),
        width: anatomy.width.map((k) => ({ ...k })),
        upper: anatomy.upper.map((k) => ({ ...k })),
        lower: anatomy.lower.map((k) => ({ ...k })),
        dorsalFin: { ...anatomy.dorsalFin },
        analFin: { ...anatomy.analFin },
        pectoralFin: { ...anatomy.pectoralFin },
        pelvicFin: { ...anatomy.pelvicFin },
      }
    : null;

/** Livree generique : dos sombre, flancs clairs, ventre blanc. Aucune livree commerciale. */
const paint = (dorsal: string, flank: string, over: Partial<LureParams['paint']> = {}): LureParams['paint'] => ({
  dorsal,
  flank,
  belly: '#f6f4ef',
  head: dorsal,
  tail: flank,
  headLength: 0,
  tailLength: 0,
  blend: 0.45,
  eyeColor: '#e8b21a',
  pattern: 'scales',
  patternColor: '#9aa9b6',
  patternScale: 14,
  finish: 'gloss',
  livery: cloneLivery(),
  ...over,
});

const anchor = (
  id: string,
  position: number,
  height: number,
  exit: PinExit,
): LureParams['assembly']['anchors'][number] => ({
  id,
  position,
  height,
  exit,
  depth: 0,
  pin: 'auto',
  method: 'bore',
});

const mount = (id: string, label: string, anchorId: string, position: number, height: number): TackleMount => ({
  id,
  label,
  anchorId,
  position,
  height,
  ringId: null,
  hookId: null,
  visible: true,
});

/**
 * Minnow de reference : la base commune dont chaque famille ne change que ce
 * qui la distingue. Tout y est regle — cotes, anatomie, assemblage, visserie,
 * ergots, gorge de colle, goupilles, lest, livree.
 */
const minnowParams = (): LureParams => ({
  shape: 'minnow',
  length: 110,
  maxWidth: 14,
  thickness: 20,
  bellyPosition: 0.4,
  dorsalCurve: 0,
  ventralCurve: 0,
  noseSharpness: 0.6,
  noseAngle: 0,
  tailTaper: 1.2,
  crossSection: 2,
  anatomy: {
    jaw: 0.075,
    peduncle: 0.72,
    dorsal: knots([
      [0, 0.12], [0.06, 0.26], [0.14, 0.4], [0.26, 0.5], [0.4, 0.53], [0.52, 0.5],
      [0.66, 0.38], [0.8, 0.24], [0.88, 0.19], [0.95, 0.2], [1, 0.23],
    ]),
    ventral: knots([
      [0, 0.1], [0.06, 0.21], [0.15, 0.34], [0.3, 0.45], [0.42, 0.47], [0.56, 0.43],
      [0.7, 0.3], [0.82, 0.2], [0.9, 0.16], [0.96, 0.17], [1, 0.2],
    ]),
    width: knots([
      [0, 0.42], [0.04, 0.68], [0.1, 0.89], [0.2, 0.97], [0.34, 1], [0.55, 0.88],
      [0.7, 0.62], [0.82, 0.36], [0.9, 0.2], [0.95, 0.14], [1, 0.1],
    ]),
    upper: knots([[0, 2.2], [0.2, 2.1], [0.4, 1.9], [0.6, 1.7], [0.8, 1.5], [1, 1.45]]),
    lower: knots([[0, 2.8], [0.2, 2.6], [0.4, 2.3], [0.6, 2.05], [0.85, 1.65], [1, 1.6]]),
    noseCap: 0.07,
    noseShape: 0.62,
    jawDepth: 0.02,
    opercleRelief: 0.022,
    orbitDepth: 0.5,
    lateralLine: 0.12,
    dorsalFin: fin(0.4, 0.58, 0.16, 12),
    analFin: fin(0.7, 0.78, 0.09, 9),
    pectoralFin: fin(0.215, 0.3, 0.3, 11),
    pelvicFin: fin(0.53, 0.585, 0.2, 7),
    caudalRays: 16,
  },
  mouthCup: 0,
  hasBib: true,
  billMode: 'polycarbonate',
  billThickness: 1.5,
  billUniform: false,
  billOffset: 7,
  billInsertion: 6,
  billFillet: 0.6,
  billProfile: 'rounded',
  billTwist: 0,
  bibAngle: 40,
  bibLength: 17,
  bibWidth: 10,
  tailShape: 'forked',
  tailSize: 0.9,
  gills: { enabled: true, position: 0.2, size: 4, relief: -0.5 },
  eyes: { enabled: true, position: 0.085, size: 5, relief: 0.3 },
  eyeStyle: 'realistic',
  clip: 'none',
  assembly: assembly({
    anchors: [
      anchor('nez', 0.08, 0, 'nose'),
      anchor('ventre', 0.36, -0.5, 'belly'),
      anchor('arriere', 0.64, -0.5, 'belly'),
    ],
  }),
  fabrication: fabrication(),
  articulation: articulation(),
  screws: {
    enabled: true,
    nutFit: 0.1,
    screws: [
      { id: 'vis-avant', position: 0.2, size: 'auto', head: 'countersunk', length: 15 },
      { id: 'vis-arriere', position: 0.48, size: 'auto', head: 'countersunk', length: 15 },
    ],
  },
  dowels: dowels(),
  outline: { nodes: [], closed: true, mirror: false },
  outlineReference: emptyReference(),
  decals: [],
  scales: scales(),
  inlays: [],
  print: print(),
  material: 'pla',
  infill: 15,
  hardwareMass: 0,
  ballastDensity: 7.9,
  ballasts: [ballast(0.36, -0.7, 2, 'min', 'cylinder'), ballast(0.5, -0.65, 1.5, 'min', 'cylinder')],
  chamber: chamber(),
  ribs: defaultRibs(),
  popperFace: defaultPopperFace(),
  softTail: defaultSoftTail(),
  shell: defaultShell(),
  insert: defaultInsert(),
  throughWire: defaultThroughWire(),
  catalogue: seedCatalogue(),
  mounts: [
    mount('mount-ventre', 'Support ventral', 'ventre', 0.36, -1),
    mount('mount-arriere', 'Support arriere', 'arriere', 0.64, -1),
  ],
  paint: paint('#2b4a5e', '#d7dee3', { tail: '#d7dee3' }),
});

const family = (
  id: ShapeId,
  label: string,
  tagline: string,
  description: string,
  over: (base: LureParams) => Partial<LureParams>,
): ShapePreset => {
  const base = minnowParams();
  return { id, label, tagline, description, params: { ...base, ...over(base), shape: id } };
};

/**
 * Les sept familles de la bibliotheque (module AB).
 *
 * Chacune est un leurre COMPLET et fonctionnel des le chargement : cotes de
 * la famille, anatomie (pedoncule, opercule en relief, orbites creusees,
 * nageoires), assemblage en deux demi-coques deja configure — plan de joint,
 * vis et ecrous captifs, ergots, gorge de colle —, goupilles en 8 aux
 * attaches et aux supports d'hamecon, lest place pour un verdict de
 * flottabilite valide. Aucune cote n'est relevee sur un modele du commerce,
 * aucune livree ni marquage n'est repris.
 */
const FAMILY_PRESETS: ShapePreset[] = [
  family(
    'minnow',
    'Minnow / jerkbait',
    'Tete effilee, pedoncule net, corps comprime',
    'Corps elance et comprime lateralement, arete dorsale qui s affirme vers le pedoncule, bavette courte inclinee. Variantes par reglage : nervure (onglet Scene), suspendu, flottant ou coulant (lest). Plage 70 a 160 mm.',
    () => ({}),
  ),
  family(
    'crankbait',
    'Crankbait',
    'Corps haut et court, epaules pleines, front bombe',
    'Corps trapu a front bombe et epaules pleines, section large, grande bavette qui fait plonger et vibrer. Variantes par reglage : squarebill, bavette ronde, epaules hautes. Plage 40 a 90 mm.',
    (base) => ({
      length: 62,
      maxWidth: 19,
      thickness: 26,
      anatomy: {
        ...base.anatomy!,
        jaw: 0.1,
        peduncle: 0.78,
        dorsal: knots([
          [0, 0.2], [0.05, 0.36], [0.13, 0.5], [0.24, 0.57], [0.36, 0.57], [0.5, 0.51],
          [0.64, 0.4], [0.78, 0.27], [0.88, 0.21], [0.95, 0.21], [1, 0.23],
        ]),
        ventral: knots([
          [0, 0.16], [0.05, 0.3], [0.14, 0.4], [0.28, 0.44], [0.42, 0.44], [0.56, 0.39],
          [0.7, 0.29], [0.82, 0.2], [0.92, 0.17], [1, 0.19],
        ]),
        width: knots([
          [0, 0.5], [0.05, 0.76], [0.12, 0.93], [0.26, 1], [0.42, 0.98], [0.58, 0.82],
          [0.72, 0.56], [0.84, 0.32], [0.92, 0.18], [0.96, 0.13], [1, 0.1],
        ]),
        upper: knots([[0, 2.4], [0.25, 2.5], [0.5, 2.2], [0.75, 1.85], [1, 1.6]]),
        lower: knots([[0, 2.3], [0.4, 2.3], [0.8, 1.9], [1, 1.7]]),
        noseCap: 0.1,
        noseShape: 0.5,
        jawDepth: 0.016,
        opercleRelief: 0.02,
        orbitDepth: 0.45,
        lateralLine: 0.1,
        dorsalFin: fin(0.38, 0.6, 0.12, 10),
        analFin: fin(0.76, 0.84, 0.08, 7),
        pectoralFin: fin(0.25, 0.34, 0.26, 9),
        pelvicFin: fin(0.42, 0.47, 0.16, 6),
        caudalRays: 12,
      },
      billThickness: 1.5,
      billOffset: 4,
      billInsertion: 7,
      bibAngle: 30,
      bibLength: 20,
      bibWidth: 14,
      tailShape: 'fan',
      tailSize: 0.55,
      gills: { enabled: true, position: 0.23, size: 3.5, relief: -0.45 },
      eyes: { enabled: true, position: 0.11, size: 5, relief: 0.3 },
      assembly: assembly({
        anchors: [
          anchor('nez', 0.08, 0, 'nose'),
          anchor('ventre', 0.33, -0.5, 'belly'),
          anchor('arriere', 0.67, -0.5, 'belly'),
        ],
      }),
      screws: {
        enabled: true,
        nutFit: 0.1,
        screws: [{ id: 'vis-0', position: 0.55, size: 'auto', head: 'countersunk', length: 15 }],
      },
      infill: 12,
      ballasts: [ballast(0.44, -0.72, 2.5, 'crk', 'sphere')],
      mounts: [
        mount('mount-ventre', 'Support ventral', 'ventre', 0.33, -1),
        mount('mount-arriere', 'Support arriere', 'arriere', 0.67, -1),
      ],
      paint: paint('#3d5a2a', '#e7c64a', { belly: '#f3e9c9', pattern: 'none' }),
    }),
  ),
  family(
    'deepdiver',
    'Deep diver de traine',
    'Corps elance, tete renforcee, longue bavette rigide',
    'Corps elance de traine, tete epaissie pour porter l encastrement d une longue bavette rigide. Variantes par reglage : queue souple rapportee ou caudale rigide. Plage 120 a 260 mm.',
    (base) => ({
      length: 165,
      maxWidth: 21,
      thickness: 30,
      anatomy: {
        ...base.anatomy!,
        jaw: 0.07,
        peduncle: 0.74,
        dorsal: knots([
          [0, 0.16], [0.05, 0.32], [0.12, 0.44], [0.24, 0.51], [0.38, 0.52], [0.52, 0.49],
          [0.66, 0.38], [0.8, 0.25], [0.88, 0.2], [0.95, 0.2], [1, 0.23],
        ]),
        ventral: knots([
          [0, 0.15], [0.05, 0.3], [0.12, 0.42], [0.26, 0.47], [0.4, 0.47], [0.55, 0.42],
          [0.7, 0.3], [0.82, 0.2], [0.9, 0.16], [1, 0.19],
        ]),
        width: knots([
          [0, 0.5], [0.04, 0.76], [0.1, 0.94], [0.22, 1], [0.4, 0.98], [0.56, 0.86],
          [0.7, 0.6], [0.82, 0.34], [0.9, 0.2], [0.95, 0.14], [1, 0.1],
        ]),
        upper: knots([[0, 2.3], [0.2, 2.2], [0.45, 1.95], [0.7, 1.7], [1, 1.5]]),
        lower: knots([[0, 2.3], [0.3, 2.35], [0.65, 2.0], [0.9, 1.65], [1, 1.6]]),
        noseCap: 0.065,
        noseShape: 0.55,
        dorsalFin: fin(0.4, 0.6, 0.14, 13),
        analFin: fin(0.68, 0.76, 0.08, 9),
        pectoralFin: fin(0.2, 0.28, 0.28, 12),
        pelvicFin: fin(0.5, 0.55, 0.18, 7),
        caudalRays: 18,
      },
      billThickness: 2.5,
      billOffset: 7,
      billInsertion: 9,
      bibAngle: 22,
      bibLength: 44,
      bibWidth: 18,
      tailShape: 'forked',
      tailSize: 0.8,
      gills: { enabled: true, position: 0.19, size: 6, relief: -0.6 },
      eyes: { enabled: true, position: 0.075, size: 7, relief: 0.4 },
      assembly: assembly({
        anchors: [
          anchor('nez', 0.06, 0, 'nose'),
          anchor('ventre', 0.36, -0.5, 'belly'),
          anchor('arriere', 0.62, -0.5, 'belly'),
        ],
      }),
      screws: {
        enabled: true,
        nutFit: 0.1,
        screws: [
          { id: 'vis-avant', position: 0.25, size: 'auto', head: 'countersunk', length: 20 },
          { id: 'vis-milieu', position: 0.45, size: 'auto', head: 'countersunk', length: 20 },
        ],
      },
      infill: 15,
      ballasts: [ballast(0.3, -0.72, 6, 'ddv', 'cylinder'), ballast(0.44, -0.7, 5, 'ddv', 'cylinder')],
      mounts: [
        mount('mount-ventre', 'Support ventral', 'ventre', 0.36, -1),
        mount('mount-arriere', 'Support arriere', 'arriere', 0.62, -1),
      ],
      paint: paint('#1f3b5c', '#cfd9e2', { tail: '#e30613', tailLength: 0.08 }),
    }),
  ),
  family(
    'popper',
    'Popper',
    'Face creusee, epaules pleines, ventre rond',
    'Face avant creusee en cuvette a fond plat et levre adoucie, epaules pleines et ventre rond ; l attache sort du fond de la cuvette. Variantes par reglage : popper creuse, chugger a face plate (profondeur de cuvette). Plage 60 a 160 mm.',
    (base) => ({
      length: 95,
      maxWidth: 24,
      thickness: 27,
      anatomy: {
        ...base.anatomy!,
        jaw: 0.1,
        peduncle: 0.76,
        dorsal: knots([
          [0, 0.44], [0.04, 0.47], [0.12, 0.52], [0.24, 0.55], [0.38, 0.54], [0.52, 0.49],
          [0.66, 0.39], [0.8, 0.27], [0.9, 0.21], [1, 0.22],
        ]),
        ventral: knots([
          [0, 0.4], [0.04, 0.42], [0.14, 0.45], [0.28, 0.46], [0.42, 0.45], [0.56, 0.4],
          [0.7, 0.3], [0.84, 0.2], [0.93, 0.17], [1, 0.18],
        ]),
        width: knots([
          [0, 0.8], [0.04, 0.84], [0.14, 0.94], [0.28, 1], [0.44, 0.97], [0.6, 0.82],
          [0.74, 0.56], [0.86, 0.3], [0.93, 0.17], [0.97, 0.12], [1, 0.1],
        ]),
        upper: knots([[0, 2.4], [0.3, 2.4], [0.6, 2.1], [0.85, 1.75], [1, 1.6]]),
        lower: knots([[0, 2.4], [0.4, 2.4], [0.75, 2.0], [1, 1.7]]),
        noseCap: 0,
        noseShape: 0.5,
        jawDepth: 0,
        opercleRelief: 0.02,
        orbitDepth: 0.45,
        dorsalFin: fin(0.42, 0.62, 0.12, 11),
        analFin: fin(0.75, 0.83, 0.08, 8),
        pectoralFin: fin(0.25, 0.33, 0.24, 9),
        pelvicFin: fin(0.44, 0.49, 0.16, 6),
        caudalRays: 12,
      },
      hasBib: false,
      popperFace: { ...defaultPopperFace(), enabled: true, diameter: 0.62, depth: 5, angle: 0, lipRadius: 0.8, offset: 0 },
      tailShape: 'fan',
      tailSize: 0.6,
      gills: { enabled: true, position: 0.24, size: 4.5, relief: -0.5 },
      eyes: { enabled: true, position: 0.13, size: 6, relief: 0.35 },
      assembly: assembly({
        anchors: [
          anchor('nez', 0.06, 0, 'nose'),
          anchor('ventre', 0.36, -0.5, 'belly'),
          anchor('arriere', 0.68, -0.5, 'belly'),
        ],
      }),
      screws: {
        enabled: true,
        nutFit: 0.1,
        screws: [{ id: 'vis-0', position: 0.56, size: 'auto', head: 'countersunk', length: 20 }],
      },
      infill: 10,
      ballasts: [ballast(0.56, -0.7, 3, 'pop', 'cylinder')],
      mounts: [
        mount('mount-ventre', 'Support ventral', 'ventre', 0.36, -1),
        mount('mount-arriere', 'Support arriere', 'arriere', 0.68, -1),
      ],
      paint: paint('#20242b', '#e8e4d8', { head: '#c1272d', headLength: 0.12, pattern: 'none' }),
    }),
  ),
  family(
    'stickbait',
    'Stickbait / pencil',
    'Fusele, section ronde a ovale, queue effilee',
    'Corps fusele sans bavette, section ronde a ovale, queue effilee sur un pedoncule fin ; c est le lestage arriere qui donne le walking. Variantes par reglage : flottant, coulant, lest mobile (chambre de bruit). Plage 110 a 220 mm.',
    (base) => ({
      length: 150,
      maxWidth: 20,
      thickness: 24,
      anatomy: {
        ...base.anatomy!,
        jaw: 0.06,
        peduncle: 0.78,
        dorsal: knots([
          [0, 0.13], [0.06, 0.27], [0.15, 0.41], [0.3, 0.5], [0.45, 0.52], [0.6, 0.47],
          [0.74, 0.36], [0.86, 0.23], [0.94, 0.18], [1, 0.2],
        ]),
        ventral: knots([
          [0, 0.12], [0.06, 0.25], [0.16, 0.39], [0.32, 0.47], [0.46, 0.48], [0.62, 0.43],
          [0.76, 0.32], [0.88, 0.2], [0.95, 0.16], [1, 0.18],
        ]),
        width: knots([
          [0, 0.34], [0.06, 0.6], [0.16, 0.84], [0.32, 0.98], [0.46, 1], [0.62, 0.9],
          [0.76, 0.64], [0.88, 0.32], [0.94, 0.17], [0.97, 0.12], [1, 0.1],
        ]),
        upper: knots([[0, 2.1], [0.4, 2.15], [0.7, 1.95], [0.9, 1.7], [1, 1.6]]),
        lower: knots([[0, 2.1], [0.4, 2.2], [0.75, 2.0], [1, 1.7]]),
        noseCap: 0.075,
        noseShape: 0.66,
        dorsalFin: fin(0.44, 0.62, 0.1, 12),
        analFin: fin(0.71, 0.79, 0.06, 8),
        pectoralFin: fin(0.19, 0.26, 0.22, 10),
        pelvicFin: fin(0.42, 0.47, 0.14, 6),
        caudalRays: 14,
      },
      hasBib: false,
      tailShape: 'forked',
      tailSize: 0.6,
      gills: { enabled: true, position: 0.17, size: 5, relief: -0.5 },
      eyes: { enabled: true, position: 0.075, size: 6, relief: 0.35 },
      assembly: assembly({
        anchors: [
          anchor('nez', 0.06, 0, 'nose'),
          anchor('ventre', 0.34, -0.5, 'belly'),
          anchor('arriere', 0.64, -0.5, 'belly'),
        ],
      }),
      screws: {
        enabled: true,
        nutFit: 0.1,
        screws: [
          { id: 'vis-avant', position: 0.22, size: 'auto', head: 'countersunk', length: 20 },
          { id: 'vis-arriere', position: 0.53, size: 'auto', head: 'countersunk', length: 20 },
        ],
      },
      infill: 12,
      ballasts: [ballast(0.62, -0.68, 6, 'stk', 'cylinder'), ballast(0.46, -0.7, 4, 'stk', 'cylinder')],
      mounts: [
        mount('mount-ventre', 'Support ventral', 'ventre', 0.34, -1),
        mount('mount-arriere', 'Support arriere', 'arriere', 0.64, -1),
      ],
      paint: paint('#16324a', '#e6ebee', { pattern: 'scales', patternScale: 18 }),
    }),
  ),
  family(
    'lipless',
    'Lipless / vibe',
    'Corps haut, dos vif, ventre arrondi, attache dorsale',
    'Corps haut et comprime, dos vif (carene marquee), ventre arrondi, attache sur le dos et lest bas et avance pour la vibration serree. Variantes par reglage : vibe classique, vibe de traine (corps plus haut). Plage 50 a 110 mm.',
    (base) => ({
      length: 75,
      maxWidth: 12,
      thickness: 27,
      anatomy: {
        ...base.anatomy!,
        jaw: 0.085,
        peduncle: 0.76,
        dorsal: knots([
          [0, 0.16], [0.05, 0.33], [0.14, 0.5], [0.26, 0.58], [0.4, 0.58], [0.54, 0.52],
          [0.68, 0.4], [0.8, 0.27], [0.9, 0.2], [1, 0.22],
        ]),
        ventral: knots([
          [0, 0.14], [0.05, 0.26], [0.15, 0.36], [0.3, 0.42], [0.44, 0.42], [0.58, 0.37],
          [0.72, 0.27], [0.84, 0.18], [0.93, 0.15], [1, 0.17],
        ]),
        width: knots([
          [0, 0.4], [0.05, 0.64], [0.15, 0.88], [0.3, 1], [0.46, 0.98], [0.62, 0.84],
          [0.76, 0.58], [0.87, 0.32], [0.94, 0.18], [0.97, 0.13], [1, 0.11],
        ]),
        upper: knots([[0, 2.0], [0.15, 1.7], [0.35, 1.45], [0.6, 1.4], [0.85, 1.4], [1, 1.45]]),
        lower: knots([[0, 2.3], [0.35, 2.5], [0.7, 2.2], [1, 1.7]]),
        noseCap: 0.085,
        noseShape: 0.55,
        jawDepth: 0.018,
        dorsalFin: fin(0.46, 0.64, 0.1, 11),
        analFin: fin(0.72, 0.8, 0.08, 8),
        pectoralFin: fin(0.22, 0.3, 0.24, 9),
        pelvicFin: fin(0.41, 0.45, 0.16, 6),
        caudalRays: 12,
      },
      hasBib: false,
      tailShape: 'fan',
      tailSize: 0.55,
      gills: { enabled: true, position: 0.21, size: 4.5, relief: -0.5 },
      eyes: { enabled: true, position: 0.1, size: 5, relief: 0.3 },
      assembly: assembly({
        anchors: [
          anchor('dos', 0.2, 0.5, 'back'),
          anchor('ventre', 0.31, -0.5, 'belly'),
          anchor('arriere', 0.62, -0.5, 'belly'),
        ],
      }),
      screws: {
        enabled: true,
        nutFit: 0.1,
        screws: [{ id: 'vis-0', position: 0.51, size: 'auto', head: 'countersunk', length: 15 }],
      },
      infill: 20,
      ballasts: [ballast(0.3, -0.72, 5, 'vib', 'cylinder'), ballast(0.42, -0.7, 4, 'vib', 'cylinder')],
      mounts: [
        mount('mount-ventre', 'Support ventral', 'ventre', 0.31, -1),
        mount('mount-arriere', 'Support arriere', 'arriere', 0.62, -1),
      ],
      paint: paint('#4a3b1f', '#d9c27a', { belly: '#f4ecd2', pattern: 'none' }),
    }),
  ),
  family(
    'swimbait',
    'Swimbait articule',
    'Deux segments, faces de joint propres, caudale rapportee',
    'Corps en deux segments relies par une quincaillerie de charniere, faces de joint en V qui liberent le debattement, caudale souple rapportee dans une fente. Test de collision au degre sur toute la course. Variantes par reglage : glide bait 2 parties, multi-segments. Plage 90 a 250 mm.',
    (base) => ({
      length: 160,
      maxWidth: 22,
      thickness: 36,
      anatomy: {
        ...base.anatomy!,
        jaw: 0.07,
        peduncle: 0.82,
        dorsal: knots([
          [0, 0.14], [0.05, 0.3], [0.13, 0.45], [0.26, 0.53], [0.4, 0.54], [0.54, 0.5],
          [0.68, 0.4], [0.82, 0.27], [0.92, 0.2], [1, 0.19],
        ]),
        ventral: knots([
          [0, 0.13], [0.05, 0.27], [0.14, 0.4], [0.28, 0.46], [0.42, 0.46], [0.56, 0.41],
          [0.7, 0.31], [0.84, 0.2], [0.93, 0.16], [1, 0.16],
        ]),
        width: knots([
          [0, 0.34], [0.05, 0.6], [0.14, 0.86], [0.28, 1], [0.44, 0.96], [0.6, 0.82],
          [0.74, 0.6], [0.86, 0.4], [0.94, 0.3], [1, 0.26],
        ]),
        upper: knots([[0, 2.2], [0.3, 2.0], [0.6, 1.75], [0.9, 1.55], [1, 1.55]]),
        lower: knots([[0, 2.2], [0.4, 2.3], [0.75, 2.0], [1, 1.8]]),
        noseCap: 0.07,
        noseShape: 0.6,
        dorsalFin: fin(0.3, 0.44, 0.1, 11),
        analFin: fin(0.72, 0.82, 0.07, 8),
        pectoralFin: fin(0.2, 0.28, 0.26, 11),
        pelvicFin: fin(0.4, 0.46, 0.16, 7),
        caudalRays: 16,
      },
      hasBib: false,
      tailShape: 'round',
      tailSize: 0.6,
      softTail: { ...defaultSoftTail(), enabled: true, length: 40, height: 34, insertion: 7, method: 'slot' },
      articulation: articulation({ enabled: true, segments: 2, positionMm: 84, swing: 40 }),
      gills: { enabled: true, position: 0.18, size: 6, relief: -0.6 },
      eyes: { enabled: true, position: 0.075, size: 8, relief: 0.4 },
      assembly: assembly({
        anchors: [
          anchor('nez', 0.06, 0, 'nose'),
          anchor('ventre', 0.33, -0.5, 'belly'),
          anchor('arriere', 0.7, -0.5, 'belly'),
        ],
      }),
      screws: {
        enabled: true,
        nutFit: 0.1,
        screws: [
          { id: 'vis-avant', position: 0.22, size: 'auto', head: 'countersunk', length: 25 },
          { id: 'vis-arriere', position: 0.78, size: 'auto', head: 'countersunk', length: 20 },
        ],
      },
      infill: 15,
      ballasts: [ballast(0.3, -0.7, 8, 'swb', 'cylinder'), ballast(0.66, -0.66, 6, 'swb', 'cylinder')],
      mounts: [
        mount('mount-ventre', 'Support ventral', 'ventre', 0.33, -1),
        mount('mount-arriere', 'Support arriere', 'arriere', 0.7, -1),
      ],
      paint: paint('#2e3d2a', '#cfd5c4', { pattern: 'scales', patternScale: 20 }),
    }),
  ),
];

export const SHAPE_PRESETS: ShapePreset[] = FAMILY_PRESETS;

export const getPreset = (id: ShapeId): ShapePreset =>
  SHAPE_PRESETS.find((preset) => preset.id === id) ?? SHAPE_PRESETS[0];

/** Copie profonde : les presets ne doivent jamais etre modifies en place. */
export const clonePreset = (id: ShapeId): LureParams => {
  const { params } = getPreset(id);
  return {
    ...params,
    ballasts: params.ballasts.map((b, i) => ({ ...b, id: `${b.id}-${i}-${Date.now()}` })),
    gills: { ...params.gills },
    eyes: { ...params.eyes },
    anatomy: cloneAnatomy(params.anatomy),
    assembly: {
      ...params.assembly,
      // Les identifiants d'ancrage restent ceux du modele : les supports
      // d'hamecon s'y rattachent par cet identifiant.
      anchors: params.assembly.anchors.map((anchor) => ({ ...anchor })),
      glueGroove: { ...params.assembly.glueGroove },
      pegs: { ...params.assembly.pegs },
      hollow: { ...params.assembly.hollow },
    },
    fabrication: { ...params.fabrication },
    chamber: { ...params.chamber },
    // La livree porte des sous-objets : une copie superficielle les ferait
    // partager entre tous les projets ouverts.
    ribs: { ...params.ribs },
    popperFace: { ...params.popperFace },
    softTail: { ...params.softTail },
    shell: { ...params.shell },
    insert: { ...params.insert },
    throughWire: { ...params.throughWire, bellyPositions: [...params.throughWire.bellyPositions] },
    catalogue: params.catalogue.map((item) => ({ ...item })),
    mounts: params.mounts.map((item, i) => ({ ...item, id: `${item.id}-${i}-${Date.now()}` })),
    paint: { ...params.paint, livery: cloneLivery(params.paint.livery) },
    // Ces sous-objets etaient partages par reference : regler le debattement
    // d'un projet modifiait le MODELE, et donc tous les projets ouverts
    // ensuite. Une copie par clone, comme pour les autres.
    articulation: { ...params.articulation },
    screws: {
      ...params.screws,
      screws: params.screws.screws.map((screw, i) => ({
        ...screw,
        id: `${screw.id}-${i}-${Date.now()}`,
      })),
    },
    dowels: { ...params.dowels },
    print: { ...params.print },
    scales: { ...params.scales },
    outline: { ...params.outline, nodes: params.outline.nodes.map((node) => ({ ...node })) },
    outlineReference: { ...params.outlineReference },
    decals: params.decals.map((decal, i) => ({ ...decal, id: `${decal.id}-${i}-${Date.now()}` })),
    inlays: params.inlays.map((inlay, i) => ({ ...inlay, id: `${inlay.id}-${i}-${Date.now()}` })),
  };
};
