/**
 * Modele de donnees de SAKUMA.
 *
 * Unites :
 *   - toutes les longueurs saisies par l'utilisateur sont en MILLIMETRES
 *   - la geometrie Three.js est construite en CENTIMETRES (1 unite = 1 cm)
 *     ce qui permet de lire directement les volumes en cm3 et donc les
 *     masses en grammes avec des densites en g/cm3.
 */

export type ShapeId =
  // Formes relevees sur des references reelles.
  | 'stickbait165'
  | 'ryoshi'
  | 'model25'
  // Formes generiques.
  | 'popper'
  | 'crankbait'
  | 'jerkbait'
  | 'spoon'
  | 'swimbait'
  | 'topwater';

/** Tailles du catalogue de goupilles en 8. */
export type PinId = 'xs06' | 'xs10' | 's' | 'm' | 'l';

/** Methode de creusement du logement de goupille. */
export type SocketMethod = 'bore' | 'channel';

/**
 * Cote par lequel la grande boucle de la goupille sort du corps.
 *
 * Quatre valeurs et pas un angle libre : le passage doit deboucher a la
 * surface, ce qui impose de savoir par quelle extremite ou quel bord de la
 * coque il ressort. Un angle intermediaire ne debouche nulle part.
 */
export type PinExit = 'nose' | 'tail' | 'belly' | 'back';

/** Mode de fabrication de la bavette. */
export type BillMode = 'printed' | 'polycarbonate';

/** Style d'oeil de la bibliotheque. */
export type EyeStyle = 'realistic' | 'globular' | 'holographic' | 'custom';

/** Forme des lests internes. */
export type BallastShape = 'sphere' | 'cylinder';

/** Profil de coupe de la bavette. */
export type BillProfile = 'rounded' | 'rect' | 'diamond';

/**
 * Point d'ancrage d'une goupille, place par l'utilisateur sur le modele.
 *
 * La position est stockee en coordonnees parametriques du corps, pas en
 * (x, y, z) bruts : un ancrage suit ainsi la forme quand on la retaille au
 * slider, ce qui est tout l'interet d'un editeur parametrique.
 */
export interface PinAnchor {
  id: string;
  /** Position sur l'axe du corps : 0 = nez, 1 = queue. */
  position: number;
  /** Hauteur dans le plan de joint : -1 = ventre, 0 = axe, 1 = dos. */
  height: number;
  /** Cote de sortie de la grande boucle : le passage debouche a la surface. */
  exit: PinExit;
  /** Profondeur d'ancrage (hauteur du goujon) en mm ; 0 = proportionnel. */
  depth: number;
  pin: PinId | 'auto';
  method: SocketMethod;
}

/**
 * Point de la cage de sculpture.
 *
 * Chaque point tire ou repousse localement la peau du corps, par-dessus la
 * forme pilotee par les sliders : de quoi rattraper un galbe que les
 * parametres seuls ne savent pas decrire, sans quitter le parametrique.
 */
export interface SculptPoint {
  id: string;
  /** Position sur l'axe : 0 = nez, 1 = queue. */
  position: number;
  /** Angle autour de la section, en degres : 0 = dos, 180 = ventre. */
  angle: number;
  /** Deplacement radial, en mm. Positif = vers l'exterieur. */
  amount: number;
  /** Rayon d'influence, en fraction de la longueur. */
  radius: number;
}

/**
 * Jeux de fabrication, tous exposes dans l'interface : ce sont des valeurs
 * qui se mesurent sur l'imprimante et se reajustent, jamais des constantes.
 */
