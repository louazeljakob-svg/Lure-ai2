/**
 * Banc d'essai et industrialisation d'un maillage importe — modules AD.2 et
 * AD.3.
 *
 * Le banc d'essai prend le modele TEL QUEL : aucun creusage, aucune coupe.
 * Il lui ajoute seulement ce qu'il faut pour pecher — une attache, des
 * hamecons a la taille du corps — et le passe dans les memes modeles que les
 * familles : flottabilite, centres, nage, rupture, impression.
 *
 * L'industrialisation, elle, applique le principe de fabrication du
 * logiciel : creusage a paroi constante, deux demi-coques dans le plan de
 * symetrie avec gorge de colle et ergots coniques, visserie a ecrou captif,
 * portees de goupille en 8 aux attaches et aux supports d'hamecon, fente de
 * bavette commune, chambres de lest. Chaque implantation est PROPOSEE depuis
 * l'anatomie relevee sur le maillage, verifiee par le vrai constructeur de
 * coques, deplacee si elle entre en collision — et tout ce qui reste refuse
 * est dit, avec sa position.
 */

import type { BallastWeight, LureParams, ShapeId } from '../types/lure';
import type { DetectedBib, ImportedMesh } from './importMesh';
import { ARCHETYPES } from './archetypes';
import { clonePreset, LIMITS, type Range } from './presets';
import { meshBodyRef, type MeshBody } from './meshBody';
import { createProfile } from './profile';
import { ASSEMBLY_PREVIEW, buildAssembly, disposeAssembly, type AssemblyResult } from './assembly';
import { buildLure, DISPLAY_RESOLUTION } from './geometry';
import { computePhysics, type PhysicsResult } from './physics';
import { seedId } from './tackle';
import { getMaterial, WATER_DENSITY } from './materials';
import { runPrintChecks, type PrintCheck } from './printCheck';
import { minBodyHeightMm, SCREW_LENGTHS } from './screws';
import {
  anchorStrength,
  applyCurrent,
  criticalSpeed,
  CURRENT_PRESETS,
  DEFAULT_ASSUMPTIONS,
  diveDepth,
  NEUTRAL_CALIBRATION,
  wobbleProfile,
  type AnchorStrength,
  type Estimate,
  type SwimInput,
} from './swim';

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
/** Cote relevee sur le maillage : bornee physiquement, jamais a la plage d'un curseur. */
const within = (value: number, range: Range) => clamp(value, range.hardMin ?? range.min, range.hardMax ?? range.max);

// ---------------------------------------------------------------------------
// Lecture du corps
// ---------------------------------------------------------------------------

/** Reperes anatomiques releves sur la peau echantillonnee (fractions de longueur). */
export interface Landmarks {
  /** Section maitresse. */
  maxSection: number;
  /** Point le plus bas du ventre. */
  lowestBelly: number;
  /** Fin du corps : pedoncule si une caudale est detectee, sinon 1. */
  bodyEnd: number;
  /** Aire relative de la section de nez : grande sur une face de popper. */
  noseFullness: number;
}

export function landmarks(body: MeshBody): Landmarks {
  const { skin } = body;
  const { nP, nT, r, yc, area } = skin;
  const last = nP - 1;
  let iMax = 0;
  for (let i = 0; i < nP; i++) if (area[i] > area[iMax]) iMax = i;
  let iLow = Math.round(last * 0.2);
  const end = Math.round(last * skin.bodyEnd);
  for (let i = Math.round(last * 0.15); i < end - Math.round(last * 0.1); i++) {
    const bottom = yc[i] - r[i * nT + nT / 2];
    const best = yc[iLow] - r[iLow * nT + nT / 2];
    if (bottom < best) iLow = i;
  }
  return {
    maxSection: iMax / last,
    lowestBelly: iLow / last,
    bodyEnd: skin.bodyEnd,
    noseFullness: area[Math.round(last * 0.02)] / Math.max(area[iMax], 1e-9),
  };
}

/**
 * Famille la plus proche : elle fournit les reglages de depart (matiere,
 * quincaillerie, jeux), jamais la forme — la forme est celle du maillage.
 */
export function guessFamily(body: MeshBody, bib: DetectedBib | null): { id: ShapeId; why: string } {
  const L = body.lengthMm;
  const H = body.heightMm;
  const W = body.widthMm;
  const slender = L / Math.max(H, 1e-6);
  if (bib) {
    return { id: 'minnow', why: `bavette detachee (elancement ${slender.toFixed(1)})` };
  }
  if (H / L > 0.28 && W / H < 0.6) {
    return { id: 'lipless', why: `corps haut et plat (hauteur ${Math.round((H / L) * 100)} % de la longueur), sans bavette` };
  }
  return { id: 'minnow', why: `corps elance sans bavette (elancement ${slender.toFixed(1)}) : reglages du minnow, bavette retiree` };
}

/** Hamecon et anneau a la taille du corps : la progression des familles. */
function hooksFor(lengthMm: number): { treble: string; ring: string } {
  if (lengthMm < 60) return { treble: '#8', ring: '#2' };
  if (lengthMm < 95) return { treble: '#6', ring: '#3' };
  if (lengthMm < 130) return { treble: '#4', ring: '#4' };
  return { treble: '#2', ring: '#5' };
}

// ---------------------------------------------------------------------------
// Parametres
// ---------------------------------------------------------------------------

/**
 * Projet de base pour un corps maille : la famille la plus proche pour les
 * reglages de fabrication, le maillage pour la forme, la bavette relevee sur
 * la piece si elle etait detachee.
 */
