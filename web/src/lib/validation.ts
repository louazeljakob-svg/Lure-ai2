/**
 * Validation des projets reimportes.
 *
 * Un fichier JSON depose par l'utilisateur est une entree non fiable : chaque
 * champ est verifie et ramene dans ses bornes avant d'atteindre le
 * generateur de geometrie, ce qui evite tout NaN ou valeur absurde.
 */

import type {
  ArticulationConfig,
  AssemblyConfig,
  BallastShape,
  BallastWeight,
  BillMode,
  BillProfile,
  FabricationConfig,
  PinAnchor,
  SculptPoint,
  ClipId,
  Decal,
  DowelConfig,
  DowelPin,
  DecalStyle,
  DetailConfig,
  EyeStyle,
  PinId,
  SocketMethod,
  FinishId,
  FinishStyle,
  Inlay,
  LiveryConfig,
  InsertConfig,
  InsertForm,
  PopperFaceConfig,
  RibConfig,
  SoftTailConfig,
  SoftTailMount,
  RibProfile,
  ShellConfig,
  TackleFamily,
  TackleItem,
  TackleMount,
  TackleSource,
  ThroughWireConfig,
  WireMaterialId,
  InlayShape,
  JointHardware,
  LureParams,
  MaterialId,
  Outline,
  OutlineNode,
  OutlineReference,
  PatternId,
  PinExit,
  PreviewQuality,
  PrintConfig,
  ProcessId,
  RattleChamber,
  RattlePocket,
  SavedPalette,
  ScaleFit,
  ScaleShape,
  ScalesConfig,
  ShapeId,
  TailShape,
} from '../types/lure';
import { clonePreset, emptyReference, LIMITS, type Range } from './presets';
import { THROUGH_WIRE_LIMITS } from './throughWire';

const DECAL_STYLES: DecalStyle[] = ['raised', 'engraved'];
const SCALE_FITS: ScaleFit[] = ['wrapped', 'lateral'];
const SCALE_SHAPES: ScaleShape[] = ['diamond', 'hex', 'scallop'];
const JOINT_HARDWARE: JointHardware[] = ['pin', 'twisted'];
const PROCESSES: ProcessId[] = ['fdm', 'resin', 'wood'];
const INLAY_SHAPES: InlayShape[] = ['custom', 'oval', 'teardrop', 'band', 'flank'];
const FINISH_STYLES: FinishStyle[] = ['smooth', 'faceted'];
const PREVIEWS: PreviewQuality[] = ['low', 'medium', 'high'];

const SHAPES: ShapeId[] = [
  'stickbait165',
  'ryoshi',
  'model25',
  'popper',
  'crankbait',
  'jerkbait',
  'spoon',
  'swimbait',
  'topwater',
  'vibetraine',
  'minnowtraine',
  'chugger',
  'lipless',
  'minnownervure',
];
const TAILS: TailShape[] = ['taper', 'round', 'forked', 'paddle', 'fan'];
const MATERIALS: MaterialId[] = [
  'pla',
  'lwpla',
  'petg',
  'abs',
  'resin',
  'tpu',
  'basswood',
  'cedar',
];
const FINISHES: FinishId[] = ['matte', 'satin', 'gloss', 'chrome', 'holo'];
const PATTERNS: PatternId[] = ['none', 'stripes', 'dots', 'scales', 'camo', 'gradient'];
const CLIP_IDS: ClipId[] = ['none', 'small', 'medium'];
const PIN_IDS: (PinId | 'auto')[] = ['auto', 'xs06', 'xs10', 's', 'm', 'l'];
const SOCKETS: SocketMethod[] = ['bore', 'channel'];
const BILL_MODES: BillMode[] = ['printed', 'polycarbonate'];
const EYE_STYLES: EyeStyle[] = ['realistic', 'globular', 'holographic', 'custom'];
const BALLAST_SHAPES: BallastShape[] = ['sphere', 'cylinder'];
const BILL_PROFILES: BillProfile[] = ['rounded', 'rect', 'diamond'];
const EXITS: PinExit[] = ['nose', 'belly', 'tail', 'back'];

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

