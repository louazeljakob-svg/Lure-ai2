/**
 * Export & sauvegarde — 100 % navigateur.
 *
 * Aucun serveur, aucune base : les fichiers sont fabriques en memoire puis
 * remis a l'utilisateur via un Blob et un lien `download`. Ils atterrissent
 * directement dans son dossier de telechargements.
 */

import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import type { LureParams, ProjectFile, SavedPalette } from '../types/lure';
import {
  buildBib,
  buildLure,
  buildTailFin,
  printedBodies,
  DISPLAY_RESOLUTION,
  STEP_RESOLUTION,
  type LureGeometry,
  type ShellPart,
} from './geometry';
import { buildInsert, buildSoftTail, measureCavity, softTailBlocker } from './insert';
import { assemblyActive } from './assembly';
import {
  ASSEMBLY_STEP,
  assemblyExport,
  billPlanFor,
  buildAssembly,
} from './assembly';
import { bibOutline, bibShape, billHalfWidthAt, billSize } from './billTemplate';
import { createProfile } from './profile';
import { buildRetentionPins } from './articulation';
import { buildStepFile } from './step';
import { encodeMeshBody, meshBodyOf, restoreMeshBody } from './meshBody';

/** Piece a exporter : ensemble assemble, ou l'une des deux coques. */
export type ExportKind = 'assembly' | 'male' | 'female' | 'insert' | 'softTail' | 'bib';

export const EXPORT_LABEL: Record<ExportKind, string> = {
  assembly: 'assemble',
  bib: 'bavette',
  insert: 'insert',
  softTail: 'queue-souple',
  male: 'male',
  female: 'femelle',
};

/**
 * Reunit les pieces a exporter pour une variante donnee.
 *
 * `owned` liste les geometries creees pour l'occasion : l'appelant doit les
 * liberer une fois la copie transformee produite.
 */
