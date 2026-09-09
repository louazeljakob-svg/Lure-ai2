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
import type { BallastWeight, ClipId, LureParams, PreviewQuality } from '../types/lure';
import { getClip, STEEL_DENSITY } from './materials';
import { clamp, createProfile, MM_TO_CM, type ProfileSampler } from './profile';
import { bibShape, clipHalfPlane } from './billTemplate';
import { createSurfaceDetail } from './surfaceDetail';
import { articulationPlan, buildJointHardware, type ArticulationPlan } from './articulation';

/** Densite du plomb, conservee comme repere pour l'interface. */
export const LEAD_DENSITY = 11.34;

/** Elancement des lests cylindriques : longueur = 2,5 x diametre. */
const CYLINDER_RATIO = 2.5;

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
 * Compromis fluidite / precision de l'apercu.
 *
 * Il ne touche QUE l'affichage : les exports partent toujours de la
 * resolution pleine, sans quoi un reglage de confort abimerait la piece.
 */
export const PREVIEW_RESOLUTION: Record<PreviewQuality, Resolution> = {
  low: { lengthSegments: 64, radialSegments: 24 },
  medium: DISPLAY_RESOLUTION,
  high: { lengthSegments: 200, radialSegments: 72 },
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

/**
 * Resolution capable de montrer le plus petit detail demande.
 *
 * Une ecaille d'un millimetre sur un maillage de 0,8 mm de pas ne se voit
 * pas : elle s'aliase en moire. On vise quatre echantillons par ecaille, et
 * on borne le resultat — au-dela, c'est le navigateur qui rend les armes.
 */
export function detailResolution(
  params: LureParams,
  base: Resolution,
  bakeScales: boolean,
): Resolution {
  if (!bakeScales || !params.scales.enabled) return base;
  const lengthCm = params.length * MM_TO_CM;
  const girthCm = Math.PI * ((params.maxWidth + params.thickness) / 2) * MM_TO_CM;
  const stepU = Math.max(params.scales.width * MM_TO_CM, 0.02) / 4;
  const stepV = Math.max(params.scales.height * MM_TO_CM, 0.02) / 4;
  return {
    lengthSegments: Math.min(Math.max(Math.round(lengthCm / stepU), base.lengthSegments), 900),
    radialSegments: Math.min(Math.max(Math.round(girthCm / stepV), base.radialSegments), 320),
  };
}

export interface BallastMarker {
  id: string;
  mass: number;
  /** Rayon de la bille, ou rayon du cylindre. */
  radius: number;
  /** Longueur du cylindre, en cm (0 pour une bille). */
  length: number;
  shape: 'sphere' | 'cylinder';
  position: [number, number, number];
  /** Faux si le lest depasse de la section du corps a cet endroit. */
  fits: boolean;
}

export interface LureGeometry {
  /**
   * Corps d'un seul tenant. Quand le leurre est articule, il reste calcule —
   * l'apercu de silhouette et les cotes s'en servent — mais ce sont les
   * `segments` qui s'impriment.
   */
  body: THREE.BufferGeometry;
  /** Segments articules, ou null si le corps est d'une seule piece. */
  segments: { front: THREE.BufferGeometry; rear: THREE.BufferGeometry } | null;
  /** Quincaillerie du joint : affichee et pesee, jamais imprimee. */
  joint: THREE.BufferGeometry | null;
  /** Cotes du joint, pour l'inspecteur et la simulation. */
  jointPlan: ArticulationPlan | null;
  /**
   * Bavette. En mode polycarbonate elle n'est PAS imprimee : la geometrie
   * n'existe que comme fantome d'aide au placement dans l'editeur, jamais
   * dans un export — voir `bibIsGhost`.
   */
  bib: THREE.BufferGeometry | null;
  /** Vrai quand la bavette affichee est une plaque rapportee, hors export. */
  bibIsGhost: boolean;
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
export function createDetailField(
  profile: ProfileSampler,
  params: LureParams,
  bakeScales = false,
): ((p: number, theta: number) => number) | null {
  // La cuiller n'a pas de tete distincte : aucun detail ne s'y applique.
  const allowed = params.shape !== 'spoon';
  const gills = allowed && params.gills.enabled ? params.gills : null;
  const eyes = allowed && params.eyes.enabled ? params.eyes : null;
  const sculpt = params.sculpt.filter((point) => Math.abs(point.amount) > 1e-4);
  // Decals et ecailles vivent dans le meme champ : ils deforment la peau au
  // lieu d'ajouter des pieces, donc ils suivent partout sans effort.
  const surface = createSurfaceDetail(profile, params, bakeScales);
  if (!gills && !eyes && sculpt.length === 0 && !surface) return null;

  const lengthCm = profile.lengthCm;

  // Ouies : sillon en arc, bombe vers l'arriere a mi-flanc comme un opercule.
  const gillRelief = gills ? gills.relief * MM_TO_CM : 0;
  const gillHalfWidth = gills ? Math.max(gills.size * MM_TO_CM * 0.35, 0.04) : 1;
  const gillBow = gills ? (gills.size * MM_TO_CM * 0.55) / lengthCm : 0;

  // Oeil : rayon et amplitude en centimetres.
  const eyeRelief = eyes ? eyes.relief * MM_TO_CM : 0;
  const eyeRadius = eyes ? Math.max((eyes.size * MM_TO_CM) / 2, 0.05) : 1;

  return (p: number, theta: number): number => {
    let displacement = surface ? surface.displace(p, theta) : 0;

    // Cage de sculpture : chaque point tire ou repousse la peau autour de lui,
    // avec une retombee douce, par-dessus la forme des sliders.
    for (const point of sculpt) {
      const along = (p - point.position) / Math.max(point.radius, 0.02);
      let delta = Math.abs(theta - THREE.MathUtils.degToRad(point.angle));
      if (delta > Math.PI) delta = Math.PI * 2 - delta;
      const around = delta / Math.max(point.radius * 6, 0.1);
      const weight = Math.exp(-(along * along + around * around) * 2);
      if (weight > 1e-3) displacement += point.amount * MM_TO_CM * weight;
    }

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
  bakeScales = false,
): THREE.BufferGeometry {
  const nStations = resolution.lengthSegments;
  const nRadial = resolution.radialSegments;
  const cols = nRadial + 1; // colonne dupliquee pour la couture UV
  const exponent = 2 / clamp(params.crossSection, 1.2, 3.6);
  const detail = createDetailField(profile, params, bakeScales);

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

  // Fonds d'extremite.
  //
  // Le profil parametrique se ferme de lui-meme : ses sections tombent a zero
  // au nez et a la pointe de queue, et l'anneau degenere suffit. Une
  // silhouette DESSINEE n'a aucune raison d'en faire autant — elle peut finir
  // sur une section pleine. On rebouche alors par un eventail, sans quoi le
  // solide resterait ouvert aux deux bouts.
  const cap = (index: number, front: boolean) => {
    if (degenerate[index]) return;
    const p = (index / nStations) * profile.bodyEnd;
    const section = profile.section(p);
    const centre = positions.length / 3;
    positions.push(profile.xAt(p), (section.top + section.bottom) / 2, 0);
    uvs.push(p, 0.5);
    for (let j = 0; j < nRadial; j++) {
      const a = index * cols + j;
      const b = a + 1;
      if (front) indices.push(centre, b, a);
      else indices.push(centre, a, b);
    }
  };
  cap(0, true);
  cap(nStations, false);

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

/** Moitie d'appendice a produire, pour l'impression en deux coques. */
export type ShellPart = 'full' | 'male' | 'female';

/** Repartit l'epaisseur d'un appendice plat de part et d'autre du joint. */
function extrudeSpan(thickness: number, part: ShellPart): { depth: number; shift: number } {
  if (part === 'full') return { depth: thickness, shift: -thickness / 2 };
  if (part === 'male') return { depth: thickness / 2, shift: 0 };
  return { depth: thickness / 2, shift: -thickness / 2 };
}

export function buildBib(
  profile: ProfileSampler,
  params: LureParams,
  part: ShellPart = 'full',
  root: THREE.Vector2 | null = null,
): THREE.BufferGeometry {
  const outline = bibShape(profile, params);
  // L'epaisseur est desormais un reglage a part entiere, plus une fraction
  // de l'epaisseur du corps.
  const thickness = clamp(params.billThickness * MM_TO_CM, 0.05, 0.6);

  // La largeur de la bavette devient laterale apres bascule : c'est donc le
  // CONTOUR qu'il faut trancher dans le plan de joint, pas l'epaisseur.
  const points =
    part === 'full' ? outline.points : clipHalfPlane(outline.points, part === 'female');
  if (points.length < 3) return new THREE.BufferGeometry();
  const shape = new THREE.Shape(points);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 24,
  });
  geometry.translate(0, 0, -thickness / 2);

  // Vrille : la section tourne progressivement autour de l'axe de la bavette.
  const twist = THREE.MathUtils.degToRad(params.billTwist);
  if (Math.abs(twist) > 1e-4) {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const span = Math.max(outline.length, 1e-6);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const angle = twist * clamp(x / span, 0, 1);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const y = position.getY(i);
      const z = position.getZ(i);
      position.setXYZ(i, x, y * cos - z * sin, y * sin + z * cos);
    }
    position.needsUpdate = true;
  }

  // Le contour est dessine dans le plan XY : on le bascule pour que la
  // largeur parte sur Z et que l'epaisseur soit verticale.
  geometry.rotateX(-Math.PI / 2);
  // Le contour est bati vers +X, or le nez du leurre est en -X : la bavette
  // doit donc etre retournee pour projeter VERS L'AVANT, comme une vraie
  // levre de plongee, et non balayer vers l'arriere sous le ventre.
  // Angle mesure depuis l'axe du corps : 0 deg = bavette dans l'axe
  // (plongee maximale), 90 deg = perpendiculaire (nage de sub-surface).
  geometry.rotateZ(Math.PI + THREE.MathUtils.degToRad(clamp(params.bibAngle, 5, 89)));

  // Quand la fente existe, la plaque se pose SUR SON TALON, au fond du
  // logement : l'apercu montre alors la bavette a l'endroit exact ou elle
  // sera une fois enfoncee. Sans fente — bavette imprimee avec le corps —
  // le talon reste noye sous le menton.
  if (root) {
    geometry.translate(root.x, root.y, 0);
  } else {
    const offset = clamp(params.billOffset * MM_TO_CM, 0, profile.lengthCm * 0.3);
    const anchorP = clamp(offset / Math.max(profile.lengthCm, 1e-6) + 0.03, 0.03, 0.4);
    const anchor = profile.section(anchorP);
    geometry.translate(profile.xAt(0) + offset, anchor.bottom * 0.75, 0);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// Nageoire caudale
// ---------------------------------------------------------------------------

export function buildTailFin(
  profile: ProfileSampler,
  params: LureParams,
  part: ShellPart = 'full',
): THREE.BufferGeometry {
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

  const span = extrudeSpan(thickness, part);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: span.depth,
    bevelEnabled: false,
    curveSegments: 24,
  });
  geometry.translate(0, 0, span.shift);

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
  density: number,
): BallastMarker[] {
  return ballasts.map((ballast) => {
    const p = clamp(ballast.position, 0.02, Math.max(profile.bodyEnd - 0.02, 0.05));
    const section = profile.section(p);
    const volume = Math.max(ballast.mass, 0.01) / Math.max(density, 0.5);
    // A masse egale, le cylindre loge dans une section plus fine que la bille.
    const radius =
      ballast.shape === 'cylinder'
        ? Math.cbrt(volume / (CYLINDER_RATIO * Math.PI)) 
        : Math.cbrt((3 * volume) / (4 * Math.PI));
    const length = ballast.shape === 'cylinder' ? radius * 2 * CYLINDER_RATIO : 0;
    const h = clamp(ballast.height, -1, 1);
    // -1 colle au ventre, +1 colle au dos, 0 sur l'axe neutre.
    const y = h < 0 ? -h * section.bottom * 0.72 : h * section.top * 0.72;
    const available = Math.min(section.halfWidth, (section.top - section.bottom) / 2);
    return {
      id: ballast.id,
      mass: ballast.mass,
      radius,
      length,
      shape: ballast.shape,
      position: [profile.xAt(p), y, 0],
      fits: radius <= available * 0.92,
    };
  });
}

// ---------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------

export interface SurfaceSampler {
  (p: number, theta: number): THREE.Vector3;
}

/**
 * Echantillonneur de la surface du corps, details compris.
 *
 * Le corps affiche et les deux coques d'assemblage passent par cette meme
 * fonction : c'est ce qui garantit que le plan de joint tombe exactement sur
 * la surface, sans decrochement.
 */
/**
 * Pieces de corps reellement imprimees : les segments s'il y en a, sinon le
 * corps d'un seul tenant. Volume, masse et export partent tous de la.
 */
export const printedBodies = (geo: LureGeometry): THREE.BufferGeometry[] =>
  geo.segments ? [geo.segments.front, geo.segments.rear] : [geo.body];

export function createSurfaceSampler(
  profile: ProfileSampler,
  params: LureParams,
  bakeScales = false,
): SurfaceSampler {
  const exponent = 2 / clamp(params.crossSection, 1.2, 3.6);
  const detail = createDetailField(profile, params, bakeScales);

  // Un vecteur neuf a chaque appel : un objet partage se ferait ecraser des
  // que l'appelant compare deux points, ce qui donne des bugs silencieux.
  return (p: number, theta: number): THREE.Vector3 => {
    const section = profile.section(p);
    const topAbs = section.top;
    const bottomAbs = -section.bottom;
    const centerY = (topAbs - bottomAbs) / 2;
    const yUnit = sgnPow(Math.cos(theta), exponent);
    const zUnit = sgnPow(Math.sin(theta), exponent);
    let y = yUnit * (yUnit >= 0 ? topAbs : bottomAbs);
    let z = zUnit * section.halfWidth;

    if (detail) {
      const displacement = detail(p, theta);
      if (displacement !== 0) {
        const dy = y - centerY;
        const radial = Math.hypot(dy, z);
        if (radial > 1e-6) {
          y += (dy / radial) * displacement;
          z += (z / radial) * displacement;
        }
      }
    }
    return new THREE.Vector3(profile.xAt(p), y, z);
  };
}

export function buildLure(
  params: LureParams,
  resolution: Resolution = DISPLAY_RESOLUTION,
  billRoot: THREE.Vector2 | null = null,
  bakeScales = false,
): LureGeometry {
  const profile = createProfile(params);
  const fine = detailResolution(params, resolution, bakeScales);
  const body = buildBody(profile, params, fine, bakeScales);
  // L'articulation coupe le corps d'un seul tenant. Elle ne se cumule pas
  // avec l'impression en deux coques, qui coupe deja dans l'autre sens : la
  // simulation le signale plutot que de produire quatre pieces bancales.
  const jointPlan =
    params.articulation.enabled && !params.assembly.enabled
      ? articulationPlan(profile, params)
      : null;
  const segments = jointPlan ? buildSegments(profile, params, fine, jointPlan, bakeScales) : null;
  const joint =
    jointPlan && params.articulation.showHardware ? buildJointHardware(jointPlan) : null;
  // La bavette rapportee est modelisee malgre tout : l'utilisateur doit voir
  // ou la plaque viendra se placer avant de la decouper.
  const bib = params.hasBib ? buildBib(profile, params, 'full', billRoot) : null;
  const bibIsGhost = params.hasBib && params.billMode === 'polycarbonate';
  const tail = profile.hasFin ? buildTailFin(profile, params) : null;
  const clip = buildClip(profile, params.clip);

  const box = new THREE.Box3();
  body.computeBoundingBox();
  if (body.boundingBox) box.union(body.boundingBox);
  for (const part of [bibIsGhost ? null : bib, tail]) {
    if (!part) continue;
    part.computeBoundingBox();
    if (part.boundingBox) box.union(part.boundingBox);
  }
  const size = box.getSize(new THREE.Vector3());

  return {
    body,
    segments,
    joint,
    jointPlan,
    bib,
    bibIsGhost,
    tail,
    clip,
    ballasts: ballastMarkers(profile, params.ballasts, params.ballastDensity),
    bounds: {
      length: size.x * 10,
      width: size.z * 10,
      height: size.y * 10,
    },
    dispose: () => {
      body.dispose();
      segments?.front.dispose();
      segments?.rear.dispose();
      joint?.dispose();
      bib?.dispose();
      tail?.dispose();
      clip?.geometry.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Segments articules
// ---------------------------------------------------------------------------

/**
 * Corps coupe en deux segments par le joint articule.
 *
 * Chaque segment est un loft a part entiere : le maillage n'est pas decoupe
 * apres coup, il est ENGENDRE jusqu'a la face de coupe. La station finale de
 * chaque colonne tombe donc exactement sur le plan du V, ce qui evite les
 * facettes tronquees et garde un solide ferme.
 *
 * La face de coupe est fermee par une bande qui va du contour de la section
 * vers l'arete du V, en contournant la fente de logement — creusee, elle, en
 * poche rectangulaire a fond plat.
 */
export function buildSegments(
  profile: ProfileSampler,
  params: LureParams,
  resolution: Resolution,
  plan: ArticulationPlan,
  bakeScales = false,
): { front: THREE.BufferGeometry; rear: THREE.BufferGeometry } {
  const nStations = resolution.lengthSegments;
  const nRadial = resolution.radialSegments;
  const exponent = 2 / clamp(params.crossSection, 1.2, 3.6);
  const detail = createDetailField(profile, params, bakeScales);

  /** Point de peau, details compris : le meme calcul que le corps entier. */
  const skin = (p: number, theta: number): THREE.Vector3 => {
    const section = profile.section(p);
    const topAbs = section.top;
    const bottomAbs = -section.bottom;
    const centerY = (topAbs - bottomAbs) / 2;
    const yUnit = sgnPow(Math.cos(theta), exponent);
    const zUnit = sgnPow(Math.sin(theta), exponent);
    let y = yUnit * (yUnit >= 0 ? topAbs : bottomAbs);
    let z = zUnit * section.halfWidth;
    if (detail) {
      const d = detail(p, theta);
      if (d !== 0) {
        const dy = y - centerY;
        const radial = Math.hypot(dy, z);
        if (radial > 1e-6) {
          y += (dy / radial) * d;
          z += (z / radial) * d;
        }
      }
    }
    return new THREE.Vector3(profile.xAt(p), y, z);
  };

  const pAtX = (x: number): number => {
    let lo = 0;
    let hi = profile.bodyEnd;
    for (let i = 0; i < 34; i++) {
      const mid = (lo + hi) / 2;
      if (profile.xAt(mid) < x) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  const build = (front: boolean): THREE.BufferGeometry => {
    const angle = front ? plan.faceAngle : plan.rearAngle;
    const tan = Math.tan(angle);
    const xApex = front ? plan.xJoint : plan.xJoint + plan.clearance;

    // Abscisse de coupe pour chaque colonne : c'est le plan du V, lu a la
    // largeur que la section presente a la charniere.
    const cutP: number[] = [];
    for (let j = 0; j <= nRadial; j++) {
      const theta = (j / nRadial) * Math.PI * 2;
      const z = sgnPow(Math.sin(theta), exponent) * plan.halfWidth;
      cutP.push(clamp(pAtX(xApex - Math.abs(z) * tan), 0.0005, profile.bodyEnd - 0.0005));
    }

    const positions: number[] = [];
    const uvs: number[] = [];
    const push = (v: THREE.Vector3, u0: number, v0: number): number => {
      positions.push(v.x, v.y, v.z);
      uvs.push(u0, v0);
      return positions.length / 3 - 1;
    };
    const indices: number[] = [];
    /** Triangle oriente vers l'exterieur du segment courant. */
    const tri = (a: number, b: number, c: number) => {
      if (a === b || b === c || a === c) return;
      indices.push(a, b, c);
    };

    // --- Peau ------------------------------------------------------------
    // Les stations gardent l'ordre du corps entier : le sens des triangles
    // est donc le meme, et le solide reste oriente vers l'exterieur.
    const grid: number[][] = [];
    for (let i = 0; i <= nStations; i++) {
      const row: number[] = [];
      const t = i / nStations;
      for (let j = 0; j <= nRadial; j++) {
        const theta = (j / nRadial) * Math.PI * 2;
        const p = front ? t * cutP[j] : cutP[j] + (profile.bodyEnd - cutP[j]) * t;
        row.push(push(skin(p, theta), p, j / nRadial));
      }
      grid.push(row);
    }
    for (let i = 0; i < nStations; i++) {
      for (let j = 0; j < nRadial; j++) {
        const a = grid[i][j];
        const b = grid[i][j + 1];
        const c = grid[i + 1][j];
        const d = grid[i + 1][j + 1];
        tri(a, b, d);
        tri(a, d, c);
      }
    }

    // --- Pointe libre (nez du segment avant, queue du segment arriere) ----
    const tipIndex = front ? 0 : nStations;
    const tipRow = grid[tipIndex];
    const tipP = front ? 0 : profile.bodyEnd;
    const tipSection = profile.section(tipP);
    if (tipSection.halfWidth > 1e-4 || tipSection.top + tipSection.bottom > 1e-4) {
      const centre = push(
        new THREE.Vector3(profile.xAt(tipP), (tipSection.top - tipSection.bottom) / 2, 0),
        tipP,
        0.5,
      );
      for (let j = 0; j < nRadial; j++) {
        // Le nez regarde vers -x, la queue vers +x : les deux eventails
        // tournent donc en sens inverse l'un de l'autre.
        if (front) tri(centre, tipRow[j + 1], tipRow[j]);
        else tri(centre, tipRow[j], tipRow[j + 1]);
      }
    }

    // --- Face de coupe en V, fente comprise ------------------------------
    const cutRow = front ? grid[nStations] : grid[0];
    const slot = plan.slot;
    const h = Math.min(slot.halfThickness, plan.halfWidth * 0.65);
    const faceX = (z: number) => xApex - Math.abs(z) * tan;
    const half = Math.round(nRadial / 2);
    const yAt = (j: number) => positions[cutRow[j] * 3 + 1];
    const inBand = (y: number) => y >= slot.from && y <= slot.to;

    // Bord interieur de la face : l'arete du V, sauf en face de la fente ou
    // il s'ecarte jusqu'au bord de la poche. Aux transitions on ajoute un
    // point a la meme hauteur, pour que le bord de la fente reste droit.
    // La hauteur exacte de la fente se cale donc sur les colonnes du loft.
    // Bord interieur de la face : l'arete du V, sauf en face de la fente ou
    // il s'ecarte jusqu'au bord de la poche. Aux transitions on ajoute un
    // point a la MEME hauteur, pour que le bord de la fente reste droit ; la
    // hauteur exacte de la fente se cale donc sur les colonnes du loft.
    // La face de coupe et la poche de la fente ne font qu'UNE surface
    // reglee. Pour chaque colonne, le bord interieur n'est pas un point mais
    // un petit chemin : bord de la bouche, fond de la paroi, milieu du fond.
    // Hors de la fente ce chemin se reduit a l'arete du V, et les quadrangles
    // correspondants s'aplatissent d'eux-memes.
    //
    // Tout decrire d'un seul tenant evite d'avoir a raccorder deux maillages
    // au bord de la fente — c'est precisement la que les trous se logent.
    const floorX = front ? xApex - slot.depth : xApex + slot.depth;
    const path = (y: number, z: number): THREE.Vector3[] =>
      z === 0
        ? [
            new THREE.Vector3(xApex, y, 0),
            new THREE.Vector3(xApex, y, 0),
            new THREE.Vector3(xApex, y, 0),
          ]
        : [
            new THREE.Vector3(faceX(z), y, z),
            new THREE.Vector3(floorX, y, z),
            new THREE.Vector3(floorX, y, 0),
          ];

    // Aux deux transitions, le bord revient sur l'arete a la MEME hauteur :
    // la fente garde ainsi des bouts droits. Entree et sortie sont traitees
    // symetriquement, sinon les deux flancs ne couvriraient pas la meme
    // plage et la poche ne se refermerait pas.
    // Le bord interieur doit etre RIGOUREUSEMENT symetrique entre les deux
    // flancs, sinon l'arete du V ne se rejoint pas et le solide s'ouvre.
    //
    // Or la peau, elle, ne l'est pas : une trame d'ecailles enveloppee
    // avance avec l'angle et deplace la colonne j autrement que son miroir.
    // On prend donc la hauteur de la colonne CANONIQUE — la premiere moitie
    // du tour — pour les deux cotes. Le contour de section reste deplace, la
    // ligne de coupe se contente d'etre un peu oblique.
    const canon = (j: number) => Math.min(j, nRadial - j);
    const canonY: number[] = [];
    for (let k = 0; k <= half; k++) canonY.push(yAt(k));

    const shape: { y: number; z: number; canon: number; role: number }[] = [];
    const owner: number[] = [];
    let previousBand = false;
    let previousY = 0;
    let previousCanon = 0;
    for (let j = 0; j <= nRadial; j++) {
      const key = canon(j);
      const y = canonY[Math.min(key, canonY.length - 1)];
      // Cote du point : positif sur la premiere moitie du tour, negatif sur
      // la seconde. Les colonnes 0, half et nRadial sont sur l'arete meme.
      const side = j === 0 || j === half || j === nRadial ? 0 : j < half ? 1 : -1;
      const band = inBand(y) && side !== 0;
      if (band && !previousBand) {
        shape.push({ y, z: 0, canon: key, role: 1 });
        owner.push(j);
      } else if (!band && previousBand) {
        shape.push({ y: previousY, z: 0, canon: previousCanon, role: 1 });
        owner.push(j - 1);
      }
      shape.push({ y, z: band ? side * h : 0, canon: key, role: 0 });
      owner.push(j);
      previousBand = band;
      previousY = y;
      previousCanon = key;
    }

    // Les sommets poses sur l'arete (z = 0) sont partages entre les deux
    // flancs : c'est ce partage qui referme la face de coupe.
    const shared = new Map<string, number>();
    const sharedPush = (key: string, v: THREE.Vector3): number => {
      const found = shared.get(key);
      if (found !== undefined) return found;
      const index = push(v, 0, 0);
      shared.set(key, index);
      return index;
    };

    const rails = shape.map((point) => {
      const trio = path(point.y, point.z);
      return trio.map((v, r) =>
        Math.abs(v.z) < 1e-12
          ? sharedPush(`${point.canon}:${point.role}:${r}:${v.x.toFixed(6)}`, v)
          : push(v, 0, 0),
      );
    });

    for (let k = 0; k + 1 < rails.length; k++) {
      const colA = [cutRow[owner[k]], ...rails[k]];
      const colB = [cutRow[owner[k + 1]], ...rails[k + 1]];
      for (let r = 0; r + 1 < colA.length; r++) {
        if (front) {
          tri(colA[r], colB[r], colB[r + 1]);
          tri(colA[r], colB[r + 1], colA[r + 1]);
        } else {
          tri(colA[r], colB[r + 1], colB[r]);
          tri(colA[r], colA[r + 1], colB[r + 1]);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  };

  return { front: build(true), rear: build(false) };
}