function sanitizeAnchors(value: unknown, fallback: PinAnchor[]): PinAnchor[] {
  if (!Array.isArray(value)) return fallback.map((anchor) => ({ ...anchor }));
  return value.slice(0, 12).map((raw, index) => {
    const item = (raw ?? {}) as Partial<PinAnchor>;
    return {
      id:
        typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 64
          ? item.id
          : `ancrage-${index}-${Math.random().toString(36).slice(2, 8)}`,
      position: num(item.position, LIMITS.anchorPosition, 0.5),
      height: num(item.height, LIMITS.anchorHeight, 0),
      exit: pick(item.exit, EXITS, 'belly'),
      depth: num(item.depth, LIMITS.anchorDepth, 0),
      pin: pick(item.pin, PIN_IDS, 'auto'),
      method: pick(item.method, SOCKETS, 'bore'),
    };
  });
}

function sanitizeAssembly(value: unknown, fallback: AssemblyConfig): AssemblyConfig {
  const raw = (value ?? {}) as Partial<AssemblyConfig>;
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    planeAngle: num(raw.planeAngle, LIMITS.planeAngle, fallback.planeAngle),
    socketMethod: pick(raw.socketMethod, SOCKETS, fallback.socketMethod),
    pin: pick(raw.pin, PIN_IDS, fallback.pin),
    roughWater: bool(raw.roughWater, fallback.roughWater),
    anchors: sanitizeAnchors(raw.anchors, fallback.anchors),
  };
}

function sanitizeFabrication(
  value: unknown,
  fallback: FabricationConfig,
): FabricationConfig {
  const raw = (value ?? {}) as Partial<FabricationConfig>;
  return {
    boreClearance: num(raw.boreClearance, LIMITS.boreClearance, fallback.boreClearance),
    channelOffset: num(raw.channelOffset, LIMITS.channelOffset, fallback.channelOffset),
    sweepExtra: num(raw.sweepExtra, LIMITS.sweepExtra, fallback.sweepExtra),
    tenonFit: num(raw.tenonFit, LIMITS.tenonFit, fallback.tenonFit),
    billFit: num(raw.billFit, LIMITS.billFit, fallback.billFit),
    rattleFit: num(raw.rattleFit, LIMITS.rattleFit, fallback.rattleFit),
  };
}

function sanitizeRattles(value: unknown, fallback: RattlePocket[]): RattlePocket[] {
  if (!Array.isArray(value)) return fallback.map((item) => ({ ...item }));
  return value.slice(0, 10).map((raw, index) => {
    const item = (raw ?? {}) as Partial<RattlePocket>;
    return {
      id:
        typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 64
          ? item.id
          : `bille-${index}-${Math.random().toString(36).slice(2, 8)}`,
      position: num(item.position, LIMITS.ballastPosition, 0.55),
      height: num(item.height, LIMITS.ballastHeight, -0.2),
      ball: num(item.ball, LIMITS.rattleBall, 6),
    };
  });
}

function sanitizeChamber(value: unknown, fallback: RattleChamber): RattleChamber {
  const raw = (value ?? {}) as Partial<RattleChamber>;
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    diameter: num(raw.diameter, LIMITS.chamberDiameter, fallback.diameter),
    fromPosition: num(raw.fromPosition, LIMITS.ballastPosition, fallback.fromPosition),
    fromHeight: num(raw.fromHeight, LIMITS.ballastHeight, fallback.fromHeight),
    toPosition: num(raw.toPosition, LIMITS.ballastPosition, fallback.toPosition),
    toHeight: num(raw.toHeight, LIMITS.ballastHeight, fallback.toHeight),
    ball: num(raw.ball, LIMITS.rattleBall, fallback.ball),
    balls: Math.round(num(raw.balls, LIMITS.chamberBalls, fallback.balls)),
  };
}