export function collectParts(
  params: LureParams,
  geo: LureGeometry,
  kind: ExportKind,
  coarse: boolean,
): { parts: THREE.BufferGeometry[]; owned: THREE.BufferGeometry[] } {
  const owned: THREE.BufferGeometry[] = [];
  const parts: THREE.BufferGeometry[] = [];

  // L'insert sort SEUL, sous son propre nom : c'est une piece d'un autre
  // materiau, souvent decoupee plutot qu'imprimee, et la fusionner au corps
  // par megarde donnerait un fichier inutilisable.
  if (kind === 'softTail') {
    const profile = createProfile(params);
    if (!softTailBlocker(profile, params)) {
      const part = buildSoftTail(profile, params);
      if (part) {
        owned.push(part.geometry);
        parts.push(part.geometry);
      }
    }
    return { parts, owned };
  }

  if (kind === 'insert') {
    const profile = createProfile(params);
    const cavity = measureCavity(profile, params, { lengthSegments: 96, radialSegments: 48 });
    const part = buildInsert(profile, params, cavity);
    if (part) {
      owned.push(part.geometry);
      parts.push(part.geometry);
    }
    return { parts, owned };
  }

  // La bavette polycarbonate n'est jamais exportee : c'est une plaque
  // decoupee a part, son modele 3D n'est qu'une aide au placement.
  const printedBib = geo.bib && !geo.bibIsGhost ? geo.bib : null;

  // Bavette imprimee (module AE) : une piece STL a part entiere, la meme
  // plaque que la polycarbonate, posee a son emplacement dans la fente.
  if (kind === 'bib') {
    if (!printedBib) return { parts, owned };
    const profile = createProfile(params);
    const plan = assemblyActive(params) ? billPlanFor(profile, params) : null;
    const bib = buildBib(profile, params, 'full', plan?.root ?? null);
    owned.push(bib);
    parts.push(bib);
    return { parts, owned };
  }

  // Combinaison bloquee : on sort la piece entiere plutot que deux coques
  // qui ne se refermeraient pas.
  if (kind === 'assembly' || !assemblyActive(params)) {
    // Un leurre articule sort en deux segments : ce sont eux les pieces a
    // imprimer, avec leurs logements de quincaillerie deja creuses.
    parts.push(...printedBodies(geo));
    if (printedBib) parts.push(printedBib);
    if (geo.tail) parts.push(geo.tail);
    return { parts, owned };
  }

  const profile = createProfile(params);
  const assembly = buildAssembly(profile, params, coarse ? ASSEMBLY_STEP : assemblyExport(params));
  owned.push(assembly.male, assembly.female, ...assembly.pins.map((pin) => pin.geometry));
  if (assembly.socketPreview) owned.push(assembly.socketPreview);
  if (assembly.tenons) owned.push(assembly.tenons);

  // Les barreaux d'assemblage sont imprimes A PART, poses a plat a cote des
  // coques : ils accompagnent donc la piece male, une seule fois.
  if (assembly.dowelPins) owned.push(assembly.dowelPins);

  if (kind === 'male') {
    parts.push(assembly.male);
    if (assembly.tenons) parts.push(assembly.tenons);
    if (assembly.dowelPins) parts.push(assembly.dowelPins);
    // Leurre articule : le cylindre de retention, imprime a part, accompagne
    // la coque male, a la hauteur de portee reellement creusee.
    const retention = assembly.jointPlan ? buildRetentionPins(assembly.jointPlan) : null;
    if (retention) {
      owned.push(retention);
      parts.push(retention);
    }
  } else {
    parts.push(assembly.female);
  }

  // Bavette et caudale sont des plaques minces qui vivent dans le plan de
  // joint : elles se partagent en deux quand le joint est vertical. Sur un
  // joint incline, les couper proprement demanderait une decoupe hors plan :
  // elles restent alors solidaires de la coque male.
  const vertical = params.assembly.planeAngle < 5;
  const share: ShellPart = vertical ? kind : 'full';
  if (vertical || kind === 'male') {
    // Une bavette imprimee logee dans sa fente sort a part (piece « bavette ») :
    // elle se prend en sandwich au montage. Sans fente, elle reste solidaire
    // des coques, comme avant.
    if (printedBib && !assembly.billPlan) {
      const bib = buildBib(profile, params, share);
      owned.push(bib);
      parts.push(bib);
    }
    if (profile.hasFin) {
      const tail = buildTailFin(profile, params, share);
      owned.push(tail);
      parts.push(tail);
    }
  }

  return { parts, owned };
}
import { sanitizeName, sanitizeParams, sanitizePalettes } from './validation';

export const slugify = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48) || 'leurre';

/**
 * Deux environnements, deux chemins de remise de fichier :
 *
 * - page ouverte en local (double-clic sur le .html, serveur de dev) :
 *   telechargement navigateur natif via un Blob et un lien `download` ;
 * - page publiee comme artefact claude.ai : le bac a sable neutralise les
 *   liens `download`, il faut passer par la capacite « downloads » de
 *   l'hote, qui demande confirmation au visiteur.
 *
 * `offerFile` choisit automatiquement le bon chemin.
 */

interface DownloadsCapability {
  save: (request: { filename: string; data: Blob }) => Promise<unknown>;
}

/** Resout la capacite d'enregistrement de l'hote, ou `null` hors artefact. */
async function hostDownloads(): Promise<DownloadsCapability | null> {
  try {
    const host = (window as unknown as { claude?: { use?: (name: string) => Promise<unknown> } })
      .claude;
    // Optional chaining volontaire : le meme bundle tourne hors artefact,
    // ou `window.claude` n'existe pas du tout.
    if (typeof host?.use !== 'function') return null;
    const namespace = await host.use('downloads');
    return (namespace as DownloadsCapability | null) ?? null;
  } catch {
    return null;
  }
}

export interface SaveOutcome {
  /** Nom finalement propose si l'extension d'origine a ete refusee. */
  renamedTo?: string;
  /** Vrai si le visiteur a refuse l'enregistrement. */
  cancelled?: boolean;
}

