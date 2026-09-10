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
import type { LiveryConfig, LureParams, PaintConfig } from '../types/lure';
import { clamp, createProfile, MM_TO_CM } from './profile';
import { scaleField } from './surfaceDetail';

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
// Couches de livree — module L
// ---------------------------------------------------------------------------

/**
 * Nacre du ventre.
 *
 * Sur la reference, le ventre n'est pas blanc : il est blanc NACRE, avec un
 * voile rose tres pale qui remonte sur le bas du flanc. La transition n'est
 * jamais une ligne franche, d'ou le degrade a quatre arrets plutot qu'un
 * aplat.
 */
function paintPearl(ctx: CanvasRenderingContext2D, amount: number): void {
  if (amount <= 0.01) return;
  const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  const rose = (a: number) => `rgba(255, 226, 226, ${a * amount})`;
  gradient.addColorStop(0, rose(0));
  gradient.addColorStop(0.38, rose(0));
  gradient.addColorStop(0.46, rose(0.35));
  gradient.addColorStop(0.5, rose(0.55));
  gradient.addColorStop(0.54, rose(0.35));
  gradient.addColorStop(0.62, rose(0));
  gradient.addColorStop(1, rose(0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.restore();
}

/**
 * Barres verticales du dos.
 *
 * Le detail qui fait la difference entre un leurre peint et un leurre imprime
 * en couleur : les barres ne sont JAMAIS nettes. Elles sont larges en haut,
 * s'effilent en descendant, et leurs bords sont fondus. On les dessine donc
 * en degrade radial vertical avec un flou de bord, et on les coupe avant le
 * ventre.
 */
function paintBars(ctx: CanvasRenderingContext2D, livery: LiveryConfig): void {
  const bars = livery.bars;
  if (!bars.enabled || bars.opacity <= 0.01) return;
  const count = Math.max(Math.round(bars.count), 1);
  const spacing = WIDTH / count;
  const half = spacing * clamp(bars.width, 0.05, 0.9) * 0.5;
  const blur = clamp(bars.blur, 0, 1);

  ctx.save();
  // Le flou natif du canvas coute cher a haute resolution ; au-dela d'un
  // certain rayon on prefere l'obtenir par le degrade lui-meme.
  ctx.filter = blur > 0.02 ? `blur(${(half * blur * 0.6).toFixed(1)}px)` : 'none';

  for (let i = 0; i < count; i++) {
    const cx = spacing * (i + 0.5);
    // Le dos porte les barres a pleine force ; elles meurent avant le ventre.
    for (const [top, bottom] of [
      [0, HEIGHT * 0.46],
      [HEIGHT * 0.54, HEIGHT],
    ]) {
      const gradient = ctx.createLinearGradient(0, top, 0, bottom);
      const dorsalEnd = top === 0;
      const a = (v: number) => hexToRgba(bars.color, v * bars.opacity);
      // Depuis l'arete : opaque, puis fondu vers le flanc.
      if (dorsalEnd) {
        gradient.addColorStop(0, a(1));
        gradient.addColorStop(0.45, a(0.8));
        gradient.addColorStop(0.8, a(0.25));
        gradient.addColorStop(1, a(0));
      } else {
        gradient.addColorStop(0, a(0));
        gradient.addColorStop(0.2, a(0.25));
        gradient.addColorStop(0.55, a(0.8));
        gradient.addColorStop(1, a(1));
      }
      ctx.fillStyle = gradient;
      // Barre legerement fuselee : plus large au dos qu'au flanc.
      ctx.beginPath();
      const narrow = half * 0.55;
      if (dorsalEnd) {
        ctx.moveTo(cx - half, top);
        ctx.lineTo(cx + half, top);
        ctx.lineTo(cx + narrow, bottom);
        ctx.lineTo(cx - narrow, bottom);
      } else {
        ctx.moveTo(cx - narrow, top);
        ctx.lineTo(cx + narrow, top);
        ctx.lineTo(cx + half, bottom);
        ctx.lineTo(cx - half, bottom);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * Micro-ecailles en losange, peintes SOUS le vernis.
 *
 * C'est explicitement ce que demande la reference : les ecailles se voient a
 * travers le vernis, elles ne sont pas posees dessus. Comme le vernis est
 * rendu par le clearcoat du materiau — donc par-dessus la carte de couleur —
 * il suffit de les peindre ici, dans la couleur, pour obtenir cet ordre.
 *
 * Le losange est trace en deux familles de lignes croisees plutot qu'en
 * milliers de chemins fermes : a 4096 px de large, un maillage ferme
 * coute des secondes, deux familles de lignes coutent des millisecondes.
 */
function paintMicroScales(ctx: CanvasRenderingContext2D, livery: LiveryConfig): void {
  const micro = livery.microScales;
  if (!micro.enabled || micro.contrast <= 0.01) return;
  // Densite : de la grosse ecaille de 8 px a la trame fine de 2 px.
  const step = HEIGHT / (14 + clamp(micro.density, 0, 1) * 46);
  const alpha = clamp(micro.contrast, 0, 1) * 0.5;

  ctx.save();
  ctx.lineWidth = Math.max(step * 0.09, 0.5);
  // Les ecailles s'estompent vers le ventre, comme sur un vrai poisson.
  const fade = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  fade.addColorStop(0, `rgba(255,255,255,${alpha})`);
  fade.addColorStop(0.42, `rgba(255,255,255,${alpha * 0.55})`);
  fade.addColorStop(0.5, `rgba(255,255,255,${alpha * 0.2})`);
  fade.addColorStop(0.58, `rgba(255,255,255,${alpha * 0.55})`);
  fade.addColorStop(1, `rgba(255,255,255,${alpha})`);
  ctx.strokeStyle = fade;

  // Le losange nait du croisement de deux familles a 45 degres.
  const diag = WIDTH + HEIGHT;
  ctx.beginPath();
  for (let d = -HEIGHT; d < diag; d += step) {
    ctx.moveTo(d, 0);
    ctx.lineTo(d + HEIGHT, HEIGHT);
    ctx.moveTo(d, HEIGHT);
    ctx.lineTo(d + HEIGHT, 0);
  }
  ctx.stroke();

  // Ombre portee d'un demi-pas : sans elle la trame est plate.
  ctx.strokeStyle = `rgba(0,0,0,${alpha * 0.45})`;
  ctx.beginPath();
  const off = step * 0.28;
  for (let d = -HEIGHT; d < diag; d += step) {
    ctx.moveTo(d + off, 0);
    ctx.lineTo(d + HEIGHT + off, HEIGHT);
    ctx.moveTo(d + off, HEIGHT);
    ctx.lineTo(d + HEIGHT + off, 0);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Opercule : plaque d'ecailles larges a reflet holographique.
 *
 * Nettement distinct du reste du corps sur la reference — c'est ce qui donne
 * la tete de poisson plutot que la tete de bouchon.
 */
function paintGillPlate(ctx: CanvasRenderingContext2D, livery: LiveryConfig): void {
  const plate = livery.gillPlate;
  if (!plate.enabled) return;
  // La plaque part du nez et couvre l'avant du corps.
  const reach = WIDTH * (0.1 + clamp(plate.size, 0, 1) * 0.2);
  const x0 = WIDTH * 0.03;

  ctx.save();
  ctx.beginPath();
  // Contour en amande : haut au niveau de l'oeil, pointe vers l'arriere bas.
  ctx.moveTo(x0, HEIGHT * 0.12);
  ctx.quadraticCurveTo(x0 + reach * 0.7, HEIGHT * 0.02, x0 + reach, HEIGHT * 0.3);
  ctx.quadraticCurveTo(x0 + reach * 0.8, HEIGHT * 0.48, x0, HEIGHT * 0.46);
  ctx.closePath();
  // Meme amande, miroir de l'autre cote de la section.
  ctx.moveTo(x0, HEIGHT * 0.88);
  ctx.quadraticCurveTo(x0 + reach * 0.7, HEIGHT * 0.98, x0 + reach, HEIGHT * 0.7);
  ctx.quadraticCurveTo(x0 + reach * 0.8, HEIGHT * 0.52, x0, HEIGHT * 0.54);
  ctx.closePath();
  ctx.clip();

  // Fond irise : rose et vert alternes, comme un film prismatique.
  // Voile, pas aplat : l'opercule doit rester un REFLET sur la couleur du
  // corps. A pleine opacite on obtient une tete blanche, ce qui est faux.
  const holo = ctx.createLinearGradient(x0, 0, x0 + reach, HEIGHT);
  holo.addColorStop(0, hexToRgba(plate.color, 0.42));
  holo.addColorStop(0.35, 'rgba(190, 240, 210, 0.34)');
  holo.addColorStop(0.62, hexToRgba(plate.color, 0.38));
  holo.addColorStop(1, 'rgba(225, 235, 245, 0.3)');
  ctx.fillStyle = holo;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Ecailles LARGES : c'est ce qui distingue l'opercule du reste du corps.
  const step = HEIGHT / 11;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = Math.max(step * 0.08, 0.6);
  ctx.beginPath();
  for (let d = -HEIGHT; d < WIDTH; d += step) {
    ctx.moveTo(d, 0);
    ctx.lineTo(d + HEIGHT, HEIGHT);
    ctx.moveTo(d, HEIGHT);
    ctx.lineTo(d + HEIGHT, 0);
  }
  ctx.stroke();
  ctx.restore();

  // Fente branchiale : un trait sombre incurve qui ferme la plaque.
  ctx.save();
  ctx.strokeStyle = 'rgba(30, 34, 40, 0.55)';
  ctx.lineWidth = Math.max(HEIGHT * 0.012, 1);
  for (const flip of [false, true]) {
    const y = (v: number) => (flip ? HEIGHT - v : v);
    ctx.beginPath();
    ctx.moveTo(x0 + reach * 0.98, y(HEIGHT * 0.3));
    ctx.quadraticCurveTo(x0 + reach * 0.78, y(HEIGHT * 0.46), x0 + reach * 0.18, y(HEIGHT * 0.46));
    ctx.stroke();
  }
  ctx.restore();
}

/** Ligne laterale : elle suit le corps, elle ne le coupe pas en deux. */
function paintLateralLine(ctx: CanvasRenderingContext2D, livery: LiveryConfig): void {
  const line = livery.lateral;
  if (!line.enabled) return;
  const thickness = Math.max(HEIGHT * 0.012 * (0.4 + line.width * 2.2), 1);
  ctx.save();
  ctx.filter = `blur(${(thickness * 0.5).toFixed(1)}px)`;
  ctx.strokeStyle = hexToRgba(line.color, 0.7);
  ctx.lineWidth = thickness;
  for (const flip of [false, true]) {
    // La ligne passe au niveau demande sur le flanc, avec un leger arc :
    // sur un vrai poisson elle remonte derriere l'opercule puis redescend.
    const base = HEIGHT * (flip ? 1 - line.position * 0.62 : line.position * 0.62);
    ctx.beginPath();
    ctx.moveTo(WIDTH * 0.1, base + (flip ? thickness : -thickness) * 1.6);
    ctx.bezierCurveTo(
      WIDTH * 0.32,
      base + (flip ? -thickness : thickness) * 1.2,
      WIDTH * 0.6,
      base,
      WIDTH * 0.97,
      base,
    );
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Voile irise : la teinte se decale le long du flanc.
 *
 * C'est la couche que le materiau ne sait pas rendre seul. Le clearcoat et
 * l'iridescence de three.js jouent sur l'ANGLE de vue ; ici on ajoute la
 * variation LONGITUDINALE — dore vers la tete, vert vers la queue — qu'on
 * voit sur une menee doree.
 */
function paintIridescence(ctx: CanvasRenderingContext2D, livery: LiveryConfig): void {
  const iris = livery.iris;
  if (iris.strength <= 0.01) return;

  // Le canvas 2D ne sait pas composer deux degrades croises en une passe :
  // on peint le voile sur une surface temporaire, on le decoupe par un
  // masque vertical, puis on repose le tout en fondu « overlay ».
  const veil = document.createElement('canvas');
  veil.width = WIDTH;
  veil.height = HEIGHT;
  const vc = veil.getContext('2d');
  if (!vc) return;

  const a = clamp(iris.strength, 0, 1) * 0.42;
  const hue = vc.createLinearGradient(0, 0, WIDTH, 0);
  hue.addColorStop(0, `rgba(255, 228, 165, ${a})`);
  hue.addColorStop(0.32, hexToRgba(iris.hue, a * 0.95));
  hue.addColorStop(0.62, `rgba(186, 218, 255, ${a * 0.75})`);
  hue.addColorStop(1, hexToRgba(iris.hue, a * 0.85));
  vc.fillStyle = hue;
  vc.fillRect(0, 0, WIDTH, HEIGHT);

  // Le voile ne touche que les flancs : le dos reste sombre, le ventre clair.
  const mask = vc.createLinearGradient(0, 0, 0, HEIGHT);
  mask.addColorStop(0, 'rgba(0,0,0,0)');
  mask.addColorStop(0.22, 'rgba(0,0,0,1)');
  mask.addColorStop(0.42, 'rgba(0,0,0,1)');
  mask.addColorStop(0.5, 'rgba(0,0,0,0.18)');
  mask.addColorStop(0.58, 'rgba(0,0,0,1)');
  mask.addColorStop(0.78, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  vc.globalCompositeOperation = 'destination-in';
  vc.fillStyle = mask;
  vc.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(veil, 0, 0, WIDTH, HEIGHT);
  ctx.restore();
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

/**
 * Peinture complete du corps, couche par couche.
 *
 * L'ordre n'est pas decoratif, c'est lui qui fait le realisme : la base
 * opaque, la nacre du ventre, les zones, le motif, les barres du dos, la
 * trame d'ecailles, l'opercule, la ligne laterale, le voile irise, puis
 * l'oeil. Le VERNIS n'est pas dans cette liste — il est rendu par le
 * clearcoat du materiau, donc physiquement au-dessus de tout ce qui est
 * peint ici. C'est exactement ce que demande la reference : les ecailles se
 * voient SOUS le vernis, elles ne sont pas posees dessus.
 *
 * `scale` multiplie la resolution sans changer une seule coordonnee de
 * dessin : tout est trace dans le repere 1024 x 256 et le contexte se charge
 * de l'agrandissement. Le rendu de presentation s'en sert pour monter a
 * 4096 px sans dupliquer le code.
 */
export function createPaintTexture(params: LureParams, scale = 1): THREE.CanvasTexture {
  const { paint } = params;
  const livery = paint.livery;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(WIDTH * scale);
  canvas.height = Math.round(HEIGHT * scale);
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.scale(scale, scale);
    paintZones(ctx, paint);
    paintPearl(ctx, livery.pearl);
    paintEndZone(ctx, paint.head, paint.headLength, paint.blend, false);
    paintEndZone(ctx, paint.tail, paint.tailLength, paint.blend, true);

    if (paint.pattern === 'stripes') paintStripes(ctx, paint);
    else if (paint.pattern === 'dots') paintDots(ctx, paint);
    else if (paint.pattern === 'scales') paintScales(ctx, paint);
    else if (paint.pattern === 'camo') paintCamo(ctx, paint);
    else if (paint.pattern === 'gradient') paintGradient(ctx, paint);

    paintBars(ctx, livery);
    paintMicroScales(ctx, livery);
    paintGillPlate(ctx, livery);
    paintLateralLine(ctx, livery);
    paintIridescence(ctx, livery);
    paintEyes(ctx, params);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

// ---------------------------------------------------------------------------
// Normal map d'ecailles
// ---------------------------------------------------------------------------

/**
 * Trame d'ecailles en carte de normales, pour l'apercu.
 *
 * Une ecaille de 1,2 mm demanderait un maillage dix fois plus dense que
 * l'affichage pour se voir en relief : a l'ecran on la peint donc en
 * normales, ce qui coute une texture et rien de plus. Le relief REEL est
 * cuit dans la surface a l'export, ou a la demande via la bascule d'apercu.
 *
 * La carte est calculee dans le meme repere UV que la peinture (u le long du
 * corps, v autour de la section), et les hauteurs viennent du meme champ
 * `scaleField` que la geometrie : l'apercu et la piece ne peuvent pas
 * diverger de forme, seulement de finesse.
 */
export function createScaleNormalMap(params: LureParams): THREE.CanvasTexture | null {
  const scales = params.scales;
  if (!scales.enabled) return null;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const lengthCm = params.length * MM_TO_CM;
  const girthCm = Math.PI * ((params.maxWidth + params.thickness) / 2) * MM_TO_CM;
  const marginTop = scales.marginTop / 100;
  const marginBottom = scales.marginBottom / 100;

  // u : 0 au nez, 1 a la queue. v : 0 au dos, 0,5 au ventre, 1 au dos.
  const height = (px: number, py: number): number => {
    const u = px / WIDTH;
    const v = py / HEIGHT;
    // Le dos est en haut de la texture, le ventre au milieu : la marge se
    // mesure donc depuis les deux bords utiles.
    const around = Math.abs(v - 0.5) * 2; // 1 = dos, 0 = ventre
    const fadeTop = Math.min(Math.max((1 - marginTop * 2 - around) / 0.25, 0), 1);
    const fadeBottom = Math.min(Math.max((around + 1 - marginBottom * 2) / 0.25, 0), 1);
    const fade = fadeTop * fadeBottom;
    if (fade <= 0) return 0;
    const su = u * lengthCm;
    const sv = v * girthCm;
    return scaleField(scales, su, sv) * fade;
  };

  const image = ctx.createImageData(WIDTH, HEIGHT);
  const data = image.data;
  // Pente en unites de texel : plus l'ecaille est profonde, plus la normale
  // s'incline. Le signe suit le style, comme pour la geometrie.
  const strength = (scales.style === 'raised' ? 1 : -1) * scales.depth * 42;

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const hx = height((x + 1) % WIDTH, y) - height((x - 1 + WIDTH) % WIDTH, y);
      const hy = height(x, Math.min(y + 1, HEIGHT - 1)) - height(x, Math.max(y - 1, 0));
      let nx = -hx * strength;
      let ny = -hy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      const i = (y * WIDTH + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz / len) * 255);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}


/**
 * Relief microscopique des ecailles de livree.
 *
 * Distinct de `createScaleNormalMap` : celle-la reflete des ecailles qui
 * EXISTENT dans la geometrie et qui seront cuites a l'export ; celle-ci est
 * purement optique. Elle n'entre dans aucun maillage, dans aucun volume et
 * dans aucun verdict — c'est le grain du vernis, pas de la matiere.
 *
 * On la calcule analytiquement plutot qu'en relisant des pixels : la trame
 * est la meme croix a 45 degres que la couche peinte, donc sa hauteur
 * s'ecrit directement, et sa pente aussi.
 */
export function createLiveryNormalMap(params: LureParams): THREE.CanvasTexture | null {
  const micro = params.paint.livery.microScales;
  if (!micro.enabled || micro.contrast <= 0.02) return null;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH / 2;
  canvas.height = HEIGHT / 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const w = canvas.width;
  const h = canvas.height;
  const period = h / (14 + clamp(micro.density, 0, 1) * 46);
  const k = (Math.PI * 2) / period;
  // Amplitude de pente : une ecaille de vernis ne fait jamais saillie, elle
  // ondule. On reste donc tres en dessous d'un relief franc.
  const amp = clamp(micro.contrast, 0, 1) * 0.55;

  const image = ctx.createImageData(w, h);
  const data = image.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // h(x, y) = cos(k(x+y)) + cos(k(x-y)) : le losange classique.
      const u = k * (x + y);
      const v = k * (x - y);
      const dhdx = -amp * k * (Math.sin(u) + Math.sin(v));
      const dhdy = -amp * k * (Math.sin(u) - Math.sin(v));
      let nx = -dhdx;
      let ny = -dhdy;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      const i = (y * w + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz / len) * 255);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Apercu CSS de la livree, utilise par les vignettes et les pastilles. */
export const paintPreviewCss = (paint: PaintConfig): string =>
  `linear-gradient(180deg, ${paint.dorsal} 0%, ${paint.flank} 55%, ${paint.belly} 100%)`;
