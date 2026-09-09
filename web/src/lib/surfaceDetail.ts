/**
 * Decals projetes et trame d'ecailles.
 *
 * Les deux vivent dans le meme champ de deplacement que les branchies, les
 * yeux et la cage de sculpture : ils DEFORMENT la peau au lieu d'ajouter des
 * pieces. C'est ce qui garantit qu'ils se retrouvent partout sans effort — a
 * l'affichage, dans les deux coques imprimables, dans le STL, dans le STEP,
 * et jusque dans le volume qui decide de la flottabilite.
 */

import * as THREE from 'three';
import type { Decal, LureParams, ScalesConfig } from '../types/lure';
import { MM_TO_CM, type ProfileSampler } from './profile';
import { bakeSignedField, flattenOutline, type SignedField } from './outline';

/** Un decal cuit : tout ce qu'il faut pour l'interroger par sommet. */
interface BakedDecal {
  field: SignedField;
  /** Centre du decal dans le plan de profil, en cm. */
  cx: number;
  cy: number;
  cos: number;
  sin: number;
  /** Echelle : unites de contour par centimetre. */
  perCm: number;
  /** Amplitude signee du relief, en cm. */
  amplitude: number;
  /** Largeur de la rampe de bord, en unites de contour. */
  ramp: number;
  mirror: boolean;
}

function bakeDecal(profile: ProfileSampler, decal: Decal): BakedDecal | null {
  const flat = flattenOutline(decal.outline);
  if (flat.length < 3) return null;
  const field = bakeSignedField(flat);
  if (!field) return null;

  const span = Math.max(field.bounds.width, 1e-6);
  // La taille demandee est une LARGEUR : la hauteur suit les proportions du
  // trace, sans quoi un decal se deformerait a chaque redimensionnement.
  const widthCm = Math.max(decal.size * MM_TO_CM, 0.05);
  const perCm = span / widthCm;

  const section = profile.section(THREE.MathUtils.clamp(decal.position, 0, profile.bodyEnd));
  const cy =
    decal.height >= 0 ? decal.height * section.top : -decal.height * section.bottom;
  const angle = THREE.MathUtils.degToRad(decal.rotation);

  return {
    field,
    cx: profile.xAt(THREE.MathUtils.clamp(decal.position, 0, profile.bodyEnd)),
    cy,
    cos: Math.cos(angle),
    sin: Math.sin(angle),
    perCm,
    amplitude: (decal.style === 'raised' ? 1 : -1) * decal.depth * MM_TO_CM,
    // L'adoucissement est un pourcentage de la taille du decal : un opercule
    // et un rayon de nageoire ne se fondent pas sur la meme distance.
    ramp: Math.max((decal.softness / 100) * span * 0.5, 1e-4),
    mirror: decal.mirror,
  };
}

/** Rampe lisse : 0 au bord, 1 a pleine profondeur. */
const smooth = (t: number): number => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};

// ---------------------------------------------------------------------------
// Ecailles
// ---------------------------------------------------------------------------

/**
 * Hauteur normalisee d'une ecaille, dans une cellule de coordonnees (u, v)
 * ramenees a [-0,5 ; 0,5]. Retourne 1 au coeur, 0 au bord et au-dela.
 */
export function scaleCell(shape: ScalesConfig['shape'], u: number, v: number): number {
  const au = Math.abs(u) * 2;
  const av = Math.abs(v) * 2;
  if (shape === 'diamond') {
    // Losange : la somme des distances normalisees fait la frontiere.
    return Math.max(0, 1 - (au + av) / 1.4);
  }
  if (shape === 'hex') {
    // Hexagone allonge : deux flancs droits, deux pentes.
    const straight = 1 - au;
    const slope = 1 - (au * 0.5 + av * 0.87) / 1.0;
    return Math.max(0, Math.min(straight, slope, 1 - av));
  }
  // Feston : demi-disque bombe vers l'arriere, borde net devant.
  const d = Math.hypot(au, av * 0.8);
  return v < -0.42 ? 0 : Math.max(0, 1 - d);
}

/**
 * Trame d'ecailles en quinconce.
 *
 * `u` court le long du corps et `v` autour (ou en hauteur, selon l'ajustement).
 * Une rangee sur deux est decalee d'une demi-ecaille : c'est ce decalage qui
 * fait lire la surface comme un poisson et non comme un damier.
 */
export function scaleField(
  scales: ScalesConfig,
  u: number,
  v: number,
): number {
  const pitchU = Math.max((scales.width + scales.spacing) * MM_TO_CM, 1e-4);
  const pitchV = Math.max((scales.height + scales.spacing) * MM_TO_CM, 1e-4);
  const row = Math.floor(v / pitchV);
  const shifted = u / pitchU + (row % 2 === 0 ? 0 : 0.5);
  const cu = shifted - Math.floor(shifted) - 0.5;
  const cv = v / pitchV - row - 0.5;

  // L'espacement retrecit l'ecaille dans sa cellule sans changer le pas.
  const fill = Math.max(
    scales.width / Math.max(scales.width + scales.spacing, 1e-4),
    0.05,
  );
  const core = scaleCell(scales.shape, cu / fill, cv / fill);
  if (core <= 0) return 0;
  // L'arrondi bombe l'ecaille au lieu de la laisser en biseau droit.
  const round = scales.rounding / 100;
  return core * (1 - round) + Math.sqrt(core) * round;
}

