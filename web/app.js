/* ============================================================================
 * WOBBLER CFD/FSI SIMULATOR — modele analytique temps reel (pas de solveur
 * Navier-Stokes). Toutes les approximations physiques sont documentees dans
 * les commentaires de chaque module ci-dessous.
 * ==========================================================================*/

(function () {
'use strict';

const RHO_WATER = 1000;     // kg/m3
const G         = 9.81;

/* ----------------------------------------------------------------------- *
 * Utilitaires
 * ----------------------------------------------------------------------- */
const clamp = THREE.MathUtils.clamp;
const lerp  = THREE.MathUtils.lerp;
const deg2rad = THREE.MathUtils.degToRad;

function smoothstep(edge0, edge1, x) {
  let t = (x - edge0) / (edge1 - edge0);
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

// Colormap "jet" (bleu -> cyan -> vert -> jaune -> orange -> rouge), t in [0,1]
function jetColor(t) {
  t = clamp(t, 0, 1);
  const r = clamp(1.5 - Math.abs(4 * t - 3), 0, 1);
  const g = clamp(1.5 - Math.abs(4 * t - 2), 0, 1);
  const b = clamp(1.5 - Math.abs(4 * t - 1), 0, 1);
  return [r, g, b];
}

// Bruit de valeur 3D (hash + interpolation trilineaire) + 2 octaves (fBm),
// utilise comme substitut leger a un bruit de Perlin pour la turbulence de sillage.
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}
function valueNoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  function corner(dx, dy, dz) { return hash3(xi + dx, yi + dy, zi + dz); }
  const c000 = corner(0,0,0), c100 = corner(1,0,0), c010 = corner(0,1,0), c110 = corner(1,1,0);
  const c001 = corner(0,0,1), c101 = corner(1,0,1), c011 = corner(0,1,1), c111 = corner(1,1,1);
  const x00 = lerp(c000, c100, u), x10 = lerp(c010, c110, u);
  const x01 = lerp(c001, c101, u), x11 = lerp(c011, c111, u);
  const y0 = lerp(x00, x10, v), y1 = lerp(x01, x11, v);
  return lerp(y0, y1, w) * 2 - 1; // -> [-1,1]
}
function fbmNoise3(x, y, z) {
  return valueNoise3(x, y, z) * 0.7 + valueNoise3(x * 2.3, y * 2.3, z * 2.3) * 0.3;
}

/* ----------------------------------------------------------------------- *
 * Etat / parametres pilotes par l'UI
 * ----------------------------------------------------------------------- */
const ui = {
  Vf: 0.7, Vw: 0.1, lipDeg: 28, lineLen: 4.0, lineK: 40,
  bodyLenMM: 100, cgPos: 45, density: 260, isoTh: 0.9, planeX: 0.10,
  matDensity: 500,     // kg/m3, densite du materiau (bois/plastique/metal) — masse du leurre
  decim: 50000,        // cible max de triangles pour le STL importe
};
const toggles = { streamlines: true, iso: false, pressure: false, hodo: true, stress: false, wake: true };

/* ----------------------------------------------------------------------- *
 * Etat de geometrie : soit le corps PROCEDURAL par defaut, soit un mesh STL
 * importe. Les grandeurs geometriques normalisees (rapports d'aspect, volume
 * adimensionne, points caracteristiques, echantillons de surface) sont
 * stockees ici et consommees par la physique et les champs.
 *   Convention repere local (apres alignement PCA du STL) :
 *     +X = nez (avant, ecoulement entrant),  -X = queue
 *      Y = axe secondaire "vertical" (dorsal/ventral)
 *      Z = axe secondaire "lateral" (flancs)
 *   Frame "normalise" : longueur principale = 1 (demi-etendue X = 0.5),
 *   centroide a l'origine. Le mesh visible est mis a l'echelle par L.
 * ----------------------------------------------------------------------- */
const PROC_METRICS = {
  // corps procedural : rapports adimensionnes (frame normalise, longueur=1)
  Rratio: 0.17,                       // R / L  (rayon caracteristique)
  aspectY: 0.17, aspectZ: 0.17,       // demi-etendues Y,Z rapportees a L
  SfrontRatio: Math.PI * 0.17 * 0.17, // Sfront / L^2
  volNorm: 0.55 * (4 / 3) * Math.PI * 0.5 * 0.17 * 0.17, // volume / L^3
};
const geom = {
  mode: 'procedural',   // 'procedural' | 'stl'
  metrics: PROC_METRICS,
  stl: null,            // donnees du mesh importe (rempli par loadSTLGeometry)
  flip: false,          // inversion manuelle nez/queue
};

/* Etat masse/inertie (MODULES A & B) — recalcule de facon throttlee, jamais a
 * chaque frame brute. updateParams() le lit pour alimenter mTrans et les
 * facteurs de lacet ; il est declare ici pour eviter tout probleme d'ordre. */
let massState = {
  massTotal: 0,        // kg, somme de tous les composants (MODULE A)
  volumeTotal: 0,      // m^3
  densite: 0,          // kg/m^3
  Iyaw: 0,             // kg·m^2, inertie de lacet autour du CM (MODULE B, Huygens)
  yawAmpFactor: 1,     // facteur multiplicatif sur l'amplitude de lacet (MODULE B.3)
  yawFreqFactor: 1,    // facteur multiplicatif sur la frequence de lacet (MODULE B.3)
  com: new THREE.Vector3(),   // centre de masse local (m)
  budget: null,        // detail par composant (rempli par computeMassBudget)
};
let IYAW_REF = null;   // inertie de reference (config par defaut) — fixee au 1er calcul

/* Profil de vitesse de recuperation dans le temps (MODULE D) */
const retrievalProfile = { mode: 'constant', paramA: 1.0, paramB: 0.6, paramC: 1.4 };

const params = {}; // recalcule chaque frame depuis `ui` et `geom`
function updateParams() {
  const m = geom.metrics;
  params.Vf = ui.Vf;
  params.Vw = ui.Vw;
  params.lipDeg = ui.lipDeg;
  params.lipAngleRad = deg2rad(ui.lipDeg);
  params.lineLen = ui.lineLen;
  params.kLine = ui.lineK;
  params.L = ui.bodyLenMM / 1000;                    // longueur principale (m) — pilote l'echelle
  params.R = m.Rratio * params.L;                    // rayon caracteristique reel
  params.aspectY = m.aspectY; params.aspectZ = m.aspectZ;
  params.Sfront = m.SfrontRatio * params.L * params.L;      // section frontale (m^2)
  params.Slip = 0.42 * params.Sfront;                       // surface effective de bavette
  const volume = m.volNorm * params.L * params.L * params.L; // volume reel (m^3)
  params.volume = volume;
  params.mass = ui.matDensity * volume;              // masse "carcasse" = densite materiau x volume
  // MODULE B.3 : la masse translatee inclut desormais TOUS les composants
  // (accessoires + ballasts), via massState.massTotal ; repli sur params.mass
  // tant que le bilan de masse n'a pas encore ete calcule (1er frame).
  const mTot = massState.massTotal > 0 ? massState.massTotal : params.mass;
  params.mTrans = mTot * 1.15 + 1e-4;                // + masse ajoutee axiale (~15%), plancher
  // Facteurs de lacet issus de l'inertie/CM (MODULE B.3), 1 par defaut
  params.yawAmpFactor = massState.yawAmpFactor || 1;
  params.yawFreqFactor = massState.yawFreqFactor || 1;
  params.VfInstant = params.Vf;                      // MODULE D : Vf instantane (surcharge par stepPhysics)
  params.cLine = 2 * Math.sqrt(params.kLine * params.mTrans) * 0.4; // sous-amorti
  params.Cd = 0.9;
  params.St = 0.22;                                  // nombre de Strouhal (sillage corps de leurre)
  params.ClDive = 1.1;
  const lipClamped = clamp(ui.lipDeg, 0, 55) / 55;
  params.psiSatBase = deg2rad(6 + 18 * lipClamped);  // amplitude de lacet saturee (deg -> rad)
  params.muBase = 1.1 + 2.2 * lipClamped;            // gain d'amortissement negatif (Van der Pol)
  params.gammaCouple = 450;                           // couplage quadratique psi^2 -> theta (regle pour amplitude visible en resonance)
  params.kBuoyBase = 6.0;
  params.cgPos = ui.cgPos / 100;
}
updateParams();

/* ----------------------------------------------------------------------- *
 * MODULE 1 — Dynamique FSI simplifiee (integrateur RK4)
 *
 *  Etat s = { psi, psiDot, theta, thetaDot, z, zDot, xRel, u, dispX, dispZ }
 *
 *  u      : vitesse du leurre le long de l'axe de traction (m/s)
 *  xRel   : allongement de la ligne = position(A) - position(leurre)
 *           A est le point tire a vitesse constante Vf (m*xRel' = Vf - u)
 *  psi    : angle de lacet (yaw) -> nage en "S"
 *  theta  : DDL secondaire (roulis) forcee en psi^2 -> boucles en "huit"
 *  z      : profondeur (positif vers le bas)
 *  dispX/Z: position affichee (repere qui suit la derive moyenne, cf. plus bas)
 *
 *  Equations (documentees ligne par ligne dans `derivatives`):
 *   1) m*u'      = k_line*xRel + c_line*(Vf-u)  -  0.5*rho*Cd*S*|Vrel|*Vrel
 *   2) psi'' = mu*w0*(1-(psi/psiSat)^2)*psi' - w0^2*psi      [Van der Pol]
 *      w0 = 2*pi*St*|Vrel|/L   (frequence de lacet verrouillee sur Strouhal)
 *      -> remplace un forcage explicite de la bavette : le limit-cycle de
 *         Van der Pol reproduit le comportement auto-entretenu de nage en S
 *         d'un wobbler reel (couplage FSI non lineaire), calibre pour que
 *         frequence ~ vitesse et amplitude ~ angle de bavette.
 *   3) theta'' = -(2w0)^2*theta - 2*zeta*(2w0)*theta' + gamma*psi^2
 *      -> reponse resonante au 2e harmonique de psi, mecanisme classique de
 *         couplage quadratique donnant des trajectoires en "huit" aux points
 *         hors axe (bavette, anneaux) alors que le nez trace un "S" simple.
 *   4) z'' = (Fdive - kBuoy*z - cZ*z') / m
 *      Fdive = 0.5*rho*ClDive*Slip*|Vrel|*Vrel*sin(angleBavette)
 * ----------------------------------------------------------------------- */
function zeroState() {
  return { psi: 0.001, psiDot: 0, theta: 0, thetaDot: 0, z: 0, zDot: 0, xRel: 0.05, u: 0.3, dispX: 0, dispZ: 0, meanU: 0.3 };
}
let state = zeroState();

function derivatives(s, p) {
  const VrelSigned = s.u - p.Vw;
  const VrelAbs = Math.abs(VrelSigned);
  const speedFactor = clamp(VrelAbs / 0.15, 0, 1); // pas de nage sans ecoulement relatif

  // MODULE D : vitesse de traction instantanee (profil jerk/pause). En mode
  // 'constant', Vf === p.Vf, donc comportement identique a l'existant.
  const Vf = (p.VfInstant !== undefined) ? p.VfInstant : p.Vf;
  const Tline = p.kLine * s.xRel + p.cLine * (Vf - s.u);
  const Ddrag = 0.5 * RHO_WATER * p.Cd * p.Sfront * VrelSigned * VrelAbs;
  const uDot = (Tline - Ddrag) / p.mTrans;
  const xRelDot = Vf - s.u;

  // MODULE B.3 : la frequence de lacet est modulee par l'inertie/CM (yawFreqFactor,
  // ~1/sqrt(I) : plus d'inertie -> nage plus lente) ; l'amplitude par yawAmpFactor.
  const fShed = p.St * VrelAbs / p.L;
  const omega0 = 2 * Math.PI * Math.max(fShed, 0.02) * (p.yawFreqFactor || 1);
  // Note : avec xi=psi/psiThresh, cette equation se ramene a la forme normalisee
  // classique de Van der Pol (xi''=mu(1-xi^2)xi'-xi) dont le cycle limite a une
  // amplitude stationnaire proche de 2*psiThresh (propriete connue de VdP, quasi
  // independante de mu) -> on divise par 2 pour que psiSatBase soit bien
  // l'amplitude REELLE de lacet obtenue en regime etabli.
  const psiThresh = (p.psiSatBase * speedFactor) / 2 * (p.yawAmpFactor || 1) + 1e-6;
  const mu = p.muBase * speedFactor;
  const psiDotDot = mu * omega0 * (1 - (s.psi * s.psi) / (psiThresh * psiThresh)) * s.psiDot - omega0 * omega0 * s.psi;

  const omegaTh = 2 * omega0, zetaTh = 0.35;
  const thetaDotDot = -omegaTh * omegaTh * s.theta - 2 * zetaTh * omegaTh * s.thetaDot + p.gammaCouple * s.psi * s.psi * speedFactor;

  const kBuoy = p.kBuoyBase * (5 / Math.max(p.lineLen, 0.5));
  const cZ = 1.8 * Math.sqrt(p.mTrans * kBuoy);
  const Fdive = 0.5 * RHO_WATER * p.ClDive * p.Slip * VrelAbs * VrelSigned * Math.sin(p.lipAngleRad);
  const zDotDot = (Fdive - kBuoy * s.z - cZ * s.zDot) / p.mTrans;

  const forwardVel = s.u * Math.cos(s.psi);
  const lateralVel = s.u * Math.sin(s.psi);
  const meanUDot = (s.u - s.meanU) / 1.5; // suit lentement la vitesse d'avance reelle en regime etabli
  const dispXDot = forwardVel - s.meanU - 0.8 * s.dispX; // repere flottant recentre (cf. commentaire plus bas)
  const dispZDot = lateralVel - 0.35 * s.dispZ;

  return {
    psi: s.psiDot, psiDot: psiDotDot, theta: s.thetaDot, thetaDot: thetaDotDot,
    z: s.zDot, zDot: zDotDot, xRel: xRelDot, u: uDot, dispX: dispXDot, dispZ: dispZDot, meanU: meanUDot,
  };
}

function addScaled(s, d, h) {
  const o = {};
  for (const k in s) o[k] = s[k] + d[k] * h;
  return o;
}
function rk4(s, dt, p) {
  const k1 = derivatives(s, p);
  const k2 = derivatives(addScaled(s, k1, dt / 2), p);
  const k3 = derivatives(addScaled(s, k2, dt / 2), p);
  const k4 = derivatives(addScaled(s, k3, dt), p);
  const o = {};
  for (const k in s) o[k] = s[k] + (dt / 6) * (k1[k] + 2 * k2[k] + 2 * k3[k] + k4[k]);
  return o;
}

let simTime = 0;
function stepPhysics(dt) {
  // Sous-pas adaptatifs : le taux de croissance (amortissement negatif) du terme
  // de Van der Pol vaut ~muBase*omega0 ; si le pas RK4 est trop grossier vis-a-vis
  // de ce taux, l'oscillateur peut diverger numeriquement avant que la saturation
  // non lineaire n'agisse (equation raide a bavette/vitesse elevees). On augmente
  // donc le nombre de sous-pas quand le regime courant l'exige.
  const VrelEst = Math.abs(state.u - params.Vw) + 0.05;
  const omega0Est = 2 * Math.PI * Math.max(params.St * VrelEst / params.L, 0.02);
  const growthRate = params.muBase * omega0Est;
  const sub = clamp(Math.ceil((growthRate * dt) / 0.2), 4, 80);
  const h = dt / sub;
  for (let i = 0; i < sub; i++) {
    // MODULE D : Vf(t) est quasi constant a l'echelle d'un sous-pas -> on l'evalue
    // une fois par sous-pas (piecewise-constant), suffisant pour le rendu.
    params.VfInstant = getInstantVf(simTime, params.Vf);
    state = rk4(state, h, params);
    simTime += h;
  }
  state.xRel = Math.max(state.xRel, 0);
  state.z = clamp(state.z, 0, 3.0);
  // Filet de securite : borne les etats (evite toute divergence residuelle) et
  // se recupere si un NaN apparaissait malgre tout, plutot que de figer la scene.
  state.psi = clamp(state.psi, -Math.PI, Math.PI);
  state.psiDot = clamp(state.psiDot, -200, 200);
  state.theta = clamp(state.theta, -Math.PI, Math.PI);
  state.thetaDot = clamp(state.thetaDot, -200, 200);
  state.u = clamp(state.u, -3, 6);
  for (const k in state) {
    if (!isFinite(state[k])) { state = zeroState(); break; }
  }
}

/* ----------------------------------------------------------------------- *
 * Scene Three.js
 * ----------------------------------------------------------------------- */
const container = document.getElementById('scene-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
scene.fog = new THREE.FogExp2(0x0b0f14, 0.045);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.005, 100);
camera.position.set(0.24, 0.16, 0.34);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.target.set(-0.06, -0.02, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.08;
controls.maxDistance = 3;

scene.add(new THREE.AmbientLight(0x8fb0c8, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(1.2, 1.8, 0.9);
scene.add(key);
const rim = new THREE.DirectionalLight(0x3fb6ff, 0.35);
rim.position.set(-1.5, 0.6, -1.2);
scene.add(rim);

// "surface de l'eau" indicative + grille de reference façon CFD-Post
const waterPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(12, 12),
  new THREE.MeshBasicMaterial({ color: 0x0e2a3d, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
);
waterPlane.rotation.x = -Math.PI / 2;
waterPlane.position.y = 0.0;
scene.add(waterPlane);
const grid = new THREE.GridHelper(6, 30, 0x22384a, 0x18242f);
grid.position.y = -1.4;
scene.add(grid);

/* ----------------------------------------------------------------------- *
 * MODULE 2 — Geometrie du leurre (formes primitives, r128)
 * Profil de corps genere par LatheGeometry (revolution autour de l'axe X
 * apres rotation), bavette triangulaire, anneaux (Torus), hameçons optionnels.
 * ----------------------------------------------------------------------- */
const lureGroup = new THREE.Group();
scene.add(lureGroup);
// Sous-groupe pour les elements RECONSTRUITS a chaque changement de geometrie
// (corps, bavette, anneaux, hameçons, marqueurs). Les champs persistants
// (plan de pression, isosurface) restent enfants directs de lureGroup et ne
// sont donc jamais supprimes par un rebuild.
const bodyGroup = new THREE.Group();
lureGroup.add(bodyGroup);

const bodyProfile = [ // (s in [0,1] le long du corps, r/Rmax)
  [0.00, 0.000], [0.05, 0.030], [0.12, 0.058], [0.22, 0.084], [0.35, 0.100],
  [0.50, 0.108], [0.62, 0.104], [0.75, 0.086], [0.85, 0.062], [0.93, 0.036],
  [0.98, 0.014], [1.00, 0.000],
];

let bodyMesh, lipMesh, ringFront, ringRear, hookGroup;
const charPoints = {}; // points caracteristiques en coordonnees LOCALES (repere leurre, echelle metres)
const stressHotspots = [];
const _geomOffset = new THREE.Vector3(); // decalage nez/queue de la geometrie visible dans le repere local

// MODULES A & B : positions LOCALES (m) des composants, pour le bilan de masse et
// le centre de masse. Renseignees a chaque buildLure (meme quand les hameçons ne
// sont pas affiches visuellement en mode STL — leur masse reste comptee).
const geomComp = {
  frameCentroid: new THREE.Vector3(), // centroide du volume (= centre de carene)
  lip: new THREE.Vector3(), ringFront: new THREE.Vector3(), ringRear: new THREE.Vector3(),
  hookFront: new THREE.Vector3(), hookRear: new THREE.Vector3(),
};

// Centroide geometrique (moyenne des sommets) d'un mesh, exprime dans le repere
// LOCAL du leurre (applique l'echelle et la position propres au mesh).
function geometryCentroidLocal(mesh) {
  const pos = mesh.geometry.attributes.position;
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < pos.count; i++) { sx += pos.getX(i); sy += pos.getY(i); sz += pos.getZ(i); }
  const n = Math.max(pos.count, 1);
  return new THREE.Vector3(sx / n, sy / n, sz / n).multiply(mesh.scale).add(mesh.position);
}

// Convertit un point du frame NORMALISE (longueur=1, centroide origine) vers le
// repere local (metres) du leurre, en appliquant echelle L + decalage CG.
function localFromNorm(pNorm) {
  return new THREE.Vector3(pNorm.x * params.L, pNorm.y * params.L, pNorm.z * params.L).add(_geomOffset);
}

// Reciproque : repere local (metres) -> frame normalise (utilise par le champ/hash STL)
function normFromLocal(pLocal, out) {
  out.set((pLocal.x - _geomOffset.x) / params.L, (pLocal.y - _geomOffset.y) / params.L, (pLocal.z - _geomOffset.z) / params.L);
  return out;
}

function disposeLureChildren() {
  for (const c of [...bodyGroup.children]) {
    bodyGroup.remove(c);
    // ne pas disposer la geometrie STL partagee (reutilisee entre rebuilds)
    if (c.geometry && c !== bodyMesh) c.geometry.dispose && c.geometry.dispose();
  }
}

// Bavette + anneaux de fixation, communs aux deux modes (positions en metres, repere local)
function addLipAndRings(noseX, tailX, R, showHooks) {
  const lipW = R * 1.6, lipLen = R * 2.1;
  const lipGeo = new THREE.BufferGeometry();
  lipGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0, -lipLen, 0, lipW * 0.5, -lipLen, 0, -lipW * 0.5,
  ]), 3));
  lipGeo.setIndex([0, 1, 2, 0, 2, 1]);
  lipGeo.computeVertexNormals();
  lipMesh = new THREE.Mesh(lipGeo, new THREE.MeshPhysicalMaterial({
    color: 0xdff6ff, transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0.0, side: THREE.DoubleSide,
  }));
  lipMesh.position.set(noseX, -R * 0.35, 0);
  lipMesh.rotation.z = params.lipAngleRad;
  bodyGroup.add(lipMesh);

  const ringGeo = new THREE.TorusGeometry(R * 0.16, R * 0.045, 8, 16);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xc9c9c9, metalness: 0.9, roughness: 0.25 });
  ringFront = new THREE.Mesh(ringGeo, ringMat);
  ringFront.position.set(noseX + R * 0.05, -R * 0.1, 0);
  ringFront.rotation.x = Math.PI / 2;
  bodyGroup.add(ringFront);
  ringRear = new THREE.Mesh(ringGeo, ringMat.clone());
  ringRear.position.set(tailX, 0, 0);
  ringRear.rotation.x = Math.PI / 2;
  bodyGroup.add(ringRear);

  // Positions des hameçons (comptees en masse dans les deux modes ; affichees
  // seulement en procedural). MODULE A/B : on les memorise systematiquement.
  const hookFrontX = 0.5 * (noseX + tailX) + 0.15 * (noseX - tailX);
  const hookRearX = tailX + 0.02 * (noseX - tailX);
  geomComp.lip.copy(lipMesh.position);
  geomComp.ringFront.copy(ringFront.position);
  geomComp.ringRear.copy(ringRear.position);
  geomComp.hookFront.set(hookFrontX, -R * 0.25, 0);
  geomComp.hookRear.set(hookRearX, -R * 0.25, 0);

  hookGroup = new THREE.Group();
  if (showHooks) {
    const hookMat = new THREE.MeshStandardMaterial({ color: 0x8891a0, metalness: 0.85, roughness: 0.3 });
    const makeTreble = (x) => {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const arc = new THREE.Mesh(new THREE.TorusGeometry(R * 0.5, R * 0.035, 6, 10, Math.PI * 1.35), hookMat);
        arc.rotation.z = Math.PI * 0.15;
        arc.rotation.y = (i * 2 * Math.PI) / 3;
        arc.position.y = -R * 0.15;
        g.add(arc);
      }
      g.position.set(x, -R * 0.25, 0);
      return g;
    };
    hookGroup.add(makeTreble(hookFrontX));
    hookGroup.add(makeTreble(hookRearX));
  }
  bodyGroup.add(hookGroup);
}

