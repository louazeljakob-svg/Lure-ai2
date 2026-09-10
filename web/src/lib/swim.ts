/**
 * Modele de nage.
 *
 * La flottaison et la nage ne sont pas deux sujets : c'est le meme corps,
 * soumis aux memes forces, a vitesse nulle puis a vitesse non nulle. Ce
 * fichier prolonge donc le calcul de flottabilite au lieu de le doubler.
 *
 * TOUT ce qui suit est une estimation d'ingenierie. Les coefficients
 * hydrodynamiques d'un corps aussi court et aussi peu profile qu'un leurre
 * ne se calculent pas, ils se mesurent — et personne ne les a mesures pour
 * CE leurre-la. On expose donc les hypotheses, on affiche des fourchettes
 * plutot que des chiffres nets, et on laisse l'utilisateur recaler le modele
 * sur ses propres essais (voir `calibrate`).
 */

import type { LureParams } from '../types/lure';

/** Masse volumique de l'eau douce, en kg/m3. */
const RHO = 1000;

/** Acceleration de la pesanteur, en m/s2. */
const G = 9.81;

/**
 * Hypotheses du modele.
 *
 * Toutes modifiables : ce sont elles qui font la difference entre un chiffre
 * credible et un chiffre invente, et l'utilisateur en sait souvent plus que
 * le modele sur son propre materiel.
 */
export interface SwimAssumptions {
  /** Portance de la bavette, par radian d'incidence. Plaque mince : ~2*pi. */
  bibLiftSlope: number;
  /** Trainee de forme de la bavette a incidence nulle. */
  bibDragBase: number;
  /** Trainee du corps, rapportee a sa section frontale. */
  bodyDrag: number;
  /** Trainee de la ligne, rapportee a sa surface projetee. */
  lineDrag: number;
  /** Amortissement en roulis, sans dimension. */
  rollDamping: number;
  /**
   * Part de la portance de bavette qui se convertit en moment de roulis.
   *
   * Cette valeur n'est PAS derivee : elle est ajustee pour que des leurres
   * connus decrochent la ou on les voit decrocher, entre quatre et neuf
   * km/h. Un corps aussi court et aussi peu profile qu'un leurre n'a pas de
   * coefficient tabule ; le seul honnete est celui qu'on recale sur des
   * observations. C'est aussi le premier a corriger dans le carnet
   * d'etalonnage.
   */
  rollCoupling: number;
  /** Rendement de la mise en oscillation : part de la portance qui bascule. */
  wobbleGain: number;
  /** Marge d'incertitude affichee, en fraction du resultat. */
  uncertainty: number;
}

export const DEFAULT_ASSUMPTIONS: SwimAssumptions = {
  bibLiftSlope: 2.6,
  bibDragBase: 0.28,
  bodyDrag: 0.22,
  lineDrag: 1.1,
  rollDamping: 0.55,
  rollCoupling: 0.03,
  wobbleGain: 0.42,
  uncertainty: 0.25,
};

/** Une valeur avec sa fourchette : jamais un chiffre isole. */
export interface Estimate {
  value: number;
  low: number;
  high: number;
}

const estimate = (value: number, uncertainty: number): Estimate => ({
  value,
  low: value * (1 - uncertainty),
  high: value * (1 + uncertainty),
});

/** Entrees du modele, toutes tirees de la geometrie reelle. */
export interface SwimInput {
  params: LureParams;
  /** Masse totale en service, en g. */
  massG: number;
  /** Volume deplace, en cm3. */
  volumeCm3: number;
  /** Centre de masse et centre de carene, en cm, repere du leurre. */
  cg: { x: number; y: number; z: number };
  cb: { x: number; y: number; z: number };
  /** Encombrement en mm. */
  bounds: { length: number; width: number; height: number };
  assumptions: SwimAssumptions;
  /** Coefficients de recalage issus du carnet d'etalonnage. */
  calibration: SwimCalibration;
}

/** Recalage appris des essais reels. Neutre = 1. */
export interface SwimCalibration {
  depth: number;
  critical: number;
  strength: number;
}

export const NEUTRAL_CALIBRATION: SwimCalibration = { depth: 1, critical: 1, strength: 1 };

// ---------------------------------------------------------------------------
// Geometrie utile
// ---------------------------------------------------------------------------

