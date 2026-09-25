/**
 * Test de bout en bout de la bibliotheque — modules AB et AG.
 *
 * Chaque famille est chargee comme un projet (aller-retour JSON compris),
 * construite, coupee en coques, exportee piece par piece, puis verifiee :
 * etancheite de chaque piece, conformite des logements, verdict de
 * flottabilite, controle d'impression, nage, tenue des ancrages, course du
 * joint au degre pres. Les deux modes de bavette sont passes pour les
 * familles a bavette. Les projets des versions precedentes sont rouverts et
 * doivent rester fermes. Un modele qui echoue n'est pas livre.
 */

import * as THREE from 'three';
import legacy from './legacy-projects.json';
import v5Projects from './v5-projects.json';
import { activeFilters, ARCHETYPES, filterValues, matchesChoice, type LibraryChoice } from '../../src/lib/archetypes';
import { SHAPE_PRESETS, clonePreset } from '../../src/lib/presets';
import { sanitizeParams } from '../../src/lib/validation';
import { createProfile } from '../../src/lib/profile';
import { buildLure, buildTailFin, DISPLAY_RESOLUTION } from '../../src/lib/geometry';
import {
  assemblyActive,
  assemblyExport,
  assemblyPlans,
  assemblyPreview,
  buildAssembly,
  disposeAssembly,
} from '../../src/lib/assembly';
import { computePhysics } from '../../src/lib/physics';
import { runPrintChecks } from '../../src/lib/printCheck';
import { collectParts, countExportTriangles, stlBytes, type ExportKind } from '../../src/lib/exporters';
import { jointTravel } from '../../src/lib/jointCheck';
import {
  anchorStrength,
  criticalSpeed,
  DEFAULT_ASSUMPTIONS,
  NEUTRAL_CALIBRATION,
  wobbleProfile,
  type SwimInput,
} from '../../src/lib/swim';
import type { LureParams } from '../../src/types/lure';
import { THUMBNAILS } from '../../src/lib/thumbnails';
import { bibAllowance, ImportError, importMesh } from '../../src/lib/importMesh';
import { createMeshBody, registerMeshBody, restoreMeshBody } from '../../src/lib/meshBody';
import { industrialise, runBench } from '../../src/lib/industrialise';
import { buildProjectFile } from '../../src/lib/exporters';

export interface Report {
  failures: string[];
  lines: string[];
}

