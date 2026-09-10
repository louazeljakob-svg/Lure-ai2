/**
 * Simulation physique simplifiee.
 *
 * Le volume et le centre de poussee sont integres directement sur le maillage
 * genere (somme des tetraedres signes), pas sur une approximation d'ellipsoide :
 * le resultat suit donc fidelement chaque reglage de forme.
 *
 * Hypotheses : leurre etanche, immersion totale au repos, eau au repos,
 * petits angles pour l'estimation d'action. Ce n'est pas de la CFD.
 */

import * as THREE from 'three';
import type { LureParams, WaterId } from '../types/lure';
import type { LureGeometry } from './geometry';
import { getMaterial, solidFraction, WATER_DENSITY } from './materials';
import { clamp, createProfile } from './profile';
import { buildAssembly, resolvePin } from './assembly';
import { printedBodies } from './geometry';
import type { BillSlotPlan } from './billTemplate';
import type { ArticulationPlan } from './articulation';
import { dowelVolumes, type DowelPlacement } from './dowels';
import { pinPath, pinWireLength, STAINLESS_DENSITY } from './hardware';

export type Buoyancy = 'float' | 'suspend' | 'sink';
export type Attitude = 'nose-up' | 'level' | 'nose-down';
export type SwimAction = 'tight' | 'wide' | 'rolling';
export type WarningLevel = 'error' | 'warn' | 'info' | 'ok';

