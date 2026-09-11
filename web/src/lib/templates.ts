/**
 * Modeles guides d'articules deux parties.
 *
 * Un preset de forme donne un corps ; un modele guide donne un LEURRE qui
 * fonctionne — joint place, quincaillerie dimensionnee, ancrages poses,
 * lestage tel que le verdict de flottabilite soit deja valide. L'utilisateur
 * part d'un objet qui nage et ajuste ensuite, au lieu d'assembler lui-meme
 * une combinaison qui a toutes les chances de couler.
 *
 * Le ratio des segments est le rapport tete / queue : il fixe la position du
 * joint, donc le caractere de la nage. Une tete longue glisse, une tete
 * courte roule.
 */

import type { LureParams, ShapeId } from '../types/lure';
import { clonePreset } from './presets';

export interface GuidedTemplate {
  id: string;
  label: string;
  tagline: string;
  /** Longueur hors-tout visee, en mm. */
  length: number;
  /** Part de la longueur revenant au segment de tete, en %. */
  headShare: number;
  description: string;
  /** Une ligne par reglage du joint : a quoi il sert POUR CE type de leurre. */
  guide: { setting: string; why: string }[];
  build: () => LureParams;
}

/** Corps de base commun : deux segments, quincaillerie a la taille. */
function articulated(
  shape: ShapeId,
  length: number,
  headShare: number,
  joint: { swing: number; faceAngle: number },
  overrides: Partial<LureParams> = {},
): LureParams {
  const base = clonePreset(shape);
  const scaled = { ...base, length, ...overrides };

  // La quincaillerie suit la taille du leurre : un oeillet de 12 mm sur un
  // glide de 180 mm ne tient pas, et le meme sur 95 mm ressort du corps.
  const eyeLength = Math.round(length * 0.1 * 10) / 10;
  const eyeWire = Math.round(Math.max(length * 0.011, 0.9) * 100) / 100;
  // La boucle doit laisser passer le cylindre de retention, et la fente doit
  // laisser passer la boucle. Les trois cotes se deduisent l'une de l'autre :
  // les poser separement produisait un joint qui se bloquait des le repos, ce
  // que le test de collision refuse maintenant.
  const retention = scaled.articulation.retentionDiameter;
  const loopFit = scaled.articulation.retentionLoopFit;
  const fit = scaled.articulation.jointFit;
  // Arrondi au dixieme SUPERIEUR : arrondir au plus proche pose parfois la
  // boucle au jeu exact, ou le moindre arrondi la fait passer sous la cote.
  const eyeLoop =
    Math.ceil(Math.max(length * 0.032, eyeWire + retention + loopFit) * 10 + 1) / 10;

  return {
    ...scaled,
    // Le corps est d'une seule piece : l'articulation coupe en travers.
    assembly: { ...scaled.assembly, enabled: false },
    articulation: {
      ...scaled.articulation,
      enabled: true,
      hardware: 'pin',
      eyeCount: length >= 150 ? 3 : 2,
      positionMm: Math.round(length * (headShare / 100) * 10) / 10,
      swing: joint.swing,
      faceAngle: joint.faceAngle,
      clearance: 0.6,
      // Cotes relevees sur de la quincaillerie du commerce : un oeillet inox
      // de 1,2 mm pese environ 0,3 g, une goupille de meme diametre 0,2 g.
      eyeMass: Math.round(eyeWire * eyeLength * 0.02 * 100) / 100,
      pinMass: Math.round(eyeWire * length * 0.004 * 100) / 100,
      showHardware: true,
      eyeLoop,
      eyeWire,
      eyeLength,
      slotHeight: Math.round((eyeLoop + 2 * fit) * 10) / 10,
      slotDepth: Math.round(eyeLength * 0.6 * 10) / 10,
      slotWidth: Math.round(length * 0.17 * 10) / 10,
    },
  };
}