function buildLure() {
  disposeLureChildren();
  _geomOffset.set(0, 0, 0);
  if (geom.mode === 'stl' && geom.stl) buildSTLBody();
  else buildProceduralBody();
  buildCharMarkers();
}

function buildProceduralBody() {
  geom.metrics = PROC_METRICS;
  updateParams();
  const L = params.L, R = params.R;
  const cgX = params.cgPos * L; // origine du groupe = centre de gravite
  _geomOffset.set(0, 0, 0);

  const profilePeak = Math.max(...bodyProfile.map(([, r]) => r));
  const pts = bodyProfile.map(([s, r]) => new THREE.Vector2((r / profilePeak) * R, s * L));
  const latheGeo = new THREE.LatheGeometry(pts, 28);
  latheGeo.rotateZ(-Math.PI / 2);      // aligne l'axe de revolution (Y) sur l'axe avant local (X)
  latheGeo.translate(-cgX, 0, 0);      // origine locale = centre de gravite
  latheGeo.computeVertexNormals();

  bodyMesh = new THREE.Mesh(latheGeo, new THREE.MeshStandardMaterial({
    color: 0x2f7ea8, metalness: 0.25, roughness: 0.35, vertexColors: false,
  }));
  bodyMesh.userData.baseColor = new THREE.Color(0x2f7ea8);
  bodyGroup.add(bodyMesh);

  const noseX = L - cgX, tailX = -cgX, lipLen = R * 2.1;
  addLipAndRings(noseX, tailX, R, true);
  geomComp.frameCentroid.copy(geometryCentroidLocal(bodyMesh)); // centre de carene

  charPoints.nose      = new THREE.Vector3(noseX, 0, 0);
  charPoints.lipTip    = new THREE.Vector3(noseX - lipLen * Math.cos(params.lipAngleRad), -R * 0.35 - lipLen * Math.sin(params.lipAngleRad), 0);
  charPoints.ringFront = ringFront.position.clone();
  charPoints.ringRear  = ringRear.position.clone();
  charPoints.tail      = new THREE.Vector3(tailX, 0, 0);
  charPoints.finLeft   = new THREE.Vector3(0.5 * L - cgX, R * 0.2, R * 1.05);
  charPoints.finRight  = new THREE.Vector3(0.5 * L - cgX, R * 0.2, -R * 1.05);
  charPoints.dorsal    = new THREE.Vector3(0.45 * L - cgX, R * 1.05, 0);

  stressHotspots.length = 0;
  stressHotspots.push(charPoints.lipTip.clone(), charPoints.ringFront.clone());
}

// Corps STL : la geometrie normalisee (longueur=1) est mise a l'echelle L et
// decalee selon cgPos ; les points caracteristiques auto-detectes (frame
// normalise) sont convertis en metres via localFromNorm.
function buildSTLBody() {
  geom.metrics = geom.stl.metrics;
  updateParams();
  const L = params.L, R = params.R;
  // decalage CG : pivot le long de X (0.5 = centroide), borne par cgPos slider
  const pivotNormX = clamp(params.cgPos - 0.5, -0.35, 0.35);
  _geomOffset.set(-pivotNormX * L, 0, 0);

  bodyMesh = new THREE.Mesh(geom.stl.geometry, new THREE.MeshStandardMaterial({
    color: 0x2f7ea8, metalness: 0.22, roughness: 0.4, vertexColors: false, side: THREE.DoubleSide,
  }));
  bodyMesh.userData.baseColor = new THREE.Color(0x2f7ea8);
  bodyMesh.scale.setScalar(L);
  bodyMesh.position.copy(_geomOffset);
  bodyGroup.add(bodyMesh);

  const cn = geom.stl.charNorm;
  for (const k in cn) charPoints[k] = localFromNorm(cn[k]);
  // retire d'eventuels points procedural non definis pour le STL
  for (const k of Object.keys(charPoints)) if (!(k in cn)) delete charPoints[k];

  const noseX = charPoints.nose.x, tailX = charPoints.tail.x;
  addLipAndRings(noseX, tailX, R, false); // pas de hameçons sur un mesh arbitraire
  geomComp.frameCentroid.copy(geometryCentroidLocal(bodyMesh)); // centre de carene (STL)

  stressHotspots.length = 0;
  stressHotspots.push(charPoints.nose.clone(), charPoints.tail.clone());
}

const markerColors = {
  nose: 0xff5a3c, lipTip: 0xffd23f, ringFront: 0x3fe0ff, ringRear: 0x8effa0,
  tail: 0xff8fe0, finLeft: 0xb98cff, finRight: 0x66ff9e, dorsal: 0xffa63f,
};
let charMarkers = {};
let comMarker = null, careneMarker = null, comLine = null; // MODULE B.2 : marqueurs CM / centre de carene
function buildCharMarkers() {
  for (const k in charMarkers) bodyGroup.remove(charMarkers[k]);
  charMarkers = {};
  const R = params.R;
  for (const key in charPoints) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(R * 0.09, 8, 8),
      new THREE.MeshBasicMaterial({ color: markerColors[key] || 0xffffff })
    );
    m.position.copy(charPoints[key]);
    bodyGroup.add(m);
    charMarkers[key] = m;
  }
  // Marqueur du centre de masse (doré) + centre de carene (cyan) + ligne d'ecart
  comMarker = new THREE.Mesh(new THREE.SphereGeometry(R * 0.14, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xffd23f }));
  bodyGroup.add(comMarker);
  careneMarker = new THREE.Mesh(new THREE.SphereGeometry(R * 0.10, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x3fe0ff, transparent: true, opacity: 0.8 }));
  careneMarker.position.copy(geomComp.frameCentroid);
  bodyGroup.add(careneMarker);
  comLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.7 }));
  bodyGroup.add(comLine);
}

buildLure();

/* ----------------------------------------------------------------------- *
 * MODULE 2b — Traitement d'un STL importe
 *
 *  Pipeline (documente etape par etape ci-dessous) :
 *   1) parse (STLLoader, ASCII/binaire) -> triangle soup + normales
 *   2) decimation par clustering de grille si triangles > cible (perf)
 *   3) PCA sur les sommets -> axes principaux ; alignement axe0 sur X
 *   4) heuristique nez/queue (l'extremite la plus "massive" = nez, +X)
 *   5) recentrage + normalisation d'echelle (longueur principale -> 1)
 *   6) metriques physiques : volume (somme de tetraedres signes),
 *      rapports d'aspect, section frontale -> alimentent updateParams()
 *   7) points caracteristiques auto (extrema sur les 3 axes)
 *   8) echantillonnage de surface + hash spatial -> deviation des streamlines
 * ----------------------------------------------------------------------- */

// -- Eigen-decomposition symetrique 3x3 (rotations de Jacobi) --------------
function jacobiEigen3(A) {
  // A : [[a00,a01,a02],[a01,a11,a12],[a02,a12,a22]] symetrique
  const a = [A[0].slice(), A[1].slice(), A[2].slice()];
  const V = [[1,0,0],[0,1,0],[0,0,1]];
  for (let sweep = 0; sweep < 24; sweep++) {
    // plus grand element hors-diagonale
    let p = 0, q = 1, max = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > max) { max = Math.abs(a[0][2]); p = 0; q = 2; }
    if (Math.abs(a[1][2]) > max) { max = Math.abs(a[1][2]); p = 1; q = 2; }
    if (max < 1e-12) break;
    const app = a[p][p], aqq = a[q][q], apq = a[p][q];
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi), s = Math.sin(phi);
    for (let k = 0; k < 3; k++) {
      const akp = a[k][p], akq = a[k][q];
      a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = a[p][k], aqk = a[q][k];
      a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
    }
    for (let k = 0; k < 3; k++) {
      const vkp = V[k][p], vkq = V[k][q];
      V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
    }
  }
  const vals = [a[0][0], a[1][1], a[2][2]];
  const vecs = [0,1,2].map(j => new THREE.Vector3(V[0][j], V[1][j], V[2][j]).normalize());
  return { vals, vecs };
}