function meshProject(imported: ImportedMesh, body: MeshBody): { params: LureParams; family: ShapeId; why: string } {
  const guess = guessFamily(body, imported.bib);
  const base = clonePreset(guess.id);
  const marks = landmarks(body);
  const L = body.lengthMm;
  const hooks = hooksFor(L);
  const bib = imported.bib;
  const hasFin = body.tailHalves !== null && body.skin.bodyEnd < 1;
  const params: LureParams = {
    ...base,
    meshBody: meshBodyRef(body),
    anatomy: null,
    length: within(body.lengthMm, LIMITS.length),
    maxWidth: within(body.widthMm, LIMITS.maxWidth),
    thickness: within(body.heightMm, LIMITS.thickness),
    tailShape: hasFin ? 'forked' : 'round',
    hasBib: bib !== null,
    billMode: 'printed',
    bibLength: bib ? within(bib.lengthMm, LIMITS.bibLength) : base.bibLength,
    bibWidth: bib ? within(bib.widthMm, LIMITS.bibWidth) : base.bibWidth,
    billThickness: bib ? within(bib.thicknessMm, LIMITS.billThickness) : base.billThickness,
    bibAngle: bib ? within(Math.round(bib.angleDeg), LIMITS.bibAngle) : base.bibAngle,
    // La racine de la plaque est son bord arriere, cote menton : c'est la
    // que la fente s'ancre. Enfoncement : un gros tiers de la longueur de
    // plaque, comme sur les familles — assez pour tenir, sans aller chercher
    // l'attache de nez.
    billOffset: bib ? within(bib.rearFromNoseMm - 0.5, LIMITS.billOffset) : base.billOffset,
    billInsertion: bib ? within(Math.round(clamp(bib.lengthMm * 0.35, 4, 12)), LIMITS.billInsertion) : base.billInsertion,
    popperFace: { ...base.popperFace, enabled: false },
    softTail: { ...base.softTail, enabled: false },
    articulation: { ...base.articulation, enabled: false },
    eyes: { ...base.eyes, enabled: false },
    gills: { ...base.gills, enabled: false },
    scales: { ...base.scales, enabled: false },
    ribs: { ...base.ribs, enabled: false },
    inlays: [],
    decals: [],
    outline: { ...base.outline, nodes: [] },
    ballasts: [],
    mounts: base.mounts.map((mount) => ({
      ...mount,
      hookId: seedId('treble', 'Triple force standard', hooks.treble),
      ringId: seedId('split', 'Anneau brise inox', hooks.ring),
    })),
  };
  // Supports d'hamecon places d'apres l'anatomie : l'avant sous la section
  // maitresse, l'arriere a mi-chemin du pedoncule.
  const front = clamp(Math.min(marks.maxSection, marks.lowestBelly + 0.04), 0.24, 0.45);
  const rear = clamp((front + marks.bodyEnd) / 2 + 0.02, front + 0.18, marks.bodyEnd - 0.1);
  params.assembly = {
    ...base.assembly,
    enabled: true,
    planeAngle: 0,
    anchors: base.assembly.anchors.map((anchor) => {
      if (anchor.id === 'ventre') return { ...anchor, position: front };
      if (anchor.id === 'arriere') return { ...anchor, position: rear };
      if (anchor.exit === 'nose') return { ...anchor, position: 0.06 };
      return { ...anchor };
    }),
  };
  params.mounts = params.mounts.map((mount) =>
    mount.anchorId === 'ventre' ? { ...mount, position: front } : mount.anchorId === 'arriere' ? { ...mount, position: rear } : mount,
  );
  return { params, family: guess.id, why: guess.why };
}

/**
 * Parametres du banc d'essai : le modele tel quel, imprime d'un seul tenant
 * au remplissage choisi, avec sa quincaillerie de peche. Rien n'est creuse.
 */
export function benchParams(imported: ImportedMesh, body: MeshBody, current: Pick<LureParams, 'material' | 'infill' | 'print'>): LureParams {
  const { params } = meshProject(imported, body);
  return {
    ...params,
    material: current.material,
    infill: current.infill,
    print: { ...current.print },
    assembly: { ...params.assembly, enabled: false },
    screws: { ...params.screws, enabled: false },
  };
}

/** Meme projet, assemblage actif : c'est lui qui donne les portees de goupille. */
export function fittedParams(imported: ImportedMesh, body: MeshBody, current: Pick<LureParams, 'material' | 'infill' | 'print'>): LureParams {
  const { params } = meshProject(imported, body);
  return { ...params, material: current.material, infill: current.infill, print: { ...current.print } };
}

// ---------------------------------------------------------------------------
// Industrialisation
// ---------------------------------------------------------------------------

export interface IndustrialOptions {
  /** Creusage en coque. */
  hollow: boolean;
  /** Paroi, en mm. */
  wall: number;
  /** Comportement vise pour le lest : celui de la famille par defaut. */
  target?: 'float' | 'suspend' | 'sink';
  /** Industrialiser meme si l'enveloppe comble des creux. */
  acceptEnvelope?: boolean;
}

export interface Placement {
  label: string;
  detail: string;
}

export interface IndustrialReport {
  family: ShapeId;
  familyWhy: string;
  /** Ce qui a ete propose, ou, et pourquoi. */
  placements: Placement[];
  /** Collisions et refus restants, chacun avec sa position. */
  problems: string[];
  /** Operations bloquees par la topologie (AD.4), nommees. */
  blocked: string[];
  /** Ce que la peau retraduite comble : a verifier, sans bloquer. */
  envelope: string[];
  /** Verdict du leurre industrialise. */
  physics: Pick<PhysicsResult, 'buoyancy' | 'ratio' | 'totalMass' | 'cgPct' | 'cbPct' | 'trimDeg'> | null;
}

/** Ecart en creux au-dela duquel l'enveloppe modifierait visiblement la forme. */
const GAP_LIMIT_MM = 0.3;

const TARGET_RATIO = { float: 0.85, suspend: 1.0, sink: 1.3 } as const;

/**
 * Operations que la topologie interdit, nommees (AD.4). Vide : tout est permis.
 */
