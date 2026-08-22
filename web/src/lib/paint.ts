/**
 * Peinture procedurale.
 *
 * La texture est peinte dans un <canvas> a la volee : U suit la longueur du
 * leurre (0 = nez, 1 = queue) et V fait le tour de la section (0 = dos,
 * 0.5 = ventre). Les zones dos / flancs / ventre sont donc des bandes
 * horizontales, la tete et la queue des bandes verticales, et les motifs se
 * superposent par-dessus.
 */

import * as THREE from 'three';
import type { LureParams, PaintConfig } from '../types/lure';
import { clamp, createProfile } from './profile';

const WIDTH = 1024;
const HEIGHT = 256;

/** Angle de l'oeil depuis le dos, en radians (identique a la geometrie). */
const EYE_ANGLE = 1.15;

const hexToRgba = (hex: string, alpha: number): string => {
  const clean = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#ffffff';
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/** Generateur pseudo-aleatoire deterministe : le camouflage ne scintille pas. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Attenuation du motif vers le ventre (V = 0.5) pour garder un ventre clair. */
const fadeToBelly = (ctx: CanvasRenderingContext2D, color: string): CanvasGradient => {
  const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  gradient.addColorStop(0, hexToRgba(color, 0.95));
  gradient.addColorStop(0.28, hexToRgba(color, 0.75));
  gradient.addColorStop(0.46, hexToRgba(color, 0));
  gradient.addColorStop(0.54, hexToRgba(color, 0));
  gradient.addColorStop(0.72, hexToRgba(color, 0.75));
  gradient.addColorStop(1, hexToRgba(color, 0.95));
  return gradient;
};

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

/**
 * Degrade vertical dos / flancs / ventre. `blend` elargit les transitions :
 * a 0 les zones sont franches, a 1 elles se fondent l'une dans l'autre.
 */
function paintZones(ctx: CanvasRenderingContext2D, paint: PaintConfig): void {
  const w = 0.015 + clamp(paint.blend, 0, 1) * 0.085;
  const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  const stops: [number, string][] = [
    [0, paint.dorsal],
    [0.18 - w, paint.dorsal],
    [0.18 + w, paint.flank],
    [0.4 - w, paint.flank],
    [0.4 + w, paint.belly],
    [0.6 - w, paint.belly],
    [0.6 + w, paint.flank],
    [0.82 - w, paint.flank],
    [0.82 + w, paint.dorsal],
    [1, paint.dorsal],
  ];
  for (const [offset, color] of stops) gradient.addColorStop(clamp(offset, 0, 1), color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

/** Zone longitudinale (tete depuis le nez, queue depuis l'arriere). */
function paintEndZone(
  ctx: CanvasRenderingContext2D,
  color: string,
  length: number,
  blend: number,
  fromTail: boolean,
): void {
  if (length <= 0.005) return;
  const span = WIDTH * length;
  const fade = 0.1 + clamp(blend, 0, 1) * 0.55;
  const x0 = fromTail ? WIDTH : 0;
  const x1 = fromTail ? WIDTH - span : span;
  const gradient = ctx.createLinearGradient(x0, 0, x1, 0);
  gradient.addColorStop(0, hexToRgba(color, 1));
  gradient.addColorStop(1 - fade, hexToRgba(color, 1));
  gradient.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(Math.min(x0, x1), 0, span, HEIGHT);
}

// ---------------------------------------------------------------------------
// Motifs
// ---------------------------------------------------------------------------

function paintStripes(ctx: CanvasRenderingContext2D, paint: PaintConfig): void {
  const count = Math.round(clamp(paint.patternScale, 3, 26));
  const spacing = WIDTH / count;
  const width = spacing * 0.34;
  const slant = spacing * 0.22;
  ctx.fillStyle = fadeToBelly(ctx, paint.patternColor);
  for (let i = 0; i < count; i++) {
    const x = i * spacing + spacing * 0.2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + width, 0);
    ctx.lineTo(x + width + slant, HEIGHT);
    ctx.lineTo(x + slant, HEIGHT);
    ctx.closePath();
    ctx.fill();
  }
}

function paintDots(ctx: CanvasRenderingContext2D, paint: PaintConfig): void {
  const scale = clamp(paint.patternScale, 3, 26);
  const cols = Math.round(scale * 1.6);
  // Nombre de rangees pair : le motif reste continu a la couture V = 0 / 1.
  const rows = Math.max(4, Math.round(scale * 0.6) * 2);
  const sx = WIDTH / cols;
  const sy = HEIGHT / rows;
  const radius = Math.min(sx, sy) * 0.24;
  ctx.fillStyle = fadeToBelly(ctx, paint.patternColor);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * sx + (row % 2 ? sx * 0.5 : 0) + sx * 0.5;
      ctx.beginPath();
      ctx.arc(x, row * sy + sy * 0.5, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Ecailles : rangees d'arcs decales d'une demi-maille, comme un vrai poisson. */
function paintScales(ctx: CanvasRenderingContext2D, paint: PaintConfig): void {
  const scale = clamp(paint.patternScale, 3, 26);
  const cols = Math.round(scale * 1.5);
  const rows = Math.max(6, Math.round(scale * 0.8) * 2);
  const sx = WIDTH / cols;
  const sy = HEIGHT / rows;
  const radius = Math.max(sx, sy) * 0.62;
  ctx.strokeStyle = fadeToBelly(ctx, paint.patternColor);
  ctx.lineWidth = Math.max(1.2, radius * 0.11);
  for (let row = 0; row <= rows; row++) {
    for (let col = -1; col <= cols; col++) {
      const x = col * sx + (row % 2 ? sx * 0.5 : 0);
      ctx.beginPath();
      ctx.arc(x, row * sy - radius * 0.45, radius, Math.PI * 0.22, Math.PI * 0.78);
      ctx.stroke();
    }
  }
}

/** Camouflage : taches irregulieres, deterministes pour un rendu stable. */
function paintCamo(ctx: CanvasRenderingContext2D, paint: PaintConfig): void {
  const scale = clamp(paint.patternScale, 3, 26);
  const blobs = Math.round(scale * 3.5);
  const random = seededRandom(Math.round(scale * 977) + 1);
  ctx.fillStyle = fadeToBelly(ctx, paint.patternColor);
  for (let i = 0; i < blobs; i++) {
    const cx = random() * WIDTH;
    // Concentre les taches sur le dos et les flancs.
    const cy = (random() < 0.5 ? random() * 0.34 : 0.66 + random() * 0.34) * HEIGHT;
    const rx = (0.4 + random() * 1.1) * (WIDTH / scale) * 0.5;
    const ry = (0.4 + random() * 1.0) * (HEIGHT / scale) * 0.9;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((random() - 0.5) * 0.9);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function paintGradient(ctx: CanvasRenderingContext2D, paint: PaintConfig): void {
  // Degrade longitudinal : tete coloree qui se fond dans le corps.
  const reach = 0.18 + (clamp(paint.patternScale, 3, 26) / 26) * 0.42;
  const gradient = ctx.createLinearGradient(0, 0, WIDTH * reach, 0);
  gradient.addColorStop(0, hexToRgba(paint.patternColor, 1));
  gradient.addColorStop(0.55, hexToRgba(paint.patternColor, 0.85));
  gradient.addColorStop(1, hexToRgba(paint.patternColor, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH * reach, HEIGHT);
}

// ---------------------------------------------------------------------------
// Oeil peint
// ---------------------------------------------------------------------------

function paintEyes(ctx: CanvasRenderingContext2D, params: LureParams): void {
  if (params.shape === 'spoon' || !params.eyes.enabled) return;
  const profile = createProfile(params);
  const section = profile.section(params.eyes.position);
  const circumference = Math.max(
    Math.PI * (section.halfWidth + (section.top - section.bottom) / 2),
    0.1,
  );
  const radius = Math.max((params.eyes.size * 0.1) / 2, 0.05);
  // Un disque sur le corps devient une ellipse en UV : les deux axes n'ont
  // pas la meme echelle.
  const rx = (radius / profile.lengthCm) * WIDTH;
  const ry = (radius / circumference) * HEIGHT;
  const cx = params.eyes.position * WIDTH;

  for (const angle of [EYE_ANGLE, Math.PI * 2 - EYE_ANGLE]) {
    const cy = (angle / (Math.PI * 2)) * HEIGHT;
    const ring = (factor: number, color: string) => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * factor, ry * factor, 0, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    };
    ring(0.95, '#f7f4ee');

    if (params.eyeStyle === 'holographic') {
      // Pastille holo : anneaux concentriques alternes, comme un film prismatique.
      for (let i = 8; i >= 1; i--) {
        ring((i / 8) * 0.78, i % 2 === 0 ? params.paint.eyeColor : '#ffffff');
      }
    } else {
      ring(0.72, params.paint.eyeColor);
    }

    ring(0.34, '#101114');

    // Reflet : plus marque sur un oeil globuleux, qui accroche la lumiere.
    const glare = params.eyeStyle === 'globular' ? 0.2 : 0.14;
    ctx.beginPath();
    ctx.ellipse(cx - rx * 0.24, cy - ry * 0.26, rx * glare, ry * glare, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------

export function createPaintTexture(params: LureParams): THREE.CanvasTexture {
  const { paint } = params;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    paintZones(ctx, paint);
    paintEndZone(ctx, paint.head, paint.headLength, paint.blend, false);
    paintEndZone(ctx, paint.tail, paint.tailLength, paint.blend, true);

    if (paint.pattern === 'stripes') paintStripes(ctx, paint);
    else if (paint.pattern === 'dots') paintDots(ctx, paint);
    else if (paint.pattern === 'scales') paintScales(ctx, paint);
    else if (paint.pattern === 'camo') paintCamo(ctx, paint);
    else if (paint.pattern === 'gradient') paintGradient(ctx, paint);

    paintEyes(ctx, params);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Apercu CSS de la livree, utilise par les vignettes et les pastilles. */
export const paintPreviewCss = (paint: PaintConfig): string =>
  `linear-gradient(180deg, ${paint.dorsal} 0%, ${paint.flank} 55%, ${paint.belly} 100%)`;