// -- Decimation par clustering de grille (triangle soup) -------------------
// Regroupe les sommets par cellule d'une grille reguliere ; garde un
// representant par cellule ; reconstruit les triangles non degeneres.
function decimateSoup(posArr, targetTris) {
  let cellFrac = 0.9;
  let result = posArr;
  for (let attempt = 0; attempt < 6; attempt++) {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < posArr.length; i += 3) {
      minX = Math.min(minX, posArr[i]); maxX = Math.max(maxX, posArr[i]);
      minY = Math.min(minY, posArr[i+1]); maxY = Math.max(maxY, posArr[i+1]);
      minZ = Math.min(minZ, posArr[i+2]); maxZ = Math.max(maxZ, posArr[i+2]);
    }
    const diag = Math.hypot(maxX-minX, maxY-minY, maxZ-minZ) || 1;
    const gridN = Math.max(8, Math.round(Math.cbrt(targetTris) * 5.0 * cellFrac));
    const cell = diag / gridN;
    const rep = new Map(); // cellKey -> {x,y,z sum,count} + id
    const keyOf = (x,y,z) => (Math.floor((x-minX)/cell))+'_'+(Math.floor((y-minY)/cell))+'_'+(Math.floor((z-minZ)/cell));
    for (let i = 0; i < posArr.length; i += 3) {
      const k = keyOf(posArr[i],posArr[i+1],posArr[i+2]);
      let r = rep.get(k);
      if (!r) { r = { x:0,y:0,z:0,n:0 }; rep.set(k, r); }
      r.x += posArr[i]; r.y += posArr[i+1]; r.z += posArr[i+2]; r.n++;
    }
    const out = [];
    for (let t = 0; t < posArr.length; t += 9) {
      const k0 = keyOf(posArr[t],posArr[t+1],posArr[t+2]);
      const k1 = keyOf(posArr[t+3],posArr[t+4],posArr[t+5]);
      const k2 = keyOf(posArr[t+6],posArr[t+7],posArr[t+8]);
      if (k0 === k1 || k1 === k2 || k0 === k2) continue; // triangle effondre
      for (const k of [k0,k1,k2]) { const r = rep.get(k); out.push(r.x/r.n, r.y/r.n, r.z/r.n); }
    }
    result = new Float32Array(out);
    const tris = result.length / 9;
    if (tris <= targetTris * 1.15 && tris > 8) return result;
    if (tris > targetTris) cellFrac *= 0.72; else cellFrac *= 1.25; // ajuste la finesse
  }
  return result;
}

// -- Volume par somme de tetraedres signes (origine = 0) -------------------
function meshVolume(posArr) {
  let v = 0;
  for (let t = 0; t < posArr.length; t += 9) {
    const ax = posArr[t],   ay = posArr[t+1], az = posArr[t+2];
    const bx = posArr[t+3], by = posArr[t+4], bz = posArr[t+5];
    const cx = posArr[t+6], cy = posArr[t+7], cz = posArr[t+8];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(v);
}

// -- Hash spatial d'un nuage de points (frame normalise) -------------------
function buildSpatialHash(points, cell) {
  const map = new Map();
  for (let i = 0; i < points.length; i += 3) {
    const k = Math.floor(points[i]/cell)+'_'+Math.floor(points[i+1]/cell)+'_'+Math.floor(points[i+2]/cell);
    let arr = map.get(k); if (!arr) { arr = []; map.set(k, arr); } arr.push(i);
  }
  return { map, cell, points };
}
const _nsOut = new THREE.Vector3();
function nearestSurfaceDist(hash, x, y, z, outDir) {
  const cell = hash.cell, pts = hash.points;
  const ix = Math.floor(x/cell), iy = Math.floor(y/cell), iz = Math.floor(z/cell);
  let best = Infinity, bx = 0, by = 0, bz = 0, found = false;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const arr = hash.map.get((ix+dx)+'_'+(iy+dy)+'_'+(iz+dz));
    if (!arr) continue;
    for (let a = 0; a < arr.length; a++) {
      const idx = arr[a];
      const ddx = x - pts[idx], ddy = y - pts[idx+1], ddz = z - pts[idx+2];
      const d2 = ddx*ddx + ddy*ddy + ddz*ddz;
      if (d2 < best) { best = d2; bx = ddx; by = ddy; bz = ddz; found = true; }
    }
  }
  if (!found) return Infinity;
  const d = Math.sqrt(best) || 1e-6;
  outDir.set(bx/d, by/d, bz/d);
  return d;
}

// -- Pipeline principal : BufferGeometry brute -> geom.stl ------------------
function processSTLGeometry(rawGeo, fileName) {
  rawGeo.deleteAttribute('normal');
  let posArr = rawGeo.attributes.position.array;
  let triCount = posArr.length / 9;
  const rawTri = triCount;

  // (2) decimation si trop de triangles
  const target = ui.decim;
  let decimated = false;
  if (triCount > target) { posArr = decimateSoup(posArr, target); triCount = posArr.length / 9; decimated = true; }

  // dims brutes (unites du fichier) pour affichage
  let rminX=Infinity,rminY=Infinity,rminZ=Infinity,rmaxX=-Infinity,rmaxY=-Infinity,rmaxZ=-Infinity;
  let mx=0,my=0,mz=0, nV = posArr.length/3;
  for (let i=0;i<posArr.length;i+=3){
    mx+=posArr[i];my+=posArr[i+1];mz+=posArr[i+2];
    rminX=Math.min(rminX,posArr[i]);rmaxX=Math.max(rmaxX,posArr[i]);
    rminY=Math.min(rminY,posArr[i+1]);rmaxY=Math.max(rmaxY,posArr[i+1]);
    rminZ=Math.min(rminZ,posArr[i+2]);rmaxZ=Math.max(rmaxZ,posArr[i+2]);
  }
  mx/=nV;my/=nV;mz/=nV;
  const rawDims = { x: rmaxX-rminX, y: rmaxY-rminY, z: rmaxZ-rminZ };

  // (3) PCA : covariance des sommets recentres
  let c00=0,c01=0,c02=0,c11=0,c12=0,c22=0;
  for (let i=0;i<posArr.length;i+=3){
    const dx=posArr[i]-mx, dy=posArr[i+1]-my, dz=posArr[i+2]-mz;
    c00+=dx*dx; c01+=dx*dy; c02+=dx*dz; c11+=dy*dy; c12+=dy*dz; c22+=dz*dz;
  }
  const inv = 1/nV;
  const cov = [[c00*inv,c01*inv,c02*inv],[c01*inv,c11*inv,c12*inv],[c02*inv,c12*inv,c22*inv]];
  const { vals, vecs } = jacobiEigen3(cov);
  const order = [0,1,2].sort((i,j)=>vals[j]-vals[i]); // desc : [principal, sec1, sec2]
  let ax0 = vecs[order[0]].clone(), ax1 = vecs[order[1]].clone(), ax2 = vecs[order[2]].clone();
  // repere droitier
  if (ax0.clone().cross(ax1).dot(ax2) < 0) ax2.multiplyScalar(-1);

  // (5 partiel) projette les sommets dans le frame PCA, recentres
  const proj = new Float32Array(posArr.length);
  let pMinX=Infinity,pMaxX=-Infinity,pMinY=Infinity,pMaxY=-Infinity,pMinZ=Infinity,pMaxZ=-Infinity;
  const _v = new THREE.Vector3();
  for (let i=0;i<posArr.length;i+=3){
    _v.set(posArr[i]-mx, posArr[i+1]-my, posArr[i+2]-mz);
    const x = _v.dot(ax0), y = _v.dot(ax1), z = _v.dot(ax2);
    proj[i]=x; proj[i+1]=y; proj[i+2]=z;
    pMinX=Math.min(pMinX,x);pMaxX=Math.max(pMaxX,x);
    pMinY=Math.min(pMinY,y);pMaxY=Math.max(pMaxY,y);
    pMinZ=Math.min(pMinZ,z);pMaxZ=Math.max(pMaxZ,z);
  }

  // (4) heuristique nez/queue : l'extremite la plus "epaisse" (grande section) = nez -> +X
  let spreadPos=0,nPos=0,spreadNeg=0,nNeg=0;
  for (let i=0;i<proj.length;i+=3){
    const r = Math.hypot(proj[i+1],proj[i+2]);
    if (proj[i]>=0){spreadPos+=r;nPos++;} else {spreadNeg+=r;nNeg++;}
  }
  const meanPos = spreadPos/Math.max(nPos,1), meanNeg = spreadNeg/Math.max(nNeg,1);
  let flipX = meanPos < meanNeg;           // nez actuellement du cote -X -> on retourne
  if (geom.flip) flipX = !flipX;           // inversion manuelle utilisateur
  if (flipX) { // rotation 180° autour de Y : (x,z)->(-x,-z), conserve l'orientation
    for (let i=0;i<proj.length;i+=3){ proj[i]=-proj[i]; proj[i+2]=-proj[i+2]; }
    const t1=pMinX; pMinX=-pMaxX; pMaxX=-t1;
    const t2=pMinZ; pMinZ=-pMaxZ; pMaxZ=-t2;
  }

  // (5) normalisation : longueur principale -> 1, centroide deja a l'origine
  const lengthPCA = (pMaxX - pMinX) || 1;
  const s = 1 / lengthPCA;
  for (let i=0;i<proj.length;i++) proj[i]*=s;
  const halfX = (pMaxX-pMinX)*0.5*s, halfY = Math.max(Math.abs(pMinY),Math.abs(pMaxY))*s, halfZ = Math.max(Math.abs(pMinZ),Math.abs(pMaxZ))*s;

  // (6) metriques physiques adimensionnees (frame normalise, L=1)
  const volNorm = Math.max(meshVolume(proj), 1e-4);
  const aspectY = Math.max(halfY, 0.02), aspectZ = Math.max(halfZ, 0.02);
  const metrics = {
    Rratio: 0.5 * (aspectY + aspectZ),
    aspectY, aspectZ,
    SfrontRatio: Math.PI * aspectY * aspectZ,
    volNorm,
  };

  // geometrie normalisee affichable
  const normGeo = new THREE.BufferGeometry();
  normGeo.setAttribute('position', new THREE.BufferAttribute(proj, 3));
  normGeo.computeVertexNormals();
  normGeo.computeBoundingSphere();

  // (7) points caracteristiques : extrema sur chaque axe (frame normalise)
  function extremeVertex(axis, sign) {
    let best = -Infinity, bi = 0;
    for (let i=0;i<proj.length;i+=3){ const val = sign*proj[i+axis]; if (val>best){best=val;bi=i;} }
    return new THREE.Vector3(proj[bi],proj[bi+1],proj[bi+2]);
  }
  const nose = extremeVertex(0, +1), tail = extremeVertex(0, -1);
  const dorsal = extremeVertex(1, +1);
  const finLeft = extremeVertex(2, +1), finRight = extremeVertex(2, -1);
  const charNorm = {
    nose, tail, dorsal, finLeft, finRight,
    ringFront: new THREE.Vector3(nose.x * 0.9, Math.min(nose.y, -0.06), 0),
    ringRear:  new THREE.Vector3(tail.x * 0.95, 0, 0),
    lipTip:    new THREE.Vector3(nose.x + 0.12, -aspectY - 0.1, 0),
  };

  // (8) echantillonnage de surface + hash (deviation des streamlines)
  const maxSamples = 1600;
  const stride = Math.max(1, Math.floor((proj.length/3) / maxSamples));
  const samples = [];
  for (let i=0;i<proj.length;i+=3*stride){ samples.push(proj[i],proj[i+1],proj[i+2]); }
  const samplePts = new Float32Array(samples);
  const hashCell = 0.14;
  const hash = buildSpatialHash(samplePts, hashCell);

  geom.stl = {
    geometry: normGeo, metrics, charNorm, hash,
    influenceR: 0.16,   // rayon d'influence de la repulsion (frame normalise)
    triCount, rawTri, decimated, rawDims, fileName,
  };
}

/* Ligne de peche + point A (tire a vitesse Vf) ------------------------- */
const lineMat = new THREE.LineBasicMaterial({ color: 0xcfd8e0, linewidth: 1 });
const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const fishingLine = new THREE.Line(lineGeo, lineMat);
scene.add(fishingLine);
const aMarker = new THREE.Mesh(new THREE.SphereGeometry(0.004, 10, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
scene.add(aMarker);

/* ----------------------------------------------------------------------- *
 * MODULE 3 — Champ de vitesse procedural (potentiel + sillage empirique)
 *
 *  V(p,t) = V_uniforme(relatif corps/eau, exprime dans le repere local)
 *         + V_doublet(p)      [ecoulement potentiel : source au nez, puits
 *                               a la queue -> emule un corps de Rankine]
 *         + V_sillage(p,t)    [rangee de vortex de Rankine alternes, fige
 *                               dans le repere du corps, pulses en temps
 *                               pour animer le lachage tourbillonnaire]
 *         + bruit(p,t)        [fBm, uniquement dans le sillage -> turbulence]
 * ----------------------------------------------------------------------- */
const _invQuat = new THREE.Quaternion();

function addPointSource(vAccum, p, srcPos, strength, rMin) {
  const dx = p.x - srcPos.x, dy = p.y - srcPos.y, dz = p.z - srcPos.z;
  let r = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (r < rMin) r = rMin;
  const coeff = strength / (4 * Math.PI * r * r * r);
  vAccum.x += dx * coeff; vAccum.y += dy * coeff; vAccum.z += dz * coeff;
}

const _wakeV = new THREE.Vector3();
function wakeVelocityLocal(pLocal, t, VrelAbs, L, R, psiAmp) {
  _wakeV.set(0, 0, 0);
  const mask = smoothstep(-0.05 * L, -0.55 * L, pLocal.x);
  if (mask <= 0.001) return _wakeV;
  const fShed = params.St * VrelAbs / L;
  const omega = 2 * Math.PI * Math.max(fShed, 0.02);
  const coreR = 0.25 * R;
  const bShed = 0.3 * R + 1.4 * R * clamp(Math.abs(psiAmp) / 0.35, 0, 1);
  const spacing = 1.15 * R;
  const tailX = -0.5 * L;
  const Gamma0 = 1.2 * Math.PI * VrelAbs * coreR;
  const K = 6;
  for (let k = 0; k < K; k++) {
    const xk = tailX - (k + 0.5) * spacing;
    const zk = (k % 2 === 0 ? 1 : -1) * bShed;
    const dx = pLocal.x - xk, dz = pLocal.z - zk;
    const r2 = dx * dx + dz * dz;
    if (r2 > (spacing * 2.2) * (spacing * 2.2)) continue;
    const r = Math.sqrt(r2) || 1e-5;
    const sign = k % 2 === 0 ? 1 : -1;
    const Gamma = Gamma0 * sign * (0.7 + 0.3 * Math.sin(omega * t - (k * Math.PI) / 2));
    const vt = r < coreR ? Gamma / (2 * Math.PI * coreR * coreR) * r : Gamma / (2 * Math.PI * r);
    _wakeV.x += (vt * -dz) / r;
    _wakeV.z += (vt * dx) / r;
  }
  _wakeV.multiplyScalar(mask);
  return _wakeV;
}

// point/vitesse en coordonnees MONDE -> vitesse relative locale (repere corps)
const _pLocal = new THREE.Vector3();
const _pNorm = new THREE.Vector3();
function fieldVelocityWorld(pWorld, out) {
  _invQuat.copy(lureGroup.quaternion).conjugate();
  _pLocal.copy(pWorld).sub(lureGroup.position).applyQuaternion(_invQuat);

  const VrelSigned = state.u - params.Vw;
  const VrelAbs = Math.abs(VrelSigned) + 1e-4;
  const L = params.L, R = params.R;

  out.set(-VrelSigned, 0, 0); // ecoulement uniforme relatif, exprime dans le repere local

  // Doublet source(nez)/puits(queue) — corps de Rankine. En mode STL les foyers
  // suivent la geometrie reelle (nez/queue detectes) via le decalage _geomOffset.
  const Q = 6 * Math.PI * VrelAbs * R * R; // gain empirique (visibilite)
  const srcX = geom.mode === 'stl' ? _geomOffset.x + 0.42 * L : 0.42 * L;
  const snkX = geom.mode === 'stl' ? _geomOffset.x - 0.42 * L : -0.42 * L;
  addPointSource(out, _pLocal, { x: srcX, y: _geomOffset.y, z: _geomOffset.z }, Q, 0.35 * R);
  addPointSource(out, _pLocal, { x: snkX, y: _geomOffset.y, z: _geomOffset.z }, -Q, 0.35 * R);

  // Deviation autour du mesh STL reel : repulsion depuis le point de surface le
  // plus proche (hash spatial). Emule le contournement de la vraie forme sans
  // resoudre l'ecoulement potentiel exact autour d'un maillage arbitraire.
  if (geom.mode === 'stl' && geom.stl) {
    normFromLocal(_pLocal, _pNorm);
    const infl = geom.stl.influenceR;
    const d = nearestSurfaceDist(geom.stl.hash, _pNorm.x, _pNorm.y, _pNorm.z, _nsOut);
    if (d < infl) {
      const push = VrelAbs * 1.9 * (1 - d / infl); // outDir est identique en local (echelle uniforme)
      out.x += _nsOut.x * push; out.y += _nsOut.y * push; out.z += _nsOut.z * push;
    }
  }

  if (toggles.wake) {
    const w = wakeVelocityLocal(_pLocal, simTime, VrelAbs, L, R, state.psi);
    out.x += w.x; out.z += w.z;
    const mask = smoothstep(-0.05 * L, -0.55 * L, _pLocal.x);
    if (mask > 0.001) {
      const n = fbmNoise3(_pLocal.x * 9 + simTime * 0.4, _pLocal.y * 9, _pLocal.z * 9 + simTime * 0.4);
      const n2 = fbmNoise3(_pLocal.z * 9 - simTime * 0.3, _pLocal.y * 9, _pLocal.x * 9);
      out.y += n * 0.12 * VrelAbs * mask;
      out.z += n2 * 0.12 * VrelAbs * mask;
    }
  }
  out.applyQuaternion(lureGroup.quaternion); // repere local -> monde
  return out;
}

/* ----------------------------------------------------------------------- *
 * MODULE 4 — Streamlines (particules advectees, trainee courte colorée par |V|)
 * ----------------------------------------------------------------------- */
const TAIL_LEN = 7;
const MAX_PARTICLES = 700;
const particles = [];
function makeParticle() { return { pos: new THREE.Vector3(), tail: [], age: 0, life: 0 }; }
for (let i = 0; i < MAX_PARTICLES; i++) particles.push(makeParticle());

const streamGeo = new THREE.BufferGeometry();
const streamPosArr = new Float32Array(MAX_PARTICLES * (TAIL_LEN - 1) * 2 * 3);
const streamColArr = new Float32Array(MAX_PARTICLES * (TAIL_LEN - 1) * 2 * 3);
streamGeo.setAttribute('position', new THREE.BufferAttribute(streamPosArr, 3));
streamGeo.setAttribute('color', new THREE.BufferAttribute(streamColArr, 3));
const streamMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 });
const streamLines = new THREE.LineSegments(streamGeo, streamMat);
// La sphere englobante calculee au 1er rendu (avant toute particule reelle) resterait
// figee (degenerescence rayon=0) sans recalcul -> desactive le frustum culling ici.
streamLines.frustumCulled = false;
scene.add(streamLines);