async function offerFile(
  filename: string,
  data: BlobPart,
  mime: string,
  fallbackFilename?: string,
): Promise<SaveOutcome> {
  // Toujours encapsule dans un Blob : contrairement a un ArrayBuffer, il est
  // copie et non transfere, donc reutilisable si une seconde tentative
  // s'avere necessaire.
  const blob = new Blob([data], { type: mime });

  const downloads = await hostDownloads();
  if (!downloads) {
    downloadBlob(blob, filename);
    return {};
  }

  try {
    await downloads.save({ filename, data: blob });
    return {};
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === 'declined') return { cancelled: true };
    if (
      fallbackFilename &&
      (code === 'rejected_extension' || code === 'extension_not_enabled')
    ) {
      // L'hote n'accepte qu'une liste d'extensions : on repropose le meme
      // fichier sous une extension autorisee, a renommer apres coup.
      await downloads.save({ filename: fallbackFilename, data: blob });
      return { renamedTo: fallbackFilename };
    }
    throw error;
  }
}

/** Declenche un telechargement navigateur natif. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Laisse au navigateur le temps de lire le blob avant de le liberer.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Pieces reellement imprimees, mises en position d'impression : longueur sur
 * X, largeur sur Y, hauteur sur Z (convention des trancheurs), piece posee sur
 * le plateau et centree en X / Y, a l'echelle du millimetre.
 *
 * L'agrafe est volontairement exclue : c'est de la quincaillerie du commerce,
 * elle pese dans la simulation mais ne s'imprime pas.
 *
 * Les geometries retournees sont des copies transformees : STL et STEP
 * partagent ainsi exactement la meme mise en position.
 */
export function printableParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry[] {
  const place = new THREE.Matrix4()
    .makeRotationX(Math.PI / 2)
    .premultiply(new THREE.Matrix4().makeScale(10, 10, 10));

  const clones = parts.map((part) => part.clone().applyMatrix4(place));

  const box = new THREE.Box3();
  for (const clone of clones) {
    clone.computeBoundingBox();
    if (clone.boundingBox) box.union(clone.boundingBox);
  }
  const center = box.getCenter(new THREE.Vector3());
  const offset = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -box.min.z);
  for (const clone of clones) clone.applyMatrix4(offset);

  return clones;
}

/**
 * Geometrie d'export : toujours a la resolution pleine, ecailles cuites,
 * quelle que soit la qualite d'apercu choisie dans l'editeur. `built` est a
 * liberer par l'appelant quand elle a ete construite pour l'occasion.
 */
function exportSource(params: LureParams, geo: LureGeometry): { source: LureGeometry; built: LureGeometry | null } {
  const bake = params.scales.enabled && !params.scales.baked;
  if (!bake && params.print.preview === 'medium') return { source: geo, built: null };
  const profile = createProfile(params);
  const plan = assemblyActive(params) ? billPlanFor(profile, params) : null;
  const built = buildLure(params, DISPLAY_RESOLUTION, plan?.root ?? null, params.scales.enabled);
  return { source: built, built };
}

/**
 * Pieces du fichier STL, posees pour l'impression. C'est la meme fonction
 * qui ecrit le fichier et qui compte ses triangles : le compteur affiche ne
 * peut pas diverger de ce qui sort (module AI).
 */
function stlParts(params: LureParams, geo: LureGeometry, kind: ExportKind): THREE.BufferGeometry[] {
  const { source, built } = exportSource(params, geo);
  const { parts, owned } = collectParts(params, source, kind, false);
  const placed = printableParts(parts);
  for (const part of owned) part.dispose();
  built?.dispose();
  return placed;
}

const triangleCount = (geometry: THREE.BufferGeometry) =>
  (geometry.getIndex() ? geometry.getIndex()!.count : geometry.getAttribute('position').count) / 3;

/** Nombre de triangles du fichier STL exporte pour cette piece. */
export function countExportTriangles(params: LureParams, geo: LureGeometry, kind: ExportKind = 'assembly'): number {
  const placed = stlParts(params, geo, kind);
  const total = placed.reduce((sum, part) => sum + triangleCount(part), 0);
  for (const part of placed) part.dispose();
  return total;
}

