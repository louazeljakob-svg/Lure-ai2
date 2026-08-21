/**
 * Peinture procedurale.
 *
 * La texture est peinte dans un <canvas> a la volee : U suit la longueur du
 * leurre (0 = nez, 1 = queue) et V fait le tour de la section (0 = dos,
 * 0.5 = ventre). Les zones dos / flanc / ventre sont donc des bandes
 * horizontales, et les motifs se superposent par-dessus.
 */

import * as THREE from 'three';
import type { PaintConfig } from '../types/lure';

const WIDTH = 1024;
const HEIGHT = 256;

const hexToRgba = (hex: string, alpha: number): string => {
  const clean = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#ffffff';
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/** Attenuation du motif vers le ventre (V = 0.5) pour garder un ventre clair. */
const fadeToBelly = (
  ctx: CanvasRenderingContext2D,
  color: string,
): CanvasGradient => {
  const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  gradient.addColorStop(0, hexToRgba(color, 0.95));
  gradient.addColorStop(0.28, hexToRgba(color, 0.75));
  gradient.addColorStop(0.46, hexToRgba(color, 0));
  gradient.addColorStop(0.54, hexToRgba(color, 0));
  gradient.addColorStop(0.72, hexToRgba(color, 0.75));
  gradient.addColorStop(1, hexToRgba(color, 0.95));
  return gradient;
};

function paintStripes(ctx: CanvasRenderingContext2D, paint: PaintConfig): void {
  const count = Math.round(Math.min(Math.max(paint.patternScale, 3), 26));
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
  const scale = Math.min(Math.max(paint.patternScale, 3), 26);
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
      const y = row * sy + sy * 0.5;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function paintGradient(ctx: CanvasRenderingContext2D, paint: PaintConfig): void {
  // Degrade longitudinal : tete coloree qui se fond dans le corps.
  const reach = 0.18 + (paint.patternScale / 26) * 0.42;
  const gradient = ctx.createLinearGradient(0, 0, WIDTH * reach, 0);
  gradient.addColorStop(0, hexToRgba(paint.patternColor, 1));
  gradient.addColorStop(0.55, hexToRgba(paint.patternColor, 0.85));
  gradient.addColorStop(1, hexToRgba(paint.patternColor, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH * reach, HEIGHT);
}

export function createPaintTexture(paint: PaintConfig): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    const base = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    base.addColorStop(0, paint.dorsal);
    base.addColorStop(0.16, paint.dorsal);
    base.addColorStop(0.32, paint.flank);
    base.addColorStop(0.46, paint.belly);
    base.addColorStop(0.54, paint.belly);
    base.addColorStop(0.68, paint.flank);
    base.addColorStop(0.84, paint.dorsal);
    base.addColorStop(1, paint.dorsal);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    if (paint.pattern === 'stripes') paintStripes(ctx, paint);
    else if (paint.pattern === 'dots') paintDots(ctx, paint);
    else if (paint.pattern === 'gradient') paintGradient(ctx, paint);
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
