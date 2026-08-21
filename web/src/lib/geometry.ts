/**
 * Generation procedurale de la geometrie du leurre.
 *
 * Rien n'est prefabrique : le corps est un maillage de revolution deformee
 * (loft de sections superelliptiques le long du profil), la bavette et la
 * nageoire caudale sont des extrusions de contours calcules a la volee.
 *
 * Toutes les transformations sont appliquees directement dans les buffers,
 * de sorte que la meme geometrie sert a l'affichage, au calcul physique et
 * a l'export STL sans avoir a jongler avec des matrices.
 */

import * as THREE from 'three';
import type { BallastWeight, LureParams } from '../types/lure';
import { clamp, createProfile, MM_TO_CM, type ProfileSampler } from './profile';

/** Densite du plomb, en g/cm3 — sert a dimensionner les lests affiches. */
export const LEAD_DENSITY = 11.34;

const RADIAL_SEGMENTS = 48;
const LENGTH_SEGMENTS = 128;

export interface BallastMarker {
  id: string;
  mass: number;
  radius: number;
  position: [number, number, number];
  /** Faux si la bille de plomb depasse de la section du corps. */
  fits: boolean;
}

export interface LureGeometry {
  body: THREE.BufferGeometry;
  bib: THREE.BufferGeometry | null;
  tail: THREE.BufferGeometry | null;
  ballasts: BallastMarker[];
  /** Encombrement reel en mm (bavette comprise). */
  bounds: { length: number; width: number; height: number };
  dispose: () => void;
}

const sgnPow = (v: number, e: number): number =>
  (v < 0 ? -1 : 1) * Math.pow(Math.abs(v), e);

// ---------------------------------------------------------------------------
// Corps
// ---------------------------------------------------------------------------