/** Surface projetee de la bavette, en m2, et son bras de levier en m. */
function bibGeometry(params: LureParams) {
  if (!params.hasBib) return { area: 0, angle: 0, lever: 0, span: 0 };
  const lengthM = params.bibLength * 1e-3;
  const widthM = params.bibWidth * 1e-3;
  // Plaque approchee par un trapeze : le contour reel vaut 0,78 du rectangle.
  const area = lengthM * widthM * 0.78;
  const angle = (Math.min(Math.max(params.bibAngle, 5), 89) * Math.PI) / 180;
  // Bras de levier : la bavette agit en avant du nez, donc devant le centre
  // de masse. C'est lui qui decide si le leurre plonge ou decroche.
  const lever = (params.length * 0.5 + params.bibLength * 0.5) * 1e-3;
  return { area, angle, lever, span: lengthM };
}

/** Section frontale du corps, en m2. */
const frontalArea = (params: LureParams): number =>
  Math.PI * (params.maxWidth * 1e-3 / 2) * (params.thickness * 1e-3 / 2);

// ---------------------------------------------------------------------------
// K.1 — Profondeur
// ---------------------------------------------------------------------------

export interface DepthPoint {
  /** Longueur de ligne larguee, en m. */
  line: number;
  /** Profondeur atteinte, en m. */
  depth: number;
}

/**
 * Profondeur d'equilibre pour une longueur de ligne donnee.
 *
 * Le compromis est simple a enoncer : la bavette tire vers le bas, la ligne
 * tire vers le haut et vers l'arriere. Plus on largue de ligne, plus la
 * trainee de celle-ci pese — c'est elle qui domine des la trentaine de
 * metres, et un modele qui l'ignore annonce des profondeurs deux fois trop
 * grandes.
 */
export function diveDepth(input: SwimInput, speedKmh: number, lineM: number): number {
  const { assumptions: a, params } = input;
  const bib = bibGeometry(params);
  if (bib.area <= 0 || speedKmh <= 0) return 0;

  const v = speedKmh / 3.6;
  const q = 0.5 * RHO * v * v;

  // Force de plongee : composante verticale de la portance de bavette.
  const dive = q * bib.area * a.bibLiftSlope * Math.sin(bib.angle) * Math.cos(bib.angle);
  // Flottabilite residuelle : ce qui pousse vers la surface.
  const buoyN = Math.max((input.volumeCm3 * 1e-6 * RHO - input.massG * 1e-3) * G, 0);
  const down = dive - buoyN;
  if (down <= 0) return 0;

  // Trainee horizontale du leurre : corps plus bavette, celle-ci presentant
  // sa surface projetee a l'ecoulement.
  const bibCd = a.bibDragBase + a.bibLiftSlope * Math.pow(Math.sin(bib.angle), 2);
  const lureDrag = q * (frontalArea(params) * a.bodyDrag + bib.area * bibCd);

  // Angle de la ligne sous l'horizontale. La trainee de la ligne ne compte
  // que par sa composante NORMALE : une ligne presque tendue dans le sens du
  // courant ne freine presque pas. D'ou l'iteration — l'angle depend de la
  // trainee, qui depend de l'angle.
  const lineDiameter = 0.3e-3;
  const k = q * a.lineDrag * lineDiameter * lineM;

  // On cherche l'angle qui verifie tan(alpha) = down / (trainee + k.sin^2).
  // Le point fixe naif oscille — plus l'angle est raide, plus la ligne
  // freine, ce qui le rabat, ce qui le redresse — alors on tranche par
  // bissection sur une fonction monotone.
  const residual = (alpha: number) =>
    down * Math.cos(alpha) - (lureDrag + k * Math.pow(Math.sin(alpha), 2)) * Math.sin(alpha);
  let lo = 0;
  let hi = Math.PI / 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (residual(mid) > 0) lo = mid;
    else hi = mid;
  }
  const alpha = (lo + hi) / 2;

  // La ligne n'est pas droite : elle se courbe sous sa propre trainee, et la
  // profondeur atteinte vaut moins que ce que donnerait une corde tendue.
  return lineM * Math.sin(alpha) * 0.72 * input.calibration.depth;
}

