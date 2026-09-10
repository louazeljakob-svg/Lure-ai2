/**
 * Goupilles cylindriques d'assemblage.
 *
 * Deux demi-coques collees glissent l'une sur l'autre pendant la prise de la
 * colle : quelques barreaux suffisent a les aligner et a reprendre l'effort.
 * Les barreaux sont imprimes A PART, poses a plat a cote des coques, parce
 * qu'un cylindre couche sort bien mieux qu'un ergot dresse sur une face.
 *
 * Le logement en forme de 8 reste ce qu'il est : il recoit la quincaillerie
 * en fil d'acier. Les deux methodes repondent a deux besoins distincts et
 * cohabitent sans se connaitre.
 */

import * as THREE from 'three';
import type { DowelPin, LureParams } from '../types/lure';
import { MM_TO_CM, type ProfileSampler } from './profile';

export interface DowelPlacement {
  id: string;
  /** Centre du logement dans le plan de joint, en cm. */
  center: THREE.Vector2;
  /** Rayon du logement, jeu compris, en cm. */
  bore: number;
  /** Rayon de la goupille imprimee, en cm. */
  radius: number;
  /** Profondeur dans CHAQUE coque, en cm. */
  depth: number;
  /** Chanfrein d'entree, en cm. */
  chamfer: number;
  valid: boolean;
  problem: string | null;
}

/** Repartition automatique : des emplacements reguliers le long du corps. */
export function autoDowels(count: number): DowelPin[] {
  const pins: DowelPin[] = [];
  for (let i = 0; i < count; i++) {
    // On evite les deux pointes, ou la section n'a plus d'epaisseur.
    const t = count === 1 ? 0.5 : i / (count - 1);
    pins.push({ id: `goupille-${i}`, position: 0.18 + t * 0.64, height: 0 });
  }
  return pins;
}

export interface DowelObstacle {
  center: THREE.Vector2;
  radius: number;
  label: string;
}

/**
 * Place les goupilles et verifie chacune.
 *
 * Trois facons de se tromper, toutes signalees plutot que produites : le
 * logement qui perce la peau, celui qui coupe une chambre interne, et celui
 * qui vient buter dans la quincaillerie deja posee.
 */
export function planDowels(
  profile: ProfileSampler,
  params: LureParams,
  /** Epaisseur de matiere disponible de part et d'autre, a (x, t). */
  room: (x: number, t: number) => number,
  obstacles: DowelObstacle[],
): DowelPlacement[] {
  const config = params.dowels;
  if (!config.enabled) return [];

  const radius = (config.diameter * MM_TO_CM) / 2;
  const bore = radius + (config.clearance * MM_TO_CM) / 2;
  const depth = config.engagement * MM_TO_CM;
  const chamfer = config.chamfer * MM_TO_CM;
  const source = config.pins.length > 0 ? config.pins : autoDowels(config.count);

  return source.map((pin) => {
    const p = Math.min(Math.max(pin.position, 0.02), profile.bodyEnd - 0.02);
    const x = profile.xAt(p);
    const section = profile.section(p);
    const t =
      pin.height >= 0 ? pin.height * section.top : -pin.height * section.bottom;
    const center = new THREE.Vector2(x, t);

    let valid = true;
    let problem: string | null = null;

    // Le logement doit rester dans la section, avec de la peau autour.
    const margin = bore + chamfer + 0.05;
    if (t - margin < section.bottom || t + margin > section.top) {
      valid = false;
      problem =
        `Logement a ${(x * 10).toFixed(0)} mm : il sort de la section. Rapprochez-le de l axe ` +
        'ou reduisez le diametre.';
    }

    // Il doit aussi rester de la matiere DERRIERE le fond, sinon le barreau
    // ressort par le flanc.
    const available = room(x, t);
    if (valid && available < depth + 0.05) {
      valid = false;
      problem =
        `Logement a ${(x * 10).toFixed(0)} mm : la coque n offre que ` +
        `${(available * 10).toFixed(1)} mm alors que l engagement en demande ` +
        `${(depth * 10).toFixed(1)} mm. Raccourcissez l engagement.`;
    }

    if (valid) {
      for (const obstacle of obstacles) {
        if (center.distanceTo(obstacle.center) < obstacle.radius + bore + 0.05) {
          valid = false;
          problem =
            `Logement a ${(x * 10).toFixed(0)} mm : il vient buter dans ${obstacle.label}. ` +
            'Deplacez-le le long du corps.';
          break;
        }
      }
    }

    return { id: pin.id, center, bore, radius, depth, chamfer, valid, problem };
  });
}

/**
 * Barreaux imprimes, poses a plat a cote des coques.
 *
 * Longueur = deux engagements moins les deux chanfreins, pour que la
 * goupille disparaisse entierement dans les logements une fois les coques
 * jointes. Le chanfrein d'entree est repris sur le barreau lui-meme : c'est
 * lui qui fait qu'on l'engage sans forcer.
 */
export function buildDowelPins(placements: DowelPlacement[]): THREE.BufferGeometry | null {
  const kept = placements.filter((item) => item.valid);
  if (kept.length === 0) return null;

  const parts: THREE.BufferGeometry[] = [];
  kept.forEach((item, index) => {
    const length = item.depth * 2 - item.chamfer * 0.5;
    const geometry = new THREE.CylinderGeometry(
      item.radius - item.chamfer * 0.5,
      item.radius - item.chamfer * 0.5,
      length,
      24,
      1,
    );
    // Couche sur le plateau, alignee le long de l'axe du leurre.
    geometry.rotateZ(Math.PI / 2);
    geometry.translate(item.center.x, item.center.y, 0);
    parts.push(geometry);
    void index;
  });

  let count = 0;
  for (const part of parts) count += part.getAttribute('position').count;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const indices: number[] = [];
  let offset = 0;
  let cursor = 0;
  for (const part of parts) {
    const pos = part.getAttribute('position');
    const nor = part.getAttribute('normal');
    positions.set(pos.array as Float32Array, cursor * 3);
    if (nor) normals.set(nor.array as Float32Array, cursor * 3);
    const index = part.getIndex();
    if (index) for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + offset);
    else for (let i = 0; i < pos.count; i++) indices.push(i + offset);
    offset += pos.count;
    cursor += pos.count;
    part.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setIndex(indices);
  return merged;
}

/** Volume retire par les logements et ajoute par les barreaux, en cm3. */
export function dowelVolumes(placements: DowelPlacement[]): {
  removed: number;
  added: number;
} {
  let removed = 0;
  let added = 0;
  for (const item of placements) {
    if (!item.valid) continue;
    // Deux logements par goupille — un dans chaque coque.
    removed += Math.PI * item.bore * item.bore * item.depth * 2;
    const length = item.depth * 2 - item.chamfer * 0.5;
    const r = item.radius - item.chamfer * 0.5;
    added += Math.PI * r * r * length;
  }
  return { removed, added };
}