const V_COLOR_MAX = 2.2; // m/s, plage haute de la colormap vitesse (legende)

function spawnParticle(pt) {
  const L = params.L, R = params.R;
  pt.pos.set(L * 1.35, (Math.random() - 0.5) * R * 2.4, (Math.random() - 0.5) * R * 4.2);
  pt.pos.applyQuaternion(lureGroup.quaternion).add(lureGroup.position);
  pt.tail.length = 0;
  pt.age = 0;
  pt.life = 4 + Math.random() * 3;
}
for (const pt of particles) spawnParticle(pt);

const _fieldTmp = new THREE.Vector3();
function updateStreamlines(dt) {
  const activeN = Math.round(ui.density);
  const L = params.L;
  let vi = 0; // index vertex courant dans les buffers
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const pt = particles[i];
    if (i < activeN) {
      fieldVelocityWorld(pt.pos, _fieldTmp);
      pt.pos.addScaledVector(_fieldTmp, dt);
      pt.age += dt;
      pt.tail.push(pt.pos.clone());
      if (pt.tail.length > TAIL_LEN) pt.tail.shift();

      const localX = pt.pos.clone().sub(lureGroup.position).applyQuaternion(_invQuat.copy(lureGroup.quaternion).conjugate()).x;
      const outOfBounds = localX < -3.2 * L || pt.age > pt.life || Math.abs(pt.pos.y - lureGroup.position.y) > L * 2.5;
      if (outOfBounds) spawnParticle(pt);

      const speed = _fieldTmp.length();
      const [r, g, b] = jetColor(speed / V_COLOR_MAX);
      for (let s = 0; s < pt.tail.length - 1; s++) {
        const a = pt.tail[s], bpt = pt.tail[s + 1];
        streamPosArr[vi] = a.x; streamPosArr[vi + 1] = a.y; streamPosArr[vi + 2] = a.z;
        streamColArr[vi] = r; streamColArr[vi + 1] = g; streamColArr[vi + 2] = b;
        vi += 3;
        streamPosArr[vi] = bpt.x; streamPosArr[vi + 1] = bpt.y; streamPosArr[vi + 2] = bpt.z;
        streamColArr[vi] = r; streamColArr[vi + 1] = g; streamColArr[vi + 2] = b;
        vi += 3;
      }
    }
  }
  // degenerer le reste du buffer (segments de longueur nulle -> invisibles)
  for (; vi < streamPosArr.length; vi += 3) { streamPosArr[vi] = 0; streamPosArr[vi + 1] = -999; streamPosArr[vi + 2] = 0; }
  streamGeo.attributes.position.needsUpdate = true;
  streamGeo.attributes.color.needsUpdate = true;
}

/* ----------------------------------------------------------------------- *
 * MODULE 5 — Plan de coupe : pression (Bernoulli simplifie)
 *   P = P0 - 1/2 * rho * (|V(p)|^2 - Vrel^2)   [le long du champ local]
 * ----------------------------------------------------------------------- */
const PRESSURE_RES = 34;
const pressurePlaneGeo = new THREE.PlaneGeometry(1, 1, PRESSURE_RES, PRESSURE_RES);
const pressureColors = new Float32Array((PRESSURE_RES + 1) * (PRESSURE_RES + 1) * 3);
pressurePlaneGeo.setAttribute('color', new THREE.BufferAttribute(pressureColors, 3));
const pressureMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.82 });
const pressurePlane = new THREE.Mesh(pressurePlaneGeo, pressureMat);
pressurePlane.rotation.y = Math.PI / 2; // plan perpendiculaire a l'axe local X
lureGroup.add(pressurePlane);

let pressureRangePa = 200; // Pa, demi-etendue courante de la colormap (auto-ajustee, cf. plus bas)
const _pw = new THREE.Vector3();
function updatePressurePlane() {
  const L = params.L, R = params.R;
  pressurePlane.position.x = ui.planeX * L;
  const scale = R * 4.0;
  pressurePlane.scale.set(scale, scale, 1);
  const VrelAbs = Math.abs(state.u - params.Vw) + 1e-4;
  // Plage de la colormap auto-ajustee sur la pression dynamique courante (comme un CFD-Post en mode auto-range)
  pressureRangePa = Math.max(60, 1.3 * 0.5 * RHO_WATER * VrelAbs * VrelAbs);
  const pos = pressurePlaneGeo.attributes.position;
  const col = pressurePlaneGeo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    // Doit reproduire exactement la transformation du mesh (scale -> rotation.y=90° -> position)
    // pour que la couleur calculee corresponde au sommet reellement affiche :
    // (x,y,0) --scale--> (x*s,y*s,0) --rotY90--> (0, y*s, -x*s) --translate--> (+lx, .., ..)
    const lx = pressurePlane.position.x;
    const ly = pos.getY(i) * scale;
    const lz = -pos.getX(i) * scale;
    _pw.set(lx, ly, lz).applyQuaternion(lureGroup.quaternion).add(lureGroup.position);
    fieldVelocityWorld(_pw, _fieldTmp);
    const speed2 = _fieldTmp.lengthSq();
    const p = -0.5 * RHO_WATER * (speed2 - VrelAbs * VrelAbs); // surpression(+) / depression(-) relative a P0
    const t = clamp((p + pressureRangePa) / (2 * pressureRangePa), 0, 1);
    const [r, g, b] = jetColor(t);
    col.setXYZ(i, r, g, b);
  }
  col.needsUpdate = true;
  updatePressureLegendTicks();
}

/* ----------------------------------------------------------------------- *
 * MODULE 6 — Isosurface de vitesse (coque approximative par ray-marching
 * radial depuis le centre du leurre, sur un maillage d'icosaedre)
 * ----------------------------------------------------------------------- */
const isoBaseGeo = new THREE.IcosahedronGeometry(1, 2);
const isoMat = new THREE.MeshBasicMaterial({ color: 0x3fb6ff, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false });
const isoMesh = new THREE.Mesh(isoBaseGeo, isoMat);
lureGroup.add(isoMesh);
const isoDir = new THREE.Vector3();
let isoAccum = 0;
function updateIsosurface(dt) {
  isoAccum += dt;
  if (isoAccum < 0.12) return;
  isoAccum = 0;
  const R = params.R, L = params.L;
  const threshold = ui.isoTh;
  const pos = isoBaseGeo.attributes.position;
  const origDir = new THREE.Vector3();
  const [r, g, b] = jetColor(clamp(threshold / V_COLOR_MAX, 0, 1));
  isoMat.color.setRGB(r, g, b);
  const steps = 14, maxR = 0.9 * L;
  const isoCenter = _geomOffset.clone(); // centroide du corps (procedural: origine ; STL: decalage CG)
  for (let i = 0; i < pos.count; i++) {
    origDir.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    isoDir.copy(origDir);
    // Balaye tout le rayon (au lieu de s'arreter au 1er echec) car le champ
    // pres du corps n'est pas monotone (pics locaux pres de la source/du puits) :
    // on retient le rayon le plus eloigne ou la vitesse depasse encore le seuil.
    let foundR = 0.04 * R;
    for (let s = 1; s <= steps; s++) {
      const rr = (s / steps) * maxR;
      const pLocal = origDir.clone().multiplyScalar(rr).add(isoCenter);
      const worldP = pLocal.clone().applyQuaternion(lureGroup.quaternion).add(lureGroup.position);
      fieldVelocityWorld(worldP, _fieldTmp);
      if (_fieldTmp.length() >= threshold) foundR = rr;
    }
    const finalP = origDir.clone().multiplyScalar(Math.max(foundR, 0.05 * R)).add(isoCenter);
    pos.setXYZ(i, finalP.x, finalP.y, finalP.z);
  }
  pos.needsUpdate = true;
  isoBaseGeo.computeVertexNormals();
}

/* ----------------------------------------------------------------------- *
 * MODULE 7 — Contrainte de Von Mises (bonus, approximation phenomenologique)
 *   sigma(x) = sigma0 + F_hydro_norm * somme_i exp(-||x - hotspot_i||^2 / s^2)
 *   F_hydro tire de la force de lacet courante (proxy de l'effort sur bavette
 *   et anneau), sans resolution elements finis.
 * ----------------------------------------------------------------------- */
const SIGMA_MAX_MPA = 18;
let stressAccum = 0;
const _hn = new THREE.Vector3();
function updateStress(dt) {
  stressAccum += dt;
  if (stressAccum < 0.15) return;
  stressAccum = 0;
  const geo = bodyMesh.geometry;
  if (!geo.attributes.color) {
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
  }
  const pos = geo.attributes.position, col = geo.attributes.color;
  const nrm = geo.attributes.normal;
  const VrelAbs = Math.abs(state.u - params.Vw);
  // Chargement hydrodynamique normalise : portance de bavette (~V^2 sin(angle))
  // + effort inertiel de lacet (|psiDot|). Sert de facteur d'echelle global.
  const Fnorm = clamp((0.5 * RHO_WATER * params.ClDive * params.Slip * VrelAbs * VrelAbs * Math.abs(Math.sin(params.lipAngleRad))) / 40, 0, 1)
              + clamp(Math.abs(state.psiDot) / 6, 0, 1);

  if (geom.mode === 'stl') {
    // Frame NORMALISE. Contrainte = base + points d'ancrage (anneaux nez/queue)
    // + protrusion laterale (aretes vives/ailerons) + chargement de pression
    // deduit des NORMALES du mesh (faces au vent -> nx>0 -> plus contraintes).
    const Rn = geom.metrics.Rratio;
    const sigma2 = (Rn * 1.5) * (Rn * 1.5) + 1e-4;
    // ancrages convertis en frame normalise (suivent un repositionnement manuel)
    const anchors = [charPoints.nose, charPoints.tail, charPoints.ringFront].map(p => normFromLocal(p.clone(), new THREE.Vector3()));
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      let s = 0.06;
      for (const h of anchors) s += Fnorm * 0.9 * Math.exp(-v.distanceToSquared(h) / sigma2);
      const lateral = Math.hypot(v.y, v.z) / (Rn + 1e-4);
      s += Fnorm * 0.35 * clamp(lateral - 0.55, 0, 1);   // aretes / ailerons qui depassent
      if (nrm) { const nx = nrm.getX(i); s += Fnorm * 0.4 * Math.max(nx, 0); } // face au vent (+X)
      s = clamp(s, 0, 1);
      const [r, g, b] = jetColor(s);
      col.setXYZ(i, r, g, b);
    }
  } else {
    // Corps procedural : frame local metres, hotspots bavette/anneau.
    const R = params.R;
    const sigma2 = (R * 1.1) * (R * 1.1);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      let s = 0.08; // contrainte residuelle de base (poids propre / pretension ligne)
      for (const h of stressHotspots) s += Fnorm * Math.exp(-v.distanceToSquared(h) / sigma2);
      s = clamp(s, 0, 1);
      const [r, g, b] = jetColor(s);
      col.setXYZ(i, r, g, b);
    }
  }
  col.needsUpdate = true;
}

/* ----------------------------------------------------------------------- *
 * MODULE 8 — Hodographes des points caracteristiques
 * ----------------------------------------------------------------------- */
const HODO_SECONDS = 6;
let hodoHistory = {};
const hodoLines = {};
function resetHodo() {
  hodoHistory = {};
  for (const k in charPoints) hodoHistory[k] = [];
  for (const k in hodoLines) scene.remove(hodoLines[k]);
  for (const k in charPoints) {
    const geo = new THREE.BufferGeometry();
    const mat = new THREE.LineBasicMaterial({ color: markerColors[k], transparent: true, opacity: 0.85 });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    hodoLines[k] = line;
  }
}
resetHodo();

const hodoXZCanvas = document.getElementById('hodoXZ');
const hodoCtx = hodoXZCanvas.getContext('2d');