/** Courbe profondeur / longueur de ligne, a une vitesse donnee. */
export function depthCurve(input: SwimInput, speedKmh: number, maxLine = 60): DepthPoint[] {
  const points: DepthPoint[] = [];
  for (let line = 0; line <= maxLine; line += maxLine / 24) {
    points.push({ line, depth: diveDepth(input, speedKmh, line) });
  }
  return points;
}

// ---------------------------------------------------------------------------
// K.2 — Vitesse critique
// ---------------------------------------------------------------------------

export interface CriticalSpeed {
  /** Vitesse de decrochage, en km/h. */
  speed: Estimate;
  /** En noeuds. */
  knots: Estimate;
  /** Trainee a cette vitesse, en N. */
  dragN: Estimate;
  /** La meme, en grammes-force. */
  dragGf: Estimate;
  /** Plage conseillee, en km/h. */
  recommended: { from: number; to: number };
  /** Vitesse ou l'amplitude d'oscillation est maximale, en km/h. */
  sweet: number;
}

/**
 * Vitesse au-dela de laquelle le leurre cesse de nager.
 *
 * Le critere est un rapport de moments : la bavette et l'ecoulement
 * produisent un moment de roulis qui croit avec le carre de la vitesse ; le
 * couple de rappel, lui, vient de l'ecart vertical entre centre de masse et
 * centre de carene et ne depend pas de la vitesse. Il existe donc une vitesse
 * ou le premier depasse le second, et au-dela le leurre ne revient plus.
 */
export function criticalSpeed(input: SwimInput): CriticalSpeed {
  const { assumptions: a, params } = input;
  const bib = bibGeometry(params);

  // Couple de rappel : masse x bras de levier VERTICAL entre centre de masse
  // et centre de carene. Un leurre dont la masse pend bas se redresse seul.
  const armM = Math.max((input.cb.y - input.cg.y) * 1e-2, 2e-4);
  const righting = input.massG * 1e-3 * G * armM;

  // Moment destabilisant par unite de pression dynamique.
  //
  // Ce n'est pas la portance entiere qui bascule le leurre : a l'equilibre la
  // bavette est symetrique et n'exerce aucun roulis. C'est sa DERIVEE en
  // roulis qui compte, et elle ne se calcule pas sur un corps pareil. Le
  // coefficient de couplage porte donc tout l'empirisme du modele, et il est
  // affiche comme tel dans le panneau d'hypotheses.
  const rollArm = params.thickness * 1e-3 * 0.5 + bib.span * Math.sin(bib.angle) * 0.5;
  const flankM2 = params.length * 1e-3 * params.thickness * 1e-3 * 0.6;
  // Un corps sans bavette n'est pas indecrochable : c'est son propre flanc
  // qui porte, d'autant plus qu'il est haut et court. L'elancement mesure
  // exactement cela.
  const stubby = Math.min(Math.max(params.thickness / Math.max(params.length, 1), 0.06), 0.5);
  const upsetting =
    (bib.area * a.bibLiftSlope * rollArm +
      flankM2 * a.bodyDrag * rollArm * (0.35 + 6 * stubby)) *
    a.rollCoupling;

  const q = righting / Math.max(upsetting, 1e-12);
  const v = Math.sqrt((2 * q) / RHO);
  const speedKmh = Math.min(v * 3.6, 18) * input.calibration.critical;

  // Trainee a cette vitesse : la bavette y presente sa surface projetee.
  const vCrit = speedKmh / 3.6;
  const qCrit = 0.5 * RHO * vCrit * vCrit;
  const bibCd = a.bibDragBase + a.bibLiftSlope * Math.pow(Math.sin(bib.angle), 2);
  const dragN = qCrit * (frontalArea(params) * a.bodyDrag + bib.area * bibCd);

  const u = a.uncertainty;
  return {
    speed: estimate(speedKmh, u),
    knots: estimate(speedKmh / 1.852, u),
    dragN: estimate(dragN, u * 1.4),
    dragGf: estimate((dragN / G) * 1000, u * 1.4),
    // En dessous de 40 % la nage est molle, au-dela de 85 % on frole le
    // decrochage : c'est la plage ou l'on traine reellement.
    recommended: { from: speedKmh * 0.4, to: speedKmh * 0.85 },
    sweet: speedKmh * 0.62,
  };
}