export interface FabricationConfig {
  /** Methode A : jeu diametral entre l'alesage et le cercle de la goupille, en mm. */
  boreClearance: number;
  /** Methode B : offset de la silhouette du fil, en mm. */
  channelOffset: number;
  /** Methode B : supplement de diametre du profil balaye, en mm. */
  sweepExtra: number;
  /** Jeu d'emboitement du goujon male dans l'alesage femelle, en mm. */
  tenonFit: number;
  /** Jeu d'insertion de la bavette rapportee, en mm. */
  billFit: number;
  /**
   * Jeu diametral entre une bille mobile et sa portee, en mm.
   *
   * A l'oppose des precedents, celui-ci est volontairement large : c'est lui
   * qui laisse la bille rouler et claquer (effet rattle).
   */
  rattleFit: number;
}

/**
 * Logement de bille mobile : une bille inox libre dans une portee spherique
 * plus large qu'elle. Le jeu est le bruit.
 */
export interface RattlePocket {
  id: string;
  /** Position sur l'axe du corps : 0 = nez, 1 = queue. */
  position: number;
  /** Hauteur dans la section : -1 = ventre, 0 = axe, 1 = dos. */
  height: number;
  /** Diametre de la bille, en mm. */
  ball: number;
}

/**
 * Chambre de bruit tubulaire : une capsule creusee dans le plan de joint,
 * dans laquelle une ou plusieurs billes roulent librement pendant la nage.
 */
export interface RattleChamber {
  enabled: boolean;
  /** Diametre interieur du tube, en mm. */
  diameter: number;
  /** Depart : position sur l'axe (0 = nez, 1 = queue) et hauteur (-1..1). */
  fromPosition: number;
  fromHeight: number;
  /** Arrivee : meme convention. Un tube peut donc etre incline. */
  toPosition: number;
  toHeight: number;
  /** Diametre des billes logees dans le tube, en mm. */
  ball: number;
  /** Nombre de billes. */
  balls: number;
}

/** Forme de la queue. `taper` et `round` sont portees par le corps lui-meme, */
/** les autres ajoutent une nageoire caudale plate generee par extrusion.     */
export type TailShape = 'taper' | 'round' | 'forked' | 'paddle' | 'fan';

export type MaterialId = 'pla' | 'lwpla' | 'resin' | 'tpu';

export type FinishId = 'matte' | 'satin' | 'gloss' | 'chrome' | 'holo';

export type PatternId = 'none' | 'stripes' | 'dots' | 'scales' | 'camo' | 'gradient';

/** Anneau brise / agrafe monte sur l'oeillet de tete. */
export type ClipId = 'none' | 'small' | 'medium';

export type WaterId = 'fresh' | 'salt';

export interface BallastWeight {
  id: string;
  /** Position sur l'axe du corps : 0 = nez, 1 = queue. */
  position: number;
  /** Position verticale dans la section : -1 = ventre, 0 = axe, 1 = dos. */
  height: number;
  /** Masse en grammes. */
  mass: number;
  /** Bille ou cylindre : a masse egale, le cylindre loge dans une section plus fine. */
  shape: BallastShape;
}

/**
 * Assemblage en deux coques imprimables.
 *
 * Le plan de joint contient toujours l'axe longitudinal du leurre : c'est
 * cette contrainte qui garantit que chaque section est coupee en deux et
 * donc que les deux coques se referment proprement.
 */
export interface AssemblyConfig {
  enabled: boolean;
  /** Orientation du plan de joint : 0 = vertical (gauche/droite), 90 = horizontal. */
  planeAngle: number;
  /** Methode de logement appliquee aux nouveaux ancrages. */
  socketMethod: SocketMethod;
  /** Taille de goupille par defaut, ou selection automatique proportionnelle. */
  pin: PinId | 'auto';
  /** Regle de robustesse : force la plus grosse goupille. */
  roughWater: boolean;
  /**
   * Points d'ancrage places par l'utilisateur. Chacun engendre son goujon sur
   * la coque male et son alesage en vis-a-vis sur la femelle.
   */
  anchors: PinAnchor[];
}

