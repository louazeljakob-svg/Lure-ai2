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
import type { BallastWeight, ClipId, LureParams } from '../types/lure';
import { getClip, STEEL_DENSITY } from './materials';
import { clamp, createProfile, MM_TO_CM, type ProfileSampler } from './profile';

/** Densite du plomb, en g/cm3 — sert a dimensionner les lests affiches. */
export const LEAD_DENSITY = 11.34;

const RADIAL_SEGMENTS = 48;
const LENGTH_SEGMENTS = 128;

export interface Resolution {
  lengthSegments: number;
  radialSegments: number;
}

/** Resolution d'affichage et d'export STL. */
export const DISPLAY_RESOLUTION: Resolution = {
  lengthSegments: LENGTH_SEGMENTS,
  radialSegments: RADIAL_SEGMENTS,
};

/**
 * Resolution reduite pour l'export STEP : chaque facette y coute une
 * vingtaine d'entites, un maillage d'affichage produirait un fichier de
 * plusieurs dizaines de mega-octets.
 */
export const STEP_RESOLUTION: Resolution = {
  lengthSegments: 64,
  radialSegments: 32,
};

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
  /** Quincaillerie : affichee et pesee, mais jamais exportee a l'impression. */
  clip: ClipPart | null;
  ballasts: BallastMarker[];
  /** Encombrement reel en mm (bavette comprise). */
  bounds: { length: number; width: number; height: number };
  dispose: () => void;
}

const sgnPow = (v: number, e: number): number =>
  (v < 0 ? -1 : 1) * Math.pow(Math.abs(v), e);

/** Angle de l'oeil depuis le dos, en radians : haut du flanc. */
const EYE_ANGLE = 1.15;

/**
 * Champ de deplacement des details de tete, exprime dans l'espace des
 * parametres du loft (station p, angle theta). Les branchies et les yeux ne
 * sont pas des pieces rapportees : ils deforment le corps lui-meme, ce qui
 * garantit un maillage ferme et donc imprimable.
 *
 * Retourne `null` quand aucun detail n'est actif.
 */
function createDetailField(
  profile: ProfileSampler,
  params: LureParams,
): ((p: number, theta: number) => number) | null {
  // La cuiller n'a pas de tete distincte : aucun detail ne s'y applique.
  const allowed = params.shape !== 'spoon';
  const gills = allowed && params.gills.enabled ? params.gills : null;
  const eyes = allowed && params.eyes.enabled ? params.eyes : null;
  if (!gills && !eyes) return null;

  const lengthCm = profile.lengthCm;

  // Ouies : sillon en arc, bombe vers l'arriere a mi-flanc comme un opercule.
  const gillRelief = gills ? gills.relief * MM_TO_CM : 0;
  const gillHalfWidth = gills ? Math.max(gills.size * MM_TO_CM * 0.35, 0.04) : 1;
  const gillBow = gills ? (gills.size * MM_TO_CM * 0.55) / lengthCm : 0;

  // Oeil : rayon et amplitude en centimetres.
  const eyeRelief = eyes ? eyes.relief * MM_TO_CM : 0;
  const eyeRadius = eyes ? Math.max((eyes.size * MM_TO_CM) / 2, 0.05) : 1;

  return (p: number, theta: number): number => {
    let displacement = 0;

    if (gills) {
      const height = Math.cos(theta);
      const lateral = Math.abs(Math.sin(theta));
      const line = gills.position + gillBow * (1 - height * height);
      const along = (p - line) * lengthCm;
      const falloff = Math.exp(-((along / gillHalfWidth) ** 2));
      displacement += gillRelief * falloff * Math.pow(lateral, 0.6);
    }

    if (eyes) {
      const section = profile.section(p);
      // Rayon local moyen : convertit un ecart angulaire en distance reelle.
      const localRadius = Math.max(
        (section.halfWidth + (section.top - section.bottom) / 2) / 2,
        0.02,
      );
      const along = (p - eyes.position) * lengthCm;
      for (const center of [EYE_ANGLE, Math.PI * 2 - EYE_ANGLE]) {
        let delta = Math.abs(theta - center);
        if (delta > Math.PI) delta = Math.PI * 2 - delta;
        const distance = Math.hypot(along, delta * localRadius);
        if (distance >= eyeRadius) continue;
        const t = distance / eyeRadius;
        if (eyeRelief >= 0) {
          // Cuvette annulaire surmontee d'un iris bombe.
          const socket = -0.9 * (1 - t * t);
          const iris = t < 0.55 ? 1.7 * (1 - (t / 0.55) ** 2) : 0;
          displacement += eyeRelief * (socket + iris);
        } else {
          // Relief negatif : oeil entierement bombe.
          displacement += -eyeRelief * (1 - t * t);
        }
      }
    }

    return displacement;
  };
}

// ---------------------------------------------------------------------------
// Corps
// ---------------------------------------------------------------------------

