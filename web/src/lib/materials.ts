/** Materiaux d'impression et leurs densites reelles (g/cm3). */

import type { ClipId, FinishId, MaterialId, ProcessId, WaterId } from '../types/lure';

export interface PrintMaterial {
  id: MaterialId;
  label: string;
  /** Densite du materiau plein, en g/cm3. */
  density: number;
  summary: string;
  /** Remplissage conseille par defaut, en %. */
  defaultInfill: number;
  /** Le procede autorise-t-il une piece creuse ? */
  hollowable: boolean;
  /** Procede auquel la matiere appartient : il filtre la liste proposee. */
  process: ProcessId;
}

export const MATERIALS: PrintMaterial[] = [
  {
    id: 'pla',
    label: 'PLA',
    density: 1.26,
    summary: 'Rigide, precis, bon marche. Reference pour les corps rigides.',
    defaultInfill: 15,
    hollowable: true,
    process: 'fdm',
  },
  {
    id: 'lwpla',
    label: 'PLA allege (LW)',
    density: 0.62,
    summary: 'PLA expanse : tres flottant, ideal pour les leurres de surface.',
    defaultInfill: 100,
    hollowable: true,
    process: 'fdm',
  },
  {
    id: 'petg',
    label: 'PETG',
    density: 1.27,
    summary: 'Plus tenace que le PLA, resiste aux chocs et a l eau chaude.',
    defaultInfill: 15,
    hollowable: true,
    process: 'fdm',
  },
  {
    id: 'abs',
    label: 'ABS',
    density: 1.04,
    summary: 'Leger et poncable, se lisse a l acetone. Demande un caisson.',
    defaultInfill: 15,
    hollowable: true,
    process: 'fdm',
  },
  {
    id: 'resin',
    label: 'Resine',
    density: 1.15,
    summary: 'Etat de surface parfait, dense. Impression pleine ou evidee.',
    defaultInfill: 100,
    hollowable: false,
    process: 'resin',
  },
  {
    id: 'tpu',
    label: 'TPU flexible',
    density: 1.21,
    summary: 'Souple : queues battantes et corps de swimbait realistes.',
    defaultInfill: 25,
    hollowable: true,
    process: 'fdm',
  },
  {
    id: 'basswood',
    label: 'Tilleul',
    density: 0.45,
    summary: 'Le bois des leurres traditionnels : tendre, homogene, flottant.',
    defaultInfill: 100,
    hollowable: false,
    process: 'wood',
  },
  {
    id: 'cedar',
    label: 'Cedre',
    density: 0.38,
    summary: 'Encore plus leger que le tilleul, tres flottant, fibre fine.',
    defaultInfill: 100,
    hollowable: false,
    process: 'wood',
  },
];

/**
 * TPU par durete Shore A (module AU.2) : densite et module d'elasticite.
 *
 * Valeurs typiques des fiches techniques de filaments du commerce ; elles
 * varient d'une marque a l'autre, d'ou les fourchettes. Le module d'Young
 * n'entre dans aucun calcul de nage (voir physique du Souple) : il sert a
 * comparer deux duretes, pas a predire une ondulation.
 */
export interface TpuGrade {
  shore: number;
  density: number;
  densityRange: [number, number];
  modulusMPa: number;
  modulusRange: [number, number];
  note: string;
}

export const TPU_GRADES: TpuGrade[] = [
  {
    shore: 85,
    density: 1.17,
    densityRange: [1.12, 1.2],
    modulusMPa: 12,
    modulusRange: [8, 20],
    note: 'Tres souple : la caudale bat le plus tot, mais le corps se dechire le plus vite.',
  },
  {
    shore: 90,
    density: 1.19,
    densityRange: [1.15, 1.22],
    modulusMPa: 18,
    modulusRange: [12, 30],
    note: 'Compromis : nage des la recuperation lente, tient mieux a l hamecon.',
  },
  {
    shore: 95,
    density: 1.21,
    densityRange: [1.18, 1.24],
    modulusMPa: 26,
    modulusRange: [18, 45],
    note: 'Le plus ferme : tient a l hamecon et aux dents, ondule moins.',
  },
];