function sanitizeSculpt(value: unknown, fallback: SculptPoint[]): SculptPoint[] {
  if (!Array.isArray(value)) return fallback.map((point) => ({ ...point }));
  return value.slice(0, 120).map((raw, index) => {
    const item = (raw ?? {}) as Partial<SculptPoint>;
    return {
      id:
        typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 64
          ? item.id
          : `cage-${index}`,
      position: num(item.position, LIMITS.anchorPosition, 0.5),
      angle: num(item.angle, { min: 0, max: 360, step: 1 }, 0),
      amount: num(item.amount, LIMITS.sculptAmount, 0),
      radius: num(item.radius, LIMITS.sculptRadius, 0.12),
    };
  });
}

/**
 * Une data URL d'image, ou rien.
 *
 * On refuse tout ce qui n'est pas une image en base64 : un projet est un
 * fichier qui circule, et rien n'oblige celui qu'on ouvre a etre honnete.
 */
const dataUrl = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) return '';
  // Huit mega-octets de base64 : au-dela, c'est le navigateur qui souffre.
  return value.length <= 8_000_000 ? value : '';
};

const FREE = { min: -1e4, max: 1e4, step: 0.0001 } as const;

function sanitizeOutline(value: unknown, fallback: Outline): Outline {
  const raw = (value ?? {}) as Partial<Outline>;
  if (!Array.isArray(raw.nodes)) return { ...fallback, nodes: fallback.nodes.map((n) => ({ ...n })) };
  return {
    nodes: raw.nodes.slice(0, 400).map((item, index) => {
      const node = (item ?? {}) as Partial<OutlineNode>;
      return {
        id:
          typeof node.id === 'string' && node.id.length > 0 && node.id.length <= 64
            ? node.id
            : `n${index}-${Math.random().toString(36).slice(2, 8)}`,
        x: num(node.x, FREE, 0),
        y: num(node.y, FREE, 0),
        inX: num(node.inX, FREE, 0),
        inY: num(node.inY, FREE, 0),
        outX: num(node.outX, FREE, 0),
        outY: num(node.outY, FREE, 0),
      };
    }),
    closed: bool(raw.closed, fallback.closed),
    mirror: bool(raw.mirror, fallback.mirror),
  };
}

function sanitizeReference(value: unknown, fallback: OutlineReference): OutlineReference {
  const raw = (value ?? {}) as Partial<OutlineReference>;
  return {
    src: dataUrl(raw.src),
    opacity: num(raw.opacity, LIMITS.decalOpacity, fallback.opacity),
    x: num(raw.x, FREE, fallback.x),
    y: num(raw.y, FREE, fallback.y),
    scale: num(raw.scale, { min: 0.02, max: 40, step: 0.001 }, fallback.scale),
    visible: bool(raw.visible, fallback.visible),
    locked: bool(raw.locked, fallback.locked),
  };
}

function sanitizeDecals(value: unknown, fallback: Decal[]): Decal[] {
  if (!Array.isArray(value)) return fallback.map((decal) => ({ ...decal }));
  return value.slice(0, 24).map((raw, index) => {
    const item = (raw ?? {}) as Partial<Decal>;
    return {
      id:
        typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 64
          ? item.id
          : `decal-${index}-${Math.random().toString(36).slice(2, 8)}`,
      name: sanitizeName(item.name, index === 0 ? 'Decal' : `Decal ${index + 1}`),
      visible: bool(item.visible, true),
      outline: sanitizeOutline(item.outline, { nodes: [], closed: true, mirror: false }),
      reference: sanitizeReference(item.reference, emptyReference()),
      style: pick(item.style, DECAL_STYLES, 'engraved'),
      depth: num(item.depth, LIMITS.decalDepth, 0.4),
      softness: num(item.softness, LIMITS.decalSoftness, 30),
      mirror: bool(item.mirror, true),
      previewOpacity: num(item.previewOpacity, LIMITS.decalOpacity, 100),
      position: num(item.position, LIMITS.decalPosition, 0.35),
      height: num(item.height, LIMITS.decalHeight, 0),
      rotation: num(item.rotation, LIMITS.decalRotation, 0),
      size: num(item.size, LIMITS.decalSize, 12),
    };
  });
}

