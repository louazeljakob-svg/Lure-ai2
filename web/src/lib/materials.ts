/** Materiaux d'impression et leurs densites reelles (g/cm3). */

import type { ClipId, FinishId, MaterialId, WaterId } from '../types/lure';

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
}

export const MATERIALS: PrintMaterial[] = [
  {
    id: 'pla',
    label: 'PLA',
    density: 1.24,
    summary: 'Rigide, precis, bon marche. Reference pour les corps rigides.',
    defaultInfill: 15,
    hollowable: true,
  },
  {
    id: 'lwpla',
    label: 'PLA allege (LW)',
    density: 0.62,
    summary: 'PLA expanse : tres flottant, ideal pour les leurres de surface.',
    defaultInfill: 100,
    hollowable: true,
  },
  {
    id: 'resin',
    label: 'Resine',
    density: 1.15,
    summary: 'Etat de surface parfait, dense. Impression pleine ou evidee.',
    defaultInfill: 100,
    hollowable: false,
  },
  {
    id: 'tpu',
    label: 'TPU flexible',
    density: 1.21,
    summary: 'Souple : queues battantes et corps de swimbait realistes.',
    defaultInfill: 25,
    hollowable: true,
  },
];

export const getMaterial = (id: MaterialId): PrintMaterial =>
  MATERIALS.find((m) => m.id === id) ?? MATERIALS[0];

/**
 * Fraction de matiere reellement deposee.
 * Meme a 0 % de remplissage il reste les parois, le dessus et le dessous :
 * on plancher a 15 % (et a 45 % pour la resine, non creusable ici).
 */
export function solidFraction(id: MaterialId, infill: number): number {
  const material = getMaterial(id);
  const floor = material.hollowable ? 0.15 : 0.45;
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