export interface PhysicsWarning {
  id: string;
  level: WarningLevel;
  title: string;
  detail: string;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PhysicsResult {
  /** Volume exterieur total en cm3 (corps + bavette + caudale). */
  volumeCm3: number;
  /** Goupilles cylindriques d'assemblage retenues, avec leur controle. */
  dowels: DowelPlacement[];
  solidFraction: number;
  bodyMass: number;
  ballastMass: number;
  hardwareMass: number;
  /** Masse de l'agrafe montee sur l'oeillet de tete. */
  clipMass: number;
  /** Masse de la goupille en 8 traversante. */
  pinMass: number;
  /** Masse des billes mobiles (rattle ponctuel et chambre). */
  rattleMass: number;
  totalMass: number;
  displacedMass: number;
  /** Masse / poussee. < 1 flotte, = 1 suspend, > 1 coule. */
  ratio: number;
  density: number;
  buoyancy: Buoyancy;
  cg: Vec3;
  cb: Vec3;
  /** Positions en % de la longueur depuis le nez. */
  cgPct: number;
  cbPct: number;
  /** Assiette au repos, en degres. Positif = nez releve. */
  trimDeg: number;
  attitude: Attitude;
  /** Bras de levier vertical CG <-> CP, en mm. Positif = stable. */
  rollMarginMm: number;
  action: SwimAction;
  actionScore: number;
  /** Fourchette de profondeur de nage indicative, en metres. */
  diveDepth: [number, number] | null;
  warnings: PhysicsWarning[];
}

// ---------------------------------------------------------------------------
// Proprietes de masse d'un maillage
// ---------------------------------------------------------------------------

/**
 * Volume et centroide d'un maillage ferme, par somme des tetraedres signes
 * formes avec l'origine. Le signe s'annule pour les faces cachees, ce qui
 * donne le volume reel meme sur une forme concave.
 */
export function massProperties(geometry: THREE.BufferGeometry): {
  volume: number;
  centroid: THREE.Vector3;
} {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  let volume = 0;

  for (let i = 0; i < count; i += 3) {
    const i0 = index ? index.getX(i) : i;
    const i1 = index ? index.getX(i + 1) : i + 1;
    const i2 = index ? index.getX(i + 2) : i + 2;
    a.fromBufferAttribute(position, i0);
    b.fromBufferAttribute(position, i1);
    c.fromBufferAttribute(position, i2);

    const v = cross.crossVectors(b, c).dot(a) / 6;
    volume += v;
    centroid.x += ((a.x + b.x + c.x) / 4) * v;
    centroid.y += ((a.y + b.y + c.y) / 4) * v;
    centroid.z += ((a.z + b.z + c.z) / 4) * v;
  }

  if (Math.abs(volume) > 1e-9) centroid.divideScalar(volume);
  return { volume: Math.abs(volume), centroid };
}

// ---------------------------------------------------------------------------
// Quincaillerie : ou pendent les hameçons et l'anneau de tete
// ---------------------------------------------------------------------------

interface PointMass {
  x: number;
  y: number;
  mass: number;
}

function hardwarePoints(params: LureParams, total: number): PointMass[] {
  if (total <= 0) return [];
  const profile = createProfile(params);
  const bellyHook = clamp(0.38, 0.1, profile.bodyEnd - 0.05);
  const tailHook = clamp(profile.bodyEnd - 0.04, 0.2, 0.98);
  return [
    // Anneau de tete : leger, centre sur le nez.
    { x: profile.xAt(0.02), y: profile.section(0.05).bottom * 0.4, mass: total * 0.12 },
    // Hameçon ventral : suspendu sous le ventre, il abaisse le centre de gravite.
    { x: profile.xAt(bellyHook), y: profile.section(bellyHook).bottom * 1.35, mass: total * 0.46 },
    // Hameçon de queue.
    { x: profile.xAt(tailHook), y: profile.section(tailHook).bottom * 1.1, mass: total * 0.42 },
  ];
}

// ---------------------------------------------------------------------------
// Calcul principal
// ---------------------------------------------------------------------------

export function computePhysics(
  params: LureParams,
  geo: LureGeometry,
  water: WaterId = 'fresh',
): PhysicsResult {
  // La bavette rapportee ne fait pas partie du corps imprime : elle ne pese
  // pas dans le calcul et ne deplace pas d'eau au titre du corps.
  const parts = [geo.body, geo.bibIsGhost ? null : geo.bib, geo.tail].filter(
    Boolean,
  ) as THREE.BufferGeometry[];
  let volume = 0;
  const weightedCentroid = new THREE.Vector3();
  for (const part of parts) {
    const props = massProperties(part);
    volume += props.volume;
    weightedCentroid.addScaledVector(props.centroid, props.volume);
  }
  const cb = volume > 1e-9 ? weightedCentroid.divideScalar(volume) : new THREE.Vector3();

  const profile = createProfile(params);

  // Les logements internes retirent de la matiere : puits de goupille, canaux
  // de sortie, fente de bavette, billes. Plutot que de les estimer un par un,
  // on mesure ce qui est reellement imprime — le volume des deux coques.
  const cavities = params.assembly.enabled
    ? shellContent(params, profile)
    : {
        printed: printedBodies(geo).reduce((sum, part) => sum + massProperties(part).volume, 0),
        mass: 0,
        points: [] as PointMass[],
        bill: null as BillSlotPlan | null,
        dowelAdded: 0,
        dowels: [] as DowelPlacement[],
      };
  // Bavette imprimee et caudale ne font pas partie des coques : leur volume
  // s'ajoute a celui des deux demi-corps.
  const appendages = Math.max(volume - massProperties(geo.body).volume, 0);
  // Quincaillerie du joint : elle s'achete, elle ne s'imprime pas, mais elle
  // pese — a condition que l'utilisateur ait renseigne ses masses.
  const jointMass = geo.jointPlan ? geo.jointPlan.hardwareMass : 0;

  const material = getMaterial(params.material);
  // Les parois de perimetre comptent : a remplissage egal, six parois
  // deposent bien plus de matiere qu'une seule.
  const fill = solidFraction(params.material, params.infill, params.print.perimeters);
  // Les barreaux d'assemblage sont pleins : ils ne suivent pas le taux de
  // remplissage du corps.
  const bodyMass =
    (cavities.printed + appendages) * material.density * fill +
    cavities.dowelAdded * material.density +
    jointMass;
  const lengthCm = profile.lengthCm;
  const halfLength = lengthCm / 2;

  const ballastMass = params.ballasts.reduce((sum, b) => sum + Math.max(b.mass, 0), 0);
  const hardwareMass = Math.max(params.hardwareMass, 0);
  // L'agrafe est en acier : elle ne deplace presque pas d'eau mais pese au nez.
  const clipMass = geo.clip?.mass ?? 0;
  // La goupille traverse le corps : sa masse se deduit de la longueur de fil
  // developpee, comme pour l'agrafe.
  const pinSpec = params.assembly.enabled ? resolvePin(params) : null;
  const pinMass = pinSpec ? pinWireLength(pinPath(pinSpec)) * Math.PI * ((pinSpec.wire * 0.05) ** 2) * STAINLESS_DENSITY : 0;
  const rattleMass = cavities.mass;
  const totalMass = bodyMass + ballastMass + hardwareMass + clipMass + pinMass + rattleMass;

  // Centre de gravite : corps homogene + billes de lest + quincaillerie.
  const points: PointMass[] = [
    { x: cb.x, y: cb.y, mass: bodyMass },
    ...geo.ballasts.map((m) => ({ x: m.position[0], y: m.position[1], mass: m.mass })),
    ...hardwarePoints(params, hardwareMass),
    ...(clipMass > 0 ? [{ x: profile.xAt(0), y: 0, mass: clipMass }] : []),
    // La goupille est logee dans la tete, sur l'axe.
    ...(pinMass > 0 ? [{ x: profile.xAt(0.07), y: 0, mass: pinMass }] : []),
    ...cavities.points,
  ];
  const cg = { x: 0, y: 0, z: 0 };
  const massSum = points.reduce((sum, p) => sum + p.mass, 0);
  if (massSum > 1e-9) {
    for (const p of points) {
      cg.x += (p.x * p.mass) / massSum;
      cg.y += (p.y * p.mass) / massSum;
    }
  }

  const displacedMass = volume * WATER_DENSITY[water];
  const ratio = displacedMass > 1e-9 ? totalMass / displacedMass : 0;
  const density = volume > 1e-9 ? totalMass / volume : 0;
  const buoyancy: Buoyancy = ratio < 0.97 ? 'float' : ratio > 1.03 ? 'sink' : 'suspend';

  // Bras de levier vertical : c'est lui qui redresse le leurre en roulis.
  const rollMarginMm = (cb.y - cg.y) * 10;

  const cgPct = ((cg.x + halfLength) / lengthCm) * 100;
  const cbPct = ((cb.x + halfLength) / lengthCm) * 100;

  // Assiette de nage : linearisation du couple de tangage. Sous traction, le
  // decalage longitudinal CG / CP gouverne l'inclinaison ; le gain (degres par
  // % de longueur de decalage) est cale sur des leurres du commerce.
  const TRIM_GAIN = 1.5;
  const trimDeg = clamp((cgPct - cbPct) * TRIM_GAIN, -40, 40);
  const attitude: Attitude = trimDeg > 4 ? 'nose-up' : trimDeg < -4 ? 'nose-down' : 'level';

  // --- Action de nage ------------------------------------------------------
  const fatness = params.maxWidth / Math.max(params.length, 1);
  const fatNorm = clamp((fatness - 0.12) / 0.22, 0, 1);
  const bibAreaNorm = params.hasBib
    ? clamp((params.bibLength * params.bibWidth) / (params.length * params.length * 0.09), 0, 1)
    : 0;
  const bibAngleNorm = params.hasBib ? clamp((params.bibAngle - 15) / 60, 0, 1) : 0;
  // Une caudale large (palette, eventail) entretient l'oscillation a elle seule.
  const tailBoost =
    params.tailShape === 'paddle'
      ? 0.25 * params.tailSize
      : params.tailShape === 'fan'
        ? 0.15 * params.tailSize
        : 0;
  const wobble = clamp(
    (params.hasBib ? 0.55 * bibAngleNorm + 0.45 * bibAreaNorm : 0.25 + 0.35 * fatNorm) +
      tailBoost,
    0,
    1,
  );
  // Au-dela de 4 mm de bras de levier, le roulis n'est plus le facteur limitant.
  const rollNorm = 1 - clamp(rollMarginMm / 4, 0, 1);
  const actionScore = clamp(0.46 * wobble + 0.3 * fatNorm + 0.24 * rollNorm, 0, 1);
  const action: SwimAction =
    rollMarginMm <= 0 ? 'rolling' : actionScore < 0.34 ? 'tight' : actionScore < 0.62 ? 'wide' : 'rolling';

  // --- Profondeur indicative ----------------------------------------------
  let diveDepth: [number, number] | null = null;
  if (params.hasBib && buoyancy !== 'sink') {
    const base = 0.4 + 4.5 * bibAreaNorm * Math.cos(THREE.MathUtils.degToRad(params.bibAngle));
    const depth = clamp(base, 0.3, 5);
    diveDepth = [Math.round(depth * 0.75 * 10) / 10, Math.round(depth * 1.25 * 10) / 10];
  }

  return {
    volumeCm3: volume,
    solidFraction: fill,
    bodyMass,
    ballastMass,
    hardwareMass,
    clipMass,
    pinMass,
    rattleMass,
    totalMass,
    displacedMass,
    ratio,
    density,
    buoyancy,
    cg,
    cb: { x: cb.x, y: cb.y, z: cb.z },
    cgPct,
    cbPct,
    trimDeg,
    attitude,
    rollMarginMm,
    action,
    actionScore,
    diveDepth,
    dowels: cavities.dowels,
    warnings: buildWarnings(params, geo, {
      buoyancy,
      ratio,
      cgPct,
      trimDeg,
      rollMarginMm,
      ballastMass,
      totalMass,
      bill: cavities.bill,
      joint: geo.jointPlan,
      dowels: cavities.dowels,
    }),
  };
}

/**
 * Matiere reellement imprimee, et billes mobiles logees dedans.
 *
 * On mesure les deux coques telles qu'elles sortiront plutot que d'estimer
 * chaque logement : c'est le generateur d'assemblage qui decide lesquels
 * tiennent dans la section, et la masse doit suivre cette decision-la.
 */
function shellContent(
  params: LureParams,
  profile: ReturnType<typeof createProfile>,
): {
  printed: number;
  mass: number;
  points: PointMass[];
  bill: BillSlotPlan | null;
  dowelAdded: number;
  dowels: DowelPlacement[];
} {
  const assembly = buildAssembly(profile, params, { stations: 40, arcSamples: 10 });
  const printed =
    massProperties(assembly.male).volume +
    massProperties(assembly.female).volume +
    (assembly.tenons ? massProperties(assembly.tenons).volume : 0);
  const points = assembly.rattles.map((ball) => ({
    x: ball.position[0],
    y: ball.position[1],
    mass: ball.mass,
  }));
  const mass = points.reduce((sum, point) => sum + point.mass, 0);
  assembly.male.dispose();
  assembly.female.dispose();
  assembly.tenons?.dispose();
  assembly.socketPreview?.dispose();
  for (const pin of assembly.pins) pin.geometry.dispose();
  assembly.dowelPins?.dispose();
  return {
    printed,
    mass,
    points,
    bill: assembly.billPlan,
    // Les logements sont deja retires du volume mesure sur les coques ; il
    // ne reste qu'a AJOUTER la matiere des barreaux, qui s'impriment a part.
    dowelAdded: dowelVolumes(assembly.dowels).added,
    dowels: assembly.dowels,
  };
}

// ---------------------------------------------------------------------------
// Coherence physique
// ---------------------------------------------------------------------------

interface WarningInput {
  buoyancy: Buoyancy;
  ratio: number;
  cgPct: number;
  trimDeg: number;
  rollMarginMm: number;
  ballastMass: number;
  totalMass: number;
  /** Empreinte de bavette retenue par l'assemblage, ou null s'il n'y en a pas. */
  bill: BillSlotPlan | null;
  /** Cotes du joint articule, ou null. */
  joint: ArticulationPlan | null;
  /** Goupilles cylindriques d'assemblage et leur controle. */
  dowels: DowelPlacement[];
}

function buildWarnings(
  params: LureParams,
  geo: LureGeometry,
  r: WarningInput,
): PhysicsWarning[] {
  const list: PhysicsWarning[] = [];

  if (r.rollMarginMm <= 0.2) {
    list.push({
      id: 'roll',
      level: r.rollMarginMm <= 0 ? 'error' : 'warn',
      title: 'Centre de gravite trop haut',
      detail:
        'Le CG est au niveau (ou au-dessus) du centre de poussee : le leurre se couchera sur le flanc au lieu de nager droit. Descendez les lests vers le ventre.',
    });
  }

  if (r.cgPct < 36 && r.buoyancy !== 'sink') {
    list.push({
      id: 'nose-heavy',
      level: 'warn',
      title: 'Trop de poids a l avant pour le volume',
      detail: `Le centre de gravite est a ${r.cgPct.toFixed(0)} % de la longueur depuis le nez. Le leurre piquera du nez et perdra son action : reculez le lest vers 50-60 %.`,
    });
  }

  if (r.cgPct > 78) {
    list.push({
      id: 'tail-heavy',
      level: 'warn',
      title: 'Lestage trop arriere',
      detail: `CG a ${r.cgPct.toFixed(0)} % : le leurre nagera queue basse, quasiment a la verticale, et vrillera la ligne au lancer.`,
    });
  }

  // Un leurre a bavette doit nager quasi horizontal ; un leurre de surface,
  // lui, est fait pour se tenir nez haut : le seuil d'alerte suit l'usage.
  const trimLimit = params.hasBib ? 18 : 32;
  if (Math.abs(r.trimDeg) > trimLimit) {
    list.push({
      id: 'trim',
      level: 'warn',
      title: 'Assiette de nage extreme',
      detail: `Assiette estimee a ${Math.abs(r.trimDeg).toFixed(0)} deg ${
        r.trimDeg > 0 ? 'nez vers le haut' : 'nez vers le bas'
      }, au-dela des ${trimLimit} deg admissibles pour ce type de leurre : il laboure au lieu de nager. Rapprochez le centre de gravite du centre de poussee.`,
    });
  }

  const ballastShare = r.totalMass > 0 ? r.ballastMass / r.totalMass : 0;
  if (ballastShare > 0.55) {
    list.push({
      id: 'ballast-share',
      level: 'warn',
      title: 'Lestage dominant',
      detail: `Les lests representent ${(ballastShare * 100).toFixed(0)} % de la masse totale. La nage devient lourde et amortie : allegez ou augmentez le volume du corps.`,
    });
  }

  for (const marker of geo.ballasts) {
    if (!marker.fits) {
      list.push({
        id: `fit-${marker.id}`,
        level: 'error',
        title: 'Lest trop volumineux',
        detail: `Une bille de plomb de ${marker.mass.toFixed(1)} g mesure ${(marker.radius * 20).toFixed(1)} mm de diametre et ne tient pas dans la section a cet endroit. Deplacez-la vers le ventre le plus large ou fractionnez-la.`,
      });
    }
  }

  if (r.ratio > 1.4) {
    list.push({
      id: 'heavy',
      level: 'info',
      title: 'Descente rapide',
      detail: `Densite ${r.ratio.toFixed(2)} fois celle de l eau : chute rapide, a reserver a la peche profonde ou au lancer long.`,
    });
  } else if (r.ratio < 0.55) {
    list.push({
      id: 'light',
      level: 'info',
      title: 'Flottaison tres haute',
      detail: 'Le leurre flottera presque hors de l eau. Ajoutez du lest si vous visez une nage sub-surface.',
    });
  }

  if (r.buoyancy === 'suspend') {
    list.push({
      id: 'suspend',
      level: 'ok',
      title: 'Suspending atteint',
      detail: 'La masse equilibre la poussee a moins de 3 %. Reglage fin : ajustez par pas de 0,1 g, la temperature de l eau suffit a faire basculer un suspending.',
    });
  }

  if (params.infill < 25 && getMaterial(params.material).hollowable) {
    list.push({
      id: 'sealing',
      level: 'info',
      title: 'Corps creux : etancheite',
      detail: 'Sous 25 % de remplissage, la flottaison depend de l air enferme. Prevoyez au moins 3 perimetres et 5 couches dessus/dessous, puis un vernis epoxy.',
    });
  }

  if (params.assembly.enabled) {
    const spec = resolvePin(params);
    const profile = createProfile(params);
    // Le logement se creuse a environ 7 % de la longueur depuis le nez.
    const section = profile.section(0.1);
    const available = Math.min(section.top - section.bottom, section.halfWidth * 2) * 10;
    if (spec.loopWidth > available * 0.85) {
      list.push({
        id: 'pin-fit',
        level: 'warn',
        title: 'Goupille trop grosse pour la tete',
        detail: `La petite boucle mesure ${spec.loopWidth} mm alors que la tete n offre que ${available.toFixed(1)} mm de section a cet endroit. Choisissez une taille en dessous, ou epaississez l avant du corps.`,
      });
    }
  }

  if (params.articulation.enabled && params.assembly.enabled) {
    list.push({
      id: 'joint-shells',
      level: 'warn',
      title: 'Articulation et deux coques ne se cumulent pas',
      detail:
        'L articulation coupe le corps en travers, l impression en deux coques le coupe dans la longueur : les deux ensemble donneraient quatre pieces dont l assemblage n est pas genere. Desactivez « Corps en deux parties » pour obtenir les segments articules.',
    });
  }

  for (const dowel of r.dowels) {
    if (dowel.valid || !dowel.problem) continue;
    list.push({
      id: `dowel-${dowel.id}`,
      level: 'warn',
      title: 'Logement de goupille non creuse',
      detail: dowel.problem,
    });
  }

  if (r.joint && r.joint.massUnknown) {
    list.push({
      id: 'joint-mass',
      level: 'warn',
      title: 'Poids de la quincaillerie non renseigne',
      detail:
        'Le verdict de flottabilite ignore les oeillets et la goupille tant que leur masse vaut zero. Pesez une piece sur une balance de cuisine et reportez la valeur : sur un swimbait, la quincaillerie pese souvent plus que le lest.',
    });
  }

  if (params.hasBib && params.billMode === 'polycarbonate' && !params.assembly.enabled) {
    list.push({
      id: 'bill-shells',
      level: 'warn',
      title: 'Fente de bavette non generee',
      detail:
        'La fente d insertion se creuse dans le plan de joint : elle demande le corps en deux parties. Activez « Corps en deux parties » dans l onglet Assemblage, ou imprimez la bavette avec le corps.',
    });
  }

  const slot = r.bill;
  if (slot?.tooWide) {
    const maxWidth = (slot.depth * 2 - params.fabrication.billFit * 0.1) * 10;
    list.push({
      id: 'bill-width',
      level: 'warn',
      title: 'Bavette trop large pour la tete',
      detail: `Le talon mesure ${params.bibWidth.toFixed(0)} mm alors que la tete ne peut recevoir que ${maxWidth.toFixed(1)} mm avec 0,5 mm de peau. La fente est creusee au maximum possible : reduisez la largeur de la bavette, ou epaississez l avant du corps.`,
    });
  }

  if (
    params.hasBib &&
    params.billMode === 'polycarbonate' &&
    params.assembly.enabled &&
    params.assembly.planeAngle >= 25
  ) {
    list.push({
      id: 'bill-joint',
      level: 'warn',
      title: 'Fente de bavette non generee',
      detail:
        'La fente d insertion suit l inclinaison de la bavette dans le plan vertical : elle n a de sens que sur un joint vertical. Ramenez l orientation du joint sous 25 deg, ou imprimez la bavette avec le corps.',
    });
  }

  if (params.hasBib && params.bibLength > params.length * 0.45) {
    list.push({
      id: 'bib-size',
      level: 'warn',
      title: 'Bavette surdimensionnee',
      detail: 'Une bavette de plus de 45 % de la longueur du corps genere une trainee que le corps ne peut plus stabiliser : nage erratique et decrochages.',
    });
  }

  if (params.maxWidth > params.thickness * 1.5) {
    list.push({
      id: 'flat',
      level: 'info',
      title: 'Corps plus large que haut',
      detail: 'Cette section aplatie favorise le roulis et les eclats de flanc — recherche pour une cuiller, a surveiller pour un poisson nageur.',
    });
  }

  if (geo.bounds.length > 250 || geo.bounds.height > 200) {
    list.push({
      id: 'print-size',
      level: 'info',
      title: 'Encombrement d impression',
      detail: `Piece de ${geo.bounds.length.toFixed(0)} mm : verifiez la capacite du plateau, ou imprimez en deux demi-coques a coller.`,
    });
  }

  const order: Record<WarningLevel, number> = { error: 0, warn: 1, ok: 2, info: 3 };
  return list.sort((a, b) => order[a.level] - order[b.level]);
}

// ---------------------------------------------------------------------------
// Ligne de flottaison (visualisation)
// ---------------------------------------------------------------------------

/**
 * Aire de la section immergee sous l'ordonnee y, la section etant assimilee
 * a une ellipse de demi-axes (a, top) au-dessus de l'axe et (a, bottom) en
 * dessous. Integrale exacte de l'ellipse : a*c*(asin k + k*sqrt(1-k2)).
 */
function sectionAreaBelow(a: number, top: number, bottomAbs: number, y: number): number {
  if (a <= 0) return 0;
  const lowerFull = (Math.PI * a * bottomAbs) / 2;
  if (y <= -bottomAbs) return 0;
  if (y >= top) return lowerFull + (Math.PI * a * top) / 2;

  if (y <= 0) {
    if (bottomAbs <= 0) return 0;
    const k = clamp(y / bottomAbs, -1, 0);
    return a * bottomAbs * (Math.asin(k) + k * Math.sqrt(Math.max(0, 1 - k * k)) + Math.PI / 2);
  }
  if (top <= 0) return lowerFull;
  const k = clamp(y / top, 0, 1);
  return lowerFull + a * top * (Math.asin(k) + k * Math.sqrt(Math.max(0, 1 - k * k)));
}

/**
 * Ordonnee (en cm) de la surface de l'eau pour un leurre a l'equilibre.
 * Retourne `null` si le leurre est entierement immerge (il coule ou suspend).
 */
export function waterlineY(params: LureParams, ratio: number): number | null {
  if (ratio >= 0.995) return null;
  const profile = createProfile(params);
  const steps = 96;
  const dx = (profile.bodyEnd / steps) * profile.lengthCm;

  let maxTop = 0;
  let maxBottom = 0;
  const sections: { a: number; top: number; bottom: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const section = profile.section((i / steps) * profile.bodyEnd);
    const bottomAbs = -section.bottom;
    sections.push({ a: section.halfWidth, top: section.top, bottom: bottomAbs });
    maxTop = Math.max(maxTop, section.top);
    maxBottom = Math.max(maxBottom, bottomAbs);
  }

  const volumeBelow = (y: number): number => {
    let sum = 0;
    for (let i = 0; i <= steps; i++) {
      const s = sections[i];
      const weight = i === 0 || i === steps ? 0.5 : 1;
      sum += weight * sectionAreaBelow(s.a, s.top, s.bottom, y);
    }
    return sum * dx;
  };

  const total = volumeBelow(maxTop + 1);
  if (total <= 1e-9) return null;
  const target = ratio * total;

  let low = -maxBottom;
  let high = maxTop;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (volumeBelow(mid) < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
