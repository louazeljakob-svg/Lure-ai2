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
import { clamp, createProfile, MM_TO_CM, type ProfileSampler } from './profile';
import { assemblyActive, assemblyBlocker, buildAssembly, resolvePin } from './assembly';
import { printedBodies } from './geometry';
import type { BillSlotPlan } from './billTemplate';
import type { ArticulationPlan } from './articulation';
import { dowelVolumes, type DowelPlacement } from './dowels';
import { planThroughWire, throughWireBlocker } from './throughWire';
import {
  buildInsert,
  buildSoftTail,
  insertBlocker,
  measureCavity,
  softTailBlocker,
} from './insert';

/**
 * Resolution de MESURE de la cavite.
 *
 * Elle n'a pas besoin d'etre celle de l'affichage : on integre un volume, pas
 * une surface a regarder. Cette densite donne le volume au millieme de cm3
 * pres pour une fraction du cout.
 */
const CAVITY_RESOLUTION = { lengthSegments: 96, radialSegments: 48 };
import {
  checkMounts,
  findTackle,
  mountTrails,
  resolveMount,
  type MountWarning,
} from './tackle';
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

/**
 * Une ligne du bilan de masse — module Q.5.
 *
 * `provenance` n'est pas decoratif : il dit a l'utilisateur si le chiffre
 * vient d'une geometrie CALCULEE, d'une ligne de catalogue VERIFIEE ou d'une
 * simple ESTIMATION. Un total qui melange les trois sans le dire serait une
 * fausse precision.
 */
