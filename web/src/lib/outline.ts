/**
 * Contours dessines a la main : echantillonnage, mesure et champ de distance.
 *
 * Un contour de Bezier est commode a EDITER mais coute cher a INTERROGER :
 * savoir si un point est dedans demande de parcourir toutes les courbes. Or
 * la projection d'un decal pose la question une fois par sommet du maillage,
 * soit des dizaines de milliers de fois par reconstruction.
 *
 * On aplatit donc le trace une bonne fois en polygone, puis on cuit un champ
 * de distance signee sur une grille. Le test devient deux interpolations
 * bilineaires, et l'adoucissement des bords tombe gratuitement : c'est la
 * distance elle-meme qui donne la rampe.
 */

import * as THREE from 'three';
import type { Outline, OutlineNode } from '../types/lure';

/** Segments par courbe lors de l'aplatissement. */
const FLATTEN_STEPS = 18;

export const outlineNode = (
  x: number,
  y: number,
  handle = 0.12,
): OutlineNode => ({
  id: `n${Math.random().toString(36).slice(2, 9)}`,
  x,
  y,
  inX: -handle,
  inY: 0,
  outX: handle,
  outY: 0,
});

export const emptyOutline = (): Outline => ({ nodes: [], closed: true, mirror: false });

/** Vrai si le trace decrit une vraie surface exploitable. */
export const outlineIsUsable = (outline: Outline | null | undefined): boolean =>
  !!outline && outline.nodes.length >= 2;

const cubic = (
  a: THREE.Vector2,
  b: THREE.Vector2,
  c: THREE.Vector2,
  d: THREE.Vector2,
  t: number,
): THREE.Vector2 => {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return new THREE.Vector2(
    a.x * w0 + b.x * w1 + c.x * w2 + d.x * w3,
    a.y * w0 + b.y * w1 + c.y * w2 + d.y * w3,
  );
};

/**
 * Aplatit le trace en polygone.
 *
 * Le miroir n'est pas un post-traitement cosmetique : il ferme le contour en
 * repassant par le reflet des memes points, de sorte que la surface obtenue
 * est bien celle que l'utilisateur voit a l'ecran.
 */
export function flattenOutline(outline: Outline, steps = FLATTEN_STEPS): THREE.Vector2[] {
  const nodes = outline.nodes;
  if (nodes.length < 2) return [];

  const walk = (list: OutlineNode[], loop: boolean): THREE.Vector2[] => {
    const out: THREE.Vector2[] = [];
    const last = loop ? list.length : list.length - 1;
    for (let i = 0; i < last; i++) {
      const from = list[i];
      const to = list[(i + 1) % list.length];
      const a = new THREE.Vector2(from.x, from.y);
      const b = new THREE.Vector2(from.x + from.outX, from.y + from.outY);
      const c = new THREE.Vector2(to.x + to.inX, to.y + to.inY);
      const d = new THREE.Vector2(to.x, to.y);
      for (let s = 0; s < steps; s++) out.push(cubic(a, b, c, d, s / steps));
    }
    if (!loop) out.push(new THREE.Vector2(list[list.length - 1].x, list[list.length - 1].y));
    return out;
  };

  if (!outline.mirror) return walk(nodes, outline.closed);

  // Symetrie : on descend le trace, puis on remonte son reflet. Les deux
  // extremites sont posees sur l'axe, sinon la couture laisserait une fente.
  const upper = walk(nodes, false);
  const lower = [...upper].reverse().map((p) => new THREE.Vector2(p.x, -p.y));
  return [...upper, ...lower.slice(1, -1)];
}

