/**
 * Assemblage visse des demi-coques — module U.
 *
 * La vis entre par le VENTRE, remonte dans le plan de symetrie et se serre
 * dans un ecrou hexagonal captif, a cheval sur les deux demi-coques. Tete et
 * ecrou portent donc chacun pour moitie sur chaque moitie : c'est le serrage
 * lui-meme qui plaque les deux coques l'une contre l'autre, et le passage,
 * lui aussi a cheval, qui les aligne.
 *
 * Tout ce qui suit est du catalogue : cotes normalisees de vis et d'ecrous,
 * conventions de mesure de longueur, jeux. Rien n'y est invente — la seule
 * chose que le module calcule, c'est OU poser la portee d'ecrou pour que la
 * vis soit entierement engagee en fin de serrage, et si ca tient.
 */

import * as THREE from 'three';
import type { LureParams, ScrewHead, ScrewSize } from '../types/lure';
import { MM_TO_CM, type ProfileSampler } from './profile';

/** Longueurs proposees, en mm. Aucune autre n'est offerte. */
export const SCREW_LENGTHS = [15, 20, 25, 30, 35] as const;

/** Masse volumique de l'acier inox, en g/cm3. */
const STAINLESS = 7.9;

export interface ScrewSpec {
  size: ScrewSize;
  /** Diametre nominal du filetage, en mm. */
  nominal: number;
  /** Percage de passage, en mm. */
  clearance: number;
  /** Tete fraisee 90 deg (DIN 965) : diametre et hauteur, en mm. */
  countersunk: { diameter: number; height: number };
  /** Tete cylindrique six pans creux (DIN 912) : diametre et hauteur, en mm. */
  socket: { diameter: number; height: number };
  /** Ecrou hexagonal DIN 934 : entre-plats et epaisseur nominaux, en mm. */
  nut: { across: number; thickness: number };
  /** Hauteur de corps a partir de laquelle ce diametre est suggere, en mm. */
  from: number;
}

export const SCREWS: Record<ScrewSize, ScrewSpec> = {
  M2: {
    size: 'M2',
    nominal: 2,
    clearance: 2.4,
    countersunk: { diameter: 3.8, height: 1.2 },
    socket: { diameter: 3.8, height: 2 },
    nut: { across: 4, thickness: 1.6 },
    from: 0,
  },
  M3: {
    size: 'M3',
    nominal: 3,
    clearance: 3.4,
    countersunk: { diameter: 6, height: 1.65 },
    socket: { diameter: 5.5, height: 3 },
    nut: { across: 5.5, thickness: 2.4 },
    from: 22,
  },
  M4: {
    size: 'M4',
    nominal: 4,
    clearance: 4.3,
    countersunk: { diameter: 8, height: 2.2 },
    socket: { diameter: 7, height: 4 },
    nut: { across: 7, thickness: 3.2 },
    from: 35,
  },
};

export const SCREW_SIZES: ScrewSize[] = ['M2', 'M3', 'M4'];

export const HEAD_LABEL: Record<ScrewHead, string> = {
  countersunk: 'Fraisee 90 deg (DIN 965)',
  socket: 'Cylindrique six pans (DIN 912)',
};

/** Retrait minimal de la tete sous la surface du ventre, en cm. */
const RECESS = 0.02;

/** Peau conservee entre un logement et la surface, en cm. */
const SKIN = 0.05;

/** Epaulement plein conserve au-dessus de l'ecrou, cote dos, en cm. */
const SHOULDER = 0.08;

/**
 * Diametre suggere par la hauteur du corps a l'emplacement de la vis.
 *
 * M2 sous 22 mm, M3 de 22 a 35, M4 au-dela. Modifiable a la main : c'est une
 * suggestion, pas une regle.
 */
export function suggestSize(heightMm: number): ScrewSize {
  if (heightMm >= SCREWS.M4.from) return 'M4';
  if (heightMm >= SCREWS.M3.from) return 'M3';
  return 'M2';
}

/** Cotes de tete retenues selon le type. */
export const headOf = (spec: ScrewSpec, head: ScrewHead) =>
  head === 'countersunk' ? spec.countersunk : spec.socket;

/**
 * Longueur utile, en mm : la distance entre la face d'appui de la tete et
 * l'extremite de la vis.
 *
 * La convention change avec le type de tete, et c'est elle qui deplace la
 * portee d'ecrou :
 *   - tete fraisee    : la longueur nominale INCLUT la tete ;
 *   - tete cylindrique: elle est mesuree SOUS la tete.
 */