export const GUIDED_TEMPLATES: GuidedTemplate[] = [
  {
    id: 'glide130',
    label: 'Glide bait 2 parties',
    tagline: '130 mm · 55 / 45 · debattement large, sans bavette',
    length: 130,
    headShare: 55,
    description:
      'Le glide ne plonge pas : il balaye. Sans bavette, c est le joint seul qui donne le S, et un debattement large laisse la queue partir loin de chaque cote.',
    guide: [
      { setting: 'Debattement 50 deg', why: 'Large : c est lui qui fait le S ample du glide, il n y a pas de bavette pour donner l action.' },
      { setting: 'Angle de face 45 deg', why: 'Encoche a angle droit, le compromis courant : assez ouverte pour le debattement, assez fermee pour que le joint ne se voie pas.' },
      { setting: 'Joint a 55 % ', why: 'Tete un peu plus longue que la queue : le leurre glisse au lieu de frelonner.' },
      { setting: 'Jeu de joint 0,6 mm', why: 'De quoi laisser tourner apres peinture et vernis, sans que le joint claque.' },
    ],
    build: () =>
      articulated('swimbait', 130, 55, { swing: 50, faceAngle: 45 }, {
        hasBib: false,
        maxWidth: 30,
        thickness: 42,
        material: 'pla',
        infill: 25,
        ballasts: [
          { id: 'lest-avant', position: 0.3, height: -0.72, mass: 17.6, shape: 'cylinder' },
          { id: 'lest-arriere', position: 0.62, height: -0.7, mass: 13.2, shape: 'sphere' },
        ],
      }),
  },
  {
    id: 'swimbait110',
    label: 'Swimbait lent 2 parties',
    tagline: '110 mm · 60 / 40 · debattement moyen, queue haute',
    length: 110,
    headShare: 60,
    description:
      'Concu pour la recuperation lente : une queue haute et courte bat des la premiere traction, et un debattement moyen evite qu elle parte en vrille.',
    guide: [
      { setting: 'Debattement 34 deg', why: 'Moyen : la queue bat des la recuperation lente sans se mettre en travers.' },
      { setting: 'Angle de face 40 deg', why: 'Un peu plus ferme que le glide : le joint reste discret sur un corps haut.' },
      { setting: 'Joint a 60 %', why: 'Queue courte et haute : elle demarre plus vite, c est ce qu on cherche en lent.' },
      { setting: 'Deux oeillets', why: 'Sur 110 mm, deux points suffisent a tenir le joint sans l alourdir.' },
    ],
    build: () =>
      articulated('swimbait', 110, 60, { swing: 34, faceAngle: 40 }, {
        hasBib: false,
        maxWidth: 26,
        thickness: 40,
        material: 'pla',
        infill: 15,
        ballasts: [
          { id: 'lest-avant', position: 0.32, height: -0.7, mass: 15.6, shape: 'cylinder' },
          { id: 'lest-arriere', position: 0.66, height: -0.66, mass: 9.1, shape: 'sphere' },
        ],
      }),
  },
  {
    id: 'minnow95',
    label: 'Minnow articule',
    tagline: '95 mm · 65 / 35 · avec bavette, joint arriere court',
    length: 95,
    headShare: 65,
    description:
      'La bavette donne deja l action ; le joint n est la que pour ajouter un fretillement de queue. D ou un segment arriere court et un debattement modere.',
    guide: [
      { setting: 'Debattement 28 deg', why: 'Modere : la bavette fait le gros du travail, le joint ne fait qu ajouter du fretillement.' },
      { setting: 'Angle de face 42 deg', why: 'Le joint tombe derriere la bavette, sur une section deja fine : une encoche trop ouverte percerait la peau.' },
      { setting: 'Joint a 65 %', why: 'Segment arriere court : c est une queue qui vibre, pas un second corps.' },
      { setting: 'Bavette conservee', why: 'C est elle qui fixe la profondeur ; le joint ne change pas la nage en plongee.' },
    ],
    build: () =>
      articulated('ryoshi', 95, 65, { swing: 28, faceAngle: 42 }, {
        hasBib: true,
        billMode: 'printed',
        bibAngle: 40,
        bibLength: 16,
        bibWidth: 13,
        material: 'pla',
        infill: 40,
        ballasts: [
          { id: 'lest-avant', position: 0.34, height: -0.72, mass: 0.8, shape: 'cylinder' },
        ],
      }),
  },
  {
    id: 'glide180',
    label: 'Grand glide',
    tagline: '180 mm · 50 / 50 · deux segments equivalents',
    length: 180,
    headShare: 50,
    description:
      'Deux moities identiques : le leurre pivote autour de son milieu et balaye tres large. C est le profil des grands glides a brochet.',
    guide: [
      { setting: 'Debattement 55 deg', why: 'Tres large : sur deux segments egaux, c est ce qui donne le balayage caracteristique.' },
      { setting: 'Angle de face 48 deg', why: 'Encoche ouverte, indispensable pour laisser passer un debattement pareil.' },
      { setting: 'Joint a 50 %', why: 'Segments equivalents : le leurre pivote autour de son milieu au lieu de suivre sa tete.' },
      { setting: 'Trois oeillets', why: 'Sur 180 mm, la charge d un brochet demande trois points plutot que deux.' },
    ],
    build: () =>
      articulated('swimbait', 180, 50, { swing: 55, faceAngle: 48 }, {
        hasBib: false,
        maxWidth: 38,
        thickness: 54,
        material: 'pla',
        infill: 20,
        ballasts: [
          { id: 'lest-avant', position: 0.28, height: -0.74, mass: 49, shape: 'cylinder' },
          { id: 'lest-arriere', position: 0.66, height: -0.72, mass: 35, shape: 'cylinder' },
        ],
      }),
  },
];

export const getTemplate = (id: string): GuidedTemplate | undefined =>
  GUIDED_TEMPLATES.find((template) => template.id === id);
