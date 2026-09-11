/**
 * Test de collision du joint articule.
 *
 * Le logement ne se verifie pas a l'oeil : une piece qui passe au repos peut
 * mordre a huit degres. On rejoue donc la course par pas d'un degre et on
 * mesure, a chaque pas, ce que chaque piece mobile trouve devant elle.
 *
 * Convention : tout est exprime dans le repere du JOINT — origine sur l'axe
 * de charniere, x vers l'arriere du leurre, z lateral, y vertical. Le segment
 * arriere et sa quincaillerie tournent autour de (0, 0) ; le segment avant
 * est fixe. C'est le meme repere des deux cotes : il suffit d'echanger les
 * roles pour verifier la queue.
 */

import * as THREE from 'three';
import type { ArticulationPlan } from './articulation';
import { MM_TO_CM, type ProfileSampler } from './profile';

/** Une interference, avec de quoi la corriger. */
export interface JointHit {
  /** Angle ou elle apparait, en degres. Negatif = l'autre sens. */
  angleDeg: number;
  /** Piece mobile fautive. */
  part: string;
  /** Ce qu'elle rencontre. */
  against: string;
  /** Profondeur d'interference, en mm. */
  depthMm: number;
  /** Correction proposee, en clair. */
  remedy: string;
  /**
   * Vrai quand cette interference BORNE la course.
   *
   * Une piece qui manque de logement sans gener la rotation — la goupille
   * verticale, qui tourne sur son axe — est signalee sans amputer le
   * debattement annonce.
   */
  limiting: boolean;
}

export interface JointTravel {
  /** Debattement demande, en degres (total). */
  wanted: number;
  /** Debattement reellement libre, en degres (total). */
  free: number;
  /** Premiere interference rencontree en s'ecartant du repos. */
  first: JointHit | null;
  /** Une entree par piece fautive, dans l'ordre ou elles apparaissent. */
  hits: JointHit[];
}

/**
 * Obstacle supplementaire pose par un autre module — vis d'assemblage,
 * cylindre imprime, quincaillerie de suspension.
 *
 * `frame` dit dans quel repere il vit : ce qui est porte par le segment
 * arriere tourne avec lui, le reste est fixe.
 */
export interface JointObstacle {
  label: string;
  frame: 'body' | 'tail';
  /** Centre dans le repere du joint, en cm. */
  x: number;
  z: number;
  /** Plage verticale occupee, en cm. */
  from: number;
  to: number;
  /** Rayon d'encombrement, en cm. */
  radius: number;
}

/** Point tourne de `angle` autour de l'axe de charniere. */
const spin = (x: number, z: number, angle: number): [number, number] => [
  x * Math.cos(angle) - z * Math.sin(angle),
  x * Math.sin(angle) + z * Math.cos(angle),
];

/**
 * Profondeur de penetration d'un point dans la matiere d'un segment, en cm.
 *
 * Zero quand le point est libre. La valeur sert a classer les interferences :
 * un dixieme de millimetre se corrige au jeu, deux millimetres demandent de
 * revoir le debattement.
 */
function biteInto(
  x: number,
  z: number,
  y: number,
  plan: ArticulationPlan,
  rear: boolean,
): number {
  const slot = plan.slot;
  // Le segment avant occupe x <= face(z) ; l'arriere, x >= face(z). On raisonne
  // sur l'avant et on replie l'arriere par symetrie.
  const sign = rear ? -1 : 1;
  const angle = rear ? plan.rearAngle : plan.faceAngle;
  const apex = rear ? -plan.clearance : 0;
  const local = sign * x;
  const face = sign * apex - Math.abs(z) * Math.tan(angle);
  // Devant la face de coupe : rien.
  if (local > face) return 0;
  // Hors de la bande de la fente, ou au-dela du fond : matiere pleine.
  const depth = slot.depth;
  const room = plan.halfWidth * 0.65;
  const half = Math.min(slot.halfMouth, room);
  const halfFloor = Math.min(slot.halfFloor, room);
  if (y < slot.from || y > slot.to) return face - local;
  const floor = sign * apex - depth;
  if (local < floor) return floor - local;
  // Dans la bande : le secteur s'ouvre lineairement de la bouche au fond.
  const mouth = sign * apex - half * Math.tan(angle);
  const span = floor - mouth;
  const t = Math.abs(span) < 1e-9 ? 0 : Math.min(Math.max((local - mouth) / span, 0), 1);
  const allowed = half + (halfFloor - half) * t;
  return Math.abs(z) > allowed ? Math.abs(z) - allowed : 0;
}