export function usefulLength(spec: ScrewSpec, head: ScrewHead, lengthMm: number): number {
  return head === 'countersunk' ? lengthMm - spec.countersunk.height : lengthMm;
}

export interface ScrewPlan {
  id: string;
  spec: ScrewSpec;
  head: ScrewHead;
  /** Longueur nominale retenue, en mm. */
  lengthMm: number;
  /** Longueur utile calculee, en mm — affichee pour verification. */
  usefulMm: number;
  /** Abscisse de la vis, en cm. */
  x: number;
  /** Ordonnee de la surface du ventre a cet endroit, en cm. */
  bellyY: number;
  /** Ordonnee du dessus de tete : sous le ventre, d'au moins 0,2 mm. */
  headTopY: number;
  /** Ordonnee de la face d'appui de la tete, en cm. */
  bearingY: number;
  /** Ordonnee de la pointe de la vis, en cm. */
  tipY: number;
  /** Logement de tete : rayon et profondeur, en cm. */
  headSeat: { radius: number; depth: number };
  /** Rayon du percage de passage, en cm. */
  boreRadius: number;
  /** Portee d'ecrou : entre-plats genere, epaisseur generee, en cm. */
  nut: { across: number; thickness: number; fromY: number; toY: number };
  /** Masse de la vis et de son ecrou, en g. */
  massG: number;
  valid: boolean;
  problem: string | null;
  /** Plus grande longueur du catalogue qui tienne ici, ou null. */
  longestFit: number | null;
}

/** Masse d'une vis et de son ecrou, en g. */
function hardwareMass(spec: ScrewSpec, head: ScrewHead, lengthMm: number): number {
  const r = (spec.nominal * MM_TO_CM) / 2;
  const shank = Math.PI * r * r * (usefulLength(spec, head, lengthMm) * MM_TO_CM);
  const cap = headOf(spec, head);
  const capRadius = (cap.diameter * MM_TO_CM) / 2;
  // La tete fraisee est un cone tronque, la cylindrique un disque plein.
  const capVolume =
    head === 'countersunk'
      ? (Math.PI * cap.height * MM_TO_CM * (capRadius * capRadius + capRadius * r + r * r)) / 3
      : Math.PI * capRadius * capRadius * cap.height * MM_TO_CM;
  // Ecrou : prisme hexagonal moins le trou de filetage.
  const across = spec.nut.across * MM_TO_CM;
  const hex = (Math.sqrt(3) / 2) * across * across;
  const nut = (hex - Math.PI * r * r) * spec.nut.thickness * MM_TO_CM;
  return (shank + capVolume + nut) * STAINLESS;
}

/**
 * Place et verifie chaque vis.
 *
 * Le placement n'a qu'un degre de liberte reel : la profondeur de la portee
 * d'ecrou, imposee par la longueur utile. Tout le reste est du controle —
 * la tete doit se noyer, l'ecrou doit porter sur de la matiere, et rien ne
 * doit percer la peau.
 */