/** Fichier STL binaire de la piece, en memoire. */
export function stlBytes(params: LureParams, geo: LureGeometry, kind: ExportKind = 'assembly'): DataView<ArrayBuffer> {
  const placed = stlParts(params, geo, kind);
  const group = new THREE.Group();
  for (const part of placed) group.add(new THREE.Mesh(part));
  group.updateMatrixWorld(true);
  const data = new STLExporter().parse(group, { binary: true }) as DataView<ArrayBuffer>;
  group.clear();
  for (const part of placed) part.dispose();
  return data;
}

export async function exportSTL(
  params: LureParams,
  geo: LureGeometry,
  name: string,
  kind: ExportKind = 'assembly',
): Promise<SaveOutcome> {
  // Le relief des ecailles est CUIT a l'export, meme si l'editeur montre une
  // normal map, et la resolution est toujours la pleine : ce qui part a
  // l'impression ne depend pas du confort d'apercu.
  const data = stlBytes(params, geo, kind);
  const suffix = kind === 'assembly' ? '' : `-${EXPORT_LABEL[kind]}`;
  const base = `${slugify(name)}${suffix}`;
  return offerFile(`${base}.stl`, data, 'model/stl', `${base}.stl.txt`);
}

/**
 * Export STEP (AP214). La geometrie est regeneree a une resolution reduite :
 * chaque facette coute une vingtaine d'entites STEP, un maillage d'affichage
 * produirait un fichier de plusieurs dizaines de mega-octets.
 */
export async function exportSTEP(
  params: LureParams,
  name: string,
  kind: ExportKind = 'assembly',
): Promise<SaveOutcome & { faces: number; solid: boolean }> {
  const coarse = buildLure(params, STEP_RESOLUTION, null, false, false);
  const { parts, owned } = collectParts(params, coarse, kind, true);
  const placed = printableParts(parts);
  try {
    const suffix = kind === 'assembly' ? '' : `-${EXPORT_LABEL[kind]}`;
    const base = `${slugify(name)}${suffix}`;
    const step = buildStepFile(placed, base);
    const outcome = await offerFile(
      `${base}.step`,
      step.text,
      'application/step',
      `${base}.step.txt`,
    );
    return { ...outcome, faces: step.faces, solid: step.solid };
  } finally {
    for (const part of placed) part.dispose();
    for (const part of owned) part.dispose();
    coarse.dispose();
  }
}

/**
 * Gabarit plat de la bavette a decouper dans du polycarbonate, aux cotes
 * reelles en millimetres. DXF pour la CN, SVG pour la decoupe laser ou le
 * trace au cutter.
 */
