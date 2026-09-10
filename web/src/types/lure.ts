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

export type MaterialId =
  | 'pla'
  | 'lwpla'
  | 'petg'
  | 'abs'
  | 'resin'
  | 'tpu'
  | 'basswood'
  | 'cedar';

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

/**
 * Livree fine — module L.
 *
 * Purement visuel. Rien ici n'entre dans une geometrie exportee, dans un
 * calcul de masse ni dans un verdict : ce sont des couches de peinture et de
 * vernis, pas de la matiere. Le champ est distinct de `PaintConfig` pour
 * qu'on puisse le lire d'un coup d'oeil et verifier cette promesse.
 */
export interface LiveryConfig {
  /** Barres verticales diffuses du dos, aux bords fondus. */
  bars: {
    enabled: boolean;
    /** Nombre de barres sur la longueur. */
    count: number;
    /** Largeur d'une barre, en fraction de l'intervalle. */
    width: number;
    /** Flou des bords : 0 = franc, 1 = totalement fondu. */
    blur: number;
    color: string;
    opacity: number;
  };
  /** Irisation du film mince : intensite et teinte dominante. */
  iris: { strength: number; hue: string };
  /** Vernis : brillance et epaisseur percue. */
  varnish: { gloss: number; thickness: number };
  /** Ligne laterale suivant le corps. */
  lateral: { enabled: boolean; color: string; width: number; position: number };
  /** Opercule en ecailles larges a reflet holographique. */
  gillPlate: { enabled: boolean; color: string; size: number };
  /** Micro-ecailles en losange peintes SOUS le vernis. */
  microScales: { enabled: boolean; density: number; contrast: number };
  /** Nacre rosee du ventre : 0 = blanc pur. */
  pearl: number;
}

/** Environnement d'apercu : purement visuel lui aussi. */
export type PreviewEnv = 'atelier' | 'studio' | 'subaquatique';


// ---------------------------------------------------------------------------
// Catalogue de quincaillerie — module Q
// ---------------------------------------------------------------------------

/** Familles de quincaillerie qui se pesent et se montent sur un leurre. */
export type TackleFamily = 'treble' | 'inline' | 'assist' | 'split' | 'solid' | 'swivel';

/**
 * Provenance d'une ligne de catalogue.
 *
 * La distinction n'est pas cosmetique : une masse « indicative » est un ordre
 * de grandeur qui peut se tromper de 30 %, une masse « verifiee » vient d'une
 * charte fournisseur ou d'une balance. Le bilan de masse affiche la
 * provenance ligne par ligne pour que l'utilisateur sache ou il en est.
 */
export type TackleSource = 'indicatif' | 'verifie';

export interface TackleItem {
  id: string;
  family: TackleFamily;
  /** Nom de la serie fabricant, saisi librement. */
  series: string;
  /** Notation normalisee : #8 a 10/0 pour les hamecons, #0 a #12 pour les anneaux. */
  size: string;
  /** Calibre du fil, en mm. */
  wireMm: number;
  /** Masse unitaire, en g. C'est la donnee qui compte. */
  massG: number;
  /** Resistance annoncee, en kg. La valeur en lb s'en deduit. */
  strengthKg: number;
  /** Longueur hors-tout d'un hamecon, ou diametre exterieur d'un anneau, en mm. */
  spanMm: number;
  source: TackleSource;
  note: string;
}

/**
 * Point de montage : un support d'hamecon ou une attache du leurre.
 *
 * Le chainage est explicite — un support porte un anneau brise, qui porte un
 * hamecon — parce que c'est ce chainage qui decide du maillon faible et de la
 * position reelle de la masse.
 */
export interface TackleMount {
  id: string;
  label: string;
  /** Ancrage porteur, si le montage suit une goupille posee. */
  anchorId: string | null;
  /** Position sur l'axe : 0 = nez, 1 = queue. Utilisee sans ancrage. */
  position: number;
  /** Hauteur dans le plan de joint : -1 = ventre, 0 = axe, 1 = dos. */
  height: number;
  /** Ligne de catalogue de l'anneau brise, ou null. */
  ringId: string | null;
  /** Ligne de catalogue de l'hamecon, ou null. */
  hookId: string | null;
  /** Representation 3D a l'echelle, affichable ou masquable. */
  visible: boolean;
}