export function topologyBlocks(imported: ImportedMesh, body: MeshBody, acceptEnvelope = false): string[] {
  const out = [...body.blocked];
  const { skin } = body;
  const rays = skin.nP * skin.nT;
  if (skin.missingRays > rays * 0.002) {
    out.push(
      `Decoupe en demi-coques : ${skin.missingRays} rayons sur ${rays} ne trouvent aucune paroi — le ` +
        'maillage a des trous ou des surfaces sans epaisseur. Les coques seraient ouvertes : operation bloquee.',
    );
  }
  if (skin.inconsistentRays > rays * 0.01) {
    out.push(
      `Decoupe en demi-coques : ${skin.inconsistentRays} rayons voient la matiere a l envers (faces ` +
        'croisees ou auto-intersections). L interieur du corps n est pas defini : operation bloquee.',
    );
  }
  // Face avant creusee (cuvette) : c'est tout le nez qui serait faux, pas un
  // detail. Le seul creux qui bloque.
  if (skin.maxGapMm > GAP_LIMIT_MM && !acceptEnvelope && skin.gaps[0].fromNoseMm < body.lengthMm * 0.08) {
    const worst = skin.gaps[0];
    out.push(
      `Retraduction de la peau : la face avant est creusee (cuvette de popper, ${worst.gapMm.toFixed(1)} mm de creux ` +
        `a ${worst.fromNoseMm.toFixed(0)} mm du nez). Une tranche transversale n y voit qu un anneau : les coques ` +
        'combleraient la cuvette. Operation bloquee — accepter l enveloppe la remplirait, ce qui change l action.',
    );
  }
  if (imported.diagnosis.nonManifold > 0 && body.blocked.length === 0 && skin.bodyEnd < 1) {
    // Rien de plus : la decoupe de caudale a reussi malgre les aretes
    // non-manifold, elles sont hors du plan de coupe.
  }
  return out;
}

/**
 * Ce que l'enveloppe comble, dit en clair. Ce n'est pas une geometrie
 * corrompue — les coques restent fermees — mais une difference de forme a
 * verifier : passages de fabrication existants (canaux de vis, portees),
 * ou forme non etoilee (nageoire decollee du flanc, bavette soudee).
 */
export function envelopeNotes(body: MeshBody): string[] {
  const { skin } = body;
  const out: string[] = [];
  const worst = skin.gaps.filter((gap) => gap.gapMm > GAP_LIMIT_MM).slice(0, 3);
  for (const gap of worst) {
    out.push(
      `Creux de ${gap.gapMm.toFixed(2)} mm comble par l enveloppe a ${gap.fromNoseMm.toFixed(0)} mm du nez, ` +
        `${gap.thetaDeg.toFixed(0)} deg depuis le dos : passage existant ou nageoire decollee — verifiez la vue.`,
    );
  }
  if (skin.railGapMm > GAP_LIMIT_MM) {
    out.push(
      `Passages de fabrication existants au ras du plan de joint (jusqu a ${skin.railGapMm.toFixed(1)} mm) : combles, ` +
        'puis les logements de l industrialisation sont recreuses a leur place.',
    );
  }
  if (skin.internalVoidMm > GAP_LIMIT_MM) {
    out.push(
      `Cavites internes existantes (jusqu a ${skin.internalVoidMm.toFixed(1)} mm) : comblees dans la peau retraduite ; ` +
        'le banc d essai, lui, les compte telles quelles.',
    );
  }
  if (skin.slotGapMm > GAP_LIMIT_MM) {
    out.push(`Fente de la bavette d origine (${skin.slotGapMm.toFixed(1)} mm) : remplacee par la fente commune.`);
  }
  return out;
}

