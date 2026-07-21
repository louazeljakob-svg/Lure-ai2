/* ============================================================================
 * WOBBLER CFD/FSI SIMULATOR — modele analytique temps reel (pas de solveur
 * Navier-Stokes). Toutes les approximations physiques sont documentees dans
 * les commentaires de chaque module ci-dessous.
 * ==========================================================================*/

(function () {
'use strict';

const RHO_WATER = 1000;     // kg/m3
const RHO_LURE  = 450;      // kg/m3 (bois/plastique dur, densite moyenne)
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
  bodyLenMM: 100, cgPos: 45, density: 260, isoTh: 1.2, planeX: 0.10,
};
const toggles = { streamlines: true, iso: false, pressure: false, hodo: true, stress: false, wake: true };

const params = {}; // recalcule chaque frame depuis `ui`
function updateParams() {
  params.Vf = ui.Vf;
  params.Vw = ui.Vw;
  params.lipDeg = ui.lipDeg;
  params.lipAngleRad = deg2rad(ui.lipDeg);
  params.lineLen = ui.lineLen;
  params.kLine = ui.lineK;
  params.L = ui.bodyLenMM / 1000;
  params.R = 0.17 * params.L; // rayon max reel du corps (le profil ci-dessous est renormalise sur son pic)
  params.Sfront = Math.PI * params.R * params.R;
  params.Slip = 0.42 * params.Sfront;
  const volume = 0.55 * (4 / 3) * Math.PI * (params.L / 2) * params.R * params.R;
  params.mass = RHO_LURE * volume;
  params.mTrans = params.mass * 1.15;               // + masse ajoutee axiale (~15%)
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

  const Tline = p.kLine * s.xRel + p.cLine * (p.Vf - s.u);
  const Ddrag = 0.5 * RHO_WATER * p.Cd * p.Sfront * VrelSigned * VrelAbs;
  const uDot = (Tline - Ddrag) / p.mTrans;
  const xRelDot = p.Vf - s.u;

  const fShed = p.St * VrelAbs / p.L;
  const omega0 = 2 * Math.PI * Math.max(fShed, 0.02);
  // Note : avec xi=psi/psiThresh, cette equation se ramene a la forme normalisee
  // classique de Van der Pol (xi''=mu(1-xi^2)xi'-xi) dont le cycle limite a une
  // amplitude stationnaire proche de 2*psiThresh (propriete connue de VdP, quasi
  // independante de mu) -> on divise par 2 pour que psiSatBase soit bien
  // l'amplitude REELLE de lacet obtenue en regime etabli.
  const psiThresh = (p.psiSatBase * speedFactor) / 2 + 1e-6;
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

const bodyProfile = [ // (s in [0,1] le long du corps, r/Rmax)
  [0.00, 0.000], [0.05, 0.030], [0.12, 0.058], [0.22, 0.084], [0.35, 0.100],
  [0.50, 0.108], [0.62, 0.104], [0.75, 0.086], [0.85, 0.062], [0.93, 0.036],
  [0.98, 0.014], [1.00, 0.000],
];

let bodyMesh, lipMesh, ringFront, ringRear, hookGroup;
const charPoints = {}; // points caracteristiques en coordonnees LOCALES (repere leurre)
const stressHotspots = [];

function buildLure() {
  if (lureGroup.children.length) { for (const c of [...lureGroup.children]) lureGroup.remove(c); }
  const L = params.L, R = params.R;
  const cgX = params.cgPos * L; // origine du groupe = centre de gravite

  const profilePeak = Math.max(...bodyProfile.map(([, r]) => r));
  const pts = bodyProfile.map(([s, r]) => new THREE.Vector2((r / profilePeak) * R, s * L));
  const latheGeo = new THREE.LatheGeometry(pts, 28);
  latheGeo.rotateZ(-Math.PI / 2);      // aligne l'axe de revolution (Y) sur l'axe avant local (X)
  latheGeo.translate(-cgX, 0, 0);      // origine locale = centre de gravite
  latheGeo.computeVertexNormals();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x2f7ea8, metalness: 0.25, roughness: 0.35, vertexColors: false,
  });
  bodyMesh = new THREE.Mesh(latheGeo, bodyMat);
  bodyMesh.userData.baseColor = new THREE.Color(0x2f7ea8);
  lureGroup.add(bodyMesh);

  // Bavette (lip) triangulaire inclinee, a l'avant du nez
  const lipW = R * 1.6, lipLen = R * 2.1;
  const lipGeo = new THREE.BufferGeometry();
  const lipVerts = new Float32Array([
    0, 0, 0,
    -lipLen, 0, lipW * 0.5,
    -lipLen, 0, -lipW * 0.5,
  ]);
  lipGeo.setAttribute('position', new THREE.BufferAttribute(lipVerts, 3));
  lipGeo.setIndex([0, 1, 2, 0, 2, 1]);
  lipGeo.computeVertexNormals();
  const lipMat = new THREE.MeshPhysicalMaterial({
    color: 0xdff6ff, transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0.0, side: THREE.DoubleSide,
  });
  lipMesh = new THREE.Mesh(lipGeo, lipMat);
  lipMesh.position.set(L - cgX, -R * 0.35, 0);
  lipMesh.rotation.z = params.lipAngleRad; // angle de bavette reglable
  lureGroup.add(lipMesh);

  // Anneaux de fixation (avant : ligne, arriere : hameçon queue)
  const ringGeo = new THREE.TorusGeometry(R * 0.16, R * 0.045, 8, 16);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xc9c9c9, metalness: 0.9, roughness: 0.25 });
  ringFront = new THREE.Mesh(ringGeo, ringMat);
  ringFront.position.set(L - cgX + R * 0.05, -R * 0.1, 0);
  ringFront.rotation.x = Math.PI / 2;
  lureGroup.add(ringFront);

  ringRear = new THREE.Mesh(ringGeo, ringMat.clone());
  ringRear.position.set(-cgX, 0, 0);
  ringRear.rotation.x = Math.PI / 2;
  lureGroup.add(ringRear);

  // Hameçons triples (visuel uniquement, geometrie simplifiee : 3 arcs a 120°)
  hookGroup = new THREE.Group();
  const hookMat = new THREE.MeshStandardMaterial({ color: 0x8891a0, metalness: 0.85, roughness: 0.3 });
  function makeTreble(x) {
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
  }
  hookGroup.add(makeTreble(0.35 * L - cgX));
  hookGroup.add(makeTreble(-cgX + 0.02 * L));
  lureGroup.add(hookGroup);

  // Points caracteristiques (reperes locaux) pour hodographes / marqueurs
  charPoints.nose      = new THREE.Vector3(L - cgX, 0, 0);
  charPoints.lipTip    = new THREE.Vector3(L - cgX - lipLen * Math.cos(params.lipAngleRad), -R * 0.35 - lipLen * Math.sin(params.lipAngleRad), 0);
  charPoints.ringFront = ringFront.position.clone();
  charPoints.ringRear  = ringRear.position.clone();
  charPoints.tail      = new THREE.Vector3(-cgX, 0, 0);
  charPoints.finLeft   = new THREE.Vector3(0.5 * L - cgX, R * 0.2, R * 1.05);
  charPoints.finRight  = new THREE.Vector3(0.5 * L - cgX, R * 0.2, -R * 1.05);
  charPoints.dorsal    = new THREE.Vector3(0.45 * L - cgX, R * 1.05, 0);

  stressHotspots.length = 0;
  stressHotspots.push(charPoints.lipTip.clone(), charPoints.ringFront.clone());

  buildCharMarkers();
}

