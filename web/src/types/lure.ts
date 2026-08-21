/**
 * Modele de donnees de LUREFORGE.
 *
 * Unites :
 *   - toutes les longueurs saisies par l'utilisateur sont en MILLIMETRES
 *   - la geometrie Three.js est construite en CENTIMETRES (1 unite = 1 cm)
 *     ce qui permet de lire directement les volumes en cm3 et donc les
 *     masses en grammes avec des densites en g/cm3.
 */

export type ShapeId =
  | 'minnow'
  | 'popper'
  | 'crankbait'
  | 'jerkbait'
  | 'spoon'
  | 'swimbait'
  | 'topwater';

/** Forme de la queue. `taper` et `round` sont portees par le corps lui-meme, */
/** les autres ajoutent une nageoire caudale plate generee par extrusion.     */
export type TailShape = 'taper' | 'round' | 'forked' | 'paddle' | 'fan';

export type MaterialId = 'pla' | 'lwpla' | 'resin' | 'tpu';

export type FinishId = 'matte' | 'satin' | 'gloss' | 'chrome';

export type PatternId = 'none' | 'stripes' | 'dots' | 'gradient';

export type WaterId = 'fresh' | 'salt';

export interface BallastWeight {
  id: string;
  /** Position sur l'axe du corps : 0 = nez, 1 = queue. */
  position: number;
  /** Position verticale dans la section : -1 = ventre, 0 = axe, 1 = dos. */
  height: number;
  /** Masse en grammes. */
  mass: number;
}

export interface PaintConfig {
  dorsal: string;
  flank: string;
  belly: string;
  pattern: PatternId;
  patternColor: string;
  /** Densite du motif (nombre de rayures / de points par rangee). */
  patternScale: number;
  finish: FinishId;
}

export interface LureParams {
  shape: ShapeId;

  // --- Corps -------------------------------------------------------------
  /** Longueur hors-tout en mm (bavette exclue, queue incluse). */
  length: number;
  /** Largeur maximale en mm (axe lateral, vue de dessus). */
  maxWidth: number;
  /** Epaisseur / hauteur du corps en mm (vue de profil). */
  thickness: number;
  /** Position du ventre le plus large : 0 = nez, 1 = queue. */
  bellyPosition: number;
  /** Courbure dorsale : -1 = dos creuse, 0 = neutre, 1 = dos bombe. */
  dorsalCurve: number;
  /** Courbure ventrale : -1 = ventre plat, 0 = neutre, 1 = ventre rebondi. */
  ventralCurve: number;
  /** Rondeur du nez : 0.25 = tres emousse, 1.2 = pointu. */
  noseSharpness: number;
  /** Effilement arriere : 0.5 = queue pleine, 2 = queue tres fine. */
  tailTaper: number;
  /** Profil de section : 2 = ellipse, > 2 = section carree, < 2 = losange. */
  crossSection: number;
  /** Creux de bouche : 0 = nez plein, 1 = bouche fortement creusee (popper). */
  mouthCup: number;

  // --- Bavette -----------------------------------------------------------
  hasBib: boolean;
  /** Angle de la bavette par rapport a l'axe du corps, en degres. */
  bibAngle: number;
  /** Longueur de la bavette en mm. */
  bibLength: number;
  /** Largeur de la bavette en mm. */
  bibWidth: number;

  // --- Queue -------------------------------------------------------------
  tailShape: TailShape;
  /** Facteur d'echelle de la nageoire caudale. */
  tailSize: number;

  // --- Impression & lestage ---------------------------------------------
  material: MaterialId;
  /** Taux de remplissage en % (0 = coque seule, 100 = plein). */
  infill: number;
  /** Masse de la quincaillerie (hameçons, anneaux brises) en g. */
  hardwareMass: number;
  ballasts: BallastWeight[];

  // --- Finition ----------------------------------------------------------
  paint: PaintConfig;
}

export interface Project {
  id: string;
  name: string;
  params: LureParams;
  createdAt: number;
  updatedAt: number;
}

/** Format du fichier .json telecharge / reimporte. */
export interface ProjectFile {
  format: 'lureforge-project';
  version: 1;
  name: string;
  savedAt: string;
  params: LureParams;
}