/** Sommets d'une tige d'oeillet, dans le repere du joint au repos. */
function shankPoints(eye: ArticulationPlan['eyes'][number]): [number, number][] {
  const points: [number, number][] = [];
  const start = eye.loopRadius;
  const end = eye.loopRadius + eye.length;
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const x = start + ((end - start) * i) / steps;
    points.push([x, eye.wireRadius], [x, -eye.wireRadius]);
  }
  return points;
}

/** Sommets de la boucle d'un oeillet : un anneau centre sur l'axe. */
function loopPoints(eye: ArticulationPlan['eyes'][number]): [number, number][] {
  const points: [number, number][] = [];
  const radius = eye.loopRadius + eye.wireRadius;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    points.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return points;
}

/**
 * Rejoue la course du joint par pas d'un degre.
 *
 * Le balayage part du repos et s'ecarte des deux cotes : la premiere
 * interference rencontree est celle qui limite VRAIMENT le debattement, et
 * c'est elle que l'interface annonce.
 */
export function jointTravel(
  profile: ProfileSampler,
  plan: ArticulationPlan,
  obstacles: JointObstacle[] = [],
): JointTravel {
  const wanted = plan.swing;
  const limit = Math.max(wanted / 2, 0);
  const hits: JointHit[] = [];
  const seen = new Set<string>();
  let free = limit * 2;

  const record = (
    angleDeg: number,
    part: string,
    against: string,
    depth: number,
    remedy: string,
    limiting = true,
  ) => {
    const key = `${part}|${against}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ angleDeg, part, against, depthMm: depth / MM_TO_CM, remedy, limiting });
  };

  // --- Controles independants de l'angle ----------------------------------

  for (const [index, eye] of plan.eyes.entries()) {
    const label = plan.eyes.length > 1 ? `Oeillet ${index + 1}` : 'Oeillet';
    if (eye.y - eye.loopRadius - eye.wireRadius < plan.slot.from - 1e-9) {
      record(
        0,
        label,
        'bord bas de la fente',
        plan.slot.from - (eye.y - eye.loopRadius - eye.wireRadius),
        'Elargissez la fente (hauteur utile) ou remontez les oeillets.',
      );
    }
    if (eye.y + eye.loopRadius + eye.wireRadius > plan.slot.to + 1e-9) {
      record(
        0,
        label,
        'bord haut de la fente',
        eye.y + eye.loopRadius + eye.wireRadius - plan.slot.to,
        'Elargissez la fente (hauteur utile) ou descendez les oeillets.',
      );
    }
    if (plan.pin && eye.loopRadius < plan.pin.radius + plan.pin.loopFit / 2) {
      record(
        0,
        label,
        'cylindre de retention',
        plan.pin.radius + plan.pin.loopFit / 2 - eye.loopRadius,
        `Le cylindre de ${((plan.pin.radius * 2) / MM_TO_CM).toFixed(1)} mm ne passe pas dans ` +
          'la boucle. Prenez un oeillet a plus grande boucle, ou reduisez le diametre du cylindre.',
      );
    }
  }

  // La portee du cylindre de retention est taillee a l'axe de charniere sur
  // toute la hauteur du barreau. Reste a verifier qu'elle tient dans la
  // largeur du segment : au-dela, le cylindre ressortirait par le flanc.
  if (plan.pin) {
    const room = plan.halfWidth * 0.65;
    if (plan.pin.seat > room) {
      record(
        0,
        'Cylindre de retention',
        'flanc du segment',
        plan.pin.seat - room,
        `Le corps n offre que ${((room * 2) / MM_TO_CM).toFixed(1)} mm a la charniere. ` +
          'Reduisez le diametre du cylindre, ou deplacez le joint vers une section plus large.',
        false,
      );
    }
  }


  // --- Balayage par pas d'un degre ----------------------------------------
  const step = THREE.MathUtils.degToRad(1);
  const steps = Math.max(Math.ceil(limit / 1), 0);
  const parts: { label: string; y: number; points: [number, number][]; remedy: string }[] = [];
  for (const [index, eye] of plan.eyes.entries()) {
    const label = plan.eyes.length > 1 ? `Oeillet ${index + 1}` : 'Oeillet';
    parts.push({
      label: `${label} (tige)`,
      y: eye.y,
      points: shankPoints(eye),
      remedy:
        'Augmentez le jeu de fonctionnement, reduisez le debattement, ou raccourcissez les oeillets.',
    });
    parts.push({
      label: `${label} (boucle)`,
      y: eye.y,
      points: loopPoints(eye),
      // Une boucle qui mord ne tourne pas : c'est la HAUTEUR de fente qui est
      // en cause, pas le debattement.
      remedy:
        `Portez la hauteur de fente a au moins ` +
        `${(((eye.loopRadius + eye.wireRadius) * 2) / MM_TO_CM).toFixed(1)} mm, ` +
        'ou prenez un oeillet a plus petite boucle.',
    });
  }

  const section = profile.section(plan.pJoint);
  const skinHalf = section.halfWidth;

  let blocked = Infinity;
  for (let k = 0; k <= steps; k++) {
    for (const direction of [1, -1] as const) {
      const angle = direction * Math.min(k * step, limit);
      const deg = THREE.MathUtils.radToDeg(angle);
      for (const part of parts) {
        for (const [px, pz] of part.points) {
          const [x, z] = spin(px, pz, angle);
          // La quincaillerie tourne AVEC le segment arriere : elle ne peut
          // mordre que dans le segment avant.
          const bite = biteInto(x, z, part.y, plan, false);
          if (bite > 1e-6) {
            record(deg, part.label, 'segment avant', bite, part.remedy);
            blocked = Math.min(blocked, Math.abs(deg));
          }
          if (Math.abs(z) > skinHalf) {
            record(
              deg,
              part.label,
              'peau du corps',
              Math.abs(z) - skinHalf,
              'Raccourcissez les oeillets ou deplacez le joint vers une section plus large.',
            );
            blocked = Math.min(blocked, Math.abs(deg));
          }
        }
      }
      // Obstacles exterieurs — vis d'assemblage, cylindres, quincaillerie.
      //
      // Ce qui compte est le mouvement RELATIF : une piece portee par le
      // corps est fixe, mais la quincaillerie de la queue lui passe devant
      // sur toute la course. On la teste donc contre les points mobiles, pas
      // contre une position de repos.
      for (const obstacle of obstacles) {
        if (obstacle.to < plan.slot.from || obstacle.from > plan.slot.to) continue;
        const [ox, oz] =
          obstacle.frame === 'tail' ? spin(obstacle.x, obstacle.z, angle) : [obstacle.x, obstacle.z];
        for (const part of parts) {
          if (part.y < obstacle.from || part.y > obstacle.to) continue;
          for (const [px, pz] of part.points) {
            const [x, z] = spin(px, pz, obstacle.frame === 'tail' ? 0 : angle);
            const gap = Math.hypot(x - ox, z - oz) - obstacle.radius;
            if (gap < 0) {
              record(
                deg,
                obstacle.label,
                `${part.label}, sur son chemin de debattement`,
                -gap,
                'Deplacez la vis le long du corps, ou servez-vous de la vis elle-meme ' +
                  'comme axe de retention a cet emplacement, en supprimant le cylindre.',
              );
              blocked = Math.min(blocked, Math.abs(deg));
            }
          }
        }
      }
      if (k === 0) break;
    }
  }

  const limiters = hits.filter((hit) => hit.limiting);
  for (const hit of limiters) blocked = Math.min(blocked, Math.abs(hit.angleDeg));
  if (Number.isFinite(blocked)) free = blocked * 2;
  const first =
    limiters.length > 0
      ? limiters.reduce((a, b) => (Math.abs(a.angleDeg) <= Math.abs(b.angleDeg) ? a : b))
      : null;
  return { wanted, free: Math.min(free, wanted), first, hits };
}