export async function exportBillTemplate(
  params: LureParams,
  name: string,
  format: 'dxf' | 'svg',
): Promise<SaveOutcome> {
  const profile = createProfile(params);
  const outline = bibOutline(profile, params).map((point) => ({
    x: point.x * 10,
    y: point.y * 10,
  }));
  // Trait de reference : jusqu'ou la plaque s'enfonce dans la tete. C'est la
  // cote qui a servi a creuser la fente, donc les deux ne peuvent pas diverger.
  const plan = billPlanFor(profile, params);
  const shape = bibShape(profile, params);
  const insertion = plan
    ? {
        x: plan.insertion * 10,
        half: billHalfWidthAt(params, plan.insertion / Math.max(shape.length, 1e-6)) * 10,
      }
    : null;
  const base = `${slugify(name)}-bavette`;

  if (format === 'dxf') {
    const body = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', 'BAVETTE',
      '90', String(outline.length), '70', '1',
    ];
    for (const point of outline) {
      body.push('10', point.x.toFixed(4), '20', point.y.toFixed(4));
    }
    if (insertion) {
      body.push(
        '0', 'LWPOLYLINE', '8', 'INSERTION', '90', '2', '70', '0',
        '10', insertion.x.toFixed(4), '20', (-insertion.half).toFixed(4),
        '10', insertion.x.toFixed(4), '20', insertion.half.toFixed(4),
      );
    }
    body.push('0', 'ENDSEC', '0', 'EOF', '');
    return offerFile(`${base}.dxf`, body.join('\n'), 'image/vnd.dxf', `${base}.dxf.txt`);
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of outline) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  }
  const pad = 2;
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;
  const path = outline
    .map((point, i) => `${i === 0 ? 'M' : 'L'}${(point.x - minX + pad).toFixed(3)} ${(maxY - point.y + pad).toFixed(3)}`)
    .join(' ');
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(2)}mm" height="${height.toFixed(2)}mm" viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}">`,
    `<title>Bavette ${name} — ${(maxX - minX).toFixed(1)} x ${(maxY - minY).toFixed(1)} mm, epaisseur ${billSize(params).thickness.toFixed(1)} mm${insertion ? `, enfoncement ${insertion.x.toFixed(1)} mm` : ''}</title>`,
    `<path d="${path} Z" fill="none" stroke="#000000" stroke-width="0.2"/>`,
    insertion
      ? `<line x1="${(insertion.x - minX + pad).toFixed(3)}" y1="${(maxY - insertion.half - minY + pad).toFixed(3)}" x2="${(insertion.x - minX + pad).toFixed(3)}" y2="${(maxY + insertion.half - minY + pad).toFixed(3)}" stroke="#e30613" stroke-width="0.2" stroke-dasharray="1 1"/>`
      : '',
    '</svg>',
    '',
  ].join('\n');
  return offerFile(`${base}.svg`, svg, 'image/svg+xml', `${base}.svg.txt`);
}

export function buildProjectFile(
  name: string,
  params: LureParams,
  palettes: SavedPalette[] = [],
): ProjectFile {
  const mesh = meshBodyOf(params);
  return {
    format: 'sakuma-project',
    version: 1,
    name,
    savedAt: new Date().toISOString(),
    params,
    palettes,
    ...(mesh ? { meshes: [encodeMeshBody(mesh)] } : {}),
  };
}

export async function exportProjectJSON(
  name: string,
  params: LureParams,
  palettes: SavedPalette[] = [],
): Promise<SaveOutcome> {
  const json = JSON.stringify(buildProjectFile(name, params, palettes), null, 2);
  return offerFile(`${slugify(name)}.json`, json, 'application/json');
}

export interface ImportedProject {
  name: string;
  params: LureParams;
  /** Bibliotheque de livrees embarquee dans le fichier. */
  palettes: SavedPalette[];
}

/** Relit un .json precedemment telecharge et restaure l'etat de l'editeur. */
export async function readProjectFile(file: File): Promise<ImportedProject> {
  // Un projet qui embarque un maillage importe peut peser quelques Mo.
  if (file.size > 60_000_000) {
    throw new Error('Fichier trop volumineux pour etre un projet SAKUMA.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('Fichier illisible : ce n est pas un JSON valide.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Fichier illisible : contenu inattendu.');
  }

  const data = parsed as Partial<ProjectFile>;
  // 'lureforge-project' : nom de format de la premiere version, encore accepte.
  if (data.format !== 'sakuma-project' && data.format !== 'lureforge-project') {
    throw new Error('Ce fichier n a pas ete produit par SAKUMA.');
  }

  // Les maillages embarques s'enregistrent AVANT la relecture des
  // parametres : le corps du projet les retrouve par leur identifiant.
  const meshes = Array.isArray(data.meshes) ? data.meshes.map(restoreMeshBody) : [];
  const params = sanitizeParams(data.params);
  if (params.meshBody && !meshes.some((mesh) => mesh?.id === params.meshBody?.id)) {
    throw new Error(
      'Ce projet s appuie sur un maillage importe qui n est pas dans le fichier : reimportez le STL, puis industrialisez-le.',
    );
  }
  return {
    name: sanitizeName(data.name, file.name.replace(/\.json$/i, '')),
    params,
    palettes: sanitizePalettes(data.palettes),
  };
}
