/**
 * Leurre articule : le corps coupe en segments relies par une vraie
 * quincaillerie.
 *
 * Le joint est une ENCOCHE EN V vue de dessus. Le segment avant se termine
 * en pointe sur l'axe de charniere ; le segment arriere s'ouvre en V pour la
 * recevoir. Les deux faces divergent en s'ecartant de l'axe, et c'est cet
 * ecart qui donne le debattement : le segment arriere tourne jusqu'a ce que
 * l'une des deux faces vienne au contact de l'autre.
 *
 *   face avant   : x = xJoint - |z| . tan(beta)
 *   face arriere : x = xJoint + jeu - |z| . tan(beta - debattement / 2)
 *
 * Il en decoule que le debattement demande EST le debattement obtenu, et
 * qu'aucune des deux faces ne peut mordre dans l'autre : leur ecart vaut le
 * jeu de joint sur l'axe et ne fait que croitre ensuite.
 */

import * as THREE from 'three';
import type { ArticulationConfig, LureParams } from '../types/lure';
import { clamp, MM_TO_CM, type ProfileSampler } from './profile';

/** Un oeillet a vis : boucle sur l'axe de charniere, tige noyee dans le corps. */
export interface EyePlacement {
  /** Hauteur de la boucle sur l'axe de charniere, en cm. */
  y: number;
  /** Rayon moyen de la boucle, en cm. */
  loopRadius: number;
  /** Rayon du fil, en cm. */
  wireRadius: number;
  /** Longueur hors-tout, en cm. */
  length: number;
  /** Vrai si l'oeillet part du segment arriere vers l'avant. */
  fromRear: boolean;
}

export interface ArticulationPlan {
  /** Abscisse de l'axe de charniere, en cm. */
  xJoint: number;
  /** Station du profil correspondante. */
  pJoint: number;
  /** Biseau de la face avant, en radians depuis le plan transversal. */
  faceAngle: number;
  /** Biseau de la face arriere : plus ouvert, c'est lui qui libere le jeu. */
  rearAngle: number;
  /** Jeu de joint, en cm. */
  clearance: number;
  /** Debattement reellement obtenu, en degres (total, moitie de chaque cote). */
  swing: number;
  /** Demi-largeur du corps a la coupe, en cm. */
  halfWidth: number;
  /** Hauteur de la section a la coupe : bas et haut, en cm. */
  bottom: number;
  top: number;
  eyes: EyePlacement[];
  /** Goupille verticale : rayon et hauteur, en cm. */
  pin: { radius: number; from: number; to: number } | null;
  /**
   * Logement de la quincaillerie, en cm.
   *
   * Ce n'est PAS un jeu statique autour de la piece au repos : `halfMouth` et
   * `halfFloor` decrivent un secteur angulaire, ouvert de `sweep` de chaque
   * cote de l'axe de charniere, qui contient tout le volume balaye par la
   * quincaillerie sur sa course. Un logement a parois paralleles bloquerait
   * le mecanisme des le premier degre.
   */
  slot: {
    /** Demi-epaisseur de la piece au repos, jeu compris, en cm. */
    halfThickness: number;
    from: number;
    to: number;
    depth: number;
    /** Demi-angle du secteur balaye : debattement / 2 + marge de securite. */
    sweep: number;
    /** Jeu de fonctionnement applique sur toutes les faces, en cm. */
    fit: number;
    /** Demi-largeur du secteur a la bouche et au fond, en cm. */
    halfMouth: number;
    halfFloor: number;
  };
  /** Masse totale de la quincaillerie, en g. */
  hardwareMass: number;
  /** Vrai tant que les masses ne sont pas renseignees. */
  massUnknown: boolean;
}

/**
 * Marge de securite ajoutee de chaque cote du debattement demande.
 *
 * Trois degres : de quoi absorber le retrait d'impression et le jeu des
 * oeillets sans que la quincaillerie vienne toucher le fond du secteur.
 */
const SWEEP_MARGIN = THREE.MathUtils.degToRad(3);