// ---------------------------------------------------------------------------
// K.3 — Wobble
// ---------------------------------------------------------------------------

export type SwimAction = 'roll' | 'yaw' | 'mixed';

export interface WobblePoint {
  speed: number;
  /** Frequence, en Hz. */
  frequency: number;
  /** Amplitude de lacet, en degres. */
  yaw: number;
  /** Amplitude de roulis, en degres. */
  roll: number;
}

export interface WobbleProfile {
  points: WobblePoint[];
  action: SwimAction;
  label: string;
}

/**
 * Oscillation en fonction de la vitesse.
 *
 * La frequence croit avec la vitesse — c'est la bavette qui bat plus vite.
 * L'amplitude, elle, passe par un maximum : d'abord elle grandit parce qu'il
 * y a plus d'energie, puis elle s'effondre a l'approche du decrochage parce
 * que le leurre part sur le flanc au lieu d'osciller. C'est cette forme en
 * cloche qui distingue un modele credible d'une droite.
 */
export function wobbleProfile(input: SwimInput, critical: CriticalSpeed): WobbleProfile {
  const { assumptions: a, params } = input;
  const bib = bibGeometry(params);
  const points: WobblePoint[] = [];
  const vc = Math.max(critical.speed.value, 0.1);

  // Elancement : un corps long et fin lace, un corps court et haut roule.
  const slenderness = params.length / Math.max(params.thickness, 1);
  const rollShare = Math.min(Math.max(1.6 / slenderness, 0.1), 0.9);

  for (let i = 0; i <= 24; i++) {
    const speed = (i / 24) * vc;
    const ratio = speed / vc;
    // Frequence : proportionnelle a la vitesse, divisee par la taille.
    const frequency = (speed / 3.6) / Math.max(params.length * 1e-3, 0.01) * a.wobbleGain;
    // Cloche : montee en racine, effondrement en fin de plage.
    const envelope = Math.sqrt(Math.max(ratio, 0)) * Math.max(1 - Math.pow(ratio, 4), 0);
    const amplitude =
      envelope * 46 * a.wobbleGain * (bib.area > 0 ? 1 : 0.35) * (1 + bib.angle * 0.4);
    points.push({
      speed,
      frequency,
      yaw: amplitude * (1 - rollShare),
      roll: amplitude * rollShare,
    });
  }

  const action: SwimAction =
    rollShare > 0.6 ? 'roll' : rollShare < 0.3 ? 'yaw' : 'mixed';
  const label =
    action === 'roll'
      ? 'Roulis dominant — wobble large et lent'
      : action === 'yaw'
        ? 'Lacet dominant — tight wiggle'
        : 'Mixte — roulis et lacet a parts comparables';
  return { points, action, label };
}

// ---------------------------------------------------------------------------
// K.5 — Courant
// ---------------------------------------------------------------------------

export interface CurrentConfig {
  /** Vitesse du courant, en km/h. */
  speed: number;
  /** Direction relative a la traine, en degres. 0 = de face, 180 = de dos. */
  heading: number;
}

export interface CurrentResult {
  /** Vitesse d'ecoulement reellement vue par le leurre, en km/h. */
  relative: number;
  /** Angle de derive laterale, en degres. */
  drift: number;
  /** Profondeur corrigee, en m. */
  depth: number;
  /** Vrai si la combinaison depasse la vitesse critique. */
  overSpeed: boolean;
}

export const CURRENT_PRESETS: { id: string; label: string; current: CurrentConfig }[] = [
  { id: 'lac', label: 'Lac calme', current: { speed: 0, heading: 0 } },
  { id: 'riviere', label: 'Riviere lente', current: { speed: 1.5, heading: 90 } },
  { id: 'fleuve', label: 'Fleuve a fort debit', current: { speed: 5, heading: 90 } },
  { id: 'contre', label: 'Traine a contre-courant', current: { speed: 4, heading: 0 } },
  { id: 'avec', label: 'Traine dans le sens du courant', current: { speed: 4, heading: 180 } },
];

/**
 * Combine vitesse de traine et courant en une vitesse relative vectorielle.
 *
 * C'est le cas classique de la riviere : on traine a 3 km/h en remontant un
 * courant de 4, et le leurre en voit 7. Il decroche alors que le compteur du
 * bateau, lui, n'a pas bouge.
 */