function sanitizeScales(value: unknown, fallback: ScalesConfig): ScalesConfig {
  const raw = (value ?? {}) as Partial<ScalesConfig>;
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    baked: bool(raw.baked, fallback.baked),
    fit: pick(raw.fit, SCALE_FITS, fallback.fit),
    shape: pick(raw.shape, SCALE_SHAPES, fallback.shape),
    width: num(raw.width, LIMITS.scaleWidth, fallback.width),
    height: num(raw.height, LIMITS.scaleHeight, fallback.height),
    spacing: num(raw.spacing, LIMITS.scaleSpacing, fallback.spacing),
    depth: num(raw.depth, LIMITS.scaleDepth, fallback.depth),
    rounding: num(raw.rounding, LIMITS.scaleRounding, fallback.rounding),
    style: pick(raw.style, DECAL_STYLES, fallback.style),
    marginTop: num(raw.marginTop, LIMITS.scaleMargin, fallback.marginTop),
    marginBottom: num(raw.marginBottom, LIMITS.scaleMargin, fallback.marginBottom),
  };
}

function sanitizeArticulation(
  value: unknown,
  fallback: ArticulationConfig,
): ArticulationConfig {
  const raw = (value ?? {}) as Partial<ArticulationConfig>;
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    hardware: pick(raw.hardware, JOINT_HARDWARE, fallback.hardware),
    eyeCount: Math.round(num(raw.eyeCount, LIMITS.eyeCount, fallback.eyeCount)),
    segments: Math.round(num(raw.segments, LIMITS.segments, fallback.segments)),
    positionMm: num(raw.positionMm, { min: 0, max: 260, step: 0.1 }, fallback.positionMm),
    swing: num(raw.swing, LIMITS.jointSwing, fallback.swing),
    faceAngle: num(raw.faceAngle, LIMITS.jointFaceAngle, fallback.faceAngle),
    clearance: num(raw.clearance, LIMITS.jointClearance, fallback.clearance),
    eyeMass: num(raw.eyeMass, LIMITS.jointMass, fallback.eyeMass),
    pinMass: num(raw.pinMass, LIMITS.jointMass, fallback.pinMass),
    showHardware: bool(raw.showHardware, fallback.showHardware),
    eyeLoop: num(raw.eyeLoop, LIMITS.eyeLoop, fallback.eyeLoop),
    eyeWire: num(raw.eyeWire, LIMITS.eyeWire, fallback.eyeWire),
    eyeLength: num(raw.eyeLength, LIMITS.eyeLength, fallback.eyeLength),
    slotHeight: num(raw.slotHeight, LIMITS.slotHeight, fallback.slotHeight),
    slotDepth: num(raw.slotDepth, LIMITS.slotDepth, fallback.slotDepth),
    slotWidth: num(raw.slotWidth, LIMITS.slotWidth, fallback.slotWidth),
    jointFit: num(raw.jointFit, LIMITS.jointFit, fallback.jointFit),
  };
}

function sanitizeInlays(value: unknown, fallback: Inlay[]): Inlay[] {
  if (!Array.isArray(value)) return fallback.map((item) => ({ ...item }));
  return value.slice(0, 12).map((raw, index) => {
    const item = (raw ?? {}) as Partial<Inlay>;
    return {
      id:
        typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 64
          ? item.id
          : `rainure-${index}-${Math.random().toString(36).slice(2, 8)}`,
      name: sanitizeName(item.name, index === 0 ? 'Rainure de collant' : `Rainure ${index + 1}`),
      visible: bool(item.visible, true),
      shape: pick(item.shape, INLAY_SHAPES, 'oval'),
      outline: sanitizeOutline(item.outline, { nodes: [], closed: true, mirror: false }),
      reference: sanitizeReference(item.reference, emptyReference()),
      depth: num(item.depth, LIMITS.inlayDepth, 0.25),
      margin: num(item.margin, LIMITS.inlayMargin, 0.2),
      cornerRadius: num(item.cornerRadius, LIMITS.inlayCorner, 1.5),
      mirror: bool(item.mirror, true),
      position: num(item.position, LIMITS.decalPosition, 0.42),
      height: num(item.height, LIMITS.decalHeight, 0.1),
      rotation: num(item.rotation, LIMITS.decalRotation, 0),
      size: num(item.size, LIMITS.decalSize, 24),
    };
  });
}