/**
 * Montage traversant — module P.
 *
 * Un fil unique traverse le corps de bout en bout et forme lui-meme les
 * boucles de nez, de ventre et de queue. Ce n'est pas une variante
 * cosmetique des oeillets : c'est ce qui change le MODE DE RUPTURE. Avec des
 * oeillets, ce qui lache est presque toujours l'ancrage dans le plastique ;
 * avec un fil traversant, l'ancrage n'existe plus — le maillon faible
 * redevient le fil lui-meme ou l'anneau brise. C'est tout l'interet du
 * montage, et le simulateur doit le refleter.
 */
export interface ThroughWireConfig {
  enabled: boolean;
  /** Diametre du fil, en mm. */
  wireMm: number;
  material: WireMaterialId;
  /** Diametre exterieur des boucles formees, en mm. */
  loopMm: number;
  /** Jeu du canal de passage autour du fil, en mm. */
  clearanceMm: number;
  /** Nombre de sorties ventrales, en plus du nez et de la queue. */
  bellyExits: number;
  /** Position de chaque sortie ventrale, en fraction de la longueur. */
  bellyPositions: number[];
}

/** Materiaux de fil, partages entre le montage traversant et le simulateur. */
export type WireMaterialId = 'inox304' | 'inox316' | 'ressort' | 'laiton';

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
  /** Couches de finition realistes. */
  livery: LiveryConfig;
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

// ---------------------------------------------------------------------------
// Contours dessines a la main (module partage : profil et decals)
// ---------------------------------------------------------------------------

/**
 * Noeud d'un contour de Bezier cubique.
 *
 * Les coordonnees vivent dans un repere normalise sans unite : x vers la
 * queue, y vers le haut, l'origine au centre. C'est le consommateur du
 * contour — profil de corps ou decal — qui decide de l'echelle reelle. Un
 * meme trace peut ainsi servir de silhouette de 130 mm ou d'opercule de 8 mm.
 *
 * Les poignees sont RELATIVES a l'ancre, ce qui rend le deplacement d'un
 * point trivial et evite de les recalculer a chaque glisser.
 */
export interface OutlineNode {
  id: string;
  x: number;
  y: number;
  /** Poignee entrante (cote point precedent), relative a l'ancre. */
  inX: number;
  inY: number;
  /** Poignee sortante (cote point suivant), relative a l'ancre. */
  outX: number;
  outY: number;
}

export interface Outline {
  nodes: OutlineNode[];
  /** Un contour ferme decrit une surface ; un contour ouvert, une ligne. */
  closed: boolean;
  /** Symetrie par rapport a l'axe horizontal : le trace se reflete en direct. */
  mirror: boolean;
}

/**
 * Photo de reference du dessinateur de contour.
 *
 * L'image vit en memoire du navigateur sous forme de data URL, ce qui permet
 * de la sauvegarder avec le projet : un contour releve sur une photo perd la
 * moitie de son sens si la photo ne revient pas avec lui.
 */
export interface OutlineReference {
  /** Data URL de l'image, ou chaine vide si aucune. */
  src: string;
  opacity: number;
  /** Position et echelle dans le repere du contour. */
  x: number;
  y: number;
  scale: number;
  visible: boolean;
  /** Verrou : empeche de deplacer l'image par megarde en tracant. */
  locked: boolean;
}

/** Un decal est pose en relief ou creuse dans la peau. */
export type DecalStyle = 'raised' | 'engraved';

/**
 * Decal de surface : une forme 2D fermee deposee sur le corps, projetee sur
 * la surface depuis la normale de la vue laterale, puis mise en relief ou
 * gravee. C'est ainsi que se font opercules, joues, pectorales et rayons.
 */
export interface Decal {
  id: string;
  name: string;
  visible: boolean;
  outline: Outline;
  reference: OutlineReference;
  style: DecalStyle;
  /** Profondeur ou hauteur du relief, en mm. */
  depth: number;
  /** Adoucissement des bords, en % de la taille du decal. */
  softness: number;
  /** Reprend le decal a l'identique sur l'autre flanc. */
  mirror: boolean;
  /** Opacite de l'apercu dans le viewport, en %. */
  previewOpacity: number;
  /** Position du centre : le long de l'axe (0 = nez, 1 = queue). */
  position: number;
  /** Hauteur du centre dans la section : -1 = ventre, 1 = dos. */
  height: number;
  /** Rotation dans le plan de profil, en degres. */
  rotation: number;
  /** Largeur du decal, en mm. La hauteur suit les proportions du trace. */
  size: number;
}