export function planScrews(
  profile: ProfileSampler,
  params: LureParams,
  /** Obstacles internes deja poses, en coordonnees du plan de joint. */
  obstacles: { center: THREE.Vector2; radius: number; label: string }[] = [],
): ScrewPlan[] {
  const config = params.screws;
  if (!config.enabled) return [];
  return config.screws.map((screw) => {
    const p = Math.min(Math.max(screw.position, 0.04), profile.bodyEnd - 0.04);
    const x = profile.xAt(p);
    /** Position annoncee : depuis le nez, comme partout ailleurs. */
    const fromNose = ((x - profile.xAt(0)) / MM_TO_CM).toFixed(0);
    const section = profile.section(p);
    const heightMm = (section.top - section.bottom) / MM_TO_CM;
    const size = screw.size === 'auto' ? suggestSize(heightMm) : screw.size;
    const spec = SCREWS[size];
    const head = screw.head;
    const cap = headOf(spec, head);

    const bellyY = section.bottom;
    const headTopY = bellyY + RECESS;
    const bearingY = headTopY + cap.height * MM_TO_CM;
    const useful = usefulLength(spec, head, screw.length);
    const tipY = bearingY + useful * MM_TO_CM;

    const across = (spec.nut.across + config.nutFit) * MM_TO_CM;
    const thickness = (spec.nut.thickness + config.nutFit) * MM_TO_CM;
    // L'ecrou est plaque contre son epaulement : sa face DOS tombe sur la
    // pointe de la vis, de sorte que le filetage est entierement engage sans
    // rien depasser au-dela.
    const nutToY = tipY;
    const nutFromY = tipY - thickness;

    const headSeat = {
      radius: (cap.diameter * MM_TO_CM) / 2,
      depth: (cap.height * MM_TO_CM) + RECESS,
    };
    const boreRadius = (spec.clearance * MM_TO_CM) / 2;

    let valid = true;
    let problem: string | null = null;

    // La tete doit se noyer : il faut assez de largeur de section a cette
    // hauteur pour la loger, sinon elle ressortirait par le flanc.
    const halfAtBelly = section.halfWidth;
    if (headSeat.radius + SKIN > halfAtBelly) {
      valid = false;
      problem =
        `Vis a ${fromNose} mm : la tete ${size} mesure ` +
        `${cap.diameter.toFixed(1)} mm alors que le corps n offre que ` +
        `${(halfAtBelly * 20).toFixed(1)} mm de large. Passez au diametre inferieur.`;
    }

    // L'ecrou doit porter sur de la matiere, epaulement compris.
    if (valid && nutToY + SHOULDER > section.top - SKIN) {
      valid = false;
      problem =
        `Vis a ${fromNose} mm : une ${size} de ${screw.length} mm ressort par le dos. ` +
        'Prenez une longueur plus courte.';
    }
    if (valid && nutFromY < bearingY + 0.05) {
      valid = false;
      problem =
        `Vis a ${fromNose} mm : la ${size} de ${screw.length} mm est trop courte pour ` +
        'atteindre une portee utile. Prenez une longueur plus grande.';
    }
    if (valid && across / 2 + SKIN > halfAtBelly) {
      valid = false;
      problem =
        `Vis a ${fromNose} mm : la portee d ecrou ${size} mesure ` +
        `${across.toFixed(2)} cm entre plats et percerait le flanc. Passez au diametre inferieur.`;
    }
    if (valid) {
      for (const obstacle of obstacles) {
        const dx = Math.abs(obstacle.center.x - x);
        const inside =
          obstacle.center.y >= headTopY - obstacle.radius &&
          obstacle.center.y <= nutToY + obstacle.radius;
        if (inside && dx < obstacle.radius + across / 2) {
          valid = false;
          problem =
            `Vis a ${fromNose} mm : le passage coupe ${obstacle.label}. ` +
            'Deplacez la vis le long du corps.';
          break;
        }
      }
    }

    // Plus grande longueur du catalogue qui tienne ici, epaulement compris.
    let longestFit: number | null = null;
    for (const candidate of SCREW_LENGTHS) {
      const tip = bearingY + usefulLength(spec, head, candidate) * MM_TO_CM;
      if (tip + SHOULDER <= section.top - SKIN && tip - thickness >= bearingY + 0.05) {
        longestFit = candidate;
      }
    }

    return {
      id: screw.id,
      spec,
      head,
      lengthMm: screw.length,
      usefulMm: useful,
      x,
      bellyY,
      headTopY,
      bearingY,
      tipY,
      headSeat,
      boreRadius,
      nut: { across, thickness, fromY: nutFromY, toY: nutToY },
      massG: hardwareMass(spec, head, screw.length),
      valid,
      problem,
      longestFit,
    };
  });
}

/** Volume retire par les percages et les logements, en cm3. */
export function screwVolumes(plans: ScrewPlan[]): number {
  let removed = 0;
  for (const plan of plans) {
    if (!plan.valid) continue;
    const bore = Math.PI * plan.boreRadius * plan.boreRadius * (plan.tipY - plan.bearingY);
    const seat =
      Math.PI * plan.headSeat.radius * plan.headSeat.radius * plan.headSeat.depth;
    const hex =
      (Math.sqrt(3) / 2) * plan.nut.across * plan.nut.across * plan.nut.thickness;
    removed += bore + seat + hex;
  }
  return removed;
}

/** Contour hexagonal d'une portee d'ecrou, entre-plats donne. */
export function hexOutline(center: THREE.Vector2, across: number): THREE.Vector2[] {
  // Entre-plats : le rayon circonscrit vaut across / racine(3).
  const radius = across / Math.sqrt(3);
  const points: THREE.Vector2[] = [];
  for (let i = 0; i < 6; i++) {
    // Un sommet en haut : deux faces verticales, l'ecrou ne tourne pas au
    // serrage puisqu'il bute sur les flancs du logement.
    const a = Math.PI / 6 + (i / 6) * Math.PI * 2;
    points.push(
      new THREE.Vector2(center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius),
    );
  }
  return points;
}