function sanitizeDowels(value: unknown, fallback: DowelConfig): DowelConfig {
  const raw = (value ?? {}) as Partial<DowelConfig>;
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    diameter: num(raw.diameter, LIMITS.dowelDiameter, fallback.diameter),
    engagement: num(raw.engagement, LIMITS.dowelEngagement, fallback.engagement),
    clearance: num(raw.clearance, LIMITS.dowelClearance, fallback.clearance),
    chamfer: num(raw.chamfer, LIMITS.dowelChamfer, fallback.chamfer),
    count: Math.round(num(raw.count, LIMITS.dowelCount, fallback.count)),
    pins: Array.isArray(raw.pins)
      ? raw.pins.slice(0, 6).map((item, index) => {
          const pin = (item ?? {}) as Partial<DowelPin>;
          return {
            id:
              typeof pin.id === 'string' && pin.id.length > 0 && pin.id.length <= 64
                ? pin.id
                : `goupille-${index}`,
            position: num(pin.position, LIMITS.anchorPosition, 0.5),
            height: num(pin.height, LIMITS.anchorHeight, 0),
          };
        })
      : fallback.pins.map((pin) => ({ ...pin })),
  };
}

function sanitizePrint(value: unknown, fallback: PrintConfig): PrintConfig {
  const raw = (value ?? {}) as Partial<PrintConfig>;
  return {
    process: pick(raw.process, PROCESSES, fallback.process),
    perimeters: Math.round(num(raw.perimeters, LIMITS.perimeters, fallback.perimeters)),
    layerHeight: num(raw.layerHeight, LIMITS.layerHeight, fallback.layerHeight),
    socketTolerance: num(raw.socketTolerance, LIMITS.socketTolerance, fallback.socketTolerance),
    shrinkage: num(raw.shrinkage, LIMITS.shrinkage, fallback.shrinkage),
    finish: pick(raw.finish, FINISH_STYLES, fallback.finish),
    preview: pick(raw.preview, PREVIEWS, fallback.preview),
  };
}


/**
 * Livree : un projet enregistre avant le module L n'en a pas. On retombe donc
 * sur celle du preset plutot que d'echouer — un ancien fichier doit toujours
 * s'ouvrir.
 */
function sanitizeLivery(value: unknown, fallback: LiveryConfig): LiveryConfig {
  const raw = (value ?? {}) as Partial<LiveryConfig>;
  const bars = (raw.bars ?? {}) as Partial<LiveryConfig['bars']>;
  const iris = (raw.iris ?? {}) as Partial<LiveryConfig['iris']>;
  const varnish = (raw.varnish ?? {}) as Partial<LiveryConfig['varnish']>;
  const lateral = (raw.lateral ?? {}) as Partial<LiveryConfig['lateral']>;
  const gill = (raw.gillPlate ?? {}) as Partial<LiveryConfig['gillPlate']>;
  const micro = (raw.microScales ?? {}) as Partial<LiveryConfig['microScales']>;
  const unit = { min: 0, max: 1, step: 0.01 };
  return {
    bars: {
      enabled: bool(bars.enabled, fallback.bars.enabled),
      count: Math.round(num(bars.count, { min: 2, max: 20, step: 1 }, fallback.bars.count)),
      width: num(bars.width, { min: 0.05, max: 0.9, step: 0.01 }, fallback.bars.width),
      blur: num(bars.blur, unit, fallback.bars.blur),
      color: color(bars.color, fallback.bars.color),
      opacity: num(bars.opacity, unit, fallback.bars.opacity),
    },
    iris: {
      strength: num(iris.strength, unit, fallback.iris.strength),
      hue: color(iris.hue, fallback.iris.hue),
    },
    varnish: {
      gloss: num(varnish.gloss, unit, fallback.varnish.gloss),
      thickness: num(varnish.thickness, unit, fallback.varnish.thickness),
    },
    lateral: {
      enabled: bool(lateral.enabled, fallback.lateral.enabled),
      color: color(lateral.color, fallback.lateral.color),
      width: num(lateral.width, unit, fallback.lateral.width),
      position: num(lateral.position, { min: 0.3, max: 0.7, step: 0.01 }, fallback.lateral.position),
    },
    gillPlate: {
      enabled: bool(gill.enabled, fallback.gillPlate.enabled),
      color: color(gill.color, fallback.gillPlate.color),
      size: num(gill.size, unit, fallback.gillPlate.size),
    },
    microScales: {
      enabled: bool(micro.enabled, fallback.microScales.enabled),
      density: num(micro.density, unit, fallback.microScales.density),
      contrast: num(micro.contrast, unit, fallback.microScales.contrast),
    },
    pearl: num(raw.pearl, unit, fallback.pearl),
  };
}