function updateHodographs(dt) {
  const worldP = new THREE.Vector3();
  for (const k in charPoints) {
    worldP.copy(charPoints[k]).applyQuaternion(lureGroup.quaternion).add(lureGroup.position);
    const hist = hodoHistory[k];
    hist.push({ x: worldP.x, y: worldP.y, z: worldP.z, t: simTime });
    while (hist.length && simTime - hist[0].t > HODO_SECONDS) hist.shift();
    if (hist.length > 1) {
      const arr = new Float32Array(hist.length * 3);
      for (let i = 0; i < hist.length; i++) { arr[i * 3] = hist[i].x; arr[i * 3 + 1] = hist[i].y; arr[i * 3 + 2] = hist[i].z; }
      hodoLines[k].geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      hodoLines[k].geometry.setDrawRange(0, hist.length);
      hodoLines[k].geometry.computeBoundingSphere();
    }
  }

  // Vue XZ (dessus) dessinee en 2D
  hodoCtx.clearRect(0, 0, hodoXZCanvas.width, hodoXZCanvas.height);
  hodoCtx.strokeStyle = '#1c2733'; hodoCtx.lineWidth = 1;
  hodoCtx.beginPath(); hodoCtx.moveTo(0, hodoXZCanvas.height / 2); hodoCtx.lineTo(hodoXZCanvas.width, hodoXZCanvas.height / 2); hodoCtx.stroke();
  const cx = hodoXZCanvas.width / 2, cy = hodoXZCanvas.height / 2;
  const scale = 900;
  // MODULE B.4 : trace AVANT (grise) superposee pour la comparaison avant/apres
  if (typeof hodoGhost !== 'undefined' && hodoGhost) {
    hodoCtx.strokeStyle = 'rgba(140,150,165,0.5)'; hodoCtx.lineWidth = 1;
    for (const k in hodoGhost) {
      const g = hodoGhost[k]; if (!g || g.length < 2) continue;
      hodoCtx.beginPath();
      for (let i = 0; i < g.length; i++) {
        const px = cx + (g[i].x - lureGroup.position.x) * scale, py = cy - (g[i].z - lureGroup.position.z) * scale;
        if (i === 0) hodoCtx.moveTo(px, py); else hodoCtx.lineTo(px, py);
      }
      hodoCtx.stroke();
    }
  }
  for (const k in charPoints) {
    const hist = hodoHistory[k];
    if (hist.length < 2) continue;
    hodoCtx.strokeStyle = '#' + new THREE.Color(markerColors[k]).getHexString();
    hodoCtx.lineWidth = 1.4;
    hodoCtx.beginPath();
    for (let i = 0; i < hist.length; i++) {
      const px = cx + (hist[i].x - lureGroup.position.x) * scale;
      const py = cy - (hist[i].z - lureGroup.position.z) * scale;
      if (i === 0) hodoCtx.moveTo(px, py); else hodoCtx.lineTo(px, py);
    }
    hodoCtx.stroke();
  }
}

/* ----------------------------------------------------------------------- *
 * Legendes (canvas 2D, colormap jet + graduations)
 * ----------------------------------------------------------------------- */
const legendsEl = document.getElementById('legends');
function makeLegend(id, title, unit, minV, maxV, decimals) {
  const wrap = document.createElement('div');
  wrap.className = 'legend'; wrap.id = 'legend-' + id;
  const t = document.createElement('div'); t.className = 'lg-title'; t.textContent = title;
  const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 14;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 180, 0);
  for (let i = 0; i <= 10; i++) { const [r, g, b] = jetColor(i / 10); grad.addColorStop(i / 10, `rgb(${r*255|0},${g*255|0},${b*255|0})`); }
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 180, 14);
  const ticks = document.createElement('div'); ticks.className = 'lg-ticks';
  const mid = (minV + maxV) / 2;
  ticks.innerHTML = `<span class="tk-min">${minV.toFixed(decimals)}</span><span class="tk-mid">${mid.toFixed(decimals)}</span><span class="tk-max">${maxV.toFixed(decimals)} ${unit}</span>`;
  wrap.appendChild(t); wrap.appendChild(canvas); wrap.appendChild(ticks);
  legendsEl.appendChild(wrap);
  wrap._ticks = ticks;
  return wrap;
}
const legendVel = makeLegend('vel', 'Magnitude vitesse', 'm/s', 0, V_COLOR_MAX, 1);
const legendPress = makeLegend('press', 'Pression relative (Bernoulli)', 'bar', -pressureRangePa / 1e5, pressureRangePa / 1e5, 4);
const legendStress = makeLegend('stress', 'Contrainte de Von Mises (approx.)', 'MPa', 0, SIGMA_MAX_MPA, 1);
function updatePressureLegendTicks() {
  const minV = -pressureRangePa / 1e5, maxV = pressureRangePa / 1e5;
  const t = legendPress._ticks;
  t.querySelector('.tk-min').textContent = minV.toFixed(4);
  t.querySelector('.tk-mid').textContent = ((minV + maxV) / 2).toFixed(4);
  t.querySelector('.tk-max').textContent = maxV.toFixed(4) + ' bar';
}
legendPress.style.display = 'none';
legendStress.style.display = 'none';

/* ----------------------------------------------------------------------- *
 * UI wiring
 * ----------------------------------------------------------------------- */
function bindSlider(id, key, valId, fmt) {
  const el = document.getElementById(id);
  const val = document.getElementById(valId);
  const apply = () => { ui[key] = parseFloat(el.value); if (val) val.textContent = fmt(ui[key]); };
  el.addEventListener('input', apply);
  apply();
}
bindSlider('vf', 'Vf', 'vfVal', v => v.toFixed(2) + ' m/s');
bindSlider('vw', 'Vw', 'vwVal', v => v.toFixed(2) + ' m/s');
bindSlider('lip', 'lipDeg', 'lipVal', v => v.toFixed(0) + '°');
bindSlider('lineLen', 'lineLen', 'lineLenVal', v => v.toFixed(1) + ' m');
bindSlider('lineK', 'lineK', 'lineKVal', v => v.toFixed(0) + ' N/m');
bindSlider('bodyLen', 'bodyLenMM', 'bodyLenVal', v => v.toFixed(0) + ' mm');
bindSlider('cgPos', 'cgPos', 'cgVal', v => v.toFixed(0) + '%');
bindSlider('density', 'density', 'densVal', v => v.toFixed(0));
bindSlider('isoTh', 'isoTh', 'isoThVal', v => v.toFixed(2));
bindSlider('planeX', 'planeX', 'planeXVal', v => v.toFixed(2));

document.getElementById('bodyLen').addEventListener('change', () => { updateParams(); buildLure(); resetHodo(); });
document.getElementById('cgPos').addEventListener('change', () => { updateParams(); buildLure(); resetHodo(); });
document.getElementById('lip').addEventListener('input', () => { if (lipMesh) lipMesh.rotation.z = deg2rad(ui.lipDeg); });

// Materiau (densite) — menu deroulant
const matSel = document.getElementById('matDensity'), matValEl = document.getElementById('matVal');
function applyMat() { ui.matDensity = parseFloat(matSel.value); matValEl.textContent = ui.matDensity + ' kg/m³'; }
matSel.addEventListener('change', applyMat); applyMat();

// Decimation STL — re-traite le mesh importe a la volee
const decimEl = document.getElementById('decim'), decimValEl = document.getElementById('decimVal');
const fmtK = v => v >= 1000 ? (v / 1000) + 'k' : ('' + v);
function applyDecimLabel() { ui.decim = parseFloat(decimEl.value); decimValEl.textContent = fmtK(ui.decim); }
decimEl.addEventListener('input', applyDecimLabel); applyDecimLabel();
decimEl.addEventListener('change', () => { if (geom.mode === 'stl' && geom.lastBuffer) loadSTLFromBuffer(geom.lastBuffer, geom.lastName); });

// Etat du mode "repositionnement de points" (declare tot : lu par applyToggleVisibility)
let reposMode = false, selectedKey = null;

const fieldStatusEl = document.getElementById('fieldStatus');
function refreshFieldStatus() {
  const on = Object.keys(toggles).filter(k => toggles[k]);
  fieldStatusEl.innerHTML = on.map(k => `<span class="badge">${k}</span>`).join('');
}
document.querySelectorAll('.toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const f = btn.dataset.field;
    toggles[f] = !toggles[f];
    btn.classList.toggle('active', toggles[f]);
    applyToggleVisibility();
    refreshFieldStatus();
  });
});
function applyToggleVisibility() {
  streamLines.visible = toggles.streamlines;
  isoMesh.visible = toggles.iso;
  pressurePlane.visible = toggles.pressure;
  for (const k in hodoLines) hodoLines[k].visible = toggles.hodo;
  document.getElementById('hodo-xz-wrap').style.display = toggles.hodo ? 'block' : 'none';
  // marqueurs visibles si hodographes actifs OU en mode repositionnement (pour les selectionner)
  for (const k in charMarkers) charMarkers[k].visible = toggles.hodo || reposMode;
  document.getElementById('isoRow').style.display = toggles.iso ? 'block' : 'none';
  document.getElementById('planeRow').style.display = toggles.pressure ? 'block' : 'none';
  legendVel.style.display = toggles.streamlines ? 'flex' : 'none';
  legendVel.style.flexDirection = 'column'; legendVel.style.alignItems = 'flex-end';
  legendPress.style.display = toggles.pressure ? 'flex' : 'none';
  legendPress.style.flexDirection = 'column'; legendPress.style.alignItems = 'flex-end';
  legendStress.style.display = toggles.stress ? 'flex' : 'none';
  legendStress.style.flexDirection = 'column'; legendStress.style.alignItems = 'flex-end';
  if (!toggles.stress && bodyMesh) bodyMesh.material.vertexColors = false, bodyMesh.material.color.set(0x2f7ea8), bodyMesh.material.needsUpdate = true;
  if (toggles.stress && bodyMesh) bodyMesh.material.vertexColors = true, bodyMesh.material.needsUpdate = true;
}
applyToggleVisibility();
refreshFieldStatus();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ----------------------------------------------------------------------- *
 * Import STL : lecture fichier, drag & drop, parsing, messages
 * ----------------------------------------------------------------------- */
const stlStatusEl = document.getElementById('stl-status');
function setStlStatus(msg, cls) { stlStatusEl.textContent = msg; stlStatusEl.className = cls || ''; }

function loadSTLFromBuffer(buffer, name) {
  setStlStatus('⏳ Analyse du STL en cours…', 'busy');
  // differe d'une frame pour que l'indicateur de chargement s'affiche avant le parsing (bloquant)
  setTimeout(() => {
    try {
      const raw = new THREE.STLLoader().parse(buffer);
      const posAttr = raw.attributes.position;
      if (!posAttr || posAttr.count < 3 || posAttr.count % 3 !== 0) throw new Error('mesh vide ou non triangulaire');
      // controle NaN (fichier corrompu / mal decode)
      const arr = posAttr.array;
      for (let i = 0; i < Math.min(arr.length, 300); i++) if (!isFinite(arr[i])) throw new Error('coordonnées invalides (fichier non-STL ?)');
      geom.lastBuffer = buffer; geom.lastName = name;
      processSTLGeometry(raw, name);
      geom.mode = 'stl';
      buildLure(); resetHodo(); applyToggleVisibility();
      const st = geom.stl, d = st.rawDims;
      let msg = `✓ ${name || 'STL'} · ${st.triCount.toLocaleString('fr-FR')} triangles`;
      if (st.decimated) msg += ` (décimé de ${st.rawTri.toLocaleString('fr-FR')})`;
      msg += ` · bbox ${d.x.toFixed(1)}×${d.y.toFixed(1)}×${d.z.toFixed(1)} (unités fichier) · échelle sim = ${ui.bodyLenMM} mm`;
      setStlStatus(msg, 'ok');
      document.getElementById('stl-flip').disabled = false;
      document.getElementById('stl-reset').disabled = false;
      document.getElementById('decimRow').style.display = 'block';
    } catch (e) {
      // messages bas-niveau (ex: taille de tableau invalide sur un fichier non-STL) -> message clair
      let m = e.message || 'fichier STL invalide';
      if (/typed array length|RangeError|Invalid array|out of memory/i.test(m)) m = 'fichier non-STL ou corrompu';
      setStlStatus('✗ Échec : ' + m + ' — corps procédural conservé', 'err');
    }
  }, 30);
}

function handleFile(file) {
  if (!file) return;
  if (file.size > 80 * 1024 * 1024) { setStlStatus('✗ Fichier trop volumineux (> 80 Mo)', 'err'); return; }
  const name = file.name || 'model.stl';
  if (!/\.stl$/i.test(name)) { setStlStatus('✗ Extension non .stl — importez un fichier STL', 'err'); return; }
  const reader = new FileReader();
  reader.onload = (e) => loadSTLFromBuffer(e.target.result, name);
  reader.onerror = () => setStlStatus('✗ Erreur de lecture du fichier', 'err');
  reader.readAsArrayBuffer(file);
}

const dropEl = document.getElementById('stl-drop');
const inputEl = document.getElementById('stl-input');
dropEl.addEventListener('click', () => inputEl.click());
inputEl.addEventListener('change', (e) => { handleFile(e.target.files[0]); inputEl.value = ''; });
['dragenter', 'dragover'].forEach(ev => dropEl.addEventListener(ev, (e) => { e.preventDefault(); dropEl.classList.add('dragover'); }));
['dragleave', 'drop'].forEach(ev => dropEl.addEventListener(ev, (e) => { e.preventDefault(); dropEl.classList.remove('dragover'); }));
dropEl.addEventListener('drop', (e) => { handleFile(e.dataTransfer.files[0]); });
// empeche le navigateur d'ouvrir le fichier si lache a cote de la zone
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

document.getElementById('stl-flip').addEventListener('click', () => {
  if (geom.mode !== 'stl' || !geom.lastBuffer) return;
  geom.flip = !geom.flip;
  loadSTLFromBuffer(geom.lastBuffer, geom.lastName);
});
document.getElementById('stl-reset').addEventListener('click', () => {
  geom.mode = 'procedural'; geom.stl = null; geom.flip = false;
  buildLure(); resetHodo(); applyToggleVisibility();
  setStlStatus('Géométrie actuelle : corps procédural (démo)', '');
  document.getElementById('stl-flip').disabled = true;
  document.getElementById('stl-reset').disabled = true;
  document.getElementById('decimRow').style.display = 'none';
});

/* ----------------------------------------------------------------------- *
 * Repositionnement manuel des points caracteristiques (raycast clic)
 * ----------------------------------------------------------------------- */
const reposBtn = document.getElementById('repos-toggle');
const reposHintEl = document.getElementById('reposHint');
const reposSelEl = document.getElementById('reposSel');
function highlightSelected() {
  for (const k in charMarkers) charMarkers[k].scale.setScalar(k === selectedKey ? 1.9 : 1);
  reposSelEl.textContent = selectedKey ? ('point sélectionné : ' + selectedKey) : 'aucun point sélectionné';
}
reposBtn.addEventListener('click', () => {
  reposMode = !reposMode;
  reposBtn.classList.toggle('active', reposMode);
  reposHintEl.style.display = reposMode ? 'block' : 'none';
  if (!reposMode) { selectedKey = null; }
  applyToggleVisibility();
  highlightSelected();
});

const raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
let _downX = 0, _downY = 0;
renderer.domElement.addEventListener('pointerdown', (e) => { _downX = e.clientX; _downY = e.clientY; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!reposMode) return;
  if (Math.hypot(e.clientX - _downX, e.clientY - _downY) > 5) return; // c'etait un glisser (orbite camera)
  const rect = renderer.domElement.getBoundingClientRect();
  _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(_ndc, camera);

  // 1) clic sur un marqueur -> le selectionner
  const entries = Object.entries(charMarkers);
  const hitMarkers = raycaster.intersectObjects(entries.map(([, m]) => m), false);
  if (hitMarkers.length) {
    selectedKey = entries.find(([, m]) => m === hitMarkers[0].object)[0];
    highlightSelected();
    return;
  }
  // 2) un point est selectionne + clic sur le corps -> le deplacer a la surface
  if (selectedKey && bodyMesh) {
    const hb = raycaster.intersectObject(bodyMesh, false);
    if (hb.length) {
      const localP = lureGroup.worldToLocal(hb[0].point.clone());
      charPoints[selectedKey].copy(localP);
      charMarkers[selectedKey].position.copy(localP);
      hodoHistory[selectedKey] = []; // reinitialise la trace de ce point
    }
  }
});

/* =======================================================================
 * MODULES A–F — Composants, masse/densite, centre de masse, presets,
 * recuperation non-constante, export. Étend l'existant sans le casser.
 * ===================================================================== */