/** Lest propose : la masse qui amene le verdict vise, logee la ou elle tient. */
function proposeBallast(
  params: LureParams,
  assembly: AssemblyResult,
  physics: PhysicsResult,
  target: keyof typeof TARGET_RATIO,
  cbPosition: number,
): { ballasts: BallastWeight[]; notes: Placement[]; problems: string[] } {
  const displaced = physics.volumeCm3 * WATER_DENSITY.fresh;
  const needed = TARGET_RATIO[target] * displaced - physics.totalMass;
  if (needed < 0.2) {
    return {
      ballasts: [],
      notes: [
        {
          label: 'Lest',
          detail:
            needed < 0
              ? `Aucun : le leurre pese deja ${physics.totalMass.toFixed(1)} g pour ${displaced.toFixed(1)} g de poussee, au-dela du rapport vise.`
              : 'Aucun : le rapport vise est deja atteint.',
        },
      ],
      problems: [],
    };
  }
  const ballasts: BallastWeight[] = [];
  const notes: Placement[] = [];
  const problems: string[] = [];
  let remaining = Math.round(needed * 10) / 10;
  const probe = assembly.ballastProbe;
  const taken: BallastWeight[] = [];
  for (let n = 0; n < 3 && remaining > 0.15; n++) {
    // Du plus lourd qui tienne au plus leger, au plus pres du centre de
    // carene et le plus bas possible : c'est lui qui garde l'assiette et le
    // redressement.
    let placed: BallastWeight | null = null;
    for (const mass of [remaining, remaining * 0.6, remaining * 0.4]) {
      const candidates: { ballast: BallastWeight; cost: number }[] = [];
      for (let dp = -0.16; dp <= 0.16001; dp += 0.01) {
        for (let h = -0.75; h <= 0.2001; h += 0.05) {
          for (const shape of ['cylinder', 'sphere'] as const) {
            const ballast: BallastWeight = {
              id: `lest-${n}-${Date.now()}`,
              position: Math.round((cbPosition + dp) * 1000) / 1000,
              height: Math.round(h * 100) / 100,
              mass: Math.round(mass * 10) / 10,
              shape,
            };
            candidates.push({ ballast, cost: Math.abs(dp) * 4 + (h + 0.75) * 0.8 });
          }
        }
      }
      candidates.sort((a, b) => a.cost - b.cost);
      for (const { ballast } of candidates) {
        if (taken.some((other) => Math.abs(other.position - ballast.position) < 0.04)) continue;
        if (probe(ballast) === null) {
          placed = ballast;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) {
      problems.push(
        `Lest : ${remaining.toFixed(1)} g manquent pour atteindre le comportement vise, et aucune chambre ` +
          'ne les loge sans percer la paroi ni croiser un logement. Ajoutez-les a la main ou allegez le corps.',
      );
      break;
    }
    ballasts.push(placed);
    taken.push(placed);
    remaining = Math.round((remaining - placed.mass) * 10) / 10;
  }
  for (const ballast of ballasts) {
    notes.push({
      label: `Lest ${ballast.mass.toFixed(1)} g`,
      detail:
        `${ballast.shape === 'sphere' ? 'Bille' : 'Cylindre'} de plomb a ${Math.round(ballast.position * 100)} % ` +
        `de la longueur, hauteur ${ballast.height.toFixed(2)} : la masse qui manque pour ${
          target === 'float' ? 'flotter lentement' : target === 'suspend' ? 'suspendre' : 'couler'
        }, logee au plus pres du centre de carene et au plus bas.`,
    });
  }
  // Une seule chambre de lest ne peut pas en loger une autre au meme endroit :
  // la sonde verifie chaque lest seul, le constructeur les verifie ensemble.
  void params;
  return { ballasts, notes, problems };
}

/**
 * Implantation proposee et verifiee : famille, visserie a la bonne longueur,
 * portees et vis deplacees hors des collisions. Commun au banc d'essai (qui
 * en tire les ancrages a eprouver) et a l'industrialisation.
 */
function fitProject(
  project: { params: LureParams; family: ShapeId; why: string },
  body: MeshBody,
  current: Pick<LureParams, 'material' | 'infill' | 'print'>,
  options: Pick<IndustrialOptions, 'hollow' | 'wall'>,
  report: IndustrialReport,
) {
  const params: LureParams = {
    ...project.params,
    material: current.material,
    infill: current.infill,
    print: { ...current.print },
  };
  params.ballastDensity = 11.34;
  params.assembly = {
    ...params.assembly,
    hollow: { enabled: options.hollow && getMaterial(params.material).hollowable, wall: options.wall },
    glueGroove: { ...params.assembly.glueGroove, enabled: true },
    pegs: { ...params.assembly.pegs, enabled: true, count: body.lengthMm > 140 ? 4 : body.lengthMm > 80 ? 3 : 2 },
  };
  // Visserie : une vis sous 70 mm, deux au-dela ; en avant de la section
  // maitresse et en arriere du support ventral. Diametre suggere d'apres la
  // hauteur locale du corps.
  const marks = landmarks(body);
  // Une vis ne tient que la ou le corps est assez haut pour la plus courte du
  // catalogue : 15 mm, plus la tete noyee, l'epaulement d'ecrou et la peau.
  const shape = createProfile(params);
  const heightAt = (p: number) => {
    const section = shape.section(p);
    return (section.top - section.bottom) / 0.1;
  };
  params.screws = { ...params.screws, enabled: false, screws: [] };

  const profile = createProfile(params);
  const build = (candidate: LureParams) => buildAssembly(profile, candidate, ASSEMBLY_PREVIEW);
  // Verification des implantations : sans creusage, gorge ni ergots — ils
  // viennent apres et s'ecartent d'eux-memes des logements. Trois fois plus
  // rapide, et le verdict sur les portees et la visserie est le meme.
  const check = (candidate: LureParams) =>
    build({
      ...candidate,
      assembly: {
        ...candidate.assembly,
        hollow: { ...candidate.assembly.hollow, enabled: false },
        glueGroove: { ...candidate.assembly.glueGroove, enabled: false },
        pegs: { ...candidate.assembly.pegs, enabled: false },
      },
    });

  // --- Fente de bavette ------------------------------------------------------
  // L'enfoncement propose d'apres la plaque du fichier est ramene au maximum
  // admissible a cet ancrage quand la tete est trop mince pour le recevoir.
  if (params.hasBib) {
    const assembly = check(params);
    const max = assembly.billPlan ? null : assembly.billMaxInsertionMm;
    disposeAssembly(assembly);
    if (max !== null && max >= 2) {
      const insertion = Math.floor(max * 10) / 10;
      report.placements.push({
        label: 'Enfoncement de bavette ramene',
        detail:
          `${params.billInsertion.toFixed(1)} mm proposes d apres la plaque du fichier, ${insertion.toFixed(1)} mm ` +
          'admissibles a cet ancrage : au-dela, la fente percerait la peau de la tete.',
      });
      params.billInsertion = insertion;
    }
  }

  // --- Visserie : emplacements ----------------------------------------------
  const pocket: [number, number][] = [];
  if (params.hasBib) {
    const assembly = check(params);
    const plan = assembly.billPlan;
    if (plan) {
      const bottom = plan.depthU(plan.insertion);
      const xs = [plan.mouth.x, plan.root.x, plan.along(bottom, -plan.halfPlate).x, plan.along(bottom, plan.halfPlate).x];
      const toP = (x: number) => (x - profile.xAt(0)) / profile.lengthCm;
      pocket.push([toP(Math.min(...xs)) - 0.01, toP(Math.max(...xs)) + 0.01]);
    }
    disposeAssembly(assembly);
  }
  /** Demi-emprise d'une portee d'ecrou M2, en fraction de longueur. */
  const halfScrew = 3 / body.lengthMm;
  const MIN_HEIGHT = minBodyHeightMm('M2', 'countersunk', SCREW_LENGTHS[0]);
  const tall: number[] = [];
  // Hors de la poche de bavette et a 5 mm au moins de chaque portee de
  // goupille : ce sont les deux voisins qu'une vis ne peut pas traverser.
  // Pareil pour une nageoire couchee sous le ventre : la tete y entrerait.
  const free = (p: number) =>
    !pocket.some(([lo, hi]) => p + halfScrew >= lo && p - halfScrew <= hi) &&
    !body.skin.fins.some((fin) => fin.rail === 'lo' && p + halfScrew >= fin.p0 - 0.01 && p - halfScrew <= fin.p1 + 0.01) &&
    params.assembly.anchors.every((anchor) => Math.abs(anchor.position - p) * body.lengthMm >= 5);
  let tallest = 0;
  for (let p = 0.08; p <= marks.bodyEnd - 0.08 + 1e-9; p += 0.005) {
    const h = heightAt(p);
    tallest = Math.max(tallest, h);
    if (h >= MIN_HEIGHT && free(p)) tall.push(p);
  }
  const nearestTall = (target: number, lo: number, hi: number) => {
    let best: number | null = null;
    for (const p of tall) if (p >= lo && p <= hi && (best === null || Math.abs(p - target) < Math.abs(best - target))) best = p;
    return best;
  };
  // Deux vis ecartees d'au moins 9 mm d'axe a axe (deux portees d'ecrou et
  // une cloison), sinon une seule au plus haut du corps.
  const spacing = Math.max(0.08, 9 / body.lengthMm);
  let screwAt: number[] = [];
  if (tall.length > 0) {
    const lastTall = tall[tall.length - 1];
    const front = body.lengthMm >= 70 ? nearestTall(marks.maxSection - 0.14, 0, lastTall - spacing) : null;
    const rear =
      front !== null ? nearestTall(Math.max(marks.maxSection + 0.14, (front + lastTall) / 2 + spacing / 2), front + spacing, 1) : null;
    if (front !== null && rear !== null) screwAt = [front, rear];
    else {
      let peak = tall[0];
      for (const p of tall) if (heightAt(p) > heightAt(peak)) peak = p;
      screwAt = [peak];
    }
  } else {
    report.problems.push(
      `Visserie non posee : la plus courte vis du catalogue (M2 x ${SCREW_LENGTHS[0]} mm) demande ${MIN_HEIGHT.toFixed(1)} mm de hauteur ` +
        `de corps, tete noyee et epaulement d ecrou compris ; ce corps culmine a ${tallest.toFixed(1)} mm. ` +
        'Les demi-coques sont tenues par les ergots et la gorge de colle.',
    );
  }
  params.screws = {
    ...params.screws,
    enabled: screwAt.length > 0,
    screws: screwAt.map((position, i) => ({
      id: `vis-${i}-${Date.now()}`,
      position: Math.round(position * 1000) / 1000,
      size: 'auto',
      head: 'countersunk',
      length: 15,
    })),
  };

  // --- Longueur de vis : la plus longue qui tienne ------------------------
  // La plus longue du catalogue que la hauteur autorise, puis on descend
  // tant que le passage deboucherait (crete dorsale, nageoire).
  {
    const assembly = check(params);
    const longest = params.screws.screws.map(
      (screw) => assembly.screws.find((item) => item.id === screw.id)?.longestFit ?? screw.length,
    );
    disposeAssembly(assembly);
    params.screws.screws.forEach((screw, index) => {
      for (const length of [35, 30, 25, 20, 15].filter((value) => value <= longest[index])) {
        const screws = params.screws.screws.map((item, i) => (i === index ? { ...item, length } : item));
        const trial = { ...params, screws: { ...params.screws, screws } };
        const probe = check(trial);
        const ok = probe.screws.find((item) => item.id === screw.id)?.valid === true;
        disposeAssembly(probe);
        if (ok) {
          params.screws = trial.screws;
          break;
        }
      }
    });
  }

  // --- Deplacement des implantations refusees -----------------------------
  // Chaque ancrage et chaque vis refuses glissent le long du corps, de part
  // et d'autre, jusqu'a trouver une place ; le deplacement est rapporte.
  const OFFSETS = [0.01, -0.01, 0.02, -0.02, 0.03, -0.03, 0.045, -0.045, 0.06, -0.06, 0.08, -0.08, 0.11, -0.11];
  for (let round = 0; round < 3; round++) {
    const assembly = check(params);
    const badSockets = assembly.sockets.filter((socket) => !socket.valid);
    const badScrews = assembly.screws.filter((screw) => !screw.valid);
    disposeAssembly(assembly);
    if (badSockets.length === 0 && badScrews.length === 0) break;
    for (const socket of badSockets) {
      const index = params.assembly.anchors.findIndex((anchor) => anchor.id === socket.anchorId);
      if (index < 0) continue;
      const original = params.assembly.anchors[index];
      let fixed = false;
      for (const offset of OFFSETS) {
        const position = clamp(original.position + offset, 0.03, marks.bodyEnd - 0.05);
        const anchors = params.assembly.anchors.map((anchor, i) => (i === index ? { ...anchor, position } : anchor));
        const trial = { ...params, assembly: { ...params.assembly, anchors } };
        const probe = check(trial);
        const ok = probe.sockets.find((item) => item.anchorId === original.id)?.valid === true;
        disposeAssembly(probe);
        if (ok) {
          params.assembly = trial.assembly;
          params.mounts = params.mounts.map((mount) => (mount.anchorId === original.id ? { ...mount, position } : mount));
          report.placements.push({
            label: `Portee « ${original.id} » deplacee`,
            detail: `De ${Math.round(original.position * 100)} % a ${Math.round(position * 100)} % : ${socket.problem ?? 'collision'}`,
          });
          fixed = true;
          break;
        }
      }
      if (!fixed && original.exit === 'nose') {
        // D'abord plus haut sur le nez, au-dessus de la fente de bavette.
        for (const height of [0.25, 0.45]) {
          const anchors = params.assembly.anchors.map((anchor, i) => (i === index ? { ...anchor, height } : anchor));
          const trial = { ...params, assembly: { ...params.assembly, anchors } };
          const probe = check(trial);
          const ok = probe.sockets.find((item) => item.anchorId === original.id)?.valid === true;
          disposeAssembly(probe);
          if (ok) {
            params.assembly = trial.assembly;
            report.placements.push({
              label: 'Attache de nez remontee',
              detail: `Hauteur ${height.toFixed(2)} au lieu de ${original.height.toFixed(2)} : ${socket.problem ?? 'collision'}`,
            });
            fixed = true;
            break;
          }
        }
      }
      if (!fixed && original.exit === 'nose') {
        // Attache de nez impossible (fente de bavette, pointe trop fine) :
        // sortie par le dos, comme sur un vibe — en arriere de la fente de
        // bavette, dont la bouche ne peut pas partager ses stations.
        for (const position of [0.12, 0.15, 0.18, 0.21, 0.25, 0.3, 0.35]) {
          const anchors = params.assembly.anchors.map((anchor, i) =>
            i === index ? { ...anchor, exit: 'back' as const, position, height: 0.6 } : anchor,
          );
          const trial = { ...params, assembly: { ...params.assembly, anchors } };
          const probe = check(trial);
          const ok =
            probe.sockets.find((item) => item.anchorId === original.id)?.valid === true && (!params.hasBib || probe.billPlan !== null);
          disposeAssembly(probe);
          if (ok) {
            params.assembly = trial.assembly;
            report.placements.push({
              label: 'Attache de ligne passee au dos',
              detail: `L attache de nez ne tient pas (${socket.problem ?? 'collision'}) : elle sort par le dos a ${Math.round(position * 100)} %.`,
            });
            break;
          }
        }
      }
    }
    for (const screwPlan of badScrews) {
      const index = params.screws.screws.findIndex((screw) => screw.id === screwPlan.id);
      if (index < 0) continue;
      const original = params.screws.screws[index];
      // Candidats : assez hauts, a distance de l'autre vis et des portees de
      // goupille (5 mm d'axe a axe), du plus proche au plus lointain. Seuls
      // les douze premiers sont construits.
      const candidates = (tall.length > 0 ? tall : OFFSETS.map((offset) => original.position + offset))
        .map((p) => Math.round(clamp(p, 0.08, marks.bodyEnd - 0.08) * 1000) / 1000)
        .filter((p) => Math.abs(p - original.position) > 1e-6)
        .filter((p) => !params.screws.screws.some((other, i) => i !== index && Math.abs(other.position - p) < spacing))
        .filter(free)
        .sort((a, b) => Math.abs(a - original.position) - Math.abs(b - original.position))
        .slice(0, 16);
      for (const position of candidates) {
        const screws = params.screws.screws.map((screw, i) => (i === index ? { ...screw, position } : screw));
        const trial = { ...params, screws: { ...params.screws, screws } };
        const probe = check(trial);
        const plan = probe.screws.find((item) => item.id === original.id);
        disposeAssembly(probe);
        if (plan?.valid) {
          params.screws = trial.screws;
          report.placements.push({
            label: 'Vis deplacee',
            detail: `De ${Math.round(original.position * 100)} % a ${Math.round(position * 100)} % : ${screwPlan.problem ?? 'collision'}`,
          });
          break;
        }
      }
    }
  }

  // Une vis qui ne trouve de place nulle part est retiree, et on le dit :
  // une vis refusee n'est pas percee, elle ne tiendrait rien.
  if (params.screws.enabled) {
    const assembly = check(params);
    const bad = assembly.screws.filter((screw) => !screw.valid);
    disposeAssembly(assembly);
    for (const plan of bad) {
      params.screws = { ...params.screws, screws: params.screws.screws.filter((screw) => screw.id !== plan.id) };
    }
    if (bad.length && params.screws.screws.length > 0) {
      // Une vis reste : l'assemblage tient, on dit simplement ce qui a ete retire.
      for (const plan of bad) {
        report.placements.push({ label: 'Vis retiree', detail: `${plan.problem ?? 'aucun emplacement valide'} Une seule vis tient ce corps.` });
      }
    } else if (bad.length) {
      params.screws = { ...params.screws, enabled: false };
      report.problems.push(
        `Visserie non posee : aucun emplacement ne tient — ${bad.map((plan) => plan.problem ?? 'refus').join(' ')} ` +
          'Les demi-coques sont tenues par les ergots et la gorge de colle.',
      );
    }
  }

  return { params, profile, build, marks };
}

/**
 * Applique le principe de fabrication du logiciel au maillage importe.
 *
 * Renvoie un projet complet — le corps maille, sa quincaillerie, ses coques —
 * et le compte rendu de ce qui a ete place, deplace ou refuse.
 */
export function industrialise(
  imported: ImportedMesh,
  body: MeshBody,
  current: Pick<LureParams, 'material' | 'infill' | 'print'>,
  options: IndustrialOptions,
): { params: LureParams | null; report: IndustrialReport } {
  const project = meshProject(imported, body);
  const report: IndustrialReport = {
    family: project.family,
    familyWhy: project.why,
    placements: [],
    problems: [],
    blocked: topologyBlocks(imported, body, options.acceptEnvelope === true),
    envelope: envelopeNotes(body),
    physics: null,
  };
  if (report.blocked.some((line) => /operation bloquee/i.test(line))) {
    return { params: null, report };
  }

  const { params, profile, build, marks } = fitProject(project, body, current, options, report);

  // --- Creusage : il doit alleger, sinon on le dit ----------------------------
  // En FDM peu rempli, les parois des chambres recoivent des perimetres
  // pleins : creuser peut ALOURDIR. On compare au corps plein.
  if (params.assembly.hollow.enabled) {
    const weigh = (candidate: LureParams) => {
      const assembly = build(candidate);
      const geo = buildLure(candidate, DISPLAY_RESOLUTION);
      const mass = computePhysics(candidate, geo, 'fresh', assembly).totalMass;
      geo.dispose();
      disposeAssembly(assembly);
      return mass;
    };
    const hollowMass = weigh(params);
    const solidMass = weigh({ ...params, assembly: { ...params.assembly, hollow: { ...params.assembly.hollow, enabled: false } } });
    const delta = hollowMass - solidMass;
    report.placements.push({
      label: 'Bilan du creusage',
      detail:
        delta < 0
          ? `Allege le corps de ${(-delta).toFixed(1)} g par rapport au corps plein au meme remplissage.`
          : `Alourdit le corps de ${delta.toFixed(1)} g : a ${params.infill} % de remplissage, les perimetres qui ` +
            'tapissent les chambres pesent plus que la matiere retiree. Le creusage paie en resine ou a fort ' +
            'remplissage ; decochez-le ici si seul le poids compte.',
    });
  }

  // --- Lest ------------------------------------------------------------------
  const family = ARCHETYPES.find((item) => item.shape === project.family);
  const target = options.target ?? family?.buoyancy ?? 'float';
  {
    const assembly = build(params);
    const geo = buildLure(params, DISPLAY_RESOLUTION);
    const physics = computePhysics(params, geo, 'fresh', assembly);
    const cbPosition = clamp((physics.cb.x - profile.xAt(0)) / profile.lengthCm, 0.2, marks.bodyEnd - 0.15);
    const proposal = proposeBallast(params, assembly, physics, target, cbPosition);
    geo.dispose();
    disposeAssembly(assembly);
    params.ballasts = proposal.ballasts;
    report.placements.push(...proposal.notes);
    report.problems.push(...proposal.problems);
  }

  // --- Verification finale ---------------------------------------------------
  const assembly = build(params);
  const at = (x: number) => `${((x - profile.xAt(0)) * 10).toFixed(0)} mm du nez`;
  for (const socket of assembly.sockets) {
    if (!socket.valid) report.problems.push(`Portee « ${socket.anchorId} » a ${at(socket.center.x)} : ${socket.problem}`);
  }
  for (const screw of assembly.screws) {
    if (!screw.valid) report.problems.push(screw.problem ?? `Vis a ${at(screw.x)} refusee.`);
  }
  for (const peg of assembly.pegs) if (!peg.valid && peg.problem) report.problems.push(peg.problem);
  for (const seat of assembly.ballastSeats) if (!seat.valid && seat.problem) report.problems.push(seat.problem);
  if (params.hasBib && !assembly.billPlan) {
    report.problems.push(`Fente de bavette : ${assembly.billProblem ?? 'refusee'}`);
  }
  if (assembly.hollow) report.problems.push(...assembly.hollow.notes.filter((note) => note.startsWith('Aucune')));

  // --- Compte rendu des implantations ---------------------------------------
  const describe = (p: number) => `${Math.round(p * 100)} % (${(p * body.lengthMm).toFixed(0)} mm du nez)`;
  for (const anchor of params.assembly.anchors) {
    const socket = assembly.sockets.find((item) => item.anchorId === anchor.id);
    report.placements.push({
      label: anchor.exit === 'nose' ? 'Attache de ligne' : anchor.exit === 'back' ? 'Attache dorsale' : `Support d hamecon « ${anchor.id} »`,
      detail:
        `Goupille en 8 ${socket?.spec.label ?? ''} a ${describe(anchor.position)}, sortie ${
          anchor.exit === 'nose' ? 'par le nez' : anchor.exit === 'back' ? 'par le dos' : anchor.exit === 'tail' ? 'par la queue' : 'par le ventre'
        }, dans sa portee fendue avec son goujon.` +
        (anchor.id === 'ventre' ? ' Place sous la section maitresse, la ou pend l hamecon avant.' : '') +
        (anchor.id === 'arriere' ? ' Place a mi-chemin du pedoncule.' : ''),
    });
  }
  for (const screw of assembly.screws) {
    report.placements.push({
      label: `Vis ${screw.spec.size} x ${screw.lengthMm} mm`,
      detail:
        `A ${at(screw.x)}, tete fraisee noyee par le ventre, ecrou captif a ${((screw.nut.fromY - screw.bellyY) * 10).toFixed(1)} mm ` +
        `du ventre (longueur utile ${screw.usefulMm.toFixed(1)} mm). Diametre suggere par la hauteur du corps a cet endroit.`,
    });
  }
  const pegsOk = assembly.pegs.filter((peg) => peg.valid);
  if (pegsOk.length) {
    report.placements.push({
      label: `${pegsOk.length} ergots coniques`,
      detail: `A ${pegsOk.map((peg) => `${peg.fromNoseMm.toFixed(0)} mm`).join(', ')} du nez, la ou la coque est la plus epaisse.`,
    });
  }
  if (assembly.glueGroove) {
    report.placements.push({
      label: 'Gorge de colle',
      detail: `${assembly.glueGroove.segments} troncons, ${assembly.glueGroove.lengthMm.toFixed(0)} mm au total.`,
    });
  }
  if (assembly.hollow && assembly.hollow.chambers > 0) {
    report.placements.push({
      label: 'Creusage',
      detail:
        `${assembly.hollow.chambers} chambres par coque, paroi ${assembly.hollow.wallMm.toFixed(1)} mm, ` +
        `${assembly.hollow.volumeCm3.toFixed(2)} cm3 retires par coque. Cloisons pleines au droit de chaque logement.`,
    });
  }
  if (params.hasBib) {
    report.placements.push({
      label: 'Fente de bavette',
      detail: assembly.billPlan
        ? `Plaque ${params.bibLength.toFixed(1)} x ${params.bibWidth.toFixed(1)} x ${params.billThickness.toFixed(1)} mm a ${params.bibAngle} deg, ` +
          `ancree a ${params.billOffset.toFixed(1)} mm du nez, enfoncee de ${(assembly.billPlan.insertion * 10).toFixed(1)} mm — cotes relevees sur la bavette du fichier.`
        : 'Refusee (voir ci-dessous).',
    });
  }
  const geo = buildLure(params, DISPLAY_RESOLUTION);
  const physics = computePhysics(params, geo, 'fresh', assembly);
  geo.dispose();
  disposeAssembly(assembly);
  report.physics = {
    buoyancy: physics.buoyancy,
    ratio: physics.ratio,
    totalMass: physics.totalMass,
    cgPct: physics.cgPct,
    cbPct: physics.cbPct,
    trimDeg: physics.trimDeg,
  };
  return { params, report };
}

// ---------------------------------------------------------------------------
// Banc d'essai (AD.2)
// ---------------------------------------------------------------------------

export interface OrientationShare {
  label: string;
  /** Part de surface a plus de 45 deg de surplomb, 0 a 1. */
  share: number;
}

export interface BenchResult {
  params: LureParams;
  physics: PhysicsResult;
  /** Poussee moins masse, en g : positif = flotte. */
  marginG: number;
  /** Centres en mm : X depuis le nez, Y depuis l'axe, Z depuis le plan de symetrie. */
  cgMm: { x: number; y: number; z: number };
  cbMm: { x: number; y: number; z: number };
  swim: {
    critical: Estimate;
    sweet: number;
    /** Profondeur a 3 km/h et 20 m de ligne, fourchette en m. */
    depth: [number, number] | null;
    frequencyHz: number;
    yawDeg: number;
    rollDeg: number;
    action: string;
    currents: { label: string; relative: number; depth: number; overSpeed: boolean }[];
  };
  anchors: AnchorStrength[];
  checks: PrintCheck[];
  orientations: OrientationShare[];
  recommended: string;
}

/** Surplombs du maillage d'origine selon la face posee sur le plateau. */
export function orientationShares(positions: Float32Array): OrientationShare[] {
  const options: { label: string; down: [number, number, number] }[] = [
    { label: 'Couche sur le flanc', down: [0, 0, -1] },
    { label: 'Pose sur le ventre', down: [0, -1, 0] },
    { label: 'Pose sur le dos', down: [0, 1, 0] },
  ];
  const totals = options.map(() => 0);
  let area = 0;
  for (let k = 0; k < positions.length; k += 9) {
    const ux = positions[k + 3] - positions[k], uy = positions[k + 4] - positions[k + 1], uz = positions[k + 5] - positions[k + 2];
    const vx = positions[k + 6] - positions[k], vy = positions[k + 7] - positions[k + 1], vz = positions[k + 8] - positions[k + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-14) continue;
    area += len / 2;
    options.forEach((option, i) => {
      const facing = (nx * option.down[0] + ny * option.down[1] + nz * option.down[2]) / len;
      if (facing > Math.SQRT1_2) totals[i] += len / 2;
    });
  }
  return options.map((option, i) => ({ label: option.label, share: area > 0 ? totals[i] / area : 0 }));
}

/**
 * Banc d'essai d'un maillage importe, sans rien modifier de sa geometrie.
 *
 * Masse et verdict : le modele imprime d'un seul tenant, au materiau, aux
 * parois et au remplissage du projet, avec des hamecons a sa taille.
 * Rupture : chaque attache et support d'hamecon PROPOSES, en goupille en 8
 * dans sa portee fendue. Tout est estimation d'ingenierie : fourchettes.
 */
export function runBench(
  imported: ImportedMesh,
  body: MeshBody,
  current: Pick<LureParams, 'material' | 'infill' | 'print'>,
  water: 'fresh' | 'salt' = 'fresh',
): BenchResult {
  const params = benchParams(imported, body, current);
  const geo = buildLure(params, DISPLAY_RESOLUTION);
  const physics = computePhysics(params, geo, water);
  const profile = createProfile(params);
  const nose = profile.xAt(0);
  const input: SwimInput = {
    params,
    massG: physics.totalMass,
    volumeCm3: physics.volumeCm3,
    cg: physics.cg,
    cb: physics.cb,
    bounds: { length: params.length, width: params.maxWidth, height: params.thickness },
    assumptions: DEFAULT_ASSUMPTIONS,
    calibration: NEUTRAL_CALIBRATION,
  };
  const critical = criticalSpeed(input);
  const wobble = wobbleProfile(input, critical);
  const peak = wobble.points.reduce((best, point) => (point.yaw + point.roll > best.yaw + best.roll ? point : best), wobble.points[0]);
  const depth = params.hasBib
    ? ([diveDepth(input, 2.5, 20), diveDepth(input, 3.5, 20)] as [number, number])
    : null;
  const currents = CURRENT_PRESETS.filter((preset) => preset.current.speed > 0).map((preset) => {
    const result = applyCurrent(input, critical, 3, preset.current, 20);
    return { label: preset.label, relative: result.relative, depth: result.depth, overSpeed: result.overSpeed };
  });

  // Rupture : les portees proposees ET verifiees — deplacees hors des
  // nageoires et des passages comme a l'industrialisation —, dans
  // l'assemblage qui les porterait.
  const scratch: IndustrialReport = { family: 'minnow', familyWhy: '', placements: [], problems: [], blocked: [], envelope: [], physics: null };
  const fitted = fitProject(meshProject(imported, body), body, current, { hollow: false, wall: 1.6 }, scratch).params;
  const assembly = buildAssembly(createProfile(fitted), fitted, ASSEMBLY_PREVIEW);
  const anchors = assembly.sockets
    .filter((socket) => socket.valid)
    .map((socket) =>
      anchorStrength(
        `${socket.spec.label} — ${socket.exit === 'nose' ? 'attache de nez' : socket.exit === 'back' ? 'attache dorsale' : 'support ventral'} a ${((socket.center.x - nose) * 10).toFixed(0)} mm`,
        socket.spec.wire,
        socket.spec.loopWidth,
        socket.seatDepth * 10,
        'inox304',
        params,
        DEFAULT_ASSUMPTIONS,
        NEUTRAL_CALIBRATION,
      ),
    );
  disposeAssembly(assembly);

  const checks = runPrintChecks(params, geo);
  geo.dispose();
  const orientations = orientationShares(body.source);
  const best = orientations.reduce((a, b) => (b.share < a.share ? b : a));
  const toMm = (v: { x: number; y: number; z: number }) => ({ x: (v.x - nose) * 10, y: v.y * 10, z: v.z * 10 });
  return {
    params,
    physics,
    marginG: physics.displacedMass - physics.totalMass,
    cgMm: toMm(physics.cg),
    cbMm: toMm(physics.cb),
    swim: {
      critical: critical.speed,
      sweet: critical.sweet,
      depth,
      frequencyHz: peak.frequency,
      yawDeg: peak.yaw,
      rollDeg: peak.roll,
      action: wobble.label,
      currents,
    },
    anchors,
    checks,
    orientations,
    recommended:
      `${best.label} (${Math.round(best.share * 100)} % de surface en surplomb) pour une piece d un seul tenant ; ` +
      'en deux demi-coques posees sur leur plan de joint, il n y a plus de surplomb du tout.',
  };
}
