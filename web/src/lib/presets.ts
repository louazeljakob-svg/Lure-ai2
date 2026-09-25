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
import { seedCatalogue, seedId } from './tackle';
import { defaultThroughWire } from './throughWire';
import { defaultPropeller, PROPELLER_ANCHOR } from './propeller';

export interface Range {
  /** Plage du curseur : un confort d'usage, pas une limite physique (AJ.3). */
  min: number;
  max: number;
  step: number;
  /**
   * Bornes physiques : une saisie au clavier est acceptee jusque-la, et la
   * validation d'un projet ne rogne qu'au-dela. Par defaut, la plage du curseur.
   */
  hardMin?: number;
  hardMax?: number;
  /** Ce qui rend impossible une valeur hors des bornes physiques. */
  limitReason?: string;
}

/** Bornes partagees par les sliders, la validation et l'import de projets. */
export const LIMITS = {
  length: { min: 30, max: 260, step: 1, hardMin: 10, hardMax: 600, limitReason: 'Un corps de moins de 10 mm ne loge plus aucune quincaillerie ; au-dela de 600 mm, le calcul de nage et la grille d export sortent de leur domaine.' },
  maxWidth: { min: 6, max: 80, step: 0.5, hardMin: 2, hardMax: 300 },
  thickness: { min: 6, max: 90, step: 0.5, hardMin: 2, hardMax: 300 },
  bellyPosition: { min: 0.2, max: 0.75, step: 0.01, hardMin: 0.1, hardMax: 0.9, limitReason: 'La section maitresse doit rester a l interieur du corps.' },
  dorsalCurve: { min: -1, max: 1, step: 0.02 },
  ventralCurve: { min: -1, max: 1, step: 0.02 },
  noseSharpness: { min: 0.25, max: 1.4, step: 0.01, hardMin: 0.1, hardMax: 2 },
  noseAngle: { min: -40, max: 40, step: 1, hardMin: -80, hardMax: 80, limitReason: 'Au-dela de 80 deg, la tete se replie sur le corps.' },
  tailTaper: { min: 0.4, max: 2.2, step: 0.01, hardMin: 0.2, hardMax: 4 },
  crossSection: { min: 1.4, max: 3.4, step: 0.05, hardMin: 1.1, hardMax: 4, limitReason: 'En dessous de 1,1, la section degenere en losange plat.' },
  mouthCup: { min: 0, max: 1, step: 0.02 },
  bibAngle: { min: 10, max: 85, step: 1, hardMin: 5, hardMax: 89, limitReason: 'La plaque doit rester inclinee entre 5 et 89 deg pour se loger dans la fente.' },
  bibLength: { min: 5, max: 60, step: 0.5, hardMin: 1, hardMax: 150 },
  bibWidth: { min: 5, max: 50, step: 0.5, hardMin: 1, hardMax: 120 },
  tailSize: { min: 0.4, max: 1.8, step: 0.02, hardMin: 0.1, hardMax: 4 },
  infill: { min: 0, max: 100, step: 5 },
  hardwareMass: { min: 0, max: 20, step: 0.1, hardMin: 0, hardMax: 200 },
  ballastMass: { min: 0.1, max: 30, step: 0.1, hardMin: 0.01, hardMax: 500 },
  ballastPosition: { min: 0.05, max: 0.95, step: 0.01, hardMin: 0, hardMax: 1, limitReason: 'Position en fraction de la longueur : de 0 (nez) a 100 % (queue).' },
  ballastHeight: { min: -1, max: 1, step: 0.05 },
  patternScale: { min: 3, max: 26, step: 1 },
  ribPitch: { min: 0.8, max: 6, step: 0.1, hardMin: 0.2, hardMax: 20 },
  shellWall: { min: 0.8, max: 4, step: 0.1, hardMin: 0.4, hardMax: 10 },
  popperDiameter: { min: 0.25, max: 0.95, step: 0.01, hardMin: 0.05, hardMax: 1 },
  softTailLength: { min: 8, max: 90, step: 1, hardMin: 2, hardMax: 300 },
  softTailHeight: { min: 6, max: 80, step: 1, hardMin: 2, hardMax: 250 },
  softTailBase: { min: 0.4, max: 4, step: 0.05, hardMin: 0.1, hardMax: 10 },
  softTailTip: { min: 0.15, max: 3, step: 0.05, hardMin: 0.05, hardMax: 10 },
  softTailSpread: { min: 0.4, max: 3, step: 0.05, hardMin: 0.1, hardMax: 6 },
  softTailInsertion: { min: 2, max: 20, step: 0.5, hardMin: 0.5, hardMax: 60 },
  softTailClearance: { min: 0.05, max: 1, step: 0.05, hardMin: 0, hardMax: 2 },
  popperDepth: { min: 0.5, max: 12, step: 0.1, hardMin: 0.1, hardMax: 40 },
  popperAngle: { min: -30, max: 60, step: 1, hardMin: -60, hardMax: 80 },
  popperLip: { min: 0, max: 3, step: 0.05, hardMin: 0, hardMax: 10 },
  popperOffset: { min: -1, max: 1, step: 0.05 },
  insertLength: { min: 0.1, max: 0.9, step: 0.01, hardMin: 0.02, hardMax: 0.98 },
  insertHeight: { min: 0.1, max: 0.95, step: 0.01, hardMin: 0.02, hardMax: 0.99 },
  insertThickness: { min: 0.2, max: 3, step: 0.05, hardMin: 0.1, hardMax: 10 },
  insertPosition: { min: 0.1, max: 0.9, step: 0.01, hardMin: 0.02, hardMax: 0.98 },
  insertOffset: { min: -1, max: 1, step: 0.05 },
  insertRotation: { min: -45, max: 45, step: 1, hardMin: -90, hardMax: 90 },
  insertClearance: { min: 0.1, max: 1.5, step: 0.05, hardMin: 0, hardMax: 3 },
  ribHeight: { min: 0.1, max: 1.5, step: 0.05, hardMin: 0.02, hardMax: 5 },
  ribZone: { min: 0, max: 1, step: 0.01 },
  ribSlant: { min: -45, max: 45, step: 1, hardMin: -80, hardMax: 80 },
  zoneLength: { min: 0, max: 0.4, step: 0.01, hardMin: 0, hardMax: 1 },
  paintBlend: { min: 0, max: 1, step: 0.02 },
  gillPosition: { min: 0.12, max: 0.5, step: 0.01, hardMin: 0.02, hardMax: 0.9 },
  gillSize: { min: 1, max: 14, step: 0.5, hardMin: 0.2, hardMax: 60 },
  gillRelief: { min: -2, max: 2, step: 0.05, hardMin: -5, hardMax: 5 },
  eyePosition: { min: 0.03, max: 0.3, step: 0.01, hardMin: 0.01, hardMax: 0.6 },
  eyeSize: { min: 1.5, max: 14, step: 0.5, hardMin: 0.2, hardMax: 60 },
  eyeRelief: { min: -2, max: 2, step: 0.05, hardMin: -5, hardMax: 5 },
  billThickness: { min: 0.5, max: 3, step: 0.1, hardMin: 0.3, hardMax: 6 },
  ballastDensity: { min: 7, max: 11.4, step: 0.05, hardMin: 0.5, hardMax: 22.6, limitReason: 'Aucun metal n est plus dense que l osmium (22,6 g/cm3).' },
  planeAngle: { min: 0, max: 90, step: 1 },
  tenonCount: { min: 1, max: 4, step: 1 },
  segments: { min: 2, max: 5, step: 1 },
  tenonDiameter: { min: 0, max: 8, step: 0.1, hardMin: 0, hardMax: 20 },
  tenonClearance: { min: 0, max: 0.4, step: 0.01, hardMin: 0, hardMax: 2 },
  boreClearance: { min: 0, max: 0.4, step: 0.01, hardMin: 0, hardMax: 2 },
  channelOffset: { min: 0.05, max: 1, step: 0.05, hardMin: 0.01, hardMax: 5 },
  sweepExtra: { min: 0, max: 1, step: 0.05, hardMin: 0, hardMax: 5 },
  tenonFit: { min: 0, max: 0.5, step: 0.01, hardMin: 0, hardMax: 2 },
  billFit: { min: 0, max: 0.5, step: 0.01, hardMin: 0, hardMax: 2 },
  billOffset: { min: 0, max: 30, step: 0.5, hardMin: 0, hardMax: 150 },
  billInsertion: { min: 0, max: 30, step: 0.5, hardMin: 0, hardMax: 150 },
  billFillet: { min: 0, max: 4, step: 0.1, hardMin: 0, hardMax: 10 },
  billTwist: { min: -30, max: 30, step: 1, hardMin: -45, hardMax: 45 },
  anchorPosition: { min: 0.02, max: 0.97, step: 0.005, hardMin: 0, hardMax: 1 },
  anchorHeight: { min: -1, max: 1, step: 0.02 },
  anchorDepth: { min: 0, max: 8, step: 0.1, hardMin: 0, hardMax: 40 },
  rattleBall: { min: 2, max: 12, step: 0.5, hardMin: 0.5, hardMax: 30 },
  chamberDiameter: { min: 3, max: 20, step: 0.5, hardMin: 0.5, hardMax: 60 },
  chamberBalls: { min: 1, max: 6, step: 1, hardMin: 1, hardMax: 20 },
  chamberFit: { min: 0.1, max: 3, step: 0.05, hardMin: 0.02, hardMax: 10, limitReason: 'Le jeu est l ecart entre le diametre de chambre et celui de la bille.' },
  chamberTravel: { min: 0, max: 80, step: 0.5, hardMin: 0, hardMax: 300 },
  // --- Helice rotative (module AP.1) ---------------------------------------
  propDiameter: { min: 20, max: 50, step: 0.5, hardMin: 8, hardMax: 120, limitReason: 'En dessous de 8 mm, il ne reste plus de pale autour du moyeu.' },
  propAngle: { min: 15, max: 60, step: 1, hardMin: 5, hardMax: 80, limitReason: 'Au-dela de 80 deg, la pale se confond avec l axe et ne pousse plus.' },
  propBlade: { min: 0.8, max: 2.5, step: 0.1, hardMin: 0.4, hardMax: 5 },
  propHub: { min: 6, max: 24, step: 0.5, hardMin: 3, hardMax: 60 },
  beadDiameter: { min: 6, max: 14, step: 0.5, hardMin: 2, hardMax: 30 },
  // --- Decals ------------------------------------------------------------
  decalDepth: { min: 0.1, max: 3, step: 0.05, hardMin: 0.02, hardMax: 5 },
  decalSoftness: { min: 0, max: 100, step: 1 },
  decalOpacity: { min: 0, max: 100, step: 1 },
  decalPosition: { min: 0, max: 1, step: 0.005 },
  decalHeight: { min: -1, max: 1, step: 0.02 },
  decalRotation: { min: -180, max: 180, step: 1, hardMin: -360, hardMax: 360 },
  decalSize: { min: 1, max: 120, step: 0.5, hardMin: 0.2, hardMax: 600 },
  // --- Ecailles ----------------------------------------------------------
  scaleWidth: { min: 0.5, max: 8, step: 0.1, hardMin: 0.1, hardMax: 30 },
  scaleHeight: { min: 0.5, max: 8, step: 0.1, hardMin: 0.1, hardMax: 30 },
  scaleSpacing: { min: 0, max: 2, step: 0.05, hardMin: 0, hardMax: 10 },
  scaleDepth: { min: 0.05, max: 1, step: 0.01, hardMin: 0.01, hardMax: 3 },
  scaleRounding: { min: 0, max: 100, step: 1 },
  scaleMargin: { min: 0, max: 40, step: 1, hardMin: 0, hardMax: 100 },
  // --- Articulation ------------------------------------------------------
  eyeCount: { min: 1, max: 4, step: 1 },
  jointSwing: { min: 0, max: 90, step: 0.5, hardMin: 0, hardMax: 150 },
  jointFaceAngle: { min: 0, max: 90, step: 0.5, hardMin: 0, hardMax: 90 },
  jointClearance: { min: 0, max: 2, step: 0.05, hardMin: 0, hardMax: 5 },
  jointMass: { min: 0, max: 10, step: 0.01, hardMin: 0, hardMax: 200 },
  eyeLoop: { min: 1, max: 10, step: 0.1, hardMin: 0.3, hardMax: 30 },
  eyeWire: { min: 0.5, max: 3, step: 0.05, hardMin: 0.1, hardMax: 6 },
  eyeLength: { min: 3, max: 30, step: 0.5, hardMin: 1, hardMax: 80 },
  slotHeight: { min: 0.5, max: 8, step: 0.1, hardMin: 0.1, hardMax: 30 },
  slotDepth: { min: 1, max: 20, step: 0.5, hardMin: 0.3, hardMax: 60 },
  slotWidth: { min: 2, max: 60, step: 0.5, hardMin: 0.5, hardMax: 150 },
  jointFit: { min: 0.05, max: 1.5, step: 0.05, hardMin: 0, hardMax: 5 },
  retentionDiameter: { min: 1.5, max: 5, step: 0.1, hardMin: 0.5, hardMax: 12 },
  retentionSeatFit: { min: 0.05, max: 0.4, step: 0.01, hardMin: 0, hardMax: 2 },
  retentionLoopFit: { min: 0.1, max: 0.5, step: 0.01, hardMin: 0, hardMax: 2 },
  retentionChamfer: { min: 0.2, max: 1, step: 0.05, hardMin: 0, hardMax: 3 },
  // --- Assemblage visse ---------------------------------------------------
  screwCount: { min: 1, max: 3, step: 1 },
  nutFit: { min: 0, max: 0.4, step: 0.01, hardMin: 0, hardMax: 2 },
  // --- Atelier -----------------------------------------------------------
  perimeters: { min: 1, max: 6, step: 1, hardMin: 1, hardMax: 30 },
  layerHeight: { min: 0.05, max: 0.4, step: 0.01, hardMin: 0.02, hardMax: 1.2 },
  socketTolerance: { min: 0, max: 0.5, step: 0.01, hardMin: 0, hardMax: 2 },
  shrinkage: { min: 0, max: 3, step: 0.05, hardMin: 0, hardMax: 10 },
  // --- Goupilles d'assemblage --------------------------------------------
  dowelCount: { min: 2, max: 6, step: 1, hardMin: 1, hardMax: 20 },
  dowelDiameter: { min: 1.5, max: 5, step: 0.1, hardMin: 0.5, hardMax: 12 },
  dowelEngagement: { min: 2, max: 10, step: 0.1, hardMin: 0.5, hardMax: 40 },
  dowelClearance: { min: 0.05, max: 0.4, step: 0.01, hardMin: 0, hardMax: 2 },
  dowelChamfer: { min: 0.2, max: 1, step: 0.05, hardMin: 0, hardMax: 3 },
  // --- Gorge de colle, ergots, creusage (modules AB, AD) -------------------
  grooveWidth: { min: 0.4, max: 2, step: 0.05, hardMin: 0.1, hardMax: 6 },
  grooveDepth: { min: 0.2, max: 1, step: 0.05, hardMin: 0.05, hardMax: 4 },
  grooveInset: { min: 0.4, max: 3, step: 0.05, hardMin: 0.1, hardMax: 15 },
  pegCount: { min: 1, max: 4, step: 1 },
  pegDiameter: { min: 1.5, max: 6, step: 0.1, hardMin: 0.5, hardMax: 15 },
  pegHeight: { min: 0.8, max: 5, step: 0.1, hardMin: 0.2, hardMax: 20 },
  pegTaper: { min: 0, max: 20, step: 0.5, hardMin: 0, hardMax: 45 },
  pegClearance: { min: 0.05, max: 0.4, step: 0.01, hardMin: 0, hardMax: 2 },
  hollowWall: { min: 0.8, max: 4, step: 0.1, hardMin: 0.4, hardMax: 10 },
  // --- Anatomie (module AB) ----------------------------------------------
  anatomyJaw: { min: 0.02, max: 0.3, step: 0.005, hardMin: 0.01, hardMax: 0.5 },
  anatomyPeduncle: { min: 0.4, max: 0.97, step: 0.005, hardMin: 0.3, hardMax: 0.99 },
  anatomyNoseCap: { min: 0, max: 0.25, step: 0.005 },
  anatomyNoseShape: { min: 0.35, max: 1, step: 0.01 },
  anatomyJawDepth: { min: 0, max: 0.06, step: 0.001 },
  anatomyOpercle: { min: 0, max: 0.06, step: 0.001 },
  anatomyOrbit: { min: 0, max: 2, step: 0.05 },
  anatomyLateral: { min: 0, max: 0.4, step: 0.01 },
  finPosition: { min: 0.02, max: 0.98, step: 0.005, hardMin: 0, hardMax: 1 },
  finSize: { min: 0, max: 0.6, step: 0.005, hardMin: 0, hardMax: 1 },
  finRays: { min: 0, max: 30, step: 1, hardMin: 0, hardMax: 80 },
  caudalRays: { min: 4, max: 30, step: 1, hardMin: 2, hardMax: 80 },
  // --- Rainures de collant ------------------------------------------------
  inlayDepth: { min: 0.1, max: 1, step: 0.01, hardMin: 0.02, hardMax: 3 },
  inlayMargin: { min: 0, max: 1, step: 0.05, hardMin: 0, hardMax: 10 },
  inlayCorner: { min: 0, max: 5, step: 0.1, hardMin: 0, hardMax: 30 },
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

/**
 * Deux ergots coniques de 3 mm, 8 degres de depouille, 0,15 mm de jeu radial.
 * Leur hauteur est le RELIEF MALE du standard Minnow 100 : 2,0 mm, repris par
 * les goujons des portees de goupille.
 */
export const defaultPegs = (): PegConfig => ({
  enabled: true,
  count: 2,
  diameter: 3,
  height: 2,
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

/** Triple force standard de la table de depart, par taille. */
const treble = (size: string) => seedId('treble', 'Triple force standard', size);
/** Anneau brise inox de la table de depart, par taille. */
const ring = (size: string) => seedId('split', 'Anneau brise inox', size);

const mount = (
  id: string,
  label: string,
  anchorId: string,
  position: number,
  height: number,
  hookId: string | null = null,
  ringId: string | null = null,
): TackleMount => ({
  id,
  label,
  anchorId,
  position,
  height,
  ringId,
  hookId,
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
      [0.7, 0.62], [0.82, 0.38], [0.9, 0.24], [0.95, 0.19], [1, 0.12],
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
  meshBody: null,
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
  // Plomb : chaque lest est loge dans sa chambre fendue, a l'abri des
  // passages de vis et des portees de goupille (module AD.3).
  ballastDensity: 11.34,
  ballasts: [ballast(0.49, -0.25, 2, 'min', 'cylinder'), ballast(0.26, -0.5, 1.5, 'min', 'sphere')],
  chamber: chamber(),
  ribs: defaultRibs(),
  popperFace: defaultPopperFace(),
  softTail: defaultSoftTail(),
  shell: defaultShell(),
  insert: defaultInsert(),
  throughWire: defaultThroughWire(),
  propeller: defaultPropeller(),
  catalogue: seedCatalogue(),
  mounts: [
    mount('mount-ventre', 'Support ventral', 'ventre', 0.36, -1, treble('#6'), ring('#3')),
    mount('mount-arriere', 'Support arriere', 'arriere', 0.64, -1, treble('#6'), ring('#3')),
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
 * Corps de revolution : rayon relatif r(u), egal a 1 a `maxAt`, pedoncule
 * marque puis leger renflement de la calotte de queue.
 *
 * - avant : r = 1 - (1 - nez) (1 - s)^k, tangente nulle au maximum ;
 * - arriere : descente en cosinus carre jusqu'au pedoncule (tangente nulle
 *   aux deux bouts), puis remontee en sinus carre vers la queue.
 *
 * La fonction est C1 partout. Elle est echantillonnee SERRE (un noeud tous
 * les 2,5 % de longueur, davantage au nez) : l'interpolation monotone ne
 * peut alors pas onduler entre deux noeuds — une section circulaire ne
 * pardonne aucun defaut de ce genre.
 */
export interface RoundBody {
  maxAt: number;
  nose: number;
  power: number;
  waist: number;
  waistAt: number;
  flare: number;
}

export const roundRadius = (body: RoundBody) => (u: number): number => {
  const m = Math.min(Math.max(body.maxAt, 0.2), 0.85);
  if (u <= m) {
    const s = u / m;
    return 1 - (1 - body.nose) * Math.pow(1 - s, body.power);
  }
  const t = (u - m) / (1 - m);
  if (t <= body.waistAt) {
    const c = Math.cos((Math.PI / 2) * (t / body.waistAt));
    return body.waist + (1 - body.waist) * c * c;
  }
  const q = Math.sin((Math.PI / 2) * ((t - body.waistAt) / (1 - body.waistAt)));
  return body.waist + (body.flare - body.waist) * q * q;
};

/** Noeuds d'un corps de revolution : dos = ventre = r / 2, largeur = r. */
export const roundKnots = (body: RoundBody): Pick<Anatomy, 'dorsal' | 'ventral' | 'width' | 'upper' | 'lower'> => {
  const r = roundRadius(body);
  const us = new Set<number>([0, 0.005, 0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.065, 0.08]);
  for (let u = 0.1; u < 1 - 1e-9; u += 0.025) us.add(Math.round(u * 1000) / 1000);
  // Noeud exactement au maximum et au pedoncule : les extremums tombent sur
  // un noeud, ou l'interpolation monotone pose une tangente nulle.
  const m = Math.min(Math.max(body.maxAt, 0.2), 0.85);
  us.add(Math.round(m * 1000) / 1000);
  us.add(Math.round((m + body.waistAt * (1 - m)) * 1000) / 1000);
  us.add(1);
  const sorted = [...us].sort((a, b) => a - b);
  return {
    dorsal: sorted.map((u) => ({ u, v: r(u) / 2 })),
    ventral: sorted.map((u) => ({ u, v: r(u) / 2 })),
    width: sorted.map((u) => ({ u, v: r(u) })),
    upper: knots([[0, 2], [1, 2]]),
    lower: knots([[0, 2], [1, 2]]),
  };
};

/** Pencil : nez effile, lest arriere, pedoncule avant la calotte de l'oeillet de queue. */
export const PENCIL_BODY: Omit<RoundBody, 'maxAt'> = { nose: 0.3, power: 2.4, waist: 0.5, waistAt: 0.72, flare: 0.6 };
/** Whopper_Plopper : corps fusele plein, pedoncule avant la perle d'helice. */
export const PLOPPER_BODY: Omit<RoundBody, 'maxAt'> = { nose: 0.42, power: 2.1, waist: 0.42, waistAt: 0.8, flare: 0.5 };

/**
 * Les six familles de la bibliotheque (modules AB, AH et AO).
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
          [0.76, 0.58], [0.87, 0.36], [0.94, 0.24], [0.97, 0.2], [1, 0.14],
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
      infill: 40,
      ballasts: [ballast(0.215, -0.5, 3.5, 'vib', 'sphere'), ballast(0.41, -0.55, 3, 'vib', 'sphere')],
      mounts: [
        mount('mount-ventre', 'Support ventral', 'ventre', 0.31, -1, treble('#8'), ring('#3')),
        mount('mount-arriere', 'Support arriere', 'arriere', 0.62, -1, treble('#8'), ring('#3')),
      ],
      paint: paint('#4a3b1f', '#d9c27a', { belly: '#f4ecd2', pattern: 'none' }),
    }),
  ),
  family(
    'plopper',
    'Whopper_Plopper',
    'Corps fusele rond, helice de queue sur perle',
    'Corps de surface a section ronde, fil traversant qui sert d axe a une helice imprimee en queue, ecartee du corps par une perle d espacement. Une ou deux pales, angle et diametre reglables ; rotation verifiee sur un tour complet au pas de 5 deg. Plage 90 a 180 mm.',
    (base) => {
      const body = roundKnots({ maxAt: 0.42, ...PLOPPER_BODY });
      return {
        length: 130,
        maxWidth: 26,
        thickness: 26,
        bellyPosition: 0.42,
        anatomy: {
          ...base.anatomy!,
          ...body,
          jaw: 0.07,
          peduncle: 0.42 + 0.8 * 0.58,
          noseCap: 0.045,
          noseShape: 0.6,
          jawDepth: 0.016,
          opercleRelief: 0.02,
          orbitDepth: 0.5,
          lateralLine: 0.08,
          dorsalFin: fin(0.4, 0.58, 0.08, 11),
          analFin: fin(0.7, 0.78, 0.06, 8),
          pectoralFin: fin(0.2, 0.27, 0.2, 9),
          pelvicFin: fin(0.5, 0.55, 0.14, 6),
          caudalRays: 12,
        },
        hasBib: false,
        tailShape: 'round',
        tailSize: 0.6,
        gills: { enabled: true, position: 0.18, size: 5, relief: -0.5 },
        eyes: { enabled: true, position: 0.08, size: 6, relief: 0.3 },
        assembly: assembly({ anchors: [] }),
        // Fil traversant = axe d'helice ; une sortie ventrale pour le triple.
        throughWire: { ...defaultThroughWire(), enabled: true, wireMm: 1.2, loopMm: 6, bellyExits: 1, bellyPositions: [0.45] },
        propeller: { ...defaultPropeller(), enabled: true },
        // Visserie INAPPLICABLE : le fil traversant, axe de l'helice, court sur
        // l'axe dans le plan de joint. La plus courte vis du catalogue (15 mm)
        // monte du ventre jusqu'au-dessus de l'axe dans ce corps de 26 mm :
        // son ecrou couperait le canal a toutes les positions (3,8 mm de trop
        // au mieux). Plutot qu'une variante inventee, les coques sont
        // assemblees par ergots, goujons et gorge de colle, sans vis.
        screws: {
          enabled: false,
          nutFit: 0.1,
          screws: [
            { id: 'vis-avant', position: 0.26, size: 'auto', head: 'countersunk', length: 15 },
            { id: 'vis-arriere', position: 0.62, size: 'auto', head: 'countersunk', length: 15 },
          ],
        },
        infill: 15,
        ballasts: [ballast(0.36, -0.8, 4, 'plop', 'sphere')],
        mounts: [
          mount('mount-ventre', 'Support ventral', 'wire-belly-0', 0.45, -1, treble('#4'), ring('#3')),
          mount('mount-queue', 'Support de queue (axe)', PROPELLER_ANCHOR, 1, 0, treble('#4'), ring('#3')),
        ],
        paint: paint('#1f2b24', '#cfd8c4', { belly: '#f3efe0', pattern: 'none' }),
      };
    },
  ),
  family(
    'pencil',
    'Pencil',
    'Section circulaire pleine, lest arriere concentre',
    'Corps de revolution a section strictement circulaire, profil tendu pour porter loin, lest concentre a l arriere. Sans bavette ni appendice. Diametre max et sa position, position du lest : reglages de famille. Plage 50 a 120 mm.',
    (base) => {
      const body = roundKnots({ maxAt: 0.6, ...PENCIL_BODY });
      return {
        length: 75,
        maxWidth: 21,
        thickness: 21,
        bellyPosition: 0.6,
        anatomy: {
          ...base.anatomy!,
          ...body,
          jaw: 0.08,
          peduncle: 0.6 + 0.72 * 0.4,
          noseCap: 0.05,
          noseShape: 0.62,
          jawDepth: 0.014,
          opercleRelief: 0.016,
          orbitDepth: 0.4,
          // Pas de ligne laterale : un sillon longitudinal casserait la
          // section circulaire sur toute sa longueur.
          lateralLine: 0,
          dorsalFin: fin(0.5, 0.64, 0.05, 9),
          analFin: fin(0.7, 0.76, 0.04, 7),
          pectoralFin: fin(0.21, 0.27, 0.15, 8),
          pelvicFin: fin(0.48, 0.52, 0.1, 6),
          caudalRays: 12,
        },
        hasBib: false,
        tailShape: 'round',
        tailSize: 0.6,
        gills: { enabled: true, position: 0.21, size: 3.5, relief: -0.45 },
        eyes: { enabled: true, position: 0.11, size: 5, relief: 0.3 },
        assembly: assembly({
          anchors: [
            anchor('nez', 0.06, 0, 'nose'),
            anchor('ventre', 0.4, -0.5, 'belly'),
            anchor('queue', 0.95, 0, 'tail'),
          ],
        }),
        screws: {
          enabled: true,
          nutFit: 0.1,
          screws: [
            { id: 'vis-avant', position: 0.26, size: 'auto', head: 'countersunk', length: 15 },
            { id: 'vis-arriere', position: 0.58, size: 'auto', head: 'countersunk', length: 15 },
          ],
        },
        infill: 15,
        ballasts: [ballast(0.85, 0, 3, 'pen', 'sphere')],
        mounts: [
          mount('mount-ventre', 'Support ventral', 'ventre', 0.4, -1, treble('#6'), ring('#3')),
          mount('mount-queue', 'Support de queue', 'queue', 0.95, 0, treble('#6'), ring('#3')),
        ],
        paint: paint('#26323d', '#e3e6ea', { pattern: 'none' }),
      };
    },
  ),
  family(
    'nageur',
    'Poisson nageur',
    'Grande bavette, chambre de billes, suspension neutre',
    'Poisson nageur classique : bavette nettement plus grande que celle du minnow, chambre de billes longitudinale creusee dans le plan de joint, lestage cale pour la suspension neutre. Billes achetees : pesees, listees dans la fiche de montage, jamais imprimees. Plage 80 a 140 mm.',
    (base) => ({
      length: 100,
      maxWidth: 15,
      thickness: 22,
      anatomy: {
        ...base.anatomy!,
        jaw: 0.08,
        peduncle: 0.73,
        dorsal: knots([
          [0, 0.13], [0.06, 0.28], [0.14, 0.42], [0.26, 0.51], [0.4, 0.53], [0.52, 0.5],
          [0.66, 0.39], [0.8, 0.25], [0.88, 0.2], [0.95, 0.21], [1, 0.24],
        ]),
        ventral: knots([
          [0, 0.11], [0.06, 0.23], [0.15, 0.37], [0.3, 0.46], [0.42, 0.47], [0.56, 0.43],
          [0.7, 0.3], [0.82, 0.2], [0.9, 0.16], [0.96, 0.17], [1, 0.2],
        ]),
        dorsalFin: fin(0.42, 0.6, 0.13, 12),
        analFin: fin(0.76, 0.83, 0.08, 9),
        pectoralFin: fin(0.22, 0.3, 0.26, 10),
        pelvicFin: fin(0.59, 0.64, 0.18, 7),
      },
      billThickness: 1.5,
      billOffset: 8,
      billInsertion: 5,
      bibAngle: 35,
      bibLength: 30,
      bibWidth: 14,
      tailShape: 'forked',
      tailSize: 0.85,
      gills: { enabled: true, position: 0.21, size: 4, relief: -0.5 },
      eyes: { enabled: true, position: 0.09, size: 5.5, relief: 0.3 },
      assembly: assembly({
        anchors: [
          anchor('nez', 0.08, 0, 'nose'),
          anchor('ventre', 0.2, -0.5, 'belly'),
          anchor('arriere', 0.71, -0.5, 'belly'),
        ],
      }),
      screws: {
        enabled: true,
        nutFit: 0.1,
        screws: [
          // Vis de 15 mm, la plus courte du catalogue : une devant la chambre
          // de billes, une derriere — aucune ne la traverse.
          { id: 'vis-avant', position: 0.14, size: 'auto', head: 'countersunk', length: 15 },
          { id: 'vis-arriere', position: 0.54, size: 'auto', head: 'countersunk', length: 15 },
        ],
      },
      infill: 15,
      // Suspension neutre : deux lests sous la chambre, billes comprises.
      ballasts: [ballast(0.28, -0.7, 1.5, 'nag', 'sphere'), ballast(0.43, -0.75, 2.2, 'nag', 'sphere')],
      // Trois billes inox de 6 mm, tube de 6,6 mm : 0,6 mm de jeu, de quoi
      // rouler et claquer. Le tube court dans le plan de joint, au-dessus de
      // l'axe : les portees ventrales, le lest et la vis passent dessous. Il
      // descend vers l'arriere, ou les billes se tassent au lancer.
      chamber: {
        enabled: true,
        diameter: 6.6,
        fromPosition: 0.24,
        fromHeight: 0.38,
        toPosition: 0.48,
        toHeight: 0.32,
        ball: 6,
        balls: 3,
      },
      mounts: [
        mount('mount-ventre', 'Support ventral', 'ventre', 0.2, -1, treble('#6'), ring('#3')),
        mount('mount-arriere', 'Support arriere', 'arriere', 0.71, -1, treble('#6'), ring('#3')),
      ],
      paint: paint('#3a4a2c', '#dfe3cf', { pattern: 'scales' }),
    }),
  ),
  family(
    'souple',
    'Souple',
    'Corps elance en TPU, lest ventral integre a l avant',
    'Corps elance imprime en TPU, lest ventral integre vers l avant, attache dorsale ou de nez, sans bavette, caudale en palette. Descend droit et s anime a la canne. Masse et position du lest, position d attache : reglages de famille. Plage 70 a 150 mm.',
    (base) => ({
      length: 100,
      maxWidth: 12.8,
      thickness: 23.5,
      anatomy: {
        ...base.anatomy!,
        jaw: 0.08,
        peduncle: 0.74,
        dorsal: knots([
          [0, 0.12], [0.06, 0.25], [0.15, 0.39], [0.28, 0.47], [0.42, 0.49], [0.56, 0.45],
          [0.68, 0.36], [0.8, 0.24], [0.88, 0.19], [0.95, 0.2], [1, 0.23],
        ]),
        ventral: knots([
          [0, 0.1], [0.06, 0.22], [0.15, 0.36], [0.28, 0.47], [0.38, 0.51], [0.5, 0.46],
          [0.64, 0.33], [0.78, 0.21], [0.88, 0.16], [0.95, 0.17], [1, 0.2],
        ]),
        width: knots([
          [0, 0.4], [0.05, 0.64], [0.12, 0.84], [0.25, 0.95], [0.4, 1], [0.6, 0.97],
          [0.72, 0.72], [0.82, 0.44], [0.9, 0.28], [0.95, 0.22], [1, 0.15],
        ]),
        dorsalFin: fin(0.46, 0.62, 0.11, 11),
        analFin: fin(0.7, 0.78, 0.08, 8),
        pectoralFin: fin(0.21, 0.29, 0.22, 9),
        pelvicFin: fin(0.44, 0.49, 0.15, 6),
      },
      hasBib: false,
      tailShape: 'paddle',
      tailSize: 0.8,
      gills: { enabled: true, position: 0.2, size: 4.5, relief: -0.5 },
      eyes: { enabled: true, position: 0.09, size: 5.5, relief: 0.3 },
      assembly: assembly({
        anchors: [
          anchor('dos', 0.2, 0.5, 'back'),
          anchor('ventre', 0.64, -0.5, 'belly'),
        ],
      }),
      screws: {
        enabled: true,
        nutFit: 0.1,
        screws: [
          // Le lest ventral occupe le premier tiers : une vis devant lui, une
          // derriere. 15 mm, la plus courte du catalogue.
          { id: 'vis-avant', position: 0.13, size: 'auto', head: 'countersunk', length: 15 },
          { id: 'vis-arriere', position: 0.55, size: 'auto', head: 'countersunk', length: 15 },
        ],
      },
      material: 'tpu',
      infill: 25,
      ballasts: [ballast(0.35, -0.35, 18, 'sou', 'cylinder')],
      mounts: [mount('mount-ventre', 'Support ventral', 'ventre', 0.64, -1, treble('#4'), ring('#3'))],
      paint: paint('#5a6b74', '#e6e9eb', { pattern: 'none' }),
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
    propeller: { ...params.propeller },
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
