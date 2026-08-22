/**
 * Validation des projets reimportes.
 *
 * Un fichier JSON depose par l'utilisateur est une entree non fiable : chaque
 * champ est verifie et ramene dans ses bornes avant d'atteindre le
 * generateur de geometrie, ce qui evite tout NaN ou valeur absurde.
 */

import type {
  AssemblyConfig,
  BallastShape,
  BallastWeight,
  BillMode,
  ClipId,
  DetailConfig,
  EyeStyle,
  PinId,
  SocketMethod,
  FinishId,
  LureParams,
  MaterialId,
  PatternId,
  SavedPalette,
  ShapeId,
  TailShape,
} from '../types/lure';
import { clonePreset, LIMITS, type Range } from './presets';

const SHAPES: ShapeId[] = [
  'stickbait165',
  'irresistible',
  'ryoshi',
  'model25',
  'minnow',
  'popper',
  'crankbait',
  'jerkbait',
  'spoon',
  'swimbait',
  'topwater',
];
const TAILS: TailShape[] = ['taper', 'round', 'forked', 'paddle', 'fan'];
const MATERIALS: MaterialId[] = ['pla', 'lwpla', 'resin', 'tpu'];
const FINISHES: FinishId[] = ['matte', 'satin', 'gloss', 'chrome', 'holo'];
const PATTERNS: PatternId[] = ['none', 'stripes', 'dots', 'scales', 'camo', 'gradient'];
const CLIP_IDS: ClipId[] = ['none', 'small', 'medium'];
const PIN_IDS: (PinId | 'auto')[] = ['auto', 'xs06', 'xs10', 's', 'm', 'l'];
const SOCKETS: SocketMethod[] = ['bore', 'channel'];
const BILL_MODES: BillMode[] = ['printed', 'polycarbonate'];
const EYE_STYLES: EyeStyle[] = ['realistic', 'globular', 'holographic', 'custom'];
const BALLAST_SHAPES: BallastShape[] = ['sphere', 'cylinder'];

const num = (value: unknown, range: Range, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, range.min), range.max);
};

const pick = <T extends string>(value: unknown, allowed: T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const color = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

function sanitizeBallasts(value: unknown, fallback: BallastWeight[]): BallastWeight[] {
  if (!Array.isArray(value)) return fallback;
  return value.slice(0, 12).map((raw, index) => {
    const item = (raw ?? {}) as Partial<BallastWeight>;
    return {
      id:
        typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 64
          ? item.id
          : `imported-${index}-${Math.random().toString(36).slice(2, 8)}`,
      position: num(item.position, LIMITS.ballastPosition, 0.5),
      height: num(item.height, LIMITS.ballastHeight, -0.7),
      mass: num(item.mass, LIMITS.ballastMass, 1),
      shape: pick(item.shape, BALLAST_SHAPES, 'sphere'),
    };
  });
}

function sanitizeDetail(
  value: unknown,
  fallback: DetailConfig,
  ranges: { position: Range; size: Range; relief: Range },
): DetailConfig {
  const raw = (value ?? {}) as Partial<DetailConfig>;
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    position: num(raw.position, ranges.position, fallback.position),
    size: num(raw.size, ranges.size, fallback.size),
    relief: num(raw.relief, ranges.relief, fallback.relief),
  };
}

function sanitizeAssembly(value: unknown, fallback: AssemblyConfig): AssemblyConfig {
  const raw = (value ?? {}) as Partial<AssemblyConfig>;
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    planeAngle: num(raw.planeAngle, LIMITS.planeAngle, fallback.planeAngle),
    tenonCount: Math.round(num(raw.tenonCount, LIMITS.tenonCount, fallback.tenonCount)),
    tenonDiameter: num(raw.tenonDiameter, LIMITS.tenonDiameter, fallback.tenonDiameter),
    tenonClearance: num(raw.tenonClearance, LIMITS.tenonClearance, fallback.tenonClearance),
    socketMethod: pick(raw.socketMethod, SOCKETS, fallback.socketMethod),
    boreClearance: num(raw.boreClearance, LIMITS.boreClearance, fallback.boreClearance),
    channelOffset: num(raw.channelOffset, LIMITS.channelOffset, fallback.channelOffset),
    pin: pick(raw.pin, PIN_IDS, fallback.pin),
    roughWater: bool(raw.roughWater, fallback.roughWater),
  };
}