function buildBody(profile: ProfileSampler, params: LureParams): THREE.BufferGeometry {
  const nStations = LENGTH_SEGMENTS;
  const nRadial = RADIAL_SEGMENTS;
  const cols = nRadial + 1; // colonne dupliquee pour la couture UV
  const exponent = 2 / clamp(params.crossSection, 1.2, 3.6);

  const positions: number[] = [];
  const uvs: number[] = [];
  const degenerate: boolean[] = [];

  for (let i = 0; i <= nStations; i++) {
    const p = (i / nStations) * profile.bodyEnd;
    const section = profile.section(p);
    const x = profile.xAt(p);
    const topAbs = section.top;
    const bottomAbs = -section.bottom;
    degenerate.push(section.halfWidth < 1e-6 && topAbs < 1e-6);

    for (let j = 0; j <= nRadial; j++) {
      const theta = (j / nRadial) * Math.PI * 2; // 0 = dos, PI = ventre
      const yUnit = sgnPow(Math.cos(theta), exponent);
      const zUnit = sgnPow(Math.sin(theta), exponent);
      positions.push(x, yUnit * (yUnit >= 0 ? topAbs : bottomAbs), zUnit * section.halfWidth);
      uvs.push(p, j / nRadial);
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < nStations; i++) {
    for (let j = 0; j < nRadial; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = (i + 1) * cols + j;
      const d = c + 1;
      // Les anneaux degeneres (nez et pointe de queue) ne produisent qu'un
      // seul triangle : l'eventail de fermeture.
      if (!degenerate[i]) indices.push(a, b, d);
      if (!degenerate[i + 1]) indices.push(a, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// Bavette
// ---------------------------------------------------------------------------

function buildBib(profile: ProfileSampler, params: LureParams): THREE.BufferGeometry {
  const bl = Math.max(params.bibLength * MM_TO_CM, 0.2);
  const hw = Math.max((params.bibWidth * MM_TO_CM) / 2, 0.15);
  const root = profile.section(0.1);
  const rootHalf = Math.max(root.halfWidth * 0.85, hw * 0.4);
  const thickness = clamp(params.thickness * MM_TO_CM * 0.1, 0.1, 0.28);

  const shape = new THREE.Shape();
  shape.moveTo(0, rootHalf);
  shape.quadraticCurveTo(bl * 0.45, hw, bl * 0.86, hw * 0.9);
  shape.quadraticCurveTo(bl * 1.08, 0, bl * 0.86, -hw * 0.9);
  shape.quadraticCurveTo(bl * 0.45, -hw, 0, -rootHalf);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 24,
  });

  // Le contour est dessine dans le plan XY : on le bascule pour que la
  // largeur parte sur Z et que l'epaisseur soit verticale.
  geometry.translate(0, 0, -thickness / 2);
  geometry.rotateX(-Math.PI / 2);
  // Inclinaison : 0 deg = bavette dans l'axe du corps, 90 deg = perpendiculaire.
  geometry.rotateZ(-THREE.MathUtils.degToRad(clamp(params.bibAngle, 5, 89)));

  const anchor = profile.section(0.07);
  geometry.translate(profile.xAt(0.045), anchor.bottom * 0.75, 0);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// Nageoire caudale
// ---------------------------------------------------------------------------

function buildTailFin(profile: ProfileSampler, params: LureParams): THREE.BufferGeometry {
  const overlap = profile.lengthCm * 0.02;
  const len = (1 - profile.bodyEnd) * profile.lengthCm + overlap;
  const thicknessCm = params.thickness * MM_TO_CM;
  const heightFactor =
    params.tailShape === 'paddle' ? 0.82 : params.tailShape === 'fan' ? 1.05 : 0.95;
  // h est une demi-hauteur : on part de la demi-epaisseur du corps.
  const h = Math.max(
    thicknessCm * 0.5 * heightFactor * clamp(params.tailSize, 0.4, 1.8),
    0.2,
  );
  const stalkSection = profile.section(Math.max(profile.bodyEnd - 0.045, 0.05));
  const stalk = Math.max((stalkSection.top - stalkSection.bottom) / 2, 0.08);
  const thickness = clamp(thicknessCm * 0.16, 0.12, 0.4);

  const shape = new THREE.Shape();
  shape.moveTo(0, stalk);
  if (params.tailShape === 'forked') {
    shape.quadraticCurveTo(len * 0.4, h * 0.5, len, h);
    shape.quadraticCurveTo(len * 0.6, h * 0.34, len * 0.44, 0);
    shape.quadraticCurveTo(len * 0.6, -h * 0.34, len, -h);
    shape.quadraticCurveTo(len * 0.4, -h * 0.5, 0, -stalk);
  } else if (params.tailShape === 'paddle') {
    shape.quadraticCurveTo(len * 0.3, h * 0.85, len * 0.6, h);
    shape.quadraticCurveTo(len * 1.02, h * 0.7, len, 0);
    shape.quadraticCurveTo(len * 1.02, -h * 0.7, len * 0.6, -h);
    shape.quadraticCurveTo(len * 0.3, -h * 0.85, 0, -stalk);
  } else {
    shape.lineTo(len * 0.88, h);
    shape.quadraticCurveTo(len * 1.12, 0, len * 0.88, -h);
    shape.lineTo(0, -stalk);
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 24,
  });
  geometry.translate(0, 0, -thickness / 2);

  const junction = profile.section(Math.max(profile.bodyEnd - 0.045, 0.05));
  const centerY = (junction.top + junction.bottom) / 2;
  geometry.translate(profile.xAt(profile.bodyEnd) - overlap, centerY, 0);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// Lests internes
// ---------------------------------------------------------------------------

export function ballastMarkers(
  profile: ProfileSampler,
  ballasts: BallastWeight[],
): BallastMarker[] {
  return ballasts.map((ballast) => {
    const p = clamp(ballast.position, 0.02, Math.max(profile.bodyEnd - 0.02, 0.05));
    const section = profile.section(p);
    const volume = Math.max(ballast.mass, 0.01) / LEAD_DENSITY;
    const radius = Math.cbrt((3 * volume) / (4 * Math.PI));
    const h = clamp(ballast.height, -1, 1);
    // -1 colle au ventre, +1 colle au dos, 0 sur l'axe neutre.
    const y = h < 0 ? -h * section.bottom * 0.72 : h * section.top * 0.72;
    const available = Math.min(section.halfWidth, (section.top - section.bottom) / 2);
    return {
      id: ballast.id,
      mass: ballast.mass,
      radius,
      position: [profile.xAt(p), y, 0],
      fits: radius <= available * 0.92,
    };
  });
}

// ---------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------

export function buildLure(params: LureParams): LureGeometry {
  const profile = createProfile(params);
  const body = buildBody(profile, params);
  const bib = params.hasBib ? buildBib(profile, params) : null;
  const tail = profile.hasFin ? buildTailFin(profile, params) : null;

  const box = new THREE.Box3();
  body.computeBoundingBox();
  if (body.boundingBox) box.union(body.boundingBox);
  for (const part of [bib, tail]) {
    if (!part) continue;
    part.computeBoundingBox();
    if (part.boundingBox) box.union(part.boundingBox);
  }
  const size = box.getSize(new THREE.Vector3());

  return {
    body,
    bib,
    tail,
    ballasts: ballastMarkers(profile, params.ballasts),
    bounds: {
      length: size.x * 10,
      width: size.z * 10,
      height: size.y * 10,
    },
    dispose: () => {
      body.dispose();
      bib?.dispose();
      tail?.dispose();
    },
  };
}