/**
 * Catalogue de quincaillerie : un projet enregistre avant le module Q n'en a
 * pas, et on retombe alors sur la table de depart. Une table partielle est
 * completee ligne par ligne plutot que rejetee — un fichier bricole a la main
 * doit s'ouvrir.
 */
function sanitizeCatalogue(value: unknown, fallback: TackleItem[]): TackleItem[] {
  if (!Array.isArray(value) || value.length === 0) return fallback;
  const families: TackleFamily[] = ['treble', 'inline', 'assist', 'split', 'solid', 'swivel'];
  const sources: TackleSource[] = ['indicatif', 'verifie'];
  const positive = { min: 0, max: 1000, step: 0.001 };
  return value.slice(0, 600).map((raw, index) => {
    const item = (raw ?? {}) as Partial<TackleItem>;
    return {
      id: typeof item.id === 'string' && item.id ? item.id : `tackle-${index}`,
      family: pick(item.family, families, 'treble'),
      series: typeof item.series === 'string' ? item.series.slice(0, 80) : 'Import',
      size: typeof item.size === 'string' ? item.size.slice(0, 16) : '#1',
      wireMm: num(item.wireMm, { min: 0.1, max: 8, step: 0.01 }, 1),
      massG: num(item.massG, positive, 1),
      strengthKg: num(item.strengthKg, { min: 0, max: 400, step: 0.1 }, 0),
      spanMm: num(item.spanMm, { min: 0, max: 200, step: 0.1 }, 0),
      source: pick(item.source, sources, 'indicatif'),
      note: typeof item.note === 'string' ? item.note.slice(0, 240) : '',
    };
  });
}

/** Supports d'hamecon : sans eux le leurre n'a simplement aucun montage. */
function sanitizeMounts(value: unknown, fallback: TackleMount[]): TackleMount[] {
  if (!Array.isArray(value)) return fallback;
  return value.slice(0, 8).map((raw, index) => {
    const mount = (raw ?? {}) as Partial<TackleMount>;
    return {
      id: typeof mount.id === 'string' && mount.id ? mount.id : `mount-${index}`,
      label: typeof mount.label === 'string' ? mount.label.slice(0, 60) : `Support ${index + 1}`,
      anchorId: typeof mount.anchorId === 'string' ? mount.anchorId : null,
      position: num(mount.position, { min: 0, max: 1, step: 0.01 }, 0.5),
      height: num(mount.height, { min: -1, max: 1, step: 0.05 }, -1),
      ringId: typeof mount.ringId === 'string' ? mount.ringId : null,
      hookId: typeof mount.hookId === 'string' ? mount.hookId : null,
      visible: bool(mount.visible, true),
    };
  });
}


