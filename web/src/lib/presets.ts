/**
 * Formes de base de la galerie et bornes des reglages.
 *
 * Chaque preset est un jeu complet de parametres : il n'y a aucun modele 3D
 * stocke, seulement des nombres que le generateur transforme en maillage.
 */

import type { LureParams, ShapeId } from '../types/lure';

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
} as const satisfies Record<string, Range>;

export interface ShapePreset {
  id: ShapeId;
  label: string;
  tagline: string;
  description: string;
  params: LureParams;
}

const ballast = (position: number, height: number, mass: number, seed: string) => ({
  id: `${seed}-${position}`,
  position,
  height,
  mass,
});

export const SHAPE_PRESETS: ShapePreset[] = [
  {
    id: 'minnow',
    label: 'Minnow',
    tagline: 'Poisson nageur elance',
    description:
      'Silhouette fuselee, bavette moyenne, nage serree. La forme polyvalente par excellence pour le brochet, la perche et le bar.',
    params: {
      shape: 'minnow',
      length: 110,
      maxWidth: 14,
      thickness: 22,
      bellyPosition: 0.42,
      dorsalCurve: 0.25,
      ventralCurve: 0.3,
      noseSharpness: 0.55,
      tailTaper: 1.15,
      crossSection: 2.1,
      mouthCup: 0,
      hasBib: true,
      bibAngle: 40,
      bibLength: 20,
      bibWidth: 16,
      tailShape: 'forked',
      tailSize: 0.9,
      material: 'pla',
      infill: 12,
      hardwareMass: 3.2,
      ballasts: [ballast(0.3, -0.7, 2, 'min'), ballast(0.52, -0.75, 4, 'min')],
      paint: {
        dorsal: '#14425E',
        flank: '#DCE6EE',
        belly: '#FFFFFF',
        pattern: 'gradient',
        patternColor: '#0B7285',
        patternScale: 8,
        finish: 'gloss',
      },
    },
  },
  {
    id: 'popper',
    label: 'Popper',
    tagline: 'Bouche creusee, travail en surface',
    description:
      'Tete tronquee et creusee qui projette une gerbe a chaque coup de scion. Lestage arriere pour garder le nez hors de l eau.',
    params: {
      shape: 'popper',
      length: 85,
      maxWidth: 20,
      thickness: 24,
      bellyPosition: 0.3,
      dorsalCurve: 0.15,
      ventralCurve: 0.35,
      noseSharpness: 0.3,
      tailTaper: 1.5,
      crossSection: 2.2,
      mouthCup: 0.85,
      hasBib: false,
      bibAngle: 45,
      bibLength: 18,
      bibWidth: 16,
      tailShape: 'round',
      tailSize: 0.8,
      material: 'pla',
      infill: 10,
      hardwareMass: 3,
      ballasts: [ballast(0.58, -0.55, 3.2, 'pop'), ballast(0.7, -0.45, 1.6, 'pop')],
      paint: {
        dorsal: '#FFFFFF',
        flank: '#FFFFFF',
        belly: '#FFFFFF',
        pattern: 'gradient',
        patternColor: '#E30613',
        patternScale: 8,
        finish: 'gloss',
      },
    },
  },
  {
    id: 'crankbait',
    label: 'Crankbait',
    tagline: 'Corps trapu, grande bavette',
    description:
      'Volume court et haut, bavette large tres inclinee : nage ample et vibrante, prospection rapide sur toute la couche d eau.',
    params: {
      shape: 'crankbait',
      length: 62,
      maxWidth: 17,
      thickness: 28,
      bellyPosition: 0.4,
      dorsalCurve: 0.3,
      ventralCurve: 0.34,
      noseSharpness: 0.4,
      tailTaper: 0.95,
      crossSection: 2.4,
      mouthCup: 0,
      hasBib: true,
      bibAngle: 58,
      bibLength: 26,
      bibWidth: 22,
      tailShape: 'round',
      tailSize: 0.8,
      material: 'pla',
      infill: 8,
      hardwareMass: 3.4,
      ballasts: [ballast(0.38, -0.8, 4.5, 'crk'), ballast(0.55, -0.7, 1.6, 'crk')],
      paint: {
        dorsal: '#2E6B1F',
        flank: '#F2C200',
        belly: '#F26A00',
        pattern: 'stripes',
        patternColor: '#12200E',
        patternScale: 9,
        finish: 'gloss',
      },
    },
  },
  {
    id: 'jerkbait',
    label: 'Jerkbait',
    tagline: 'Long et fin, nage erratique',
    description:
      'Corps allonge, bavette courte et peu inclinee. Concu pour les depart-arret : le suspending fige le leurre entre deux tirees.',
    params: {
      shape: 'jerkbait',
      length: 120,
      maxWidth: 13,
      thickness: 22,
      bellyPosition: 0.45,
      dorsalCurve: 0.2,
      ventralCurve: 0.2,
      noseSharpness: 0.6,
      tailTaper: 1.3,
      crossSection: 2,
      mouthCup: 0,
      hasBib: true,
      bibAngle: 32,
      bibLength: 18,
      bibWidth: 14,
      tailShape: 'forked',
      tailSize: 0.85,
      material: 'pla',
      infill: 10,
      hardwareMass: 3.6,
      ballasts: [ballast(0.48, -0.7, 4, 'jrk'), ballast(0.62, -0.65, 3.2, 'jrk')],
      paint: {
        dorsal: '#0E2E4F',
        flank: '#D9E2EA',
        belly: '#FFFFFF',
        pattern: 'dots',
        patternColor: '#9AA7B2',
        patternScale: 16,
        finish: 'gloss',
      },
    },
  },
  {
    id: 'spoon',
    label: 'Spoon',
    tagline: 'Cuiller ondulante',
    description:
      'Lame large et plate, sans bavette : c est la section aplatie qui cree le roulis et les eclats de flanc a la descente.',
    params: {
      shape: 'spoon',
      length: 72,
      maxWidth: 26,
      thickness: 8,
      bellyPosition: 0.45,
      dorsalCurve: 0.1,
      ventralCurve: 0.1,
      noseSharpness: 0.5,
      tailTaper: 0.9,
      crossSection: 1.8,
      mouthCup: 0,
      hasBib: false,
      bibAngle: 45,
      bibLength: 15,
      bibWidth: 14,
      tailShape: 'fan',
      tailSize: 0.6,
      material: 'resin',
      infill: 100,
      hardwareMass: 2.6,
      ballasts: [],
      paint: {
        dorsal: '#E30613',
        flank: '#FFFFFF',
        belly: '#E30613',
        pattern: 'stripes',
        patternColor: '#E30613',
        patternScale: 5,
        finish: 'chrome',
      },
    },
  },
  {
    id: 'swimbait',
    label: 'Swimbait',
    tagline: 'Gros volume, queue palette',
    description:
      'Corps de poisson fourrage imposant termine par une palette souple. Imprime en TPU, la queue bat des la moindre traction.',
    params: {
      shape: 'swimbait',
      length: 135,
      maxWidth: 24,
      thickness: 38,
      bellyPosition: 0.4,
      dorsalCurve: 0.45,
      ventralCurve: 0.4,
      noseSharpness: 0.45,
      tailTaper: 1.6,
      crossSection: 2.2,
      mouthCup: 0,
      hasBib: false,
      bibAngle: 45,
      bibLength: 20,
      bibWidth: 18,
      tailShape: 'paddle',
      tailSize: 1,
      material: 'tpu',
      infill: 25,
      hardwareMass: 4.5,
      ballasts: [ballast(0.42, -0.7, 18, 'swb'), ballast(0.6, -0.65, 11.5, 'swb')],
      paint: {
        dorsal: '#3E5C43',
        flank: '#C9C3B4',
        belly: '#F2EDE4',
        pattern: 'dots',
        patternColor: '#2A2A24',
        patternScale: 14,
        finish: 'satin',
      },
    },
  },
  {
    id: 'topwater',
    label: 'Topwater',
    tagline: 'Stickbait de surface',
    description:
      'Cigare sans bavette, leste sur l arriere : la tete pivote a chaque tiree pour un walking the dog regulier.',
    params: {
      shape: 'topwater',
      length: 105,
      maxWidth: 18,
      thickness: 20,
      bellyPosition: 0.55,
      dorsalCurve: 0.1,
      ventralCurve: 0.15,
      noseSharpness: 0.4,
      tailTaper: 1.1,
      crossSection: 2,
      mouthCup: 0.25,
      hasBib: false,
      bibAngle: 45,
      bibLength: 16,
      bibWidth: 14,
      tailShape: 'round',
      tailSize: 0.7,
      material: 'lwpla',
      infill: 100,
      hardwareMass: 3,
      ballasts: [ballast(0.85, -0.4, 1.5, 'top')],
      paint: {
        dorsal: '#E30613',
        flank: '#FFFFFF',
        belly: '#FFFFFF',
        pattern: 'none',
        patternColor: '#111315',
        patternScale: 8,
        finish: 'satin',
      },
    },
  },
];

export const getPreset = (id: ShapeId): ShapePreset =>
  SHAPE_PRESETS.find((preset) => preset.id === id) ?? SHAPE_PRESETS[0];

/** Copie profonde : les presets ne doivent jamais etre modifies en place. */
export const clonePreset = (id: ShapeId): LureParams => {
  const { params } = getPreset(id);
  return {
    ...params,
    ballasts: params.ballasts.map((b, i) => ({ ...b, id: `${b.id}-${i}-${Date.now()}` })),
    paint: { ...params.paint },
  };
};
