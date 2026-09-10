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
import type { Decal, Inlay, LureParams, ScalesConfig } from '../types/lure';
import { MM_TO_CM, type ProfileSampler } from './profile';
import {
  bakeSignedField,
  flattenOutline,
  inlayShapePoints,
  roundCorners,
  type SignedField,
} from './outline';

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

/** Une rainure cuite : meme parametrage qu'un decal, autre effet. */
interface BakedInlay {
  field: SignedField;
  cx: number;
  cy: number;
  cos: number;
  sin: number;
  perCm: number;
  /** Profondeur du creux, en cm. */
  depth: number;
  /** Marge peripherique, en unites de contour. */
  margin: number;
  mirror: boolean;
}

function bakeInlay(profile: ProfileSampler, inlay: Inlay): BakedInlay | null {
  const raw =
    inlay.shape === 'custom' ? flattenOutline(inlay.outline) : inlayShapePoints(inlay.shape);
  if (raw.length < 3) return null;

  // Le rayon d'angle est donne en millimetres reels : il faut donc le
  // ramener dans les unites du contour avant d'arrondir.
  const widthCm = Math.max(inlay.size * MM_TO_CM, 0.05);
  const spanRaw = Math.max(
    Math.max(...raw.map((p) => p.x)) - Math.min(...raw.map((p) => p.x)),
    1e-6,
  );
  const perCm = spanRaw / widthCm;
  const flat = roundCorners(raw, inlay.cornerRadius * MM_TO_CM * perCm);

  const field = bakeSignedField(flat);
  if (!field) return null;

  const section = profile.section(THREE.MathUtils.clamp(inlay.position, 0, profile.bodyEnd));
  const cy = inlay.height >= 0 ? inlay.height * section.top : -inlay.height * section.bottom;
  const angle = THREE.MathUtils.degToRad(inlay.rotation);

  return {
    field,
    cx: profile.xAt(THREE.MathUtils.clamp(inlay.position, 0, profile.bodyEnd)),
    cy,
    cos: Math.cos(angle),
    sin: Math.sin(angle),
    perCm,
    depth: inlay.depth * MM_TO_CM,
    margin: inlay.margin * MM_TO_CM * perCm,
    mirror: inlay.mirror,
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

// ---------------------------------------------------------------------------
// Nervures transversales — module O.1
// ---------------------------------------------------------------------------

/**
 * Champ de nervures : des anneaux en relief perpendiculaires a l'axe.
 *
 * La hauteur est une fonction PERIODIQUE de la distance parcourue le long du
 * corps, ce qui donne un pas constant en millimetres quelle que soit la
 * longueur du leurre — et non un nombre fixe d'anneaux qui s'ecarteraient sur
 * un grand modele. L'inclinaison ajoute simplement un terme proportionnel a
 * la position autour de la section, exactement comme une helice.
 *
 * Les nervures DOMINENT les ecailles : la ou les deux existent, l'ecaille se
 * plaque sur la nervure au lieu de s'y ajouter, sinon les deux reliefs se
 * cumuleraient et la surface deviendrait du bruit.
 */
/**
 * Angle d'inclinaison REELLEMENT obtenu, en degres.
 *
 * Une helice sur un corps ferme doit avancer d'un nombre entier de pas par
 * tour ; l'angle demande est donc arrondi au plus proche angle qui ferme.
 * L'interface affiche celui-la, pas celui du curseur.
 */
export function ribSlantEffective(params: LureParams): number {
  const ribs = params.ribs;
  const pitchCm = Math.max(ribs.pitch * MM_TO_CM, 0.02);
  const meanRadius = Math.max(((params.thickness + params.maxWidth) * MM_TO_CM) / 4, 0.05);
  const turnCm = 2 * Math.PI * meanRadius;
  const wanted = Math.tan((Math.min(Math.max(ribs.slant, -45), 45) * Math.PI) / 180);
  const turns = Math.round((wanted * turnCm) / pitchCm);
  return (Math.atan((turns * pitchCm) / turnCm) * 180) / Math.PI;
}

export function ribField(
  params: LureParams,
  lengthCm: number,
): ((p: number, theta: number) => number) | null {
  const ribs = params.ribs;
  if (!ribs.enabled || ribs.height <= 0.005 || ribs.to - ribs.from <= 0.01) return null;

  const pitchCm = Math.max(ribs.pitch * MM_TO_CM, 0.02);
  const heightCm = ribs.height * MM_TO_CM;
  // Rayon moyen : convertit un angle de section en distance parcourue, ce qui
  // donne a l'inclinaison le meme sens qu'une helice sur un cylindre.
  const meanRadius = Math.max(((params.thickness + params.maxWidth) * MM_TO_CM) / 4, 0.05);

  // Inclinaison QUANTIFIEE.
  //
  // Une nervure inclinee est une helice, et une helice sur un corps ferme
  // doit se refermer sur elle-meme : en un tour complet de section, elle doit
  // avancer d'un nombre ENTIER de pas. Autrement le motif ne raccorde pas a
  // la couture theta = 0, et le maillage s'ouvre — c'est exactement ce que le
  // test a montre. On arrondit donc l'angle demande au plus proche angle qui
  // ferme, et l'interface affiche l'angle reellement obtenu.
  const turnCm = 2 * Math.PI * meanRadius;
  const wanted = Math.tan((Math.min(Math.max(ribs.slant, -45), 45) * Math.PI) / 180);
  const turns = Math.round((wanted * turnCm) / pitchCm);
  const slant = (turns * pitchCm) / turnCm;

  /** Profil d'une nervure sur un cycle : u dans [0, 1). */
  const shape = (u: number): number => {
    // Centre le motif : la crete tombe au milieu du cycle.
    const t = Math.abs(u - 0.5) * 2; // 0 a la crete, 1 dans le creux
    switch (ribs.profile) {
      case 'triangle':
        return Math.max(1 - t, 0);
      case 'square':
        // Creneau adouci sur un dixieme de pas : une arete franche ne
        // s'imprime pas et fait exploser le maillage en pointes.
        return t < 0.5 ? 1 : t > 0.6 ? 0 : (0.6 - t) / 0.1;
      default:
        return 0.5 * (1 + Math.cos(Math.PI * Math.min(t, 1)));
    }
  };

  return (p: number, theta: number): number => {
    if (p < ribs.from || p > ribs.to) return 0;
    // Fondu aux deux bouts de la zone : une nervure qui s'arrete net laisse
    // une marche que l'impression rend visible.
    const fade = Math.min(
      1,
      Math.min(p - ribs.from, ribs.to - p) / Math.max((ribs.to - ribs.from) * 0.08, 1e-4),
    );
    const along = p * lengthCm + slant * theta * meanRadius;
    const u = ((along / pitchCm) % 1 + 1) % 1;
    return heightCm * shape(u) * fade;
  };
}

export function createSurfaceDetail(
  profile: ProfileSampler,
  params: LureParams,
  bakeScales: boolean,
): SurfaceDetail | null {
  const decals = params.decals
    .filter((decal) => decal.visible)
    .map((decal) => bakeDecal(profile, decal))
    .filter((baked): baked is BakedDecal => baked !== null);

  const inlays = params.inlays
    .filter((inlay) => inlay.visible)
    .map((inlay) => bakeInlay(profile, inlay))
    .filter((baked): baked is BakedInlay => baked !== null);

  const scales = params.scales.enabled && bakeScales ? params.scales : null;
  const ribs = ribField(params, profile.lengthCm);
  const ribHeightCm = ribs ? params.ribs.height * MM_TO_CM : 0;
  if (decals.length === 0 && inlays.length === 0 && !scales && !ribs) return null;

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

    // Nervures d'abord : elles portent le relief, et les ecailles viendront se
    // plaquer PAR-DESSUS au lieu de s'y ajouter.
    const rib = ribs ? ribs(p, theta) : 0;
    total += rib;

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
        // Les nervures dominent : sur une crete l'ecaille s'aplatit au quart
        // de son relief, dans un creux elle reste entiere. Deux reliefs
        // cumules ne donnent pas une surface plus riche, ils donnent du bruit.
        const crest = ribHeightCm > 0 ? Math.min(rib / ribHeightCm, 1) : 0;
        const under = 1 - 0.75 * crest;
        if (height01 > 0) {
          total += scaleAmplitude * height01 * fade * under;
        } else if (scales.style === 'engraved') {
          // En grave, ce sont les interstices qui descendent : hors ecaille,
          // la peau reste a son niveau et l'ecaille ressort en creux.
          total += scaleAmplitude;
        }
      }
    }

    // --- Rainures de collant ---------------------------------------------
    // Le fond est une surface de COLLAGE : il ne suit ni les ecailles ni les
    // decals. A l'interieur, tout le relief accumule plus haut est efface et
    // remplace par un creux net. La transition tient en un dixieme de
    // millimetre — un bord flou ne collerait pas mieux et se verrait.
    for (const inlay of inlays) {
      if (!inlay.mirror && Math.sin(theta) < 0) continue;
      if (lateral < 0.12) continue;
      const dx = (x - inlay.cx) * inlay.perCm;
      const dy = (y - inlay.cy) * inlay.perCm;
      const lx = dx * inlay.cos + dy * inlay.sin;
      const ly = -dx * inlay.sin + dy * inlay.cos;
      // La marge peripherique elargit le creux autour du collant.
      const signed = inlay.field.at(lx, ly) + inlay.margin;
      if (signed <= 0) continue;
      const edge = Math.max(0.01 * inlay.perCm, 1e-4);
      const weight = smooth(signed / edge);
      total = total * (1 - weight) - inlay.depth * weight;
    }

    return total;
  };

  const finest = scales
    ? Math.max(Math.min(scales.width, scales.height) * MM_TO_CM, 0.02)
    : Math.max(lengthCm / 200, 0.02);

  return { displace, active: true, finest };
}
