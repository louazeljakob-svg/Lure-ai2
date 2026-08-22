/**
 * Contour plat de la bavette.
 *
 * Le meme trace sert a trois choses : la bavette imprimee avec le corps, le
 * gabarit DXF / SVG a decouper dans du polycarbonate, et la fente d'insertion
 * creusee dans la tete. Un seul contour, donc aucune derive possible entre la
 * piece et son logement.
 *
 * Repere local : x part de la racine vers la pointe, y est la demi-largeur.
 * Unites en centimetres, comme le reste de la geometrie.
 */

import * as THREE from 'three';
import type { LureParams } from '../types/lure';
import { MM_TO_CM, type ProfileSampler } from './profile';

/** Longueur du talon d'insertion, en cm, pour une bavette rapportee. */
export function bibTangLength(params: LureParams): number {
  return Math.max(params.bibLength * MM_TO_CM * 0.42, 0.35);
}

export interface BibShape {
  /** Contour ferme, en centimetres. */
  points: THREE.Vector2[];
  length: number;
  halfWidth: number;
  rootHalf: number;
}

export function bibShape(
  profile: ProfileSampler,
  params: LureParams,
  withTang = false,
): BibShape {
  const length = Math.max(params.bibLength * MM_TO_CM, 0.2);
  const halfWidth = Math.max((params.bibWidth * MM_TO_CM) / 2, 0.15);
  const root = profile.section(0.1);
  const rootHalf = Math.max(root.halfWidth * 0.85, halfWidth * 0.4);
  const tang = withTang ? bibTangLength(params) : 0;

  const curve = new THREE.Path();
  curve.moveTo(-tang, rootHalf * 0.9);
  if (tang > 0) curve.lineTo(0, rootHalf);
  curve.quadraticCurveTo(length * 0.45, halfWidth, length * 0.86, halfWidth * 0.9);
  curve.quadraticCurveTo(length * 1.08, 0, length * 0.86, -halfWidth * 0.9);
  curve.quadraticCurveTo(length * 0.45, -halfWidth, 0, -rootHalf);
  if (tang > 0) curve.lineTo(-tang, -rootHalf * 0.9);
  curve.closePath();

  return { points: curve.getPoints(48), length, halfWidth, rootHalf };
}

/** Contour du gabarit a decouper, talon d'insertion compris. */
export const bibOutline = (profile: ProfileSampler, params: LureParams): THREE.Vector2[] =>
  bibShape(profile, params, true).points;

/**
 * Coupe un contour ferme par le demi-plan y >= 0 (ou y <= 0).
 *
 * La bavette est une plaque dont la LARGEUR est laterale : pour la partager
 * entre les deux coques, il faut trancher son contour dans le plan de joint,
 * et non couper son epaisseur.
 */
export function clipHalfPlane(
  points: THREE.Vector2[],
  keepPositive: boolean,
): THREE.Vector2[] {
  const inside = (point: THREE.Vector2) => (keepPositive ? point.y >= 0 : point.y <= 0);
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const previous = points[(i + points.length - 1) % points.length];
    const currentIn = inside(current);
    const previousIn = inside(previous);
    if (currentIn !== previousIn) {
      // Intersection avec y = 0.
      const t = previous.y / (previous.y - current.y);
      out.push(
        new THREE.Vector2(previous.x + (current.x - previous.x) * t, 0),
      );
    }
    if (currentIn) out.push(current);
  }
  return out;
}