/* ----- MODULE A.1 : donnees composants -------------------------------- */
const HOOK_MASS_TABLE = { '#14':0.05,'#12':0.08,'#10':0.12,'#8':0.18,'#6':0.28,'#4':0.42,'#2':0.65,'#1':0.85,'#1/0':1.1,'#2/0':1.5,'#3/0':2.1 };
const lureComponents = {
  frame:  { massMode: 'auto', massG: 0 },      // 'auto' = params.mass (densite x volume)
  epoxy:  { thicknessMM: 0.15, densityKgM3: 1120 },
  lip:    { lengthMM: null, widthMM: null, thicknessMM: 1.2, densityKgM3: 1150 },
  ringFront: { wireDiaMM: 0.8, coilDiaMM: 3.2, densityKgM3: 7900 },
  ringRear:  { wireDiaMM: 0.8, coilDiaMM: 3.2, densityKgM3: 7900 },
  clip:   { massG: 0.25 },
  hookFront: { enabled: true, size: '#6' },
  hookRear:  { enabled: true, size: '#4' },
  ballasts: [ { massG: 0, posXFrac: 0.5, posYmm: 0, posZmm: 0, id: 'b1' } ],
  waterType: 'fresh',                          // 'fresh' (1000) | 'salt' (1025)
};
let _ballastSeq = 2;

/* ----- MODULE A.2 : aire de surface + bilan de masse ------------------ */
const _saA = new THREE.Vector3(), _saB = new THREE.Vector3(), _saC = new THREE.Vector3(),
      _saAB = new THREE.Vector3(), _saAC = new THREE.Vector3();
function meshSurfaceArea(geometry) {
  const pos = geometry.attributes.position, idx = geometry.index;
  const tri = idx ? idx.count / 3 : pos.count / 3;
  let area = 0;
  for (let t = 0; t < tri; t++) {
    const i0 = idx ? idx.getX(t*3) : t*3, i1 = idx ? idx.getX(t*3+1) : t*3+1, i2 = idx ? idx.getX(t*3+2) : t*3+2;
    _saA.fromBufferAttribute(pos, i0); _saB.fromBufferAttribute(pos, i1); _saC.fromBufferAttribute(pos, i2);
    _saAB.subVectors(_saB, _saA); _saAC.subVectors(_saC, _saA);
    area += _saAB.cross(_saAC).length() * 0.5;
  }
  return area;
}
// masse d'un tore (anneau brise) : volume = 2π²·R·r² -> m = 2π²·R·r²·ρ
function torusMass(rc) {
  return 2 * Math.PI * Math.PI * (rc.coilDiaMM/2/1000) * Math.pow(rc.wireDiaMM/2/1000, 2) * rc.densityKgM3;
}
function computeMassBudget() {
  const lc = lureComponents;
  const rhoEff = lc.waterType === 'salt' ? 1025 : 1000;
  const per = {};
  per.frame = lc.frame.massMode === 'auto' ? params.mass : Math.max(lc.frame.massG, 0)/1000;
  // epoxy : aire de surface (m², echelle du mesh prise en compte) x epaisseur x densite
  const areaLocal = meshSurfaceArea(bodyMesh.geometry) * bodyMesh.scale.x * bodyMesh.scale.x;
  per.epoxy = areaLocal * (lc.epoxy.thicknessMM/1000) * lc.epoxy.densityKgM3;
  // lip : plaque L x l x e (dims deduites de R si nulles) — coherent avec addLipAndRings
  const lipL = (lc.lip.lengthMM != null ? lc.lip.lengthMM : 2.1*params.R*1000)/1000;
  const lipW = (lc.lip.widthMM  != null ? lc.lip.widthMM  : 1.6*params.R*1000)/1000;
  per.lip = lipL * lipW * (lc.lip.thicknessMM/1000) * lc.lip.densityKgM3;
  per.ringFront = torusMass(lc.ringFront);
  per.ringRear  = torusMass(lc.ringRear);
  per.clip = Math.max(lc.clip.massG, 0)/1000;
  per.hookFront = lc.hookFront.enabled ? (HOOK_MASS_TABLE[lc.hookFront.size]||0)/1000 : 0;
  per.hookRear  = lc.hookRear.enabled  ? (HOOK_MASS_TABLE[lc.hookRear.size] ||0)/1000 : 0;
  per.ballasts = lc.ballasts.reduce((s,b)=>s + Math.max(b.massG,0)/1000, 0);
  let massTotal = 0; for (const k in per) massTotal += per[k];
  // Approximation "de confort" : les accessoires n'ajoutent pas de volume de carene
  // significatif -> volume deplace = volume du corps (params.volume).
  const volumeTotal = params.volume;
  const densite = massTotal / Math.max(volumeTotal, 1e-9);
  return { massTotal, volumeTotal, densite, rhoEff, parComposant: per };
}
/* ----- MODULE A.3 : classification regime ----------------------------- */
function classifyRegime(densite, rhoEff) {
  if (densite < 0.97 * rhoEff) return { label: 'FLOTTANT', cls: 'reg-float' };
  if (densite > 1.03 * rhoEff) return { label: 'COULANT', cls: 'reg-sink' };
  return { label: 'SUSPENDU (neutre)', cls: 'reg-susp' };
}
/* ----- MODULE A.4 : vitesse terminale en eau calme -------------------- *
 * Equilibre poids apparent / trainee : |m - ρ·V|·g = 0.5·ρ·Cd·S·v²
 *  -> v = sqrt( 2·|Fnet| / (ρ·Cd·S) ). Signe + = coule, - = remonte.       */
function terminalVelocity() {
  const b = computeMassBudget();
  const Fnet = (b.massTotal - b.rhoEff * b.volumeTotal) * G;
  const v = Math.sqrt(2 * Math.abs(Fnet) / (b.rhoEff * params.Cd * params.Sfront + 1e-12));
  return { vcms: Math.sign(Fnet) * v * 100, sinks: Fnet > 0, Fnet };
}
/* ----- MODULE A.5 : suggestion de lestage pour un regime cible -------- */
function suggestWeight(targetFactor) {
  const b = computeMassBudget();
  const nonBallast = b.massTotal - b.parComposant.ballasts;                 // kg
  const requiredBallast = Math.max(0, targetFactor * b.rhoEff * b.volumeTotal - nonBallast);
  const reqG = requiredBallast * 1000;
  const bs = lureComponents.ballasts;
  const curSum = bs.reduce((s,x)=>s + Math.max(x.massG,0), 0);
  if (bs.length === 1 || curSum < 1e-6) bs.forEach((x,i)=> x.massG = i === 0 ? reqG : 0);
  else bs.forEach(x=> x.massG = reqG * (Math.max(x.massG,0)/curSum));       // au prorata
  refreshBallastUI(); recomputeMass(); updateMassPanelReadouts();
}

/* ----- MODULE B.2/B.3 : centre de masse, inertie, facteurs de lacet ---- */
let _nbCache = []; // composants NON-ballast {m, p} (positions figees entre deux rebuilds)
function refreshComponentCache() {
  const b = computeMassBudget();
  _nbCache = [
    { m: b.parComposant.frame,     p: geomComp.frameCentroid },
    { m: b.parComposant.epoxy,     p: geomComp.frameCentroid },
    { m: b.parComposant.lip,       p: geomComp.lip },
    { m: b.parComposant.ringFront, p: geomComp.ringFront },
    { m: b.parComposant.ringRear,  p: geomComp.ringRear },
    { m: b.parComposant.clip,      p: geomComp.ringFront },   // clip a l'anneau avant
    { m: b.parComposant.hookFront, p: geomComp.hookFront },
    { m: b.parComposant.hookRear,  p: geomComp.hookRear },
  ];
  return b;
}
function ballastPos(bl) {
  const noseX = charPoints.nose ? charPoints.nose.x : 0;
  const tailX = charPoints.tail ? charPoints.tail.x : 0;
  return new THREE.Vector3(lerp(noseX, tailX, clamp(bl.posXFrac, 0, 1)), bl.posYmm/1000, bl.posZmm/1000);
}
function computeCenterOfMass(ballasts) {
  let M = 0; const c = new THREE.Vector3();
  for (const it of _nbCache) if (it.m > 0) { c.addScaledVector(it.p, it.m); M += it.m; }
  for (const bl of ballasts) { const m = Math.max(bl.massG,0)/1000; if (m > 0) { c.addScaledVector(ballastPos(bl), m); M += m; } }
  if (M > 0) c.multiplyScalar(1 / M);
  return c;
}
// Iyaw autour de l'axe vertical passant par le CM (Huygens, masses ponctuelles)
function computeIyaw(ballasts, com) {
  let I = 0;
  for (const it of _nbCache) if (it.m > 0) { const dx = it.p.x-com.x, dz = it.p.z-com.z; I += it.m*(dx*dx+dz*dz); }
  for (const bl of ballasts) { const m = Math.max(bl.massG,0)/1000; if (m > 0) { const p = ballastPos(bl); const dx = p.x-com.x, dz = p.z-com.z; I += m*(dx*dx+dz*dz); } }
  return I;
}
/* Approximation (pas un solveur multi-corps rigide) : plus d'inertie de lacet
 * -> nage plus lente (freq ~ 1/sqrt(I)) et de plus grande amplitude ; un CM
 * decale vers la queue accentue l'amplitude et ralentit encore la frequence. */
function yawFactorsFrom(Iyaw, com) {
  const ref = IYAW_REF || Iyaw || 1;
  const ratio = clamp(Iyaw / ref, 0.4, 2.6);
  const cmRear = clamp((geomComp.frameCentroid.x - com.x) / (0.25 * params.L + 1e-6), -1.5, 1.5);
  const amp  = clamp(Math.sqrt(ratio) * (1 + 0.30 * cmRear), 0.4, 3.0);
  const freq = clamp((1 / Math.sqrt(ratio)) * (1 - 0.15 * cmRear), 0.4, 2.2);
  return { amp, freq };
}
function recomputeMass() {
  const b = refreshComponentCache();
  massState.massTotal = b.massTotal; massState.volumeTotal = b.volumeTotal;
  massState.densite = b.densite; massState.budget = b;
  const com = computeCenterOfMass(lureComponents.ballasts);
  massState.com.copy(com);
  const I = computeIyaw(lureComponents.ballasts, com);
  massState.Iyaw = I;
  if (IYAW_REF === null && I > 0) IYAW_REF = I; // reference = 1re config (defaut, sans ballast)
  const f = yawFactorsFrom(I, com);
  massState.yawAmpFactor = f.amp; massState.yawFreqFactor = f.freq;
}

/* ----- MODULE D.1 : profil de vitesse de recuperation Vf(t) ----------- */
const RETRIEVAL_LABELS = {
  'constant':         ['—', '—', '—'],
  'steady-pause':     ['Durée traction (s)', 'Durée pause (s)', '—'],
  'jerk-jerk-pause':  ['—', 'Durée pause (s)', 'Intensité jerk (×)'],
  'twitch':           ['—', '—', 'Amplitude twitch (×)'],
  'custom':           ['Fréquence (Hz)', 'Offset (×base)', 'Amplitude (×base)'],
};
function getInstantVf(t, baseVf) {
  const p = retrievalProfile;
  switch (p.mode) {
    case 'steady-pause': {
      const A = Math.max(p.paramA, 0.05), B = Math.max(p.paramB, 0.05), per = A + B;
      return ((t % per) + per) % per < A ? baseVf : 0;
    }
    case 'jerk-jerk-pause': {
      const jerk = 0.15, gap = 0.2, pause = Math.max(p.paramB, 0.1), per = jerk*2 + gap + pause;
      const ph = ((t % per) + per) % per;
      if (ph < jerk) return baseVf * p.paramC;
      if (ph < jerk + gap) return baseVf * 0.15;
      if (ph < jerk*2 + gap) return baseVf * p.paramC;
      return 0;
    }
    case 'twitch': {
      const per = 0.4; // oscillation rapide autour de 0.3·base, sans pause complete
      return Math.max(baseVf * 0.05, baseVf*0.3 + baseVf*p.paramC*0.5*Math.sin(2*Math.PI*t/per));
    }
    case 'custom':
      return Math.max(0, baseVf*p.paramB + baseVf*p.paramC*0.5*Math.sin(2*Math.PI*t*Math.max(p.paramA,0.05)));
    default: return baseVf; // 'constant' — comportement d'origine
  }
}

/* ----- MODULE B.4 : simulation headless + optimisation multi-poids ----- *
 * On duplique state/params dans des variables locales et on integre N s SANS
 * toucher a la simulation visible. Optimisation par "coordinate descent"
 * (un ballast a la fois, 2-3 passes) — pas un solveur global, suffisant ici. */
function simulateHeadless(ballasts, seconds, dt) {
  const p = Object.assign({}, params);
  const com = computeCenterOfMass(ballasts);
  const f = yawFactorsFrom(computeIyaw(ballasts, com), com);
  p.yawAmpFactor = f.amp; p.yawFreqFactor = f.freq; // masse fixe -> mTrans inchange
  let s = Object.assign({}, state);
  let t = 0; const steps = Math.round(seconds / dt), subN = 4, h = dt / subN;
  const rec = [];
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < subN; j++) {
      p.VfInstant = getInstantVf(t, p.Vf);
      s = rk4(s, h, p); t += h;
      s.psi = clamp(s.psi, -Math.PI, Math.PI); s.psiDot = clamp(s.psiDot, -200, 200);
      s.theta = clamp(s.theta, -Math.PI, Math.PI); s.u = clamp(s.u, -3, 6);
      if (!isFinite(s.psi)) return { psiPP: 0, thetaAmp: 1e9, zVar: 1e9 };
    }
    if (t > seconds - 1.0) rec.push({ psi: s.psi, theta: s.theta, z: s.z });
  }
  let pmin=1e9, pmax=-1e9, tmin=1e9, tmax=-1e9, zs=0, z2=0;
  for (const r of rec) { pmin=Math.min(pmin,r.psi); pmax=Math.max(pmax,r.psi);
    tmin=Math.min(tmin,r.theta); tmax=Math.max(tmax,r.theta); zs+=r.z; z2+=r.z*r.z; }
  const n = rec.length || 1, zm = zs/n;
  return { psiPP: pmax-pmin, thetaAmp: tmax-tmin, zVar: Math.max(z2/n - zm*zm, 0) };
}
function scoreConfig(cfg, objective) {
  const m = simulateHeadless(cfg, 3, 0.02);
  return objective === 'vive' ? m.psiPP : -(m.thetaAmp + 5 * m.zVar); // + = meilleur
}
let optRunning = false, optResult = null, hodoGhost = null;
function optimizeBallasts(objective) {
  if (optRunning) return;
  optRunning = true; optResult = null;
  M.optApply.style.display = 'none';
  M.optStatus.textContent = 'Optimisation en cours… 0%';
  refreshComponentCache(); // fige les masses non-ballast pour toute l'optimisation
  // sauvegarde la trace actuelle pour la comparaison avant/apres (grise)
  hodoGhost = {}; for (const k in hodoHistory) hodoGhost[k] = hodoHistory[k].map(pt => ({ x: pt.x, z: pt.z }));

  const bs = lureComponents.ballasts;
  const activeIdx = bs.map((b,i)=>i).filter(i => bs[i].massG > 0);
  const targets = activeIdx.length ? activeIdx : [0];
  const passes = targets.length > 1 ? 3 : 1;
  const fracs = [0.15,0.24,0.33,0.42,0.5,0.58,0.67,0.76,0.85];
  const yMax = params.R * 1000 * 0.7;
  const ys = [-yMax, -yMax/2, 0, yMax/2, yMax];

  const work = bs.map(b => ({ ...b }));               // config de travail
  let best = { cfg: work.map(b=>({...b})), score: scoreConfig(work, objective) };

  // file de taches (une par candidat) evaluee par lots pour ne pas bloquer le rendu
  const tasks = [];
  for (let pass = 0; pass < passes; pass++)
    for (const ti of targets)
      for (const fr of fracs)
        for (const yv of ys)
          tasks.push({ ti, fr, yv });
  let done = 0; const total = tasks.length;
  let curBestForTarget = null, curTarget = -1;

  function chunk() {
    const t0 = performance.now();
    while (tasks.length && performance.now() - t0 < 12) { // ~12ms/frame max
      const tk = tasks.shift();
      if (tk.ti !== curTarget) { curTarget = tk.ti; curBestForTarget = null; }
      const trial = work.map(b=>({...b}));
      trial[tk.ti].posXFrac = tk.fr; trial[tk.ti].posYmm = tk.yv;
      const sc = scoreConfig(trial, objective);
      if (!curBestForTarget || sc > curBestForTarget.score) {
        curBestForTarget = { fr: tk.fr, yv: tk.yv, score: sc };
        // commit immediat sur la config de travail (coordinate descent)
        work[tk.ti].posXFrac = tk.fr; work[tk.ti].posYmm = tk.yv;
        if (sc > best.score) best = { cfg: work.map(b=>({...b})), score: sc };
      }
      done++;
    }
    M.optStatus.textContent = 'Optimisation en cours… ' + Math.round(100*done/total) + '%';
    if (tasks.length) { setTimeout(chunk, 0); return; }
    // termine
    optRunning = false; optResult = best.cfg;
    const posTxt = optResult.filter(b=>b.massG>0).map((b,i)=>`P${i+1}: X=${Math.round(b.posXFrac*100)}% Y=${b.posYmm.toFixed(1)}mm`).join(' · ');
    M.optStatus.textContent = `Trouvé (${objective}) — ${posTxt || 'aucun poids actif'}`;
    M.optApply.style.display = optResult ? 'block' : 'none';
  }
  setTimeout(chunk, 0);
}
function applyOptResult() {
  if (!optResult) return;
  lureComponents.ballasts = optResult.map(b => ({ ...b }));
  refreshBallastUI(); recomputeMass(); buildLure(); resetHodo();
  updateMassPanelReadouts();
  M.optApply.style.display = 'none';
  M.optStatus.textContent = 'Configuration appliquée (trace grise = avant).';
}