/** Ajustement de la trame d'ecailles sur la surface. */
export type ScaleFit = 'wrapped' | 'lateral';
export type ScaleShape = 'diamond' | 'hex' | 'scallop';

/**
 * Trame d'ecailles carrelee sur tout le corps.
 *
 * Affichee en direct comme normal map — une ecaille de 1,2 mm demanderait un
 * maillage dix fois plus dense que l'affichage pour se voir en relief — et
 * cuite en deplacement reel dans la surface au moment de l'export.
 */
export interface ScalesConfig {
  enabled: boolean;
  /** Affiche le relief reellement cuit au lieu de la normal map. */
  baked: boolean;
  fit: ScaleFit;
  shape: ScaleShape;
  /** Largeur d'une ecaille, en mm. */
  width: number;
  /** Hauteur d'une ecaille, en mm. */
  height: number;
  /** Espacement entre ecailles, en mm. */
  spacing: number;
  /** Profondeur du relief, en mm. */
  depth: number;
  /** Arrondi du bord de l'ecaille, en %. */
  rounding: number;
  style: DecalStyle;
  /** Marge sans ecailles sur le dos, en % de la hauteur. */
  marginTop: number;
  /** Marge sans ecailles sous le ventre, en % de la hauteur. */
  marginBottom: number;
}

/** Formes de rainure prêtes a l'emploi, en plus du trace libre. */
export type InlayShape = 'custom' | 'oval' | 'teardrop' | 'band' | 'flank';

/**
 * Rainure pour collant reflechissant.
 *
 * Un creux PLAT sur le flanc, destine a recevoir un collant decoupe pour
 * qu'il affleure la surface au lieu de depasser. Le fond ne suit pas la
 * courbure des ecailles : c'est une surface de collage, elle doit etre lisse.
 * Ecailles et decals sont donc effaces a l'interieur, avec une transition
 * nette sur le bord.
 */
export interface Inlay {
  id: string;
  name: string;
  visible: boolean;
  shape: InlayShape;
  /** Trace libre, utilise quand `shape` vaut `custom`. */
  outline: Outline;
  reference: OutlineReference;
  /** Profondeur du creux, en mm. */
  depth: number;
  /** Marge peripherique autour du collant, en mm. */
  margin: number;
  /** Rayon des angles, en mm. */
  cornerRadius: number;
  mirror: boolean;
  /** Position du centre : le long de l'axe (0 = nez, 1 = queue). */
  position: number;
  /** Hauteur du centre dans la section : -1 = ventre, 1 = dos. */
  height: number;
  rotation: number;
  /** Largeur, en mm. La hauteur suit les proportions de la forme. */
  size: number;
}

/** Quincaillerie qui relie deux segments articules. */
export type JointHardware = 'pin' | 'twisted';

/**
 * Articulation : le corps est coupe en deux segments relies par une
 * quincaillerie reelle, imprimable et assemblable.
 */
export interface ArticulationConfig {
  enabled: boolean;
  hardware: JointHardware;
  /** Nombre d'oeillets qui tiennent le joint. */
  eyeCount: number;
  /** Position de la coupe le long du corps, en mm depuis le nez. */
  positionMm: number;
  /** Debattement total, en degres : la moitie de chaque cote. */
  swing: number;
  /** Biseau de chaque face, en degres depuis le plan transversal. */
  faceAngle: number;
  /** Jeu de joint, en mm. */
  clearance: number;
  /** Masse d'un oeillet, en g. Zero = non renseigne. */
  eyeMass: number;
  /** Masse de la goupille, en g. Zero = non renseigne. */
  pinMass: number;
  showHardware: boolean;
  /** Oeillet a vis : cotes communes a tous les oeillets, en mm. */
  eyeLoop: number;
  eyeWire: number;
  eyeLength: number;
  /** Fente de logement : cotes communes a toutes les fentes, en mm. */
  slotHeight: number;
  slotDepth: number;
  slotWidth: number;
}