/** Ramene n'importe quelle entree a un jeu de parametres exploitable. */
export function sanitizeParams(input: unknown): LureParams {
  const raw = (input ?? {}) as Partial<LureParams>;
  const shape = pick(raw.shape, SHAPES, 'minnow');
  const base = clonePreset(shape);
  const paint = (raw.paint ?? {}) as Partial<LureParams['paint']>;

  return {
    shape,
    length: num(raw.length, LIMITS.length, base.length),
    maxWidth: num(raw.maxWidth, LIMITS.maxWidth, base.maxWidth),
    thickness: num(raw.thickness, LIMITS.thickness, base.thickness),
    bellyPosition: num(raw.bellyPosition, LIMITS.bellyPosition, base.bellyPosition),
    dorsalCurve: num(raw.dorsalCurve, LIMITS.dorsalCurve, base.dorsalCurve),
    ventralCurve: num(raw.ventralCurve, LIMITS.ventralCurve, base.ventralCurve),
    noseSharpness: num(raw.noseSharpness, LIMITS.noseSharpness, base.noseSharpness),
    tailTaper: num(raw.tailTaper, LIMITS.tailTaper, base.tailTaper),
    crossSection: num(raw.crossSection, LIMITS.crossSection, base.crossSection),
    mouthCup: num(raw.mouthCup, LIMITS.mouthCup, base.mouthCup),
    hasBib: bool(raw.hasBib, base.hasBib),
    billMode: pick(raw.billMode, BILL_MODES, base.billMode),
    billThickness: num(raw.billThickness, LIMITS.billThickness, base.billThickness),
    bibAngle: num(raw.bibAngle, LIMITS.bibAngle, base.bibAngle),
    bibLength: num(raw.bibLength, LIMITS.bibLength, base.bibLength),
    bibWidth: num(raw.bibWidth, LIMITS.bibWidth, base.bibWidth),
    tailShape: pick(raw.tailShape, TAILS, base.tailShape),
    tailSize: num(raw.tailSize, LIMITS.tailSize, base.tailSize),
    gills: sanitizeDetail(raw.gills, base.gills, {
      position: LIMITS.gillPosition,
      size: LIMITS.gillSize,
      relief: LIMITS.gillRelief,
    }),
    eyes: sanitizeDetail(raw.eyes, base.eyes, {
      position: LIMITS.eyePosition,
      size: LIMITS.eyeSize,
      relief: LIMITS.eyeRelief,
    }),
    eyeStyle: pick(raw.eyeStyle, EYE_STYLES, base.eyeStyle),
    clip: pick(raw.clip, CLIP_IDS, base.clip),
    assembly: sanitizeAssembly(raw.assembly, base.assembly),
    material: pick(raw.material, MATERIALS, base.material),
    infill: num(raw.infill, LIMITS.infill, base.infill),
    hardwareMass: num(raw.hardwareMass, LIMITS.hardwareMass, base.hardwareMass),
    ballastDensity: num(raw.ballastDensity, LIMITS.ballastDensity, base.ballastDensity),
    ballasts: sanitizeBallasts(raw.ballasts, base.ballasts),
    paint: {
      dorsal: color(paint.dorsal, base.paint.dorsal),
      flank: color(paint.flank, base.paint.flank),
      belly: color(paint.belly, base.paint.belly),
      head: color(paint.head, base.paint.head),
      tail: color(paint.tail, base.paint.tail),
      headLength: num(paint.headLength, LIMITS.zoneLength, base.paint.headLength),
      tailLength: num(paint.tailLength, LIMITS.zoneLength, base.paint.tailLength),
      blend: num(paint.blend, LIMITS.paintBlend, base.paint.blend),
      eyeColor: color(paint.eyeColor, base.paint.eyeColor),
      pattern: pick(paint.pattern, PATTERNS, base.paint.pattern),
      patternColor: color(paint.patternColor, base.paint.patternColor),
      patternScale: num(paint.patternScale, LIMITS.patternScale, base.paint.patternScale),
      finish: pick(paint.finish, FINISHES, base.paint.finish),
    },
  };
}

/** Bibliotheque de livrees embarquee dans un projet importe. */
export function sanitizePalettes(value: unknown): SavedPalette[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).map((raw, index) => {
    const item = (raw ?? {}) as Partial<SavedPalette>;
    const params = sanitizeParams({ paint: item.paint });
    return {
      id:
        typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 64
          ? item.id
          : `palette-${index}-${Math.random().toString(36).slice(2, 8)}`,
      name: sanitizeName(item.name, `Livree ${index + 1}`),
      paint: params.paint,
    };
  });
}

/** Nom de projet nettoye (jamais vide, jamais demesure). */
export const sanitizeName = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().slice(0, 60);
  return trimmed.length > 0 ? trimmed : fallback;
};