export function applyCurrent(
  input: SwimInput,
  critical: CriticalSpeed,
  trollingKmh: number,
  current: CurrentConfig,
  lineM: number,
): CurrentResult {
  const rad = (current.heading * Math.PI) / 180;
  // Le leurre avance a +x ; un courant de face vient a sa rencontre.
  const vx = trollingKmh + current.speed * Math.cos(rad);
  const vz = current.speed * Math.sin(rad);
  const relative = Math.hypot(vx, vz);
  const drift = (Math.atan2(vz, Math.max(vx, 1e-6)) * 180) / Math.PI;
  return {
    relative,
    drift,
    depth: diveDepth(input, relative, lineM),
    overSpeed: relative > critical.speed.value,
  };
}

// ---------------------------------------------------------------------------
// K.6 — Infiltration d'eau
// ---------------------------------------------------------------------------

export type Sealant = 'none' | 'varnish' | 'epoxy' | 'uv';

export const SEALANTS: { id: Sealant; label: string; factor: number; note: string }[] = [
  { id: 'none', label: 'Aucun', factor: 1, note: 'Le PLA brut boit par ses interfaces de couches.' },
  { id: 'varnish', label: 'Vernis', factor: 0.45, note: 'Bouche les pores de surface, pas les joints.' },
  { id: 'epoxy', label: 'Epoxy', factor: 0.12, note: 'Film continu : c est le traitement de reference.' },
  { id: 'uv', label: 'Resine UV', factor: 0.2, note: 'Rapide, mais fragile sur les aretes vives.' },
];

export interface SoakInput {
  params: LureParams;
  sealant: Sealant;
  /** Volume creux interne disponible, en cm3. */
  voidCm3: number;
  /** Nombre de percages traversants. */
  holes: number;
  /** Profondeur d'utilisation, en m. */
  depthM: number;
}

export interface SoakPoint {
  /** Heures d'immersion cumulees. */
  hours: number;
  /** Masse d'eau absorbee, en g. */
  water: number;
  /** Recul du centre de masse, en mm (vers le bas et vers l'arriere). */
  cgShift: number;
}

export interface SoakResult {
  points: SoakPoint[];
  /** Masse d'eau a saturation, en g. */
  saturation: number;
  /** Heures avant chaque bascule, ou null si elle n'arrive jamais. */
  toSuspend: number | null;
  toSink: number | null;
  /** Eau necessaire a chaque bascule, en g. */
  waterToSuspend: number | null;
  waterToSink: number | null;
  /** Heures avant que la nage devienne inexploitable. */
  toUnusable: number | null;
  /** Gain apporte par chaque option d'etancheite, en heures. */
  advice: { id: Sealant; label: string; hoursToSuspend: number | null; note: string }[];
}

/**
 * Accumulation d'eau dans le temps.
 *
 * Le PLA imprime n'est pas etanche, et ce n'est pas le materiau qui fait le
 * gros du chemin : c'est la POROSITE ENTRE COUCHES. Une couche epaisse et
 * peu de parois laissent des canaux continus jusqu'au coeur ; le meme leurre
 * a six parois et 0,1 mm de couche met dix fois plus longtemps a boire.
 *
 * Le remplissage exponentiel vers une saturation est la forme classique d'une
 * diffusion : rapide au debut, puis de plus en plus lent.
 */