export interface MassLine {
  key: string;
  label: string;
  massG: number;
  /** Part du total, en %. */
  share: number;
  provenance: 'geometrie' | 'verifie' | 'estimation';
  detail: string;
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
  /** Volume interne mesure de la coque a paroi mince, en cm3. */
  cavityCm3: number;
  /** Masse et volume de l'insert interne. */
  insertMass: number;
  insertVolumeCm3: number;
  /** Masse et volume de la queue souple rapportee. */
  softTailMass: number;
  softTailVolumeCm3: number;
  /** Profondeur d'insertion reellement obtenue, en mm. */
  softTailInsertionMm: number;
  /** Masse des hamecons et anneaux affectes depuis le catalogue. */
  tackleMass: number;
  hookMass: number;
  ringMass: number;
  totalMass: number;
  /** Bilan de masse poste par poste, avec la provenance de chaque valeur. */
  massBreakdown: MassLine[];
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


/**
 * Masses ponctuelles de la quincaillerie affectee — modules Q.4 et R.
 *
 * Le bras de levier compte autant que la masse : un triple 3/0 au ventre
 * arriere ne deplace pas le centre de gravite comme le meme triple au ventre
 * avant, et c'est souvent lui qui decide de l'action. On place donc l'anneau
 * AU point d'accrochage et l'hamecon a mi-longueur SOUS lui, ce qui est la
 * position moyenne d'un hamecon qui pend.
 */
function tacklePoints(params: LureParams, profile: ProfileSampler): PointMass[] {
  const out: PointMass[] = [];
  for (const mount of params.mounts) {
    const resolved = resolveMount(params.catalogue, mount);
    if (resolved.massG <= 0) continue;
    const p = clamp(mount.position, 0.02, profile.bodyEnd - 0.01);
    const x = profile.xAt(p);
    const section = profile.section(p);
    // height : -1 au ventre, 0 sur l'axe, +1 au dos.
    const surfaceY =
      mount.height < 0 ? section.bottom * -mount.height : section.top * mount.height;

    // Un support de queue traine derriere, un support ventral pend dessous :
    // les deux ne deplacent pas le centre de masse dans la meme direction.
    const trails = mountTrails(mount.position);
    if (resolved.ring) {
      out.push({ x, y: surfaceY, mass: resolved.ring.massG });
    }
    if (resolved.hook) {
      // Le centre de masse d'un hamecon suspendu se trouve a environ la
      // moitie de sa longueur hors-tout, au bout de l'anneau.
      const hangCm = resolved.hook.spanMm * 0.5 * MM_TO_CM;
      const ringDrop = resolved.ring ? resolved.ring.spanMm * 0.66 * MM_TO_CM : 0;
      const reach = ringDrop + hangCm;
      const sign = mount.height <= 0 ? -1 : 1;
      out.push(
        trails
          ? { x: x + reach, y: surfaceY, mass: resolved.hook.massG }
          : { x, y: surfaceY + sign * reach, mass: resolved.hook.massG },
      );
    }
  }
  return out;
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
  const cavities = assemblyActive(params)
    ? shellContent(params, profile)
    : {
        printed: printedBodies(geo).reduce((sum, part) => sum + massProperties(part).volume, 0),
        mass: 0,
        points: [] as PointMass[],
        bill: null as BillSlotPlan | null,
        billProblem: null as string | null,
        dowelAdded: 0,
        dowels: [] as DowelPlacement[],
      };
  // Bavette imprimee et caudale ne font pas partie des coques : leur volume
  // s'ajoute a celui des deux demi-corps.
  const appendages = Math.max(volume - massProperties(geo.body).volume, 0);
  // Quincaillerie du joint : elle s'achete, elle ne s'imprime pas, mais elle
  // pese — a condition que l'utilisateur ait renseigne ses masses.
  const jointMass = geo.jointPlan ? geo.jointPlan.hardwareMass : 0;

  // --- Coque a paroi mince et insert (module O.2) ---------------------------
  //
  // Quand la coque est active, la matiere n'est plus « le volume fois un taux
  // de remplissage » : c'est la PAROI, mesuree comme la difference entre le
  // corps et sa cavite. Un chiffre mesure remplace une estimation.
  const cavity = measureCavity(profile, params, CAVITY_RESOLUTION);
  const insertPart = params.shell.enabled && !insertBlocker(params, cavity)
    ? buildInsert(profile, params, cavity)
    : null;
  const insertMass = insertPart?.massG ?? 0;
  // Queue souple rapportee : une piece a part, dans un autre materiau. Elle
  // pese ET elle deplace de l'eau, donc elle compte deux fois dans le verdict.
  const softTailPart = softTailBlocker(profile, params) ? null : buildSoftTail(profile, params);
  const softTailMass = softTailPart?.massG ?? 0;
  const softTailVolume = softTailPart?.volumeCm3 ?? 0;
  const softTailCentre = softTailPart?.centre ?? null;
  const softTailInsertion = softTailPart ? softTailPart.size.length - softTailPart.freeLength : 0;
  softTailPart?.geometry.dispose();
  const insertVolume = insertPart?.volumeCm3 ?? 0;
  const insertCentre = insertPart?.centre ?? null;
  insertPart?.geometry.dispose();

  const material = getMaterial(params.material);
  // Les parois de perimetre comptent : a remplissage egal, six parois
  // deposent bien plus de matiere qu'une seule.
  const fill = solidFraction(params.material, params.infill, params.print.perimeters);
  // Les barreaux d'assemblage sont pleins : ils ne suivent pas le taux de
  // remplissage du corps.
  const wallVolume = params.shell.enabled
    ? Math.max(cavities.printed - cavity.volumeCm3, cavities.printed * 0.05)
    : null;
  const bodyMass =
    (wallVolume !== null
      ? // Une paroi est pleine : elle ne suit pas le taux de remplissage.
        wallVolume * material.density + appendages * material.density * fill
      : (cavities.printed + appendages) * material.density * fill) +
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
  const pinSpec = assemblyActive(params) ? resolvePin(params) : null;
  const pinMass = pinSpec ? pinWireLength(pinPath(pinSpec)) * Math.PI * ((pinSpec.wire * 0.05) ** 2) * STAINLESS_DENSITY : 0;
  // Montage traversant : la masse du fil se DEDUIT de sa longueur developpee,
  // comme celle d'une goupille. Elle ne se saisit pas.
  const wirePlan =
    params.throughWire.enabled && !throughWireBlocker(params)
      ? planThroughWire(params, profile.lengthCm)
      : null;
  const wireMass = wirePlan ? wirePlan.massG : 0;
  const rattleMass = cavities.mass;
  // Quincaillerie affectee depuis le catalogue : hamecons et anneaux, a leur
  // masse reelle et a leur place reelle.
  const tackle = tacklePoints(params, profile);
  const tackleMass = tackle.reduce((sum, p) => sum + p.mass, 0);
  const hookMass = params.mounts.reduce(
    (sum, m) => sum + (findTackle(params.catalogue, m.hookId)?.massG ?? 0),
    0,
  );
  const ringMass = tackleMass - hookMass;
  const totalMass =
    bodyMass +
    insertMass +
    softTailMass +
    ballastMass +
    hardwareMass +
    clipMass +
    pinMass +
    wireMass +
    rattleMass +
    tackleMass;

  // Centre de gravite : corps homogene + billes de lest + quincaillerie.
  const points: PointMass[] = [
    { x: cb.x, y: cb.y, mass: bodyMass },
    ...geo.ballasts.map((m) => ({ x: m.position[0], y: m.position[1], mass: m.mass })),
    ...hardwarePoints(params, hardwareMass),
    ...(clipMass > 0 ? [{ x: profile.xAt(0), y: 0, mass: clipMass }] : []),
    // La goupille est logee dans la tete, sur l'axe.
    ...(pinMass > 0 ? [{ x: profile.xAt(0.07), y: 0, mass: pinMass }] : []),
    // Le fil traversant est reparti sur toute la longueur, donc centre.
    ...(wireMass > 0 ? [{ x: profile.xAt(0.5), y: 0, mass: wireMass }] : []),
    // L'insert pese a SA place : c'est ce qui en fait une piece et non un decor.
    ...(insertMass > 0 && insertCentre
      ? [{ x: insertCentre.x, y: insertCentre.y, mass: insertMass }]
      : []),
    ...(softTailMass > 0 && softTailCentre
      ? [{ x: softTailCentre.x, y: softTailCentre.y, mass: softTailMass }]
      : []),
    ...cavities.points,
    ...tackle,
  ];
  const cg = { x: 0, y: 0, z: 0 };
  const massSum = points.reduce((sum, p) => sum + p.mass, 0);
  if (massSum > 1e-9) {
    for (const p of points) {
      cg.x += (p.x * p.mass) / massSum;
      cg.y += (p.y * p.mass) / massSum;
    }
  }

  // La queue souple deplace son propre volume : l'oublier ferait couler le
  // leurre sur le papier alors qu'il flotte dans le seau.
  volume += softTailVolume;
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

  // --- Bilan de masse (Q.5) ------------------------------------------------
  //
  // Chaque poste dit d'ou il vient. Un corps imprime se CALCULE sur sa
  // geometrie ; un hamecon vaut ce que dit sa ligne de catalogue, verifiee ou
  // non ; la masse de quincaillerie saisie a la main reste une estimation. Le
  // total n'a de sens que si l'on sait ce qu'on y a mis.
  const tackleVerified =
    params.mounts.length > 0 &&
    params.mounts.every((m) => {
      const ring = findTackle(params.catalogue, m.ringId);
      const hook = findTackle(params.catalogue, m.hookId);
      return (
        (!ring || ring.source === 'verifie') && (!hook || hook.source === 'verifie')
      );
    });

  const rawLines: Omit<MassLine, 'share'>[] = [
    {
      key: 'body',
      label: 'Corps imprime',
      massG: bodyMass,
      provenance: 'geometrie',
      detail: `${material.label}, ${Math.round(fill * 100)} % de matiere deposee`,
    },
    {
      key: 'ballast',
      label: 'Lest interne',
      massG: ballastMass,
      provenance: 'geometrie',
      detail: `${params.ballasts.length} lest(s) a ${params.ballastDensity.toFixed(2)} g/cm3`,
    },
    {
      key: 'internal',
      label: 'Quincaillerie interne',
      massG: clipMass + pinMass + wireMass + rattleMass,
      provenance: 'geometrie',
      detail: wireMass > 0
        ? `Agrafe, billes et fil traversant (${(wirePlan!.wireLengthCm * 10).toFixed(0)} mm developpes)`
        : 'Agrafe, goupille et billes, deduits de la longueur de fil et du volume',
    },
    {
      key: 'hooks',
      label: 'Hamecons',
      massG: hookMass,
      provenance: tackleVerified ? 'verifie' : 'estimation',
      detail: hookMass > 0 ? 'Catalogue, place a son bras de levier reel' : 'Aucun hamecon affecte',
    },
    {
      key: 'rings',
      label: 'Anneaux',
      massG: ringMass,
      provenance: tackleVerified ? 'verifie' : 'estimation',
      detail: ringMass > 0 ? 'Catalogue, au point d accrochage' : 'Aucun anneau affecte',
    },
    {
      key: 'insert',
      label: 'Insert / pieces rapportees',
      massG: insertMass + softTailMass,
      provenance: 'geometrie',
      detail: [
        insertMass > 0
          ? `insert ${getMaterial(params.insert.material).label} ${insertVolume.toFixed(2)} cm3`
          : null,
        softTailMass > 0
          ? `queue souple ${getMaterial(params.softTail.material).label} ${softTailVolume.toFixed(2)} cm3`
          : null,
      ]
        .filter(Boolean)
        .join(', ') || 'Aucune piece rapportee',
    },
    {
      key: 'manual',
      label: 'Quincaillerie non detaillee',
      massG: hardwareMass,
      provenance: 'estimation',
      detail: 'Valeur saisie a la main, repartie sur trois points types',
    },
  ];
  const massBreakdown: MassLine[] = rawLines.map((line) => ({
    ...line,
    share: totalMass > 1e-9 ? (line.massG / totalMass) * 100 : 0,
  }));

  return {
    volumeCm3: volume,
    solidFraction: fill,
    bodyMass,
    ballastMass,
    hardwareMass,
    clipMass,
    pinMass,
    rattleMass,
    cavityCm3: cavity.volumeCm3,
    insertMass,
    insertVolumeCm3: insertVolume,
    softTailMass,
    softTailVolumeCm3: softTailVolume,
    softTailInsertionMm: softTailInsertion,
    tackleMass,
    hookMass,
    ringMass,
    totalMass,
    massBreakdown,
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
      billProblem: cavities.billProblem,
      joint: geo.jointPlan,
      dowels: cavities.dowels,
      tackleMass,
      mountWarnings: checkMounts(
        params.mounts.map((mount) => resolveMount(params.catalogue, mount)),
        params.length,
        params.thickness,
      ),
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
  billProblem: string | null;
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
    billProblem: assembly.billProblem,
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
  /** Pourquoi la fente est absente ou moins enfoncee que demande. */
  billProblem: string | null;
  /** Cotes du joint articule, ou null. */
  joint: ArticulationPlan | null;
  /** Goupilles cylindriques d'assemblage et leur controle. */
  dowels: DowelPlacement[];
  tackleMass: number;
  mountWarnings: MountWarning[];
}

function buildWarnings(
  params: LureParams,
  geo: LureGeometry,
  r: WarningInput,
): PhysicsWarning[] {
  const list: PhysicsWarning[] = [];

  const block = assemblyBlocker(params);
  if (block) {
    list.push({
      id: 'assembly-blocked',
      level: 'error',
      title: 'Deux coques impossibles avec cette combinaison',
      detail: block,
    });
  }

  // Q.4 : le champ « masse de quincaillerie » d'avant le catalogue n'a pas
  // disparu — il sert encore pour ce qu'on ne detaille pas. Mais s'il reste
  // rempli alors que des hamecons sont affectes, la meme masse est comptee
  // deux fois. On ne corrige pas en silence : on le dit.
  if (params.hardwareMass > 0.05 && r.tackleMass > 0.05) {
    list.push({
      id: 'tackle-double',
      level: 'warn',
      title: 'Quincaillerie comptee deux fois',
      detail: `Le catalogue affecte ${r.tackleMass.toFixed(1)} g d hamecons et d anneaux, et le champ « masse de quincaillerie » ajoute encore ${params.hardwareMass.toFixed(1)} g. Ramenez ce champ a zero, ou n y laissez que ce qui n est pas detaille.`,
    });
  }

  for (const warning of r.mountWarnings) {
    list.push({
      id: `mount-${warning.mountId}`,
      level: warning.level,
      title: warning.level === 'error' ? 'Collision d hamecons' : 'Montage a verifier',
      detail: warning.message,
    });
  }

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

  if (r.billProblem) {
    list.push({
      id: 'bill-depth',
      level: 'warn',
      title: 'Fente de bavette bornee par la tete',
      detail: r.billProblem,
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