/** Montage traversant : absent d'un projet anterieur au module P. */
function sanitizeThroughWire(value: unknown, fallback: ThroughWireConfig): ThroughWireConfig {
  const raw = (value ?? {}) as Partial<ThroughWireConfig>;
  const materials: WireMaterialId[] = ['inox304', 'inox316', 'ressort', 'laiton'];
  const positions = Array.isArray(raw.bellyPositions)
    ? raw.bellyPositions
        .slice(0, 3)
        .map((p) => num(p, { min: 0.12, max: 0.9, step: 0.01 }, 0.42))
    : fallback.bellyPositions;
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    wireMm: num(raw.wireMm, THROUGH_WIRE_LIMITS.wireMm, fallback.wireMm),
    material: pick(raw.material, materials, fallback.material),
    loopMm: num(raw.loopMm, THROUGH_WIRE_LIMITS.loopMm, fallback.loopMm),
    clearanceMm: num(raw.clearanceMm, THROUGH_WIRE_LIMITS.clearanceMm, fallback.clearanceMm),
    bellyExits: Math.round(num(raw.bellyExits, THROUGH_WIRE_LIMITS.bellyExits, fallback.bellyExits)),
    bellyPositions: positions.length ? positions : fallback.bellyPositions,
  };
}


/** Nervures transversales : absentes d'un projet anterieur au module O. */
function sanitizeRibs(value: unknown, fallback: RibConfig): RibConfig {
  const raw = (value ?? {}) as Partial<RibConfig>;
  const profiles: RibProfile[] = ['round', 'triangle', 'square'];
  const from = num(raw.from, LIMITS.ribZone, fallback.from);
  const to = num(raw.to, LIMITS.ribZone, fallback.to);
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    pitch: num(raw.pitch, LIMITS.ribPitch, fallback.pitch),
    height: num(raw.height, LIMITS.ribHeight, fallback.height),
    profile: pick(raw.profile, profiles, fallback.profile),
    // Une zone inversee ne veut rien dire : on la remet a l'endroit plutot
    // que de generer une bande vide sans le dire.
    from: Math.min(from, to),
    to: Math.max(from, to),
    slant: num(raw.slant, LIMITS.ribSlant, fallback.slant),
  };
}


/** Face de popper : absente d'un projet anterieur au module O. */
function sanitizePopperFace(value: unknown, fallback: PopperFaceConfig): PopperFaceConfig {
  const raw = (value ?? {}) as Partial<PopperFaceConfig>;
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    diameter: num(raw.diameter, LIMITS.popperDiameter, fallback.diameter),
    depth: num(raw.depth, LIMITS.popperDepth, fallback.depth),
    angle: num(raw.angle, LIMITS.popperAngle, fallback.angle),
    lipRadius: num(raw.lipRadius, LIMITS.popperLip, fallback.lipRadius),
    offset: num(raw.offset, LIMITS.popperOffset, fallback.offset),
  };
}

/** Queue souple : absente d'un projet anterieur au module O. */
function sanitizeSoftTail(value: unknown, fallback: SoftTailConfig): SoftTailConfig {
  const raw = (value ?? {}) as Partial<SoftTailConfig>;
  const methods: SoftTailMount[] = ['slot', 'tenon'];
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    length: num(raw.length, LIMITS.softTailLength, fallback.length),
    height: num(raw.height, LIMITS.softTailHeight, fallback.height),
    baseThickness: num(raw.baseThickness, LIMITS.softTailBase, fallback.baseThickness),
    tipThickness: num(raw.tipThickness, LIMITS.softTailTip, fallback.tipThickness),
    spread: num(raw.spread, LIMITS.softTailSpread, fallback.spread),
    method: pick(raw.method, methods, fallback.method),
    insertion: num(raw.insertion, LIMITS.softTailInsertion, fallback.insertion),
    clearance: num(raw.clearance, LIMITS.softTailClearance, fallback.clearance),
    material: pick(raw.material, MATERIALS, fallback.material),
  };
}

/** Coque a paroi mince et insert : absents d'un projet anterieur au module O. */
function sanitizeShell(value: unknown, fallback: ShellConfig): ShellConfig {
  const raw = (value ?? {}) as Partial<ShellConfig>;
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    wallMm: num(raw.wallMm, LIMITS.shellWall, fallback.wallMm),
    transparency: num(raw.transparency, { min: 0, max: 1, step: 0.01 }, fallback.transparency),
  };
}