const markerColors = {
  nose: 0xff5a3c, lipTip: 0xffd23f, ringFront: 0x3fe0ff, ringRear: 0x8effa0,
  tail: 0xff8fe0, finLeft: 0xb98cff, finRight: 0x66ff9e, dorsal: 0xffa63f,
};
let charMarkers = {};
function buildCharMarkers() {
  for (const k in charMarkers) lureGroup.remove(charMarkers[k]);
  charMarkers = {};
  const R = params.R;
  for (const key in charPoints) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(R * 0.09, 8, 8),
      new THREE.MeshBasicMaterial({ color: markerColors[key] || 0xffffff })
    );
    m.position.copy(charPoints[key]);
    lureGroup.add(m);
    charMarkers[key] = m;
  }
}

buildLure();

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
function fieldVelocityWorld(pWorld, out) {
  _invQuat.copy(lureGroup.quaternion).conjugate();
  _pLocal.copy(pWorld).sub(lureGroup.position).applyQuaternion(_invQuat);

  const VrelSigned = state.u - params.Vw;
  const VrelAbs = Math.abs(VrelSigned) + 1e-4;
  const L = params.L, R = params.R;

  out.set(-VrelSigned, 0, 0); // ecoulement uniforme relatif, exprime dans le repere local

  const Q = 6 * Math.PI * VrelAbs * R * R; // gain empirique (visibilite) sur le doublet source/puits
  addPointSource(out, _pLocal, { x: 0.42 * L, y: 0, z: 0 }, Q, 0.35 * R);
  addPointSource(out, _pLocal, { x: -0.42 * L, y: 0, z: 0 }, -Q, 0.35 * R);

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
  const isoCenter = new THREE.Vector3(0, 0, 0); // centre du corps (a mi-chemin source/puits)
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
function updateStress(dt) {
  stressAccum += dt;
  if (stressAccum < 0.15) return;
  stressAccum = 0;
  const geo = bodyMesh.geometry;
  if (!geo.attributes.color) {
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
  }
  const pos = geo.attributes.position, col = geo.attributes.color;
  const VrelAbs = Math.abs(state.u - params.Vw);
  const Fnorm = clamp((0.5 * RHO_WATER * params.ClDive * params.Slip * VrelAbs * VrelAbs * Math.abs(Math.sin(params.lipAngleRad))) / 40, 0, 1)
              + clamp(Math.abs(state.psiDot) / 6, 0, 1);
  const R = params.R;
  const sigma2 = (R * 1.1) * (R * 1.1);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    let s = 0.08; // contrainte residuelle de base (poids propre / pretension ligne)
    for (const h of stressHotspots) {
      const d2 = v.distanceToSquared(h);
      s += Fnorm * Math.exp(-d2 / sigma2);
    }
    s = clamp(s, 0, 1);
    const [r, g, b] = jetColor(s);
    col.setXYZ(i, r, g, b);
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
  for (const k in charMarkers) charMarkers[k].visible = toggles.hodo;
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
  stepPhysics(dt);
  updateLureTransform();

  if (toggles.streamlines || toggles.wake) updateStreamlines(dt);
  if (toggles.pressure) updatePressurePlane();
  if (toggles.iso) updateIsosurface(dt);
  if (toggles.stress) updateStress(dt);
  updateHodographs(dt);

  const VrelAbs = Math.abs(state.u - params.Vw);
  const fShed = params.St * VrelAbs / params.L;
  timeValEl.textContent = simTime.toFixed(2);
  regimeValEl.textContent = `V_rel = ${VrelAbs.toFixed(2)} m/s · f_shed = ${fShed.toFixed(2)} Hz · profondeur = ${state.z.toFixed(2)} m`;

  controls.update();
  renderer.render(scene, camera);
}
animate();

})();