export interface PaintConfig {
  dorsal: string;
  flank: string;
  belly: string;
  /** Zone de tete, appliquee depuis le nez. */
  head: string;
  /** Zone de queue, appliquee depuis l'arriere. */
  tail: string;
  /** Longueur de la zone de tete, en fraction de la longueur (0 = desactivee). */
  headLength: number;
  /** Longueur de la zone de queue, en fraction de la longueur (0 = desactivee). */
  tailLength: number;
  /** Douceur des transitions entre zones : 0 = franc, 1 = fondu large. */
  blend: number;
  /** Couleur de l'iris peint. */
  eyeColor: string;
  pattern: PatternId;
  patternColor: string;
  /** Densite du motif (nombre de rayures / d'ecailles par rangee). */
  patternScale: number;
  finish: FinishId;
}

/** Livree enregistree dans la bibliotheque du projet. */
export interface SavedPalette {
  id: string;
  name: string;
  paint: PaintConfig;
}

/**
 * Detail de tete genere sur le corps lui-meme (branchies, yeux) : il n'y a
 * pas de piece rapportee, les sommets du maillage sont deplaces localement.
 */
export interface DetailConfig {
  enabled: boolean;
  /** Position sur l'axe du corps : 0 = nez, 1 = queue. */
  position: number;
  /** Taille caracteristique en mm. */
  size: number;
  /** Relief en mm : negatif = gravure creuse, positif = bourrelet saillant. */
  relief: number;
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
  /** Imprimee avec le corps, ou decoupee dans du polycarbonate. */
  billMode: BillMode;
  /** Epaisseur de la bavette, en mm, independante de sa longueur et sa largeur. */
  billThickness: number;
  /**
   * Echelle liee : largeur et epaisseur suivent la longueur, selon les
   * proportions de la bavette de reference. Decoche pour les regler a part.
   */
  billUniform: boolean;
  /** Recul du point d'ancrage depuis la pointe du nez, en mm. */
  billOffset: number;
  /** Rayon de conge sur les aretes de la bavette, en mm. */
  billFillet: number;
  /** Profil de coupe. */
  billProfile: BillProfile;
  /** Vrille de la bavette sur son propre axe, en degres. */
  billTwist: number;
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

  // --- Details de tete ---------------------------------------------------
  /** Ligne d'ouie gravee sur les flancs. Ignore sur la cuiller. */
  gills: DetailConfig;
  /** Oeil : cuvette creusee surmontee d'un iris bombe. Ignore sur la cuiller. */
  eyes: DetailConfig;
  /** Style d'oeil de la bibliotheque. */
  eyeStyle: EyeStyle;

  // --- Quincaillerie ------------------------------------------------------
  /** Agrafe montee sur l'oeillet de tete (visualisation + masse). */
  clip: ClipId;
  /** Assemblage male / femelle, goujons et logement de goupille. */
  assembly: AssemblyConfig;
  /** Jeux de fabrication, mesures sur l'imprimante et reglables. */
  fabrication: FabricationConfig;
  /** Cage de sculpture : deformations locales par-dessus les sliders. */
  sculpt: SculptPoint[];

  // --- Impression & lestage ---------------------------------------------
  material: MaterialId;
  /** Taux de remplissage en % (0 = coque seule, 100 = plein). */
  infill: number;
  /** Masse de la quincaillerie (hameçons, anneaux brises) en g. */
  hardwareMass: number;
  /** Densite des lests internes, en g/cm3 (inox ~7,9 ; plomb 11,34). */
  ballastDensity: number;
  ballasts: BallastWeight[];
  /** Logements de billes mobiles (rattle ponctuel). */
  rattles: RattlePocket[];
  /** Chambre a billes tubulaire. */
  chamber: RattleChamber;

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
  format: 'sakuma-project' | 'lureforge-project';
  version: 1;
  name: string;
  savedAt: string;
  params: LureParams;
  /** Bibliotheque de livrees enregistree avec le projet. */
  palettes?: SavedPalette[];
}