/** Recherche de la station qui tombe sur une abscisse donnee. */
function pAtX(profile: ProfileSampler, x: number): number {
  let lo = 0;
  let hi = profile.bodyEnd;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (profile.xAt(mid) < x) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Cotes du joint, ou `null` si l'articulation ne tient pas dans ce corps.
 *
 * Un segment trop court ne s'imprime pas et ne nage pas : mieux vaut le dire
 * que produire une piece impossible.
 */
export function articulationPlan(
  profile: ProfileSampler,
  params: LureParams,
): ArticulationPlan | null {
  const config = params.articulation;
  if (!config.enabled) return null;

  const lengthCm = profile.lengthCm;
  const noseX = profile.xAt(0);
  // Position par defaut : au milieu du corps si l'utilisateur n'a rien pose.
  const wanted = config.positionMm > 0 ? config.positionMm * MM_TO_CM : lengthCm * 0.55;
  const xJoint = noseX + clamp(wanted, lengthCm * 0.18, lengthCm * 0.85);
  const pJoint = pAtX(profile, xJoint);
  const section = profile.section(pJoint);
  if (section.halfWidth < 0.05) return null;

  const faceAngle = THREE.MathUtils.degToRad(clamp(config.faceAngle, 0, 89));
  // Le debattement est obtenu en OUVRANT la face arriere : elle recule plus
  // vite que la face avant, et l'ecart entre les deux est l'angle libre.
  const swingRad = THREE.MathUtils.degToRad(clamp(config.swing, 0, 179));
  const rearAngle = Math.max(faceAngle - swingRad / 2, 0);
  const swing = THREE.MathUtils.radToDeg((faceAngle - rearAngle) * 2);

  const clearance = config.clearance * MM_TO_CM;
  const wireRadius = (config.eyeWire * MM_TO_CM) / 2;
  const loopRadius = Math.max((config.eyeLoop * MM_TO_CM) / 2 - wireRadius, wireRadius);

  const pin =
    config.hardware === 'pin'
      ? {
          radius: Math.max(wireRadius * 1.15, 0.045),
          from: section.bottom + 0.04,
          to: section.top - 0.04,
        }
      : null;

  const fit = Math.max(config.jointFit, 0) * MM_TO_CM;
  const halfThickness = Math.max((config.slotHeight * MM_TO_CM) / 2, 0.03) + fit;
  // La fente est bornee par la hauteur utile : deux millimetres de peau au
  // dos et au ventre, sinon elle deboucherait par le dessus.
  const usableHalf = Math.max((section.top - section.bottom) / 2 - 0.2, 0.05);
  const slotHalf = Math.min((config.slotWidth * MM_TO_CM) / 2, usableHalf);
  const mid = (section.top + section.bottom) / 2;
  const depth = Math.max(config.slotDepth * MM_TO_CM, 0.05);

  // Secteur balaye : la moitie du debattement de chaque cote, plus une marge
  // de securite de trois degres. La demi-largeur du logement croit avec la
  // distance a l'axe — c'est ce qui en fait un secteur et non un couloir.
  const sweep = Math.min(swingRad / 2 + SWEEP_MARGIN, Math.PI / 2 - 0.05);
  const halfFloor = halfThickness / Math.cos(sweep) + depth * Math.tan(sweep);
  // La bouche est sur la face en V : plus le biseau est ouvert, plus elle
  // recule, donc plus le secteur s'y est deja elargi.
  const lever = Math.max(1 - Math.tan(sweep) * Math.tan(faceAngle), 0.2);
  const halfMouth = Math.min(halfThickness / Math.cos(sweep) / lever, halfFloor);
  const slot = {
    halfThickness,
    from: mid - slotHalf,
    to: mid + slotHalf,
    depth,
    sweep,
    fit,
    halfMouth,
    halfFloor,
  };

  // Oeillets repartis dans la FENTE, pas sur la hauteur de la section : une
  // boucle posee au-dela du bord de la fente est noyee dans la matiere, et
  // c'est la premiere raison pour laquelle rien ne tournait. La peau garde
  // son millimetre de marge, la fente le sien.
  const margin = loopRadius + wireRadius;
  const low = Math.max(section.bottom + margin + 0.1, slot.from + margin);
  const high = Math.min(section.top - margin - 0.1, slot.to - margin);
  const count = Math.max(1, Math.min(Math.round(config.eyeCount), 4));
  const eyes: EyePlacement[] = [];
  if (high >= low) {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      eyes.push({
        y: low + (high - low) * t,
        loopRadius,
        wireRadius,
        length: config.eyeLength * MM_TO_CM,
        // Les oeillets sont visses dans le segment ARRIERE et viennent
        // s'enfiler sur la goupille du segment avant.
        fromRear: true,
      });
    }
  }

  const hardwareMass = eyes.length * config.eyeMass + (pin ? config.pinMass : 0);
  return {
    xJoint,
    pJoint,
    faceAngle,
    rearAngle,
    clearance,
    swing,
    halfWidth: section.halfWidth,
    bottom: section.bottom,
    top: section.top,
    eyes,
    pin,
    slot,
    hardwareMass,
    massUnknown: config.eyeMass <= 0 || (pin !== null && config.pinMass <= 0),
  };
}

/**
 * Ajuste les cotes de la quincaillerie a la section reelle du corps.
 *
 * Le bouton « Ajuster au corps » de l'inspecteur appelle ceci : les oeillets
 * se redistribuent sur la hauteur utile et la goupille prend toute la hauteur
 * de la section a cette station.
 */