/**
 * Goupille cylindrique d'assemblage : un simple barreau, imprime a plat a
 * cote des coques, qui aligne et tient les deux moities.
 *
 * Elle ne remplace pas le logement en forme de 8 — celui-la recoit la
 * quincaillerie en fil d'acier et reste le comportement par defaut. Les deux
 * methodes coexistent et repondent a deux besoins differents : tenir la
 * quincaillerie, ou tenir les coques entre elles.
 */
export interface DowelPin {
  id: string;
  /** Position sur l'axe du corps : 0 = nez, 1 = queue. */
  position: number;
  /** Hauteur dans le plan de joint : -1 = ventre, 0 = axe, 1 = dos. */
  height: number;
}

/** Reglages des goupilles cylindriques d'assemblage. */
export interface DowelConfig {
  enabled: boolean;
  /** Diametre de la goupille, en mm. */
  diameter: number;
  /** Longueur d'engagement dans CHAQUE coque, en mm. */
  engagement: number;
  /** Jeu diametral entre le logement et la goupille, en mm. */
  clearance: number;
  /** Chanfrein d'entree du logement, en mm. */
  chamfer: number;
  /**
   * Emplacements. Vide = repartition automatique le long du corps ; des que
   * l'utilisateur en deplace un, la liste devient explicite.
   */
  pins: DowelPin[];
  /** Nombre vise par la repartition automatique. */
  count: number;
}

/** Procede de fabrication vise : il change la liste des matieres utiles. */
export type ProcessId = 'fdm' | 'resin' | 'wood';

/** Rendu de surface a l'affichage. */
export type FinishStyle = 'smooth' | 'faceted';

/** Compromis fluidite / precision de l'apercu. */
export type PreviewQuality = 'low' | 'medium' | 'high';

/** Reglages d'atelier : ils pilotent la masse et le controle d'impression. */
export interface PrintConfig {
  process: ProcessId;
  /** Nombre de parois de perimetre. */
  perimeters: number;
  /** Hauteur de couche, en mm. */
  layerHeight: number;
  /** Tolerance appliquee aux logements de quincaillerie, en mm. */
  socketTolerance: number;
  /** Compensation de retrait, en %. */
  shrinkage: number;
  finish: FinishStyle;
  preview: PreviewQuality;
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
  /** Goupilles cylindriques d'assemblage, imprimees a part. */
  dowels: DowelConfig;
  /** Jeux de fabrication, mesures sur l'imprimante et reglables. */
  fabrication: FabricationConfig;
  /** Cage de sculpture : deformations locales par-dessus les sliders. */
  sculpt: SculptPoint[];
  /** Articulation : corps coupe en segments relies par une quincaillerie. */
  articulation: ArticulationConfig;

  // --- Surface ------------------------------------------------------------
  /**
   * Silhouette dessinee a la main. Quand elle porte au moins deux noeuds,
   * elle remplace le dos et le ventre calcules par les sliders — le reste du
   * parametrique continue de s'appliquer.
   */
  outline: Outline;
  /** Photo de reference du dessinateur de silhouette. */
  outlineReference: OutlineReference;
  /** Decals de surface, multiples et independants. */
  decals: Decal[];
  /** Trame d'ecailles, une seule par projet. */
  scales: ScalesConfig;
  /** Rainures pour collants reflechissants. */
  inlays: Inlay[];

  // --- Impression & lestage ---------------------------------------------
  material: MaterialId;
  /** Reglages d'atelier : procede, parois, couche, tolerances, apercu. */
  print: PrintConfig;
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

  // --- Montage traversant (module P) --------------------------------------
  /** Fil unique de bout en bout, en plus des modes d'ancrage existants. */
  throughWire: ThroughWireConfig;

  // --- Quincaillerie pesee (module Q) -------------------------------------
  /**
   * Table de quincaillerie du projet.
   *
   * Elle voyage AVEC le projet et non a cote : un leurre partage emporte les
   * masses sur lesquelles son verdict a ete calcule, sinon le destinataire
   * verrait un autre verdict que l'auteur.
   */
  catalogue: TackleItem[];
  /** Supports d'hamecon et attaches, avec leur chainage anneau / hamecon. */
  mounts: TackleMount[];

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