function sanitizeInsert(value: unknown, fallback: InsertConfig): InsertConfig {
  const raw = (value ?? {}) as Partial<InsertConfig>;
  const forms: InsertForm[] = ['plate', 'curved', 'volume'];
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    form: pick(raw.form, forms, fallback.form),
    length: num(raw.length, LIMITS.insertLength, fallback.length),
    height: num(raw.height, LIMITS.insertHeight, fallback.height),
    thickness: num(raw.thickness, LIMITS.insertThickness, fallback.thickness),
    position: num(raw.position, LIMITS.insertPosition, fallback.position),
    offset: num(raw.offset, LIMITS.insertOffset, fallback.offset),
    rotation: num(raw.rotation, LIMITS.insertRotation, fallback.rotation),
    clearance: num(raw.clearance, LIMITS.insertClearance, fallback.clearance),
    material: pick(raw.material, MATERIALS, fallback.material),
  };
}

/** Ramene n'importe quelle entree a un jeu de parametres exploitable. */
export function sanitizeParams(input: unknown): LureParams {
  const raw = (input ?? {}) as Partial<LureParams>;
  // Les gabarits Irresistible et Minnow ont ete retires de la bibliotheque :
  // un projet qui les reference retombe sur la premiere forme disponible.
  const shape = pick(raw.shape, SHAPES, SHAPES[0]);
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
    noseAngle: num(raw.noseAngle, LIMITS.noseAngle, base.noseAngle),
    tailTaper: num(raw.tailTaper, LIMITS.tailTaper, base.tailTaper),
    crossSection: num(raw.crossSection, LIMITS.crossSection, base.crossSection),
    mouthCup: num(raw.mouthCup, LIMITS.mouthCup, base.mouthCup),
    hasBib: bool(raw.hasBib, base.hasBib),
    billMode: pick(raw.billMode, BILL_MODES, base.billMode),
    billThickness: num(raw.billThickness, LIMITS.billThickness, base.billThickness),
    billUniform: bool(raw.billUniform, base.billUniform),
    billOffset: num(raw.billOffset, LIMITS.billOffset, base.billOffset),
    billFillet: num(raw.billFillet, LIMITS.billFillet, base.billFillet),
    billProfile: pick(raw.billProfile, BILL_PROFILES, base.billProfile),
    billTwist: num(raw.billTwist, LIMITS.billTwist, base.billTwist),
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
    dowels: sanitizeDowels(raw.dowels, base.dowels),
    fabrication: sanitizeFabrication(raw.fabrication, base.fabrication),
    sculpt: sanitizeSculpt(raw.sculpt, base.sculpt),
    articulation: sanitizeArticulation(raw.articulation, base.articulation),
    outline: sanitizeOutline(raw.outline, base.outline),
    outlineReference: sanitizeReference(raw.outlineReference, base.outlineReference),
    decals: sanitizeDecals(raw.decals, base.decals),
    scales: sanitizeScales(raw.scales, base.scales),
    inlays: sanitizeInlays(raw.inlays, base.inlays),
    material: pick(raw.material, MATERIALS, base.material),
    print: sanitizePrint(raw.print, base.print),
    infill: num(raw.infill, LIMITS.infill, base.infill),
    hardwareMass: num(raw.hardwareMass, LIMITS.hardwareMass, base.hardwareMass),
    ballastDensity: num(raw.ballastDensity, LIMITS.ballastDensity, base.ballastDensity),
    ballasts: sanitizeBallasts(raw.ballasts, base.ballasts),
    rattles: sanitizeRattles(raw.rattles, base.rattles),
    chamber: sanitizeChamber(raw.chamber, base.chamber),
    ribs: sanitizeRibs(raw.ribs, base.ribs),
    popperFace: sanitizePopperFace(raw.popperFace, base.popperFace),
    softTail: sanitizeSoftTail(raw.softTail, base.softTail),
    shell: sanitizeShell(raw.shell, base.shell),
    insert: sanitizeInsert(raw.insert, base.insert),
    throughWire: sanitizeThroughWire(raw.throughWire, base.throughWire),
    catalogue: sanitizeCatalogue(raw.catalogue, base.catalogue),
    mounts: sanitizeMounts(raw.mounts, base.mounts),
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
      livery: sanitizeLivery(paint.livery, base.paint.livery),
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