/** Arete dirigee apparue exactement une fois, avec son opposee : solide ferme. */
export function audit(geometry: THREE.BufferGeometry): { triangles: number; open: number; volume: number } {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const ids = new Map<string, number>();
  const key = (i: number) => {
    const q = (v: number) => (+(+v.toFixed(6) + 0).toFixed(6)).toString();
    const k = `${q(position.getX(i))},${q(position.getY(i))},${q(position.getZ(i))}`;
    let id = ids.get(k);
    if (id === undefined) {
      id = ids.size;
      ids.set(k, id);
    }
    return id;
  };
  const edges = new Map<string, number>();
  let volume = 0;
  for (let f = 0; f < count; f += 3) {
    const a = index ? index.getX(f) : f;
    const b = index ? index.getX(f + 1) : f + 1;
    const c = index ? index.getX(f + 2) : f + 2;
    const A = key(a);
    const B = key(b);
    const C = key(c);
    if (A === B || B === C || A === C) continue;
    for (const [u, v] of [
      [A, B],
      [B, C],
      [C, A],
    ]) {
      const e = `${u}>${v}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
    const ax = position.getX(a);
    const ay = position.getY(a);
    const az = position.getZ(a);
    const bx = position.getX(b);
    const by = position.getY(b);
    const bz = position.getZ(b);
    const cx = position.getX(c);
    const cy = position.getY(c);
    const cz = position.getZ(c);
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  let open = 0;
  for (const [e, n] of edges) {
    if (n !== 1) {
      open += n;
      continue;
    }
    const [u, v] = e.split('>');
    if ((edges.get(`${v}>${u}`) ?? 0) !== 1) open++;
  }
  return { triangles: count / 3, open, volume: Math.abs(volume) };
}

function checkFamily(id: string, variant: string, params: LureParams, report: Report): void {
  const tag = `${id}${variant ? ` (${variant})` : ''}`;
  const fail = (what: string) => report.failures.push(`${tag} : ${what}`);
  const profile = createProfile(params);

  // --- Corps, a la resolution d'export -------------------------------------
  const plans = assemblyPlans(profile, params);
  const geo = buildLure(params, DISPLAY_RESOLUTION, plans.billPlan?.root ?? null, true);
  const body = audit(geo.body);
  if (body.open) fail(`corps ouvert (${body.open} aretes)`);
  if (geo.tail) {
    const tail = audit(geo.tail);
    if (tail.open) fail(`caudale ouverte (${tail.open} aretes)`);
  }

  // --- Coques, logements, exports ------------------------------------------
  if (!assemblyActive(params)) fail('assemblage en deux demi-coques inactif');
  const assembly = buildAssembly(profile, params, assemblyExport(params));
  const male = audit(assembly.male);
  const female = audit(assembly.female);
  if (male.open) fail(`coque male ouverte (${male.open} aretes)`);
  if (female.open) fail(`coque femelle ouverte (${female.open} aretes)`);
  for (const socket of assembly.sockets) {
    if (!socket.valid) fail(`goupille ${socket.anchorId} refusee : ${socket.problem}`);
  }
  for (const screw of assembly.screws) {
    if (!screw.valid) fail(`vis ${screw.id} refusee : ${screw.problem}`);
  }
  if (params.screws.enabled && assembly.screws.length === 0) fail('aucune vis');
  for (const peg of assembly.pegs) if (!peg.valid) fail(`ergot refuse : ${peg.problem}`);
  if (params.assembly.pegs.enabled && assembly.pegs.filter((peg) => peg.valid).length < 2) {
    fail('moins de deux ergots');
  }
  if (params.assembly.glueGroove.enabled && (!assembly.glueGroove || assembly.glueGroove.segments === 0)) {
    fail('gorge de colle absente');
  }
  if (assembly.jointProblem) fail(`charniere : ${assembly.jointProblem}`);
  if (assembly.tailSlotProblem) fail(`queue rapportee : ${assembly.tailSlotProblem}`);
  if (params.hasBib) {
    if (!assembly.billPlan) fail(`fente de bavette refusee : ${assembly.billProblem}`);
    else if (assembly.billProblem) fail(`fente de bavette : ${assembly.billProblem}`);
  }

  const kinds: ExportKind[] = ['assembly', 'male', 'female'];
  if (params.hasBib && params.billMode === 'printed') kinds.push('bib');
  if (params.softTail.enabled) kinds.push('softTail');
  let exported = 0;
  for (const kind of kinds) {
    const { parts, owned } = collectParts(params, geo, kind, false);
    if (parts.length === 0) fail(`export ${kind} vide`);
    for (const part of parts) {
      const a = audit(part);
      exported += a.triangles;
      if (a.open) fail(`export ${kind} : piece ouverte (${a.open} aretes)`);
    }
    for (const part of owned) part.dispose();
  }

  // --- Physique ----------------------------------------------------------------
  const physics = computePhysics(params, geo, 'fresh');
  const wanted = ARCHETYPES.find((item) => item.shape === id)?.buoyancy;
  if (wanted && physics.buoyancy !== wanted) {
    fail(`verdict ${physics.buoyancy} au lieu de ${wanted} (rapport ${physics.ratio.toFixed(3)})`);
  }
  for (const warning of physics.warnings) {
    if (warning.level === 'error') fail(`simulation : ${warning.title} — ${warning.detail}`);
  }
  for (const check of runPrintChecks(params, geo)) {
    if (!check.ok) fail(`controle d impression « ${check.label} » : ${check.detail}`);
  }

  // --- Nage et tenue ---------------------------------------------------------
  const input: SwimInput = {
    params,
    massG: physics.totalMass,
    volumeCm3: physics.volumeCm3,
    cg: physics.cg,
    cb: physics.cb,
    bounds: { length: params.length, width: params.maxWidth, height: params.thickness },
    assumptions: DEFAULT_ASSUMPTIONS,
    calibration: NEUTRAL_CALIBRATION,
  };
  const critical = criticalSpeed(input);
  const wobble = wobbleProfile(input, critical);
  if (!Number.isFinite(critical.sweet) || critical.sweet <= 0) fail('vitesse critique non calculable');
  if (!wobble.points.every((point) => Number.isFinite(point.yaw) && Number.isFinite(point.frequency))) {
    fail('oscillation non calculable');
  }
  for (const socket of assembly.sockets) {
    const strength = anchorStrength(
      socket.spec.label,
      socket.spec.wire,
      socket.spec.loopWidth,
      socket.seatDepth * 10,
      'inox304',
      params,
      DEFAULT_ASSUMPTIONS,
      NEUTRAL_CALIBRATION,
      false,
    );
    if (!Number.isFinite(strength.kgf.value) || strength.kgf.value <= 0 || !strength.modeLabel) {
      fail(`charge de rupture non calculable pour ${socket.anchorId}`);
    }
  }

  // --- Joint articule : course au degre pres ---------------------------------
  if (geo.jointPlan) {
    const travel = jointTravel(profile, geo.jointPlan);
    if (travel.free + 1e-6 < travel.wanted - 1) {
      fail(`debattement ${travel.free} deg sur ${travel.wanted} : ${travel.first?.part} contre ${travel.first?.against}`);
    }
  }

  report.lines.push(
    `${tag.padEnd(28)} corps ${String(body.triangles).padStart(7)} tri · coques ${String(
      male.triangles + female.triangles,
    ).padStart(7)} tri · export ${String(exported).padStart(7)} tri · ` +
      `${physics.buoyancy} ${physics.ratio.toFixed(3)} · ${physics.totalMass.toFixed(1)} g`,
  );
  geo.dispose();
}

/** STL binaire d'un leurre complet, tel qu'un utilisateur l'exporterait de son logiciel. */
function familyStl(params: LureParams, rotate: (p: THREE.Vector3) => THREE.Vector3 = (p) => p): ArrayBuffer {
  const geo = buildLure(params, DISPLAY_RESOLUTION);
  const parts = [geo.body, geo.tail, params.hasBib && params.billMode === 'printed' ? geo.bib : null].filter(
    (part): part is THREE.BufferGeometry => part !== null,
  );
  const soup: number[] = [];
  const v = new THREE.Vector3();
  for (const part of parts) {
    const position = part.getAttribute('position');
    const index = part.getIndex();
    const count = index ? index.count : position.count;
    for (let k = 0; k < count; k++) {
      v.fromBufferAttribute(position, index ? index.getX(k) : k);
      const r = rotate(v.clone());
      soup.push(r.x * 10, r.y * 10, r.z * 10);
    }
  }
  geo.dispose();
  const triangles = soup.length / 9;
  const buffer = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles, true);
  let offset = 84;
  for (let t = 0; t < triangles; t++) {
    offset += 12;
    for (let k = 0; k < 9; k++) {
      view.setFloat32(offset, soup[t * 9 + k], true);
      offset += 4;
    }
    offset += 2;
  }
  return buffer;
}

/**
 * Import STL et industrialisation (module AD) : le modele est lu, repare,
 * oriente, passe au banc d'essai, industrialise, enregistre en projet JSON
 * avec son maillage, rouvert, puis controle comme une famille.
 */
function checkImport(id: string, report: Report, turned = false, base: LureParams = clonePreset(id as LureParams['shape'])): void {
  const tag = `import ${id}${turned ? ' (fichier tourne)' : ''}`;
  const fail = (what: string) => report.failures.push(`${tag} : ${what}`);
  const source = { ...base, billMode: 'printed' as const };
  // Fichier tourne : axe long sur Z, dos vers -X — l'orientation doit etre retrouvee.
  const buffer = familyStl(source, turned ? (p) => new THREE.Vector3(-p.y, p.z, p.x) : undefined);
  const started = Date.now();
  const mesh = importMesh(`${id}.stl`, buffer);
  const readMs = Date.now() - started;
  if (!mesh.diagnosis.watertight) fail(`maillage non etanche apres reparation (${mesh.diagnosis.openEdges} aretes)`);
  if (Math.abs(mesh.bounds.length - (source.length + (mesh.bib && mesh.bib.fromNoseMm < 0 ? -mesh.bib.fromNoseMm : 0))) > 0.5) {
    fail(`longueur relue ${mesh.bounds.length.toFixed(1)} mm`);
  }
  if (source.hasBib !== (mesh.bib !== null)) fail(`bavette ${mesh.bib ? 'inventee' : 'non reconnue'}`);
  const body = createMeshBody(`e2e-${id}-${turned ? 't' : 'd'}`, `${id}.stl`, mesh.body, null, bibAllowance(mesh));
  registerMeshBody(body);
  // Orientation : le nez doit etre en -X et le dos en +Y — la caudale est a
  // l'arriere et la bavette sous le menton.
  if (body.skin.bodyEnd >= 1 && source.tailShape !== 'round') fail('caudale non retrouvee : nez et queue inverses ?');

  // --- Banc d'essai, geometrie intacte ---------------------------------------
  const bench = runBench(mesh, body, source, 'fresh');
  if (!(bench.physics.totalMass > 0) || !Number.isFinite(bench.physics.ratio)) fail('banc : masse non calculee');
  if (Math.abs(bench.physics.volumeCm3 - mesh.volume) > mesh.volume * 0.03) {
    fail(`banc : volume ${bench.physics.volumeCm3.toFixed(2)} cm3 pour ${mesh.volume.toFixed(2)} cm3 mesures`);
  }
  if (bench.anchors.length < 2) fail(`banc : ${bench.anchors.length} ancrage(s) evalue(s)`);
  if (bench.anchors.some((anchor) => !anchor.modeLabel)) fail('banc : mode de rupture non nomme');
  if (!Number.isFinite(bench.swim.critical.value)) fail('banc : vitesse critique non calculee');

  // --- Industrialisation -------------------------------------------------------
  const { params, report: made } = industrialise(mesh, body, source, { hollow: true, wall: 1.6 });
  if (!params) {
    fail(`industrialisation refusee : ${made.blocked.join(' / ')}`);
    return;
  }
  for (const problem of made.problems) fail(`industrialisation : ${problem}`);

  // --- Projet JSON avec son maillage, rouvert ----------------------------------
  const file = JSON.parse(JSON.stringify(buildProjectFile(`${id} industrialise`, params)));
  if (!Array.isArray(file.meshes) || file.meshes.length !== 1) fail('maillage non embarque dans le projet');
  const restored = file.meshes.map(restoreMeshBody);
  if (!restored[0]) fail('maillage embarque illisible');
  const reopened = sanitizeParams(file.params);
  if (!reopened.meshBody) fail('reference au maillage perdue');
  checkFamily(made.family, `${tag}, industrialise`, reopened, report);
  report.lines.push(
    `${tag.padEnd(28)} ${mesh.diagnosis.triangles} tri lus en ${readMs} ms · banc ${bench.physics.buoyancy} ` +
      `${bench.physics.totalMass.toFixed(1)} g · industrialise ${made.physics?.buoyancy} ${made.physics?.totalMass.toFixed(1)} g`,
  );
}

// ---------------------------------------------------------------------------
// Jeu de test de l'import (module AK.6)
// ---------------------------------------------------------------------------

type Xf = (p: THREE.Vector3) => THREE.Vector3;

/** Soupe de triangles en mm, depuis des geometries en cm. */
function soupOf(parts: (THREE.BufferGeometry | null)[], xf: Xf): number[] {
  const soup: number[] = [];
  const v = new THREE.Vector3();
  for (const part of parts) {
    if (!part) continue;
    const position = part.getAttribute('position');
    const index = part.getIndex();
    const count = index ? index.count : position.count;
    for (let k = 0; k < count; k++) {
      v.fromBufferAttribute(position, index ? index.getX(k) : k);
      const r = xf(v.clone().multiplyScalar(10));
      soup.push(r.x, r.y, r.z);
    }
  }
  return soup;
}

function binaryStl(soup: number[], header = '', trailing = 0): ArrayBuffer {
  const count = soup.length / 9;
  const buffer = new ArrayBuffer(84 + count * 50 + trailing);
  const view = new DataView(buffer);
  for (let i = 0; i < Math.min(header.length, 80); i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, count, true);
  let offset = 84;
  for (let t = 0; t < count; t++) {
    offset += 12;
    for (let k = 0; k < 9; k++) {
      view.setFloat32(offset, soup[t * 9 + k], true);
      offset += 4;
    }
    offset += 2;
  }
  return buffer;
}

function asciiStl(soup: number[], name: string): string {
  const lines = [`solid ${name}`];
  for (let t = 0; t < soup.length / 9; t++) {
    lines.push('  facet normal 0 0 0', '    outer loop');
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      lines.push(`      vertex ${soup[o].toExponential(6)} ${soup[o + 1].toExponential(6)} ${soup[o + 2].toExponential(6)}`);
    }
    lines.push('    endloop', '  endfacet');
  }
  lines.push(`endsolid ${name}`);
  return lines.join('\r\n');
}

const scaled = (shape: LureParams['shape'], length: number): LureParams => {
  const params = clonePreset(shape);
  const k = length / params.length;
  return { ...params, length, maxWidth: params.maxWidth * k, thickness: params.thickness * k };
};

/**
 * Les quatre fichiers du jeu de test AK.6, fabriques comme les exporterait un
 * autre logiciel : demi-coques posees sur leur face de joint, en-tete binaire
 * menteur, octets de bourrage, Z vers le haut, faces retournees, doublons,
 * petits trous.
 */
export function testFiles(): { name: string; data: ArrayBuffer | string; lengthMm: number; halfShell: boolean }[] {
  const files: { name: string; data: ArrayBuffer | string; lengthMm: number; halfShell: boolean }[] = [];
  {
    const p = scaled('minnow', 95);
    const a = buildAssembly(createProfile(p), p, { stations: 70, arcSamples: 14 });
    const soup = soupOf([a.male], (v) => new THREE.Vector3(-v.y + 40, v.x + 60, v.z + 5));
    files.push({ name: 'demi-coque-legere.stl', data: asciiStl(soup, 'demi_coque_male'), lengthMm: 95, halfShell: true });
    disposeAssembly(a);
  }
  {
    const p = scaled('lipless', 135);
    const a = buildAssembly(createProfile(p), p, { stations: 67, arcSamples: 13 });
    const soup = soupOf([a.female], (v) => new THREE.Vector3(v.x, v.y, -v.z));
    files.push({ name: 'demi-coque-moyenne.stl', data: binaryStl(soup, 'solid lipless femelle exported', 4), lengthMm: 135, halfShell: true });
    disposeAssembly(a);
  }
  {
    const p = { ...scaled('minnow', 65), billMode: 'printed' as const };
    const profile = createProfile(p);
    const a = buildAssembly(profile, p, { stations: 57, arcSamples: 13 });
    const geo = buildLure(p, DISPLAY_RESOLUTION, a.billPlan?.root ?? null);
    const parts = [a.male, a.female, a.tenons, buildTailFin(profile, p, 'male'), buildTailFin(profile, p, 'female'), geo.bib];
    files.push({ name: 'assemblage-dense.stl', data: binaryStl(soupOf(parts, (v) => new THREE.Vector3(v.x, -v.z, v.y)), 'assemblage minnow 65'), lengthMm: 65, halfShell: false });
    geo.dispose();
    disposeAssembly(a);
  }
  {
    const p = { ...scaled('minnow', 95), billMode: 'printed' as const };
    // Un peu plus fin que l'export de l'application : ~171 000 facettes.
    const geo = buildLure(p, { lengthSegments: 143, radialSegments: 54 });
    const profile = createProfile(p);
    const eye = (side: number) => {
      const section = profile.section(0.085);
      const g = new THREE.SphereGeometry(0.22, 24, 16);
      g.translate(profile.xAt(0.085) + 0.05, (section.top + section.bottom) / 2 + section.top * 0.25, side * section.halfWidth * 0.8);
      return g;
    };
    let soup = soupOf([geo.body, geo.tail, geo.bib, eye(1), eye(-1)], (v) => new THREE.Vector3(-v.x, v.z, v.y));
    const count = soup.length / 9;
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 300; i++) {
      const t = Math.floor(rnd() * count) * 9;
      for (let c = 0; c < 3; c++) [soup[t + 3 + c], soup[t + 6 + c]] = [soup[t + 6 + c], soup[t + 3 + c]];
    }
    for (let i = 0; i < 50; i++) {
      const t = Math.floor(rnd() * count) * 9;
      soup.push(...soup.slice(t, t + 9));
    }
    const drop = new Set<number>();
    for (let i = 0; i < 6; i++) drop.add(Math.floor(rnd() * count));
    soup = soup.filter((_, i) => !drop.has(Math.floor(i / 9)));
    files.push({ name: 'assemblage-tres-dense.stl', data: binaryStl(soup, 'solid tres dense'), lengthMm: 95, halfShell: false });
    geo.dispose();
  }
  return files;
}

/** Limites nommees, attendues sur un corps trop petit pour la visserie du catalogue. */
const NAMED_LIMITS = /^(Visserie non posee|Aucune chambre possible)/;

function checkTestFile(file: ReturnType<typeof testFiles>[number], report: Report): void {
  const tag = `jeu AK.6 ${file.name}`;
  const fail = (what: string) => report.failures.push(`${tag} : ${what}`);
  const started = Date.now();
  let mesh;
  try {
    mesh = importMesh(file.name, file.data);
  } catch (error) {
    fail(`import en echec : ${error instanceof Error ? error.message : error}`);
    return;
  }
  const body = createMeshBody(`e2e-${file.name}`, file.name, mesh.body, null, bibAllowance(mesh));
  registerMeshBody(body);
  const importMs = Date.now() - started;
  if (file.halfShell !== (mesh.halfShell !== null)) fail(`demi-coque ${mesh.halfShell ? 'inventee' : 'non reconnue'}`);
  if (mesh.halfShell && !mesh.halfShell.completed) fail('demi-coque non reconstituee');
  if (!(mesh.volume > 0)) fail('volume nul');
  const bench = runBench(mesh, body, clonePreset('minnow'), 'fresh');
  if (!Number.isFinite(bench.physics.ratio)) fail('banc : flottabilite non calculee');
  if (!Number.isFinite(bench.swim.critical.value)) fail('banc : nage non calculee');
  if (bench.anchors.length === 0 || bench.anchors.some((anchor) => !(anchor.kgf.value > 0))) fail('banc : charge de rupture non calculee');
  const { params, report: made } = industrialise(mesh, body, clonePreset('minnow'), { hollow: true, wall: 1.6 });
  if (!params) {
    fail(`industrialisation refusee : ${made.blocked.join(' / ')}`);
    return;
  }
  for (const problem of made.problems) if (!NAMED_LIMITS.test(problem)) fail(`industrialisation : ${problem}`);
  const assembly = buildAssembly(createProfile(params), params, assemblyExport(params));
  if (audit(assembly.male).open || audit(assembly.female).open) fail('demi-coques ouvertes');
  const screws = assembly.screws.filter((screw) => screw.valid).length;
  const sockets = assembly.sockets.filter((socket) => socket.valid).length;
  const limited = made.problems.some((problem) => NAMED_LIMITS.test(problem));
  if (!limited && screws === 0) fail('aucune vis posee');
  if (sockets === 0) fail('aucune portee de goupille');
  disposeAssembly(assembly);
  report.lines.push(
    `${tag.padEnd(40)} ${mesh.diagnosis.triangles} tri · ${mesh.bounds.length.toFixed(1)} mm · ${mesh.volume.toFixed(2)} cm3 · ` +
      `import ${importMs} ms · banc ${bench.physics.buoyancy} · ${screws} vis, ${sockets} portees${limited ? ' (visserie impossible, nommee)' : ''}`,
  );
}

/** Un import qui echoue le dit, et nomme la cause (AK.2). */
function checkImportErrors(report: Report): void {
  const cases: { name: string; data: ArrayBuffer | string; cause: RegExp }[] = [
    { name: 'vide.stl', data: new ArrayBuffer(0), cause: /vide|0 octet/i },
    { name: 'texte.stl', data: 'bonjour, ceci n est pas un maillage', cause: /facette|triangle|STL/i },
    { name: 'tronque.stl', data: binaryStl([0, 0, 0, 1, 0, 0, 0, 1, 0], '', 0).slice(0, 60), cause: /octets|tronque|en-tete|84/i },
    { name: 'plat.stl', data: binaryStl([0, 0, 0, 0, 0, 0, 0, 0, 0]), cause: /confondues|aire nulle|point/i },
  ];
  for (const item of cases) {
    try {
      importMesh(item.name, item.data);
      report.failures.push(`import ${item.name} : aurait du echouer`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!(error instanceof ImportError) || !item.cause.test(message)) {
        report.failures.push(`import ${item.name} : cause mal nommee (« ${message} »)`);
      } else {
        report.lines.push(`echec nomme ${item.name.padEnd(12)} ${message.slice(0, 90)}`);
      }
    }
  }
}

export function run(): Report {
  const report: Report = { failures: [], lines: [] };

  // Critere AH.1 : la bibliotheque ne contient que les deux familles.
  const ids = SHAPE_PRESETS.map((preset) => preset.id);
  const expected = ['minnow', 'lipless'];
  if (ids.join() !== expected.join()) report.failures.push(`bibliotheque : ${ids.join(', ')}`);
  if (ARCHETYPES.map((item) => item.shape).join() !== expected.join()) report.failures.push('fiches de famille en trop');

  // Aucun filtre, seul ou combine, ne renvoie de liste vide.
  const walk = (chosen: LibraryChoice, depth: number) => {
    if (ARCHETYPES.filter((item) => matchesChoice(item, chosen)).length === 0) {
      report.failures.push(`filtres ${JSON.stringify(chosen)} : liste vide`);
    }
    if (depth >= activeFilters().length) return;
    const filter = activeFilters()[depth];
    walk(chosen, depth + 1);
    for (const value of filterValues(filter.key, chosen)) walk({ ...chosen, [filter.key]: value }, depth + 1);
  };
  walk({}, 0);

  const counted: Record<string, number> = {};
  for (const preset of SHAPE_PRESETS) {
    // Vignette pre-calculee et stockee : affichage instantane (AB.5).
    const thumb = THUMBNAILS[preset.id];
    if (!thumb || !thumb.image.startsWith('data:image/')) {
      report.failures.push(`${preset.id} : vignette pre-calculee absente`);
    }
    // Chargement comme un projet : aller-retour JSON et nettoyage.
    const params = sanitizeParams(JSON.parse(JSON.stringify(clonePreset(preset.id))));
    if (!params.anatomy) report.failures.push(`${preset.id} : anatomie perdue au chargement`);
    checkFamily(preset.id, '', params, report);
    if (params.hasBib) {
      // Les deux modes de bavette : meme fente, memes jeux.
      const printed = { ...params, billMode: 'printed' as const };
      checkFamily(preset.id, 'bavette imprimee', printed, report);
      const a = assemblyPlans(createProfile(params), params).billPlan;
      const b = assemblyPlans(createProfile(printed), printed).billPlan;
      if (!a || !b || Math.abs(a.depth - b.depth) > 1e-9 || Math.abs(a.halfPlate - b.halfPlate) > 1e-9 || a.mouth.distanceTo(b.mouth) > 1e-9) {
        report.failures.push(`${preset.id} : la fente differe entre bavette imprimee et polycarbonate`);
      }
    }

    // Module AI : la carte affiche ce que l'editeur calcule et ce que le
    // fichier STL contient vraiment, a la taille par defaut.
    {
      const fresh = clonePreset(preset.id);
      const profile = createProfile(fresh);
      const preview = assemblyPreview(profile, fresh);
      const plans = assemblyPlans(profile, fresh, preview);
      const geo = buildLure(fresh, DISPLAY_RESOLUTION, plans.billPlan?.root ?? null);
      const physics = computePhysics(fresh, geo, 'fresh', preview);
      const triangles = countExportTriangles(fresh, geo, 'assembly');
      const bytes = stlBytes(fresh, geo, 'assembly').byteLength;
      if ((bytes - 84) / 50 !== triangles) report.failures.push(`${preset.id} : ${triangles} triangles comptes, ${(bytes - 84) / 50} dans le STL`);
      if (thumb && thumb.exportTriangles !== triangles) {
        report.failures.push(`${preset.id} : la carte affiche ${thumb.exportTriangles} triangles, l export en contient ${triangles}`);
      }
      if (thumb && Math.abs(thumb.massG - physics.totalMass) > 0.051) {
        report.failures.push(`${preset.id} : la carte affiche ${thumb.massG} g, le modele pese ${physics.totalMass.toFixed(2)} g`);
      }
      if (thumb && Math.abs(thumb.volumeCm3 - physics.volumeCm3) > 0.0051) {
        report.failures.push(`${preset.id} : la carte affiche ${thumb.volumeCm3} cm3, le modele en mesure ${physics.volumeCm3.toFixed(3)}`);
      }
      counted[preset.id] = triangles;
      report.lines.push(`${`${preset.id} (carte)`.padEnd(28)} ${triangles} triangles exportes · ${physics.totalMass.toFixed(1)} g · ${physics.volumeCm3.toFixed(2)} cm3`);
      geo.dispose();
      if (preview) disposeAssembly(preview);
    }

    // Densite suivant la taille : a 100 mm plus de 15 000 triangles, et un
    // corps plus long en porte davantage.
    const at = (length: number) => {
      const g = buildLure({ ...params, length }, DISPLAY_RESOLUTION);
      const n = audit(g.body).triangles;
      g.dispose();
      return n;
    };
    const t100 = at(100);
    if (t100 <= 15000) report.failures.push(`${preset.id} : ${t100} triangles a 100 mm`);
    const t70 = at(70);
    const t160 = at(160);
    if (!(t160 > t100 && t100 > t70)) report.failures.push(`${preset.id} : densite independante de la taille (${t70} / ${t100} / ${t160})`);
  }
  if (counted.minnow === counted.lipless) report.failures.push('les deux cartes affichent le meme nombre de triangles');

  // Import STL et industrialisation (module AD), dont des corps que seuls
  // les curseurs atteignent desormais : trapu a bavette, fusele sans bavette.
  checkImport('minnow', report);
  checkImport('lipless', report);
  checkImport('minnow', report, true);
  {
    const base = clonePreset('minnow');
    checkImport('minnow trapu (curseurs)', report, false, { ...base, length: 70, thickness: 24, maxWidth: 19 });
    checkImport('minnow sans bavette (curseurs)', report, false, { ...base, hasBib: false, length: 130, maxWidth: 17, thickness: 20 });
  }
  {
    // Face avant creusee : non decoupable en tranches, refus nomme.
    const base = clonePreset('minnow');
    const cupped: LureParams = {
      ...base,
      hasBib: false,
      popperFace: { ...base.popperFace, enabled: true, diameter: 0.62, depth: 5, angle: 0, lipRadius: 0.8, offset: 0 },
      anatomy: base.anatomy ? { ...base.anatomy, noseCap: 0 } : null,
    };
    const mesh = importMesh('face-creusee.stl', familyStl(cupped));
    const body = createMeshBody('e2e-face-creusee', 'face-creusee.stl', mesh.body);
    registerMeshBody(body);
    const { params, report: made } = industrialise(mesh, body, cupped, { hollow: true, wall: 1.6 });
    if (params || !made.blocked.some((line) => /cuvette/.test(line))) {
      report.failures.push('import face creusee : la face creusee devait etre refusee et nommee');
    } else {
      report.lines.push('import face creusee           refus nomme : face avant creusee');
    }
  }

  // Jeu de test AK.6 et echecs nommes.
  for (const file of testFiles()) checkTestFile(file, report);
  checkImportErrors(report);

  // Projets v5 des familles retirees (module AH) : ils se rouvrent sous la
  // famille dont ils partagent l'attache, avec leurs cotes et leur anatomie
  // intactes. Le swimbait articule repasse le test de collision au degre.
  for (const item of v5Projects as { id: string; params: LureParams }[]) {
    const fail = (what: string) => report.failures.push(`projet ${item.id} : ${what}`);
    const params = sanitizeParams(JSON.parse(JSON.stringify(item.params)));
    if (params.shape !== 'minnow' && params.shape !== 'lipless') fail(`famille ${params.shape}`);
    if (params.length !== item.params.length || params.thickness !== item.params.thickness || params.maxWidth !== item.params.maxWidth) {
      fail('cotes modifiees a la reouverture');
    }
    if (JSON.stringify(params.anatomy) !== JSON.stringify(item.params.anatomy)) fail('anatomie modifiee a la reouverture');
    if (params.hasBib !== item.params.hasBib || params.articulation.enabled !== item.params.articulation.enabled) fail('bavette ou articulation perdue');
    const profile = createProfile(params);
    const geo = buildLure(params, DISPLAY_RESOLUTION);
    if (audit(geo.body).open) fail('corps ouvert');
    if (assemblyActive(params)) {
      const a = buildAssembly(profile, params, assemblyExport(params));
      if (audit(a.male).open || audit(a.female).open) fail('coques ouvertes');
      disposeAssembly(a);
    }
    let travel = '';
    if (geo.jointPlan) {
      const t = jointTravel(profile, geo.jointPlan);
      if (t.free + 1e-6 < t.wanted - 1) fail(`debattement ${t.free} deg sur ${t.wanted} : ${t.first?.part} contre ${t.first?.against}`);
      travel = ` · joint ${t.free}/${t.wanted} deg libres au pas de 1 deg`;
    }
    geo.dispose();
    report.lines.push(`projet ${item.id.padEnd(15)} rouvert en ${params.shape}, ${params.length} mm${travel}`);
  }

  // Projets des versions precedentes : ils s'ouvrent et restent fermes.
  for (const item of legacy as { id: string; params: unknown }[]) {
    const params = sanitizeParams(item.params);
    if (params.anatomy) report.failures.push(`projet ${item.id} : anatomie ajoutee a un ancien projet`);
    const geo = buildLure(params, DISPLAY_RESOLUTION);
    const body = audit(geo.body);
    if (body.open) report.failures.push(`projet ${item.id} : corps ouvert`);
    if (assemblyActive(params)) {
      const a = buildAssembly(createProfile(params), params);
      if (audit(a.male).open || audit(a.female).open) report.failures.push(`projet ${item.id} : coques ouvertes`);
    }
    geo.dispose();
    report.lines.push(`ancien projet ${item.id.padEnd(15)} ferme`);
  }
  return report;
}