export function soakCurve(input: SoakInput, floatMarginG: number): SoakResult {
  const { params } = input;
  const sealant = SEALANTS.find((item) => item.id === input.sealant) ?? SEALANTS[0];

  // Porosite : la hauteur de couche ouvre le chemin, les parois le referment.
  const porosity =
    (params.print.layerHeight / 0.2) / Math.max(params.print.perimeters, 1) * sealant.factor;
  // Les percages traversants sont des entrees franches, pas de la diffusion.
  const holeFlow = input.holes * 0.06 * sealant.factor;
  // La pression accelere l'entree : un metre d'eau, c'est 0,1 bar de plus.
  const pressure = 1 + input.depthM / 10;

  const saturation = Math.max(input.voidCm3 * 0.55, 0.2);
  // Constante de temps, en heures : de quelques heures a plusieurs centaines.
  const tau = Math.max(6 / Math.max(porosity * pressure + holeFlow, 1e-3), 1.5);

  const points: SoakPoint[] = [];
  const span = Math.min(Math.max(tau * 3, 24), 900);
  for (let i = 0; i <= 40; i++) {
    const hours = (i / 40) * span;
    const water = saturation * (1 - Math.exp(-hours / tau));
    points.push({
      hours,
      water,
      // L'eau se loge en bas et vers l'arriere : elle casse l'assiette avant
      // meme de faire couler le leurre.
      cgShift: (water / Math.max(saturation, 1e-6)) * params.length * 0.035,
    });
  }

  /** Heures necessaires pour absorber une masse donnee. */
  const hoursFor = (grams: number): number | null => {
    if (grams <= 0) return 0;
    if (grams >= saturation) return null;
    return -tau * Math.log(1 - grams / saturation);
  };

  const toSuspend = hoursFor(floatMarginG);
  const toSink = hoursFor(floatMarginG * 1.35);
  return {
    points,
    saturation,
    toSuspend,
    toSink,
    waterToSuspend: floatMarginG < saturation ? floatMarginG : null,
    waterToSink: floatMarginG * 1.35 < saturation ? floatMarginG * 1.35 : null,
    // La nage se degrade bien avant : un tiers de la marge suffit a casser
    // l'assiette, et un leurre qui nage de travers ne prend plus.
    toUnusable: hoursFor(floatMarginG * 0.35),
    advice: SEALANTS.map((option) => {
      const alt = soakConstant(params, option.factor, input, pressure);
      const grams = floatMarginG;
      const hours =
        grams >= saturation ? null : -alt * Math.log(1 - grams / saturation);
      return { id: option.id, label: option.label, hoursToSuspend: hours, note: option.note };
    }),
  };
}

/** Constante de temps pour une etancheite donnee — sert au comparatif. */
function soakConstant(
  params: LureParams,
  factor: number,
  input: SoakInput,
  pressure: number,
): number {
  const porosity =
    (params.print.layerHeight / 0.2) / Math.max(params.print.perimeters, 1) * factor;
  const holeFlow = input.holes * 0.06 * factor;
  return Math.max(6 / Math.max(porosity * pressure + holeFlow, 1e-3), 1.5);
}

// ---------------------------------------------------------------------------
// K.7 — Contrainte mecanique
// ---------------------------------------------------------------------------

export type WireMaterial = 'inox304' | 'inox316' | 'ressort' | 'laiton';

/** Table de materiaux de fil, exposee et modifiable. */
export const WIRE_MATERIALS: {
  id: WireMaterial;
  label: string;
  /** Resistance a la traction, en MPa. */
  tensile: number;
  /** Limite d'elasticite, en MPa : c'est elle qui gouverne l'ouverture. */
  yield: number;
}[] = [
  { id: 'inox304', label: 'Inox 304', tensile: 620, yield: 290 },
  { id: 'inox316', label: 'Inox 316', tensile: 580, yield: 270 },
  { id: 'ressort', label: 'Acier ressort', tensile: 1600, yield: 1300 },
  { id: 'laiton', label: 'Laiton', tensile: 380, yield: 200 },
];

export type FailureMode = 'tension' | 'loop' | 'pullout';

export interface AnchorStrength {
  label: string;
  /** Charge de rupture, en N. */
  newtons: Estimate;
  /** La meme, en kgf. */
  kgf: Estimate;
  mode: FailureMode;
  modeLabel: string;
}

const MODE_LABEL: Record<FailureMode, string> = {
  tension: 'rupture en traction du fil',
  loop: 'ouverture de la boucle',
  pullout: 'arrachement de l ancrage dans le plastique',
};

/**
 * Charge de rupture d'un point d'ancrage : le plus faible de trois modes.
 *
 * Le classement compte autant que le chiffre. Sur un oeillet a vis, c'est
 * presque toujours la BOUCLE qui s'ouvre en premier, bien avant que le fil
 * ne casse — et sur un corps imprime a faible remplissage, c'est
 * l'ARRACHEMENT qui limite. Annoncer la traction pure serait rassurant et
 * faux.
 */