function buildBody(
  profile: ProfileSampler,
  params: LureParams,
  resolution: Resolution,
): THREE.BufferGeometry {
  const nStations = resolution.lengthSegments;
  const nRadial = resolution.radialSegments;
  const cols = nRadial + 1; // colonne dupliquee pour la couture UV
  const exponent = 2 / clamp(params.crossSection, 1.2, 3.6);
  const detail = createDetailField(profile, params);

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

    const centerY = (topAbs - bottomAbs) / 2;

    for (let j = 0; j <= nRadial; j++) {
      const theta = (j / nRadial) * Math.PI * 2; // 0 = dos, PI = ventre
      const yUnit = sgnPow(Math.cos(theta), exponent);
      const zUnit = sgnPow(Math.sin(theta), exponent);
      let y = yUnit * (yUnit >= 0 ? topAbs : bottomAbs);
      let z = zUnit * section.halfWidth;

      if (detail) {
        const displacement = detail(p, theta);
        if (displacement !== 0) {
          // Deplacement le long de la normale approchee : la direction
          // radiale issue du centre de la section.
          const dy = y - centerY;
          const radial = Math.hypot(dy, z);
          if (radial > 1e-6) {
            y += (dy / radial) * displacement;
            z += (z / radial) * displacement;
          }
        }
      }

      positions.push(x, y, z);
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
  // Le contour est bati vers +X, or le nez du leurre est en -X : la bavette
  // doit donc etre retournee pour projeter VERS L'AVANT, comme une vraie
  // levre de plongee, et non balayer vers l'arriere sous le ventre.
  // Angle mesure depuis l'axe du corps : 0 deg = bavette dans l'axe
  // (plongee maximale), 90 deg = perpendiculaire (nage de sub-surface).
  geometry.rotateZ(Math.PI + THREE.MathUtils.degToRad(clamp(params.bibAngle, 5, 89)));

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
// Agrafe (anneau brise)
// ---------------------------------------------------------------------------

export interface ClipPart {
  geometry: THREE.BufferGeometry;
  /** Masse d'acier, deduite de la longueur de fil reellement developpee. */
  mass: number;
}

/**
 * Agrafe generee comme un vrai fil plie : une courbe de Catmull-Rom decrit
 * l'axe du fil (crochet, branche, boucle, branche, crochet) et un tube de la
 * section du fil est balaye le long de cette courbe. La masse en decoule
 * directement, au lieu d'etre saisie en dur.
 */
function buildClip(profile: ProfileSampler, id: ClipId): ClipPart | null {
  const spec = getClip(id);
  if (!spec) return null;

  const total = spec.length * MM_TO_CM;
  const wireRadius = (spec.wire * MM_TO_CM) / 2;
  const loopRadius = total * 0.165;
  const loopCenter = total - loopRadius;
  const legX = loopRadius * 0.62;

  const at = (x: number, y: number) => new THREE.Vector3(x, y, 0);
  const points: THREE.Vector3[] = [
    // Crochet inferieur gauche, recourbe vers l'exterieur.
    at(-legX * 1.35, total * 0.115),
    at(-legX * 1.55, total * 0.05),
    at(-legX * 1.0, total * 0.015),
    at(-legX * 0.72, total * 0.085),
    // Branche gauche, legerement galbee.
    at(-legX * 0.98, total * 0.3),
    at(-legX * 0.82, loopCenter - loopRadius * 0.6),
  ];
  // Boucle : 250 degres, du bas-gauche au bas-droit en passant par le haut.
  for (let i = 0; i <= 28; i++) {
    const angle = THREE.MathUtils.degToRad(215 - (i / 28) * 250);
    points.push(
      at(Math.cos(angle) * loopRadius, loopCenter + Math.sin(angle) * loopRadius),
    );
  }
  // Branche droite, miroir de la gauche.
  points.push(
    at(legX * 0.82, loopCenter - loopRadius * 0.6),
    at(legX * 0.98, total * 0.3),
    at(legX * 0.72, total * 0.085),
    at(legX * 1.0, total * 0.015),
    at(legX * 1.55, total * 0.05),
    at(legX * 1.35, total * 0.115),
  );

  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4);
  const geometry = new THREE.TubeGeometry(curve, 190, wireRadius, 8, false);

  // L'agrafe pend a l'oeillet de tete, dans le plan vertical : l'axe local Y
  // (des crochets vers la boucle) part donc vers l'avant du leurre.
  geometry.rotateZ(Math.PI / 2);
  geometry.translate(profile.xAt(0), profile.section(0.04).top * 0.1, 0);

  const wireLength = curve.getLength();
  const mass = wireLength * Math.PI * wireRadius * wireRadius * STEEL_DENSITY;
  return { geometry, mass };
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

export function buildLure(
  params: LureParams,
  resolution: Resolution = DISPLAY_RESOLUTION,
): LureGeometry {
  const profile = createProfile(params);
  const body = buildBody(profile, params, resolution);
  const bib = params.hasBib ? buildBib(profile, params) : null;
  const tail = profile.hasFin ? buildTailFin(profile, params) : null;
  const clip = buildClip(profile, params.clip);

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
    clip,
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
      clip?.geometry.dispose();
    },
  };
}
