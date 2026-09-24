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
import { ARCHETYPES } from '../../src/lib/archetypes';
import { SHAPE_PRESETS, clonePreset } from '../../src/lib/presets';
import { sanitizeParams } from '../../src/lib/validation';
import { createProfile } from '../../src/lib/profile';
import { buildLure, DISPLAY_RESOLUTION } from '../../src/lib/geometry';
import {
  assemblyActive,
  assemblyExport,
  assemblyPlans,
  buildAssembly,
} from '../../src/lib/assembly';
import { computePhysics } from '../../src/lib/physics';
import { runPrintChecks } from '../../src/lib/printCheck';
import { collectParts, type ExportKind } from '../../src/lib/exporters';
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

export function run(): Report {
  const report: Report = { failures: [], lines: [] };

  // Critere 1 : la bibliotheque ne contient que les sept familles.
  const ids = SHAPE_PRESETS.map((preset) => preset.id);
  const expected = ['minnow', 'crankbait', 'deepdiver', 'popper', 'stickbait', 'lipless', 'swimbait'];
  if (ids.join() !== expected.join()) report.failures.push(`bibliotheque : ${ids.join(', ')}`);

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
    // Critere 3 : a 100 mm, plus de 15 000 triangles.
    const scaled = { ...params, length: 100 };
    const small = buildLure(scaled, DISPLAY_RESOLUTION);
    const tri = audit(small.body).triangles;
    if (tri <= 15000) report.failures.push(`${preset.id} : ${tri} triangles a 100 mm`);
    small.dispose();
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