/* ----- MODULE C.1 : presets de types de leurres ----------------------- */
const LURE_PRESETS = {
  crankbait_square: { bodyLenMM: 55,  lipDeg: 35, matDensity: 180,  hookFront:'#4', hookRear:'#2',  ballastHint:'ventral-avant',           desc:'Crank à bavette carrée, nage large et rapide' },
  jerkbait:         { bodyLenMM: 110, lipDeg: 8,  matDensity: 1050, hookFront:'#4', hookRear:'#4',  ballastHint:'centre-bas (suspending)', desc:'Jerkbait suspending, nage erratique par saccades' },
  popper:           { bodyLenMM: 70,  lipDeg: 0,  matDensity: 500,  hookFront:'#2', hookRear:'#1',  ballastHint:'arrière (queue haute)',   desc:'Popper de surface, pas de bavette' },
  swimbait:         { bodyLenMM: 130, lipDeg: 12, matDensity: 1150, hookFront:'#1/0', hookRear:null, ballastHint:'ventral-centre',          desc:'Swimbait fusiforme, nage ondulante' },
  spinnerbait_body: { bodyLenMM: 40,  lipDeg: 0,  matDensity: 7900, hookFront:null, hookRear:'#2/0', ballastHint:'nez (tête plombée)',      desc:'Corps/tête de spinnerbait' },
};
const BALLAST_HINT_POS = { // texte -> (posXFrac, posYmm relatif a R)
  'ventral-avant':        (R)=>({ posXFrac:0.3,  posYmm:-R*1000*0.5 }),
  'centre-bas (suspending)':(R)=>({ posXFrac:0.5, posYmm:-R*1000*0.4 }),
  'arrière (queue haute)':(R)=>({ posXFrac:0.72, posYmm: R*1000*0.2 }),
  'ventral-centre':       (R)=>({ posXFrac:0.5,  posYmm:-R*1000*0.5 }),
  'nez (tête plombée)':   (R)=>({ posXFrac:0.15, posYmm:-R*1000*0.3 }),
};
function applyPreset(name) {
  const pr = LURE_PRESETS[name]; if (!pr) return;
  M.presetDesc.textContent = pr.desc;
  // hooks (toujours applicables, meme en STL) + synchro des menus deroulants
  lureComponents.hookFront.enabled = pr.hookFront != null;
  if (pr.hookFront) lureComponents.hookFront.size = pr.hookFront;
  lureComponents.hookRear.enabled = pr.hookRear != null;
  if (pr.hookRear) lureComponents.hookRear.size = pr.hookRear;
  if (M.hookFront) M.hookFront.value = pr.hookFront != null ? pr.hookFront : 'off';
  if (M.hookRear) M.hookRear.value = pr.hookRear != null ? pr.hookRear : 'off';
  // materiau (toujours)
  ui.matDensity = pr.matDensity;
  const matSelEl = document.getElementById('matDensity');
  if (matSelEl) { matSelEl.value = String(pr.matDensity); matSelEl.dispatchEvent(new Event('change')); }
  // geometrie seulement en mode procedural (un STL importe garde sa forme)
  if (geom.mode === 'procedural') {
    const bl = document.getElementById('bodyLen'), lp = document.getElementById('lip');
    bl.value = pr.bodyLenMM; bl.dispatchEvent(new Event('input')); bl.dispatchEvent(new Event('change'));
    lp.value = pr.lipDeg; lp.dispatchEvent(new Event('input'));
  }
  updateParams();
  // ballast principal selon l'indice de positionnement
  const hint = BALLAST_HINT_POS[pr.ballastHint];
  if (hint && lureComponents.ballasts.length) {
    const h = hint(params.R);
    lureComponents.ballasts[0].posXFrac = h.posXFrac;
    lureComponents.ballasts[0].posYmm = h.posYmm;
  }
  refreshBallastUI(); recomputeMass(); updateMassPanelReadouts();
}