// ---------------------------------------------------------------------------
// Champ complet
// ---------------------------------------------------------------------------

export interface SurfaceDetail {
  /** Deplacement radial en cm, a la station p et a l'angle theta. */
  displace: (p: number, theta: number) => number;
  /** Vrai si au moins un decal ou la trame d'ecailles est actif. */
  active: boolean;
  /**
   * Plus petit detail porte par le champ, en cm. Le mailleur s'en sert pour
   * choisir une resolution capable de le montrer.
   */
  finest: number;
}

/**
 * Assemble decals et ecailles en un seul champ interrogeable.
 *
 * `bakeScales` decide si la trame entre dans la geometrie : a l'affichage
 * courant elle est rendue en normal map, bien moins couteuse qu'un maillage
 * capable de porter une ecaille d'un millimetre.
 */
export function createSurfaceDetail(
  profile: ProfileSampler,
  params: LureParams,
  bakeScales: boolean,
): SurfaceDetail | null {
  const decals = params.decals
    .filter((decal) => decal.visible)
    .map((decal) => bakeDecal(profile, decal))
    .filter((baked): baked is BakedDecal => baked !== null);

  const scales = params.scales.enabled && bakeScales ? params.scales : null;
  if (decals.length === 0 && !scales) return null;

  const lengthCm = profile.lengthCm;
  const scaleAmplitude = scales
    ? (scales.style === 'raised' ? 1 : -1) * scales.depth * MM_TO_CM
    : 0;
  const marginTop = scales ? scales.marginTop / 100 : 0;
  const marginBottom = scales ? scales.marginBottom / 100 : 0;

  const displace = (p: number, theta: number): number => {
    const section = profile.section(p);
    const x = profile.xAt(p);
    const topAbs = section.top;
    const bottomAbs = -section.bottom;
    // Position du point dans le plan de profil, sans les details : c'est de
    // la SILHOUETTE que part la projection, exactement comme un tampon
    // applique de cote.
    const cosT = Math.cos(theta);
    const y = (cosT >= 0 ? cosT * topAbs : cosT * bottomAbs);
    const lateral = Math.abs(Math.sin(theta));

    let total = 0;

    if (decals.length > 0) {
      // Le decal est projete depuis le flanc : il ne mord plus quand la peau
      // se derobe vers le dos ou le ventre, sinon il baverait sur l'arete.
      const facing = smooth((lateral - 0.15) / 0.35);
      if (facing > 0) {
        for (const baked of decals) {
          if (!baked.mirror && Math.sin(theta) < 0) continue;
          const dx = (x - baked.cx) * baked.perCm;
          const dy = (y - baked.cy) * baked.perCm;
          const lx = dx * baked.cos + dy * baked.sin;
          const ly = -dx * baked.sin + dy * baked.cos;
          const signed = baked.field.at(lx, ly);
          if (signed <= 0) continue;
          const weight = baked.ramp > 1e-4 ? smooth(signed / baked.ramp) : 1;
          total += baked.amplitude * weight * facing;
        }
      }
    }

    if (scales) {
      // Marges : la trame s'eteint avant le dos et avant le ventre, la ou une
      // projection laterale s'etirerait en trainees.
      const height = cosT; // 1 = dos, -1 = ventre
      const fade =
        smooth((1 - marginTop * 2 - height) / 0.25) *
        smooth((height + 1 - marginBottom * 2) / 0.25);
      if (fade > 0) {
        let u: number;
        let v: number;
        if (scales.fit === 'lateral') {
          // Tampon lateral : taille uniforme, lue dans le plan de profil.
          u = x;
          v = y;
        } else {
          // Enveloppe : la trame suit la surface, donc l'abscisse curviligne.
          const perimeter = Math.PI * (section.halfWidth + (topAbs + bottomAbs) / 2);
          u = p * lengthCm;
          v = (theta / (Math.PI * 2)) * Math.max(perimeter, 1e-3);
        }
        const height01 = scaleField(scales, u, v);
        if (height01 > 0) {
          total += scaleAmplitude * height01 * fade;
        } else if (scales.style === 'engraved') {
          // En grave, ce sont les interstices qui descendent : hors ecaille,
          // la peau reste a son niveau et l'ecaille ressort en creux.
          total += scaleAmplitude;
        }
      }
    }

    return total;
  };

  const finest = scales
    ? Math.max(Math.min(scales.width, scales.height) * MM_TO_CM, 0.02)
    : Math.max(lengthCm / 200, 0.02);

  return { displace, active: true, finest };
}