/** Grade TPU interpole a la durete demandee, bornee a 85-95 A. */
export function tpuAt(shore: number): TpuGrade {
  const s = Math.min(Math.max(shore, 85), 95);
  const lo = s <= 90 ? TPU_GRADES[0] : TPU_GRADES[1];
  const hi = s <= 90 ? TPU_GRADES[1] : TPU_GRADES[2];
  const t = (s - lo.shore) / (hi.shore - lo.shore);
  const mix = (a: number, b: number) => Math.round((a + (b - a) * t) * 1000) / 1000;
  return {
    shore: s,
    density: mix(lo.density, hi.density),
    densityRange: [mix(lo.densityRange[0], hi.densityRange[0]), mix(lo.densityRange[1], hi.densityRange[1])],
    modulusMPa: mix(lo.modulusMPa, hi.modulusMPa),
    modulusRange: [mix(lo.modulusRange[0], hi.modulusRange[0]), mix(lo.modulusRange[1], hi.modulusRange[1])],
    note: t < 0.5 ? lo.note : hi.note,
  };
}

/**
 * Densite de la matiere du corps : celle du materiau, ou pour un souple
 * monobloc en TPU, celle de sa durete.
 */
export function bodyDensity(params: { material: MaterialId; soft?: { enabled: boolean; hardness: number } }): number {
  if (params.material === 'tpu' && params.soft?.enabled) return tpuAt(params.soft.hardness).density;
  return getMaterial(params.material).density;
}

/** Matieres proposees pour un procede donne. */
export const materialsFor = (process: ProcessId): PrintMaterial[] =>
  MATERIALS.filter((material) => material.process === process);

export const getMaterial = (id: MaterialId): PrintMaterial =>
  MATERIALS.find((m) => m.id === id) ?? MATERIALS[0];

/**
 * Fraction de matiere reellement deposee.
 *
 * Meme a 0 % de remplissage il reste la coque : les parois de perimetre, le
 * dessus et le dessous. Plus il y a de parois, plus ce plancher monte — c'est
 * ce qui fait qu'un leurre a six parois coule la ou le meme a une paroi
 * flotte. Une piece massive (resine pleine, bois) ignore le remplissage.
 */
export function solidFraction(id: MaterialId, infill: number, perimeters = 3): number {
  const material = getMaterial(id);
  if (!material.hollowable) return 1;
  // Trois parois de 0,4 mm sur un corps d'une quinzaine de millimetres : la
  // coque occupe environ un sixieme du volume. La formule est calee sur ce
  // cas de reference — trois parois redonnent exactement le plancher
  // historique — et suit ensuite le nombre de parois, ce qui fait qu'un
  // corps a six parois coule la ou le meme a une paroi flotte.
  const floor = Math.min(Math.max(0.05 * perimeters, 0.05), 0.5);
  const ratio = Math.min(Math.max(infill, 0), 100) / 100;
  return Math.min(1, floor + (1 - floor) * ratio);
}

export const WATER_DENSITY: Record<WaterId, number> = {
  fresh: 1.0,
  salt: 1.025,
};

export const WATER_LABEL: Record<WaterId, string> = {
  fresh: 'Eau douce',
  salt: 'Eau de mer',
};

/** Rendu PBR associe a chaque finition. */
export const FINISHES: Record<
  FinishId,
  { label: string; roughness: number; metalness: number; iridescence: number }
> = {
  matte: { label: 'Mat', roughness: 0.9, metalness: 0.02, iridescence: 0 },
  satin: { label: 'Satine', roughness: 0.5, metalness: 0.08, iridescence: 0 },
  gloss: { label: 'Brillant', roughness: 0.12, metalness: 0.1, iridescence: 0 },
  chrome: { label: 'Metallise', roughness: 0.14, metalness: 0.95, iridescence: 0 },
  // Irisation physique de three.js : le film mince decale la teinte selon
  // l'angle de vue, ce qui simule un film holographique.
  holo: { label: 'Holographique', roughness: 0.18, metalness: 0.6, iridescence: 1 },
};

/** Densite de l'acier a ressort des agrafes, en g/cm3. */
export const STEEL_DENSITY = 7.85;

export interface ClipSpec {
  id: Exclude<ClipId, 'none'>;
  label: string;
  /** Diametre du fil, en mm. */
  wire: number;
  /** Longueur hors-tout de l'agrafe, en mm. */
  length: number;
}

/** Agrafes disponibles, aux cotes du modele du commerce. */
export const CLIPS: ClipSpec[] = [
  { id: 'small', label: 'Petit', wire: 1.2, length: 16 },
  { id: 'medium', label: 'Moyen', wire: 1.6, length: 17.5 },
];

export const getClip = (id: ClipId): ClipSpec | null =>
  CLIPS.find((clip) => clip.id === id) ?? null;