/* ----- MODULE E : export rapport + STL modifie ------------------------ */
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function buildReportObject() {
  const b = computeMassBudget();
  const reg = classifyRegime(b.densite, b.rhoEff);
  const tv = terminalVelocity();
  const carene = geomComp.frameCentroid;
  return {
    geometry: { mode: geom.mode, bodyLenMM: ui.bodyLenMM, matDensity: ui.matDensity, cgPos: ui.cgPos },
    components: lureComponents,
    massBudget: { massTotal_g: b.massTotal*1000, volume_cm3: b.volumeTotal*1e6, densite_kgm3: b.densite,
                  parComposant_g: Object.fromEntries(Object.entries(b.parComposant).map(([k,v])=>[k, +(v*1000).toFixed(3)])) },
    centerOfMass: { local_mm: { x:+(massState.com.x*1000).toFixed(2), y:+(massState.com.y*1000).toFixed(2), z:+(massState.com.z*1000).toFixed(2) },
                    buoyancyCenter_mm: { x:+(carene.x*1000).toFixed(2), y:+(carene.y*1000).toFixed(2), z:+(carene.z*1000).toFixed(2) },
                    offset_mm: +(massState.com.distanceTo(carene)*1000).toFixed(2) },
    regime: reg.label,
    terminalVelocity_cms: +tv.vcms.toFixed(2),
    retrievalProfile: { ...retrievalProfile },
    fsiSummary: { psiAmplitudeDeg: +fsiStats.psiAmpDeg.toFixed(1), thetaAmplitudeDeg: +fsiStats.thetaAmpDeg.toFixed(1), dominantFreqHz: +fsiStats.freqHz.toFixed(2) },
  };
}
function exportReport() {
  download('rapport_leurre.json', JSON.stringify(buildReportObject(), null, 2), 'application/json');
}
function exportReportTxt() {
  const r = buildReportObject(), mb = r.massBudget;
  const L = [];
  L.push('=== RAPPORT LEURRE — Simulateur CFD/FSI ===');
  L.push('Géométrie      : ' + r.geometry.mode + ' · longueur ' + r.geometry.bodyLenMM + ' mm · matériau ' + r.geometry.matDensity + ' kg/m³ · CG ' + r.geometry.cgPos + '%');
  L.push('Masse totale   : ' + mb.massTotal_g.toFixed(2) + ' g   (volume ' + mb.volume_cm3.toFixed(2) + ' cm³)');
  L.push('Densité        : ' + mb.densite_kgm3.toFixed(1) + ' kg/m³  ->  ' + r.regime);
  L.push('Vitesse chute  : ' + r.terminalVelocity_cms.toFixed(2) + ' cm/s (+ = coule)');
  L.push('Détail masses (g) :');
  for (const k in mb.parComposant_g) L.push('   - ' + k.padEnd(10) + ' : ' + mb.parComposant_g[k]);
  L.push('Centre de masse (mm)   : X=' + r.centerOfMass.local_mm.x + ' Y=' + r.centerOfMass.local_mm.y + ' Z=' + r.centerOfMass.local_mm.z);
  L.push('Centre de carène (mm)  : X=' + r.centerOfMass.buoyancyCenter_mm.x + ' Y=' + r.centerOfMass.buoyancyCenter_mm.y + ' Z=' + r.centerOfMass.buoyancyCenter_mm.z);
  L.push('Écart CM/carène        : ' + r.centerOfMass.offset_mm + ' mm');
  L.push('Récupération   : ' + r.retrievalProfile.mode + ' (A=' + r.retrievalProfile.paramA + ' B=' + r.retrievalProfile.paramB + ' C=' + r.retrievalProfile.paramC + ')');
  L.push('Nage (régime établi) : lacet ' + r.fsiSummary.psiAmplitudeDeg + '°  · roulis ' + r.fsiSummary.thetaAmplitudeDeg + '°  · f ' + r.fsiSummary.dominantFreqHz + ' Hz');
  download('rapport_leurre.txt', L.join('\n'), 'text/plain');
}
// STL modifie : corps + sphere(s) "cavite suggeree" par ballast (PAS un vrai CSG boolean)
function exportModifiedSTL() {
  const geos = [];
  // corps, en coordonnees monde-local du bodyGroup (echelle + offset appliques)
  const bodyG = bodyMesh.geometry.clone();
  bodyG.scale(bodyMesh.scale.x, bodyMesh.scale.y, bodyMesh.scale.z);
  bodyG.translate(bodyMesh.position.x, bodyMesh.position.y, bodyMesh.position.z);
  geos.push(bodyG);
  const RHO_BALLAST = 7900; // acier/plomb approx pour deduire un rayon depuis la masse
  for (const bl of lureComponents.ballasts) {
    const m = Math.max(bl.massG, 0)/1000; if (m <= 0) continue;
    const vol = m / RHO_BALLAST; const rad = Math.cbrt(3*vol/(4*Math.PI));
    const sph = new THREE.SphereGeometry(Math.max(rad, params.R*0.05), 12, 8);
    const p = ballastPos(bl); sph.translate(p.x, p.y, p.z);
    geos.push(sph);
  }
  // Fusion = simple concatenation d'attributs (PAS de soustraction booleenne).
  const merged = mergeGeometriesSimple(geos);
  let stl = new THREE.STLExporter().parse(new THREE.Mesh(merged), { binary: false });
  // L'ASCII STLExporter n'expose pas de header : on encode l'avertissement dans le
  // nom du "solid" (les spheres sont INDICATIVES — pas une vraie cavite booleenne).
  const name = 'CAVITES_INDICATIVES_non_booleen_a_ajuster_en_CAO';
  stl = stl.replace('solid exported', 'solid ' + name).replace('endsolid exported', 'endsolid ' + name);
  download('leurre_ballast_cavites.stl', stl, 'model/stl');
}
// concatenation minimale de BufferGeometries non indexees (fallback sans BufferGeometryUtils)
function mergeGeometriesSimple(geos) {
  let total = 0;
  const nonIndexed = geos.map(g => g.index ? g.toNonIndexed() : g);
  for (const g of nonIndexed) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  let off = 0;
  for (const g of nonIndexed) { const a = g.attributes.position.array; pos.set(a, off); off += a.length; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

/* ----- Statistiques FSI en regime etabli (pour rapport / lecture) ------ */
let fsiHist = [];
const fsiStats = { psiAmpDeg: 0, thetaAmpDeg: 0, freqHz: 0 };
function sampleFsiStats() {
  fsiHist.push({ t: simTime, psi: state.psi, theta: state.theta });
  while (fsiHist.length && simTime - fsiHist[0].t > 3.0) fsiHist.shift();
  if (fsiHist.length < 8) return;
  let pmin=1e9,pmax=-1e9,tmin=1e9,tmax=-1e9, crossings=0, prev=fsiHist[0].psi;
  for (const s of fsiHist) {
    pmin=Math.min(pmin,s.psi); pmax=Math.max(pmax,s.psi);
    tmin=Math.min(tmin,s.theta); tmax=Math.max(tmax,s.theta);
    if ((prev < 0 && s.psi >= 0) || (prev > 0 && s.psi <= 0)) crossings++;
    prev = s.psi;
  }
  const span = Math.max(fsiHist[fsiHist.length-1].t - fsiHist[0].t, 1e-3);
  fsiStats.psiAmpDeg = (pmax - pmin) * 180/Math.PI;
  fsiStats.thetaAmpDeg = (tmax - tmin) * 180/Math.PI;
  fsiStats.freqHz = (crossings / 2) / span; // 2 passages par zero -> 1 periode
}

/* ----- MODULE F : construction du panneau flottant #massPanel ---------- */
const M = {}; // refs d'elements
function el(id) { return document.getElementById(id); }
function buildMassPanel() {
  const massPanel = el('massPanel');
  const hookOpts = (sel) => Object.keys(HOOK_MASS_TABLE).map(s => `<option value="${s}"${s===sel?' selected':''}>${s}</option>`).join('');
  const presetOpts = ['<option value="">— choisir —</option>'].concat(
    Object.entries(LURE_PRESETS).map(([k,v]) => `<option value="${k}">${k.replace(/_/g,' ')}</option>`)).join('');
  massPanel.innerHTML = `
    <h3>Preset de leurre</h3>
    <select id="mp-preset">${presetOpts}</select>
    <div id="mp-presetDesc" class="mp-note">Point de départ ; tous les réglages restent modifiables.</div>

    <div class="mp-sep"></div><h3>Composants</h3>
    <div class="row"><label>Eau <span class="val"></span></label>
      <select id="mp-water"><option value="fresh">Douce (1000)</option><option value="salt">Mer (1025)</option></select></div>
    <div class="row"><label>Carcasse <span class="val"></span></label>
      <select id="mp-frameMode"><option value="auto">Auto (densité × volume)</option><option value="manual">Masse manuelle</option></select></div>
    <div class="row" id="mp-frameManualRow" style="display:none"><label>Masse carcasse (g) <span class="val" id="mp-frameMassVal">0</span></label>
      <input type="range" id="mp-frameMass" min="0" max="80" step="0.5" value="0"></div>
    <div class="row"><label>Hameçon avant <span class="val"></span></label>
      <select id="mp-hookFront"><option value="off">Aucun</option>${hookOpts(lureComponents.hookFront.size)}</select></div>
    <div class="row"><label>Hameçon arrière <span class="val"></span></label>
      <select id="mp-hookRear"><option value="off">Aucun</option>${hookOpts(lureComponents.hookRear.size)}</select></div>
    <div class="mp-note">Poids internes (ballasts) :</div>
    <div id="mp-ballastList"></div>
    <button class="mini-btn" id="mp-addBallast">+ Ajouter un poids</button>

    <div class="mp-sep"></div><h3>Bilan masse &amp; densité</h3>
    <div id="mp-badge" class="mp-badge">—</div>
    <div class="mp-note" id="mp-massTotals">—</div>
    <div class="mp-detail" id="mp-massDetail"></div>
    <canvas id="mp-fall" width="240" height="70"></canvas>
    <div class="mp-note" id="mp-fallVal">—</div>

    <div class="mp-sep"></div><h3>Régime cible (lestage auto)</h3>
    <div class="toggles3">
      <button class="mini-btn" id="mp-regFloat">Flottant</button>
      <button class="mini-btn" id="mp-regSuspend">Suspendu</button>
      <button class="mini-btn" id="mp-regSink">Coulant</button></div>

    <div class="mp-sep"></div><h3>Centre de masse</h3>
    <div class="mp-note" id="mp-comCoords">—</div>
    <div class="row" style="margin-top:6px"><label>Objectif d'optimisation <span class="val"></span></label></div>
    <div class="toggles">
      <div class="toggle-btn active" id="mp-objVive" data-obj="vive">Nage vive</div>
      <div class="toggle-btn" id="mp-objStable" data-obj="stable">Nage stable</div></div>
    <div class="stl-actions" style="margin-top:6px">
      <button class="mini-btn" id="mp-optimize">⚙ Optimiser</button>
      <button class="mini-btn" id="mp-optApply" style="display:none">✓ Appliquer</button></div>
    <div class="mp-note" id="mp-optStatus"></div>

    <div class="mp-sep"></div><h3>Récupération</h3>
    <select id="mp-retMode">
      <option value="constant">Constante</option>
      <option value="steady-pause">Stop-and-go</option>
      <option value="jerk-jerk-pause">Jerk-jerk-pause</option>
      <option value="twitch">Twitch rapide</option>
      <option value="custom">Personnalisé</option></select>
    <div class="row" id="mp-retARow" style="margin-top:6px;display:none"><label id="mp-retALabel">A <span class="val" id="mp-retAVal">1.0</span></label>
      <input type="range" id="mp-retA" min="0.05" max="3" step="0.05" value="1.0"></div>
    <div class="row" id="mp-retBRow" style="display:none"><label id="mp-retBLabel">B <span class="val" id="mp-retBVal">0.6</span></label>
      <input type="range" id="mp-retB" min="0.05" max="3" step="0.05" value="0.6"></div>
    <div class="row" id="mp-retCRow" style="display:none"><label id="mp-retCLabel">C <span class="val" id="mp-retCVal">1.4</span></label>
      <input type="range" id="mp-retC" min="0.1" max="3" step="0.05" value="1.4"></div>
    <canvas id="mp-vf" width="240" height="60"></canvas>

    <div class="mp-sep"></div><h3>Export</h3>
    <div class="stl-actions"><button class="mini-btn" id="mp-expJson">Rapport JSON</button>
      <button class="mini-btn" id="mp-expTxt">Résumé TXT</button></div>
    <div class="stl-actions" style="margin-top:6px"><button class="mini-btn" id="mp-expStl">Exporter STL + cavité(s)</button></div>
  `;
  // refs
  for (const k of ['preset','presetDesc','water','frameMode','frameManualRow','frameMass','frameMassVal',
    'hookFront','hookRear','ballastList','addBallast','badge','massTotals','massDetail','fall','fallVal',
    'regFloat','regSuspend','regSink','comCoords','objVive','objStable','optimize','optApply','optStatus',
    'retMode','retARow','retBRow','retCRow','retA','retB','retC','retAVal','retBVal','retCVal',
    'retALabel','retBLabel','retCLabel','vf','expJson','expTxt','expStl'])
    M[k] = el('mp-' + k);
  M.fallCtx = M.fall.getContext('2d');
  M.vfCtx = M.vf.getContext('2d');
  wireMassPanel();
  refreshBallastUI();
}

let swimObjective = 'vive';
function wireMassPanel() {
  M.preset.addEventListener('change', () => { if (M.preset.value) applyPreset(M.preset.value); });
  M.water.addEventListener('change', () => { lureComponents.waterType = M.water.value; recomputeMass(); updateMassPanelReadouts(); });
  M.frameMode.addEventListener('change', () => {
    lureComponents.frame.massMode = M.frameMode.value;
    M.frameManualRow.style.display = M.frameMode.value === 'manual' ? 'block' : 'none';
    recomputeMass(); updateMassPanelReadouts();
  });
  M.frameMass.addEventListener('input', () => { lureComponents.frame.massG = parseFloat(M.frameMass.value); M.frameMassVal.textContent = M.frameMass.value; recomputeMass(); updateMassPanelReadouts(); });
  M.hookFront.addEventListener('change', () => { const v = M.hookFront.value; lureComponents.hookFront.enabled = v !== 'off'; if (v !== 'off') lureComponents.hookFront.size = v; recomputeMass(); updateMassPanelReadouts(); });
  M.hookRear.addEventListener('change', () => { const v = M.hookRear.value; lureComponents.hookRear.enabled = v !== 'off'; if (v !== 'off') lureComponents.hookRear.size = v; recomputeMass(); updateMassPanelReadouts(); });
  M.addBallast.addEventListener('click', () => {
    if (lureComponents.ballasts.length >= 4) return;
    lureComponents.ballasts.push({ massG: 2, posXFrac: 0.5, posYmm: 0, posZmm: 0, id: 'b' + (_ballastSeq++) });
    refreshBallastUI(); recomputeMass(); updateMassPanelReadouts();
  });
  M.regFloat.addEventListener('click', () => suggestWeight(0.95));
  M.regSuspend.addEventListener('click', () => suggestWeight(1.00));
  M.regSink.addEventListener('click', () => suggestWeight(1.05));
  M.objVive.addEventListener('click', () => { swimObjective = 'vive'; M.objVive.classList.add('active'); M.objStable.classList.remove('active'); });
  M.objStable.addEventListener('click', () => { swimObjective = 'stable'; M.objStable.classList.add('active'); M.objVive.classList.remove('active'); });
  M.optimize.addEventListener('click', () => optimizeBallasts(swimObjective));
  M.optApply.addEventListener('click', applyOptResult);
  M.retMode.addEventListener('change', () => { retrievalProfile.mode = M.retMode.value; refreshRetrievalUI(); });
  const bindRet = (slider, valEl, key) => slider.addEventListener('input', () => { retrievalProfile[key] = parseFloat(slider.value); valEl.textContent = slider.value; });
  bindRet(M.retA, M.retAVal, 'paramA'); bindRet(M.retB, M.retBVal, 'paramB'); bindRet(M.retC, M.retCVal, 'paramC');
  M.expJson.addEventListener('click', exportReport);
  M.expTxt.addEventListener('click', exportReportTxt);
  M.expStl.addEventListener('click', exportModifiedSTL);
  refreshRetrievalUI();
}
function refreshRetrievalUI() {
  const lab = RETRIEVAL_LABELS[retrievalProfile.mode] || ['—','—','—'];
  const rows = [[M.retARow, M.retALabel, lab[0], M.retAVal, retrievalProfile.paramA],
               [M.retBRow, M.retBLabel, lab[1], M.retBVal, retrievalProfile.paramB],
               [M.retCRow, M.retCLabel, lab[2], M.retCVal, retrievalProfile.paramC]];
  for (const [row, labEl, text, valEl, val] of rows) {
    if (text === '—') { row.style.display = 'none'; }
    else { row.style.display = 'block'; labEl.firstChild.textContent = text + ' '; valEl.textContent = val; }
  }
}
function refreshBallastUI() {
  const bs = lureComponents.ballasts;
  M.ballastList.innerHTML = bs.map((b, i) => `
    <div class="ballast-row" data-i="${i}">
      <div class="ballast-hd">Poids ${i+1}${bs.length>1?` <span class="bll-del" data-i="${i}">🗑</span>`:''}</div>
      <label>masse <span class="val">${b.massG.toFixed(1)} g</span></label>
      <input type="range" class="bll-mass" data-i="${i}" min="0" max="20" step="0.5" value="${b.massG}">
      <label>X (0=nez) <span class="val">${Math.round(b.posXFrac*100)}%</span></label>
      <input type="range" class="bll-x" data-i="${i}" min="0" max="100" step="1" value="${Math.round(b.posXFrac*100)}">
      <label>Y (mm) <span class="val">${b.posYmm.toFixed(1)}</span></label>
      <input type="range" class="bll-y" data-i="${i}" min="-20" max="20" step="0.5" value="${b.posYmm}">
      <label>Z (mm) <span class="val">${b.posZmm.toFixed(1)}</span></label>
      <input type="range" class="bll-z" data-i="${i}" min="-20" max="20" step="0.5" value="${b.posZmm}">
    </div>`).join('');
  const onIn = (cls, key, scale, fmt) => M.ballastList.querySelectorAll('.' + cls).forEach(inp => {
    inp.addEventListener('input', () => {
      const i = +inp.dataset.i; lureComponents.ballasts[i][key] = parseFloat(inp.value) * scale;
      inp.previousElementSibling.querySelector('.val').textContent = fmt(parseFloat(inp.value));
      recomputeMass(); updateMassPanelReadouts();
    });
  });
  onIn('bll-mass', 'massG', 1, v => v.toFixed(1) + ' g');
  onIn('bll-x', 'posXFrac', 0.01, v => Math.round(v) + '%');
  onIn('bll-y', 'posYmm', 1, v => v.toFixed(1));
  onIn('bll-z', 'posZmm', 1, v => v.toFixed(1));
  M.ballastList.querySelectorAll('.bll-del').forEach(d => d.addEventListener('click', () => {
    lureComponents.ballasts.splice(+d.dataset.i, 1); refreshBallastUI(); recomputeMass(); updateMassPanelReadouts();
  }));
}
function updateMassPanelReadouts() {
  const b = massState.budget || computeMassBudget();
  const reg = classifyRegime(b.densite, b.rhoEff);
  M.badge.textContent = reg.label; M.badge.className = 'mp-badge ' + reg.cls;
  M.massTotals.textContent = `Masse ${(b.massTotal*1000).toFixed(2)} g · Vol ${(b.volumeTotal*1e6).toFixed(2)} cm³ · ρ ${b.densite.toFixed(0)} kg/m³`;
  const pc = b.parComposant;
  M.massDetail.innerHTML = Object.keys(pc).map(k => `<span>${k}: <b>${(pc[k]*1000).toFixed(2)}g</b></span>`).join('');
  const tv = terminalVelocity();
  const d10 = Math.abs(tv.vcms) > 0.01 ? (10/Math.abs(tv.vcms)).toFixed(1) : '∞';
  M.fallVal.textContent = `${tv.sinks?'Chute':'Remontée'} ${Math.abs(tv.vcms).toFixed(1)} cm/s · 10 cm en ${d10} s`;
  const com = massState.com, car = geomComp.frameCentroid;
  M.comCoords.innerHTML = `CM (mm) X=${(com.x*1000).toFixed(1)} Y=${(com.y*1000).toFixed(1)} Z=${(com.z*1000).toFixed(1)} · écart carène <b>${(com.distanceTo(car)*1000).toFixed(1)} mm</b>`;
  drawFallCanvas(tv);
}
// petit graphe z(t) au repos (integration simple jusqu'a 5s), MODULE A.4
function drawFallCanvas(tv) {
  const ctx = M.fallCtx, W = M.fall.width, H = M.fall.height;
  ctx.clearRect(0,0,W,H); ctx.fillStyle = '#070a0e'; ctx.fillRect(0,0,W,H);
  // integration verticale simple : m z'' = Fnet - 0.5ρCd S z'|z'|
  const b = massState.budget || computeMassBudget();
  const m = Math.max(b.massTotal, 1e-5); let z = 0, v = 0; const dt = 0.02; const pts = [];
  for (let t = 0; t <= 5; t += dt) {
    const drag = 0.5 * b.rhoEff * params.Cd * params.Sfront * v * Math.abs(v);
    const a = (tv.Fnet - drag) / (m * 1.15);
    v += a*dt; z += v*dt; pts.push(z);
    if (Math.abs(v) < 1e-4 && t > 0.5) break;
  }
  const zmax = Math.max(0.02, ...pts.map(Math.abs));
  ctx.strokeStyle = '#2a3644'; ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke();
  ctx.strokeStyle = tv.sinks ? '#ff7a6b' : '#8effa0'; ctx.lineWidth = 1.5; ctx.beginPath();
  pts.forEach((zz,i) => { const x = (i/(pts.length-1||1))*W, y = H/2 + (zz/zmax)*(H/2-4);
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
  ctx.stroke();
}
// profil Vf(t) glissant sur ~6s + curseur present, MODULE D
function drawVfCanvas() {
  const ctx = M.vfCtx, W = M.vf.width, H = M.vf.height;
  ctx.clearRect(0,0,W,H); ctx.fillStyle = '#070a0e'; ctx.fillRect(0,0,W,H);
  const base = params.Vf, win = 6, t0 = simTime - win;
  let vmax = 1e-3; const N = 120, vals = [];
  for (let i = 0; i < N; i++) { const t = t0 + (i/(N-1))*win; const vf = getInstantVf(t, base); vals.push(vf); vmax = Math.max(vmax, vf); }
  ctx.strokeStyle = '#2a3644'; ctx.beginPath(); ctx.moveTo(0,H-2); ctx.lineTo(W,H-2); ctx.stroke();
  ctx.strokeStyle = '#3fb6ff'; ctx.lineWidth = 1.5; ctx.beginPath();
  vals.forEach((vf,i) => { const x = (i/(N-1))*W, y = H-2 - (vf/vmax)*(H-6); if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
  ctx.stroke();
  ctx.strokeStyle = '#ff7a45'; ctx.beginPath(); ctx.moveTo(W-1, 0); ctx.lineTo(W-1, H); ctx.stroke(); // instant present a droite
}

buildMassPanel();
recomputeMass();
updateMassPanelReadouts();
let massAccum = 0;

/* ----------------------------------------------------------------------- *
 * Boucle principale
 * ----------------------------------------------------------------------- */
const clock = new THREE.Clock();
const timeValEl = document.getElementById('timeVal');
const regimeValEl = document.getElementById('regimeVal');
document.getElementById('loading').style.display = 'none';

function updateLureTransform() {
  const L = params.L;
  lureGroup.position.set(state.dispX, -state.z, state.dispZ);
  const pitch = clamp(-3.0 * state.zDot, -0.35, 0.35);
  const euler = new THREE.Euler(pitch, state.psi, state.theta, 'YXZ');
  lureGroup.quaternion.setFromEuler(euler);

  // Ligne de peche : point A tire a Vf, relie a l'anneau avant (leger affaissement)
  const ringWorld = charPoints.ringFront.clone().applyQuaternion(lureGroup.quaternion).add(lureGroup.position);
  const aPos = new THREE.Vector3(ringWorld.x + state.xRel + 1.4 * L, ringWorld.y + 0.5 * L, ringWorld.z * 0.2);
  aMarker.position.copy(aPos);
  const mid = ringWorld.clone().lerp(aPos, 0.5); mid.y -= 0.6 * L * clamp(1 - ui.lineK / 200, 0.15, 1);
  const curve = new THREE.QuadraticBezierCurve3(ringWorld, mid, aPos);
  const linePts = curve.getPoints(12);
  fishingLine.geometry.dispose();
  fishingLine.geometry = new THREE.BufferGeometry().setFromPoints(linePts);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  updateParams();
  // En mode repositionnement, on fige la nage : les marqueurs restent immobiles
  // et donc faciles a cliquer/deplacer precisement sur le mesh.
  if (!reposMode) { stepPhysics(dt); updateLureTransform(); }

  if (toggles.streamlines || toggles.wake) updateStreamlines(dt);
  if (toggles.pressure) updatePressurePlane();
  if (toggles.iso) updateIsosurface(dt);
  if (toggles.stress) updateStress(dt);
  if (!reposMode) updateHodographs(dt);

  // MODULES A/B/D : recalculs throttles (masse/CM, stats FSI, profil Vf) — jamais
  // a chaque frame brute (cf. pattern stressAccum/isoAccum).
  if (!reposMode) sampleFsiStats();
  massAccum += dt;
  if (massAccum > 0.2) {
    massAccum = 0;
    if (!optRunning) recomputeMass();     // pendant l'optimisation, les masses sont figees
    updateMassPanelReadouts();
    drawVfCanvas();
  }
  // MODULE B.2 : marqueurs CM (doré) / centre de carene (cyan) + ligne d'ecart
  if (comMarker) {
    comMarker.position.copy(massState.com);
    careneMarker.position.copy(geomComp.frameCentroid);
    comLine.geometry.setFromPoints([massState.com, geomComp.frameCentroid]);
  }

  const VrelAbs = Math.abs(state.u - params.Vw);
  const fShed = params.St * VrelAbs / params.L;
  const vfNow = getInstantVf(simTime, params.Vf);
  timeValEl.textContent = simTime.toFixed(2);
  regimeValEl.textContent = `V_rel = ${VrelAbs.toFixed(2)} m/s · f_shed = ${fShed.toFixed(2)} Hz · profondeur = ${state.z.toFixed(2)} m · Vf(t) = ${vfNow.toFixed(2)} m/s`;

  controls.update();
  renderer.render(scene, camera);
}
animate();

})();