export function fitToBody(
  profile: ProfileSampler,
  config: ArticulationConfig,
): Partial<ArticulationConfig> {
  const lengthCm = profile.lengthCm;
  const wanted = config.positionMm > 0 ? config.positionMm * MM_TO_CM : lengthCm * 0.55;
  const p = pAtX(profile, profile.xAt(0) + clamp(wanted, lengthCm * 0.18, lengthCm * 0.85));
  const section = profile.section(p);
  const heightMm = ((section.top + section.bottom) / MM_TO_CM);
  return {
    // La fente occupe la hauteur utile de la section, moins deux millimetres
    // de peau de chaque cote.
    slotWidth: Math.max(Math.round((heightMm - 4) * 10) / 10, 2),
    slotDepth: Math.max(Math.round(Math.min(config.eyeLength * 0.6, heightMm) * 10) / 10, 1),
    positionMm: Math.round(((profile.xAt(p) - profile.xAt(0)) / MM_TO_CM) * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Quincaillerie affichee
// ---------------------------------------------------------------------------

const tube = (
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
): THREE.BufferGeometry => {
  const dir = new THREE.Vector3().subVectors(to, from);
  const length = dir.length();
  if (length < 1e-6) return new THREE.BufferGeometry();
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 16, 1);
  geometry.translate(0, length / 2, 0);
  geometry.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()),
  );
  geometry.translate(from.x, from.y, from.z);
  return geometry;
};

/**
 * Oeillets et goupille, pour l'affichage seulement.
 *
 * Comme l'agrafe de tete, cette quincaillerie pese dans la simulation mais ne
 * part jamais dans un fichier d'impression : elle s'achete, elle ne s'imprime
 * pas.
 */
export function buildJointHardware(plan: ArticulationPlan): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];

  for (const eye of plan.eyes) {
    // Boucle : un tore centre sur l'axe de charniere, dans le plan vertical
    // de la goupille — c'est par la que passe le fil de la goupille.
    const loop = new THREE.TorusGeometry(eye.loopRadius, eye.wireRadius, 10, 24);
    loop.rotateY(Math.PI / 2);
    loop.translate(plan.xJoint, eye.y, 0);
    parts.push(loop);

    // Tige : elle repart vers l'arriere, noyee dans le segment qui la porte.
    const start = new THREE.Vector3(plan.xJoint + eye.loopRadius, eye.y, 0);
    const end = new THREE.Vector3(plan.xJoint + eye.loopRadius + eye.length, eye.y, 0);
    parts.push(tube(start, end, eye.wireRadius));
  }

  if (plan.pin) {
    parts.push(
      tube(
        new THREE.Vector3(plan.xJoint, plan.pin.from, 0),
        new THREE.Vector3(plan.xJoint, plan.pin.to, 0),
        plan.pin.radius,
      ),
    );
  }

  if (parts.length === 0) return null;

  // Fusion manuelle : eviter une dependance de plus pour trois cylindres.
  let count = 0;
  for (const part of parts) count += part.getAttribute('position').count;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const indices: number[] = [];
  let vertexOffset = 0;
  let cursor = 0;
  for (const part of parts) {
    const pos = part.getAttribute('position');
    const nor = part.getAttribute('normal');
    positions.set(pos.array as Float32Array, cursor * 3);
    if (nor) normals.set(nor.array as Float32Array, cursor * 3);
    const index = part.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + vertexOffset);
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(i + vertexOffset);
    }
    vertexOffset += pos.count;
    cursor += pos.count;
    part.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setIndex(indices);
  return merged;
}

/**
 * Raison, en clair, qui empeche d'articuler ce corps — ou `null` si rien ne
 * s'y oppose.
 *
 * Mieux vaut dire pourquoi que masquer l'option : un menu ou l'entree existe
 * mais ne fait rien est pire qu'un menu ou elle manque.
 */
export function articulationBlocker(params: LureParams): string | null {
  // Deux segments demandent de la matiere de chaque cote du joint, plus la
  // place de la quincaillerie. En dessous, la piece ne s'imprime pas.
  const minimum = Math.max(params.articulation.eyeLength * 2.5, 45);
  if (params.length < minimum) {
    return (
      `Corps trop court pour une articulation : ${params.length.toFixed(0)} mm alors qu il en ` +
      `faut au moins ${minimum.toFixed(0)} mm pour loger la quincaillerie de part et d autre du joint.`
    );
  }
  if (params.shape === 'spoon') {
    return 'Une cuiller est une lame pleine : il n y a pas de section a couper en deux segments.';
  }
  return null;
}