export interface OutlineBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export function outlineBounds(points: THREE.Vector2[]): OutlineBounds {
  if (points.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

const pointInPolygon = (points: THREE.Vector2[], x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
};

const distanceToPolygon = (points: THREE.Vector2[], x: number, y: number): number => {
  let best = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 < 1e-12 ? 0 : Math.min(Math.max(((x - a.x) * dx + (y - a.y) * dy) / len2, 0), 1);
    const px = a.x + dx * t - x;
    const py = a.y + dy * t - y;
    const d = Math.hypot(px, py);
    if (d < best) best = d;
  }
  return best;
};

/**
 * Champ de distance signee cuit sur une grille.
 *
 * Positif dedans, negatif dehors, en unites du contour. La grille deborde la
 * boite du trace d'une marge : sans elle, l'adoucissement serait tronque net
 * au bord de la grille au lieu de s'eteindre.
 */
export interface SignedField {
  bounds: OutlineBounds;
  /** Valeur signee au point demande, en unites du contour. */
  at: (x: number, y: number) => number;
}

export function bakeSignedField(
  points: THREE.Vector2[],
  resolution = 96,
): SignedField | null {
  if (points.length < 3) return null;
  const raw = outlineBounds(points);
  const margin = Math.max(raw.width, raw.height) * 0.25 + 1e-6;
  const minX = raw.minX - margin;
  const minY = raw.minY - margin;
  const spanX = raw.width + margin * 2;
  const spanY = raw.height + margin * 2;

  // Grille proportionnelle : un decal tres allonge ne merite pas autant de
  // colonnes que de lignes, et l'inverse non plus.
  const ratio = spanY / Math.max(spanX, 1e-9);
  const cols = Math.max(8, Math.round(resolution * Math.min(Math.max(1 / Math.sqrt(ratio), 0.3), 3)));
  const rows = Math.max(8, Math.round(resolution * Math.min(Math.max(Math.sqrt(ratio), 0.3), 3)));

  const grid = new Float32Array((cols + 1) * (rows + 1));
  for (let j = 0; j <= rows; j++) {
    const y = minY + (spanY * j) / rows;
    for (let i = 0; i <= cols; i++) {
      const x = minX + (spanX * i) / cols;
      const d = distanceToPolygon(points, x, y);
      grid[j * (cols + 1) + i] = pointInPolygon(points, x, y) ? d : -d;
    }
  }

  const at = (x: number, y: number): number => {
    const fx = ((x - minX) / spanX) * cols;
    const fy = ((y - minY) / spanY) * rows;
    if (fx < 0 || fy < 0 || fx > cols || fy > rows) {
      // Hors grille : franchement dehors, et d'autant plus qu'on s'eloigne.
      const dx = Math.max(minX - x, x - (minX + spanX), 0);
      const dy = Math.max(minY - y, y - (minY + spanY), 0);
      return -(Math.hypot(dx, dy) + margin);
    }
    const i = Math.min(Math.floor(fx), cols - 1);
    const j = Math.min(Math.floor(fy), rows - 1);
    const tx = fx - i;
    const ty = fy - j;
    const row = j * (cols + 1) + i;
    const a = grid[row];
    const b = grid[row + 1];
    const c = grid[row + cols + 1];
    const d = grid[row + cols + 2];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };

  return { bounds: raw, at };
}

/**
 * Arrondit les angles d'un polygone d'un rayon donne.
 *
 * Chaque sommet est remplace par un arc tangent aux deux cotes. Le rayon est
 * borne par la moitie du plus court des deux cotes : au-dela, les arcs
 * voisins se recouvriraient et le contour se croiserait.
 */
export function roundCorners(
  points: THREE.Vector2[],
  radius: number,
  steps = 6,
): THREE.Vector2[] {
  if (radius <= 1e-6 || points.length < 3) return points;
  const out: THREE.Vector2[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const previous = points[(i - 1 + n) % n];
    const current = points[i];
    const next = points[(i + 1) % n];

    const toPrev = new THREE.Vector2().subVectors(previous, current);
    const toNext = new THREE.Vector2().subVectors(next, current);
    const lenPrev = toPrev.length();
    const lenNext = toNext.length();
    if (lenPrev < 1e-9 || lenNext < 1e-9) {
      out.push(current.clone());
      continue;
    }
    toPrev.divideScalar(lenPrev);
    toNext.divideScalar(lenNext);

    // Angle entre les deux cotes : un sommet presque plat n'a pas besoin
    // d'arc, et le calcul y devient instable.
    const cos = Math.min(Math.max(toPrev.dot(toNext), -1), 1);
    const angle = Math.acos(cos);
    if (angle > Math.PI - 0.05 || angle < 0.05) {
      out.push(current.clone());
      continue;
    }

    const cut = Math.min(radius / Math.tan(angle / 2), lenPrev / 2, lenNext / 2);
    const a = new THREE.Vector2().copy(current).addScaledVector(toPrev, cut);
    const b = new THREE.Vector2().copy(current).addScaledVector(toNext, cut);
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      // Bezier quadratique : l'arc de cercle a moins d'un pour cent pres,
      // pour trois lignes au lieu d'une trigonometrie complete.
      const u = 1 - t;
      out.push(
        new THREE.Vector2(
          a.x * u * u + current.x * 2 * u * t + b.x * t * t,
          a.y * u * u + current.y * 2 * u * t + b.y * t * t,
        ),
      );
    }
  }
  return out;
}

/**
 * Contours prets a l'emploi des rainures de collant, en coordonnees
 * normalisees. Une largeur de 2, une hauteur qui suit la forme.
 */
export function inlayShapePoints(shape: string): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  if (shape === 'oval') {
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      points.push(new THREE.Vector2(Math.cos(a), Math.sin(a) * 0.42));
    }
    return points;
  }
  if (shape === 'teardrop') {
    // Goutte : ronde a l'avant, effilee vers l'arriere, comme une ecaille
    // de flanc ou un patch d'opercule.
    for (let i = 0; i < 56; i++) {
      const a = (i / 56) * Math.PI * 2;
      const taper = (1 + Math.cos(a)) / 2;
      points.push(
        new THREE.Vector2(Math.cos(a), Math.sin(a) * 0.46 * (0.25 + 0.75 * taper)),
      );
    }
    return points;
  }
  if (shape === 'band') {
    // Bande laterale : un rectangle allonge, angles arrondis par le reglage.
    return [
      new THREE.Vector2(-1, -0.16),
      new THREE.Vector2(1, -0.16),
      new THREE.Vector2(1, 0.16),
      new THREE.Vector2(-1, 0.16),
    ];
  }
  // Forme du flanc, decalee vers l'interieur : un ovale plus plein a l'avant,
  // qui epouse la silhouette du corps.
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * Math.PI * 2;
    const belly = 1 + 0.18 * Math.cos(a - 0.6);
    points.push(new THREE.Vector2(Math.cos(a) * 1.02, Math.sin(a) * 0.5 * belly));
  }
  return points;
}