export function anchorStrength(
  label: string,
  wireMm: number,
  loopMm: number,
  embedMm: number,
  material: WireMaterial,
  params: LureParams,
  assumptions: SwimAssumptions,
  calibration: SwimCalibration,
): AnchorStrength {
  const spec = WIRE_MATERIALS.find((item) => item.id === material) ?? WIRE_MATERIALS[0];
  const r = wireMm * 1e-3 / 2;
  const areaM2 = Math.PI * r * r;

  // 1 — Traction pure du fil.
  const tension = spec.tensile * 1e6 * areaM2;

  // 2 — Ouverture de la boucle.
  //
  // La boucle d'une goupille en 8 est FERMEE : elle ne travaille pas comme
  // une console encastree mais comme un anneau charge en traction
  // diametrale. La redondance de l'anneau divise le moment par trois par
  // rapport au calcul en console — c'est la difference entre un chiffre
  // alarmiste et un chiffre juste. Moment maximal d'un anneau mince sous
  // deux forces radiales opposees : M = 0,318 * W * R (Roark). Le moment
  // plastique d'une section ronde vaut (4/3) * yield * r^3.
  const plasticMoment = (4 / 3) * spec.yield * 1e6 * Math.pow(r, 3);
  const loopRadius = Math.max((loopMm * 1e-3) / 2, 1e-4);
  const loop = plasticMoment / (0.318 * loopRadius);

  // 3 — Arrachement dans le plastique.
  //
  // La boucle ne se cisaille pas un cylindre de matiere : elle LABOURE le
  // corps le long de son canal de sortie. Ce qui resiste est donc la surface
  // portante de la boucle — sa largeur multipliee par le diametre du fil —
  // et la matiere cede en matage, pas en cisaillement pur. On prend le
  // double de la contrainte de cisaillement inter-couches, valeur usuelle du
  // matage sur un thermoplastique imprime.
  const shearMPa = params.material === 'resin' ? 22 : params.material === 'petg' ? 26 : 24;
  const solid =
    Math.min(0.15 + 0.85 * (params.infill / 100), 1) *
    Math.min(0.5 + 0.12 * params.print.perimeters, 1);
  const bearingArea = loopMm * 1e-3 * wireMm * 1e-3;
  // Un logement peu profond laisse peu de matiere au-dessus de la boucle :
  // en dessous d'un diametre de fil de portee, la tenue s'effondre.
  const seatFactor = Math.min(embedMm / Math.max(wireMm, 0.1), 1);
  const pullout = shearMPa * 2 * 1e6 * bearingArea * solid * seatFactor;

  const modes: { mode: FailureMode; value: number }[] = [
    { mode: 'tension', value: tension },
    { mode: 'loop', value: loop },
    { mode: 'pullout', value: pullout },
  ];
  modes.sort((a, b) => a.value - b.value);
  const weakest = modes[0];
  const newtons = weakest.value * calibration.strength;

  return {
    label,
    newtons: estimate(newtons, assumptions.uncertainty * 1.6),
    kgf: estimate(newtons / G, assumptions.uncertainty * 1.6),
    mode: weakest.mode,
    modeLabel: MODE_LABEL[weakest.mode],
  };
}

export interface SnagResult {
  /** Ce qui cede en premier. */
  first: string;
  /** Sa charge, en kgf. */
  kgf: number;
  /** Le classement complet, du plus faible au plus solide. */
  ranking: { label: string; kgf: number }[];
}

/**
 * Scenario « accroche au fond ».
 *
 * On tire jusqu'a ce que quelque chose lache. Savoir QUOI change tout : si
 * c'est la ligne, on repart avec le leurre ; si c'est le corps, on ramene une
 * piece dechiree. Le noeud est compte a 85 % de la ligne, valeur courante
 * d'un noeud correctement serre.
 */
export function snagScenario(
  anchors: AnchorStrength[],
  lineKg: number,
): SnagResult {
  const ranking = [
    { label: 'Corps de ligne', kgf: lineKg },
    { label: 'Noeud', kgf: lineKg * 0.85 },
    ...anchors.map((a) => ({ label: a.label, kgf: a.kgf.value })),
  ].sort((a, b) => a.kgf - b.kgf);
  return { first: ranking[0].label, kgf: ranking[0].kgf, ranking };
}
