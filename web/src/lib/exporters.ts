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
import { buildLure, STEP_RESOLUTION, type LureGeometry } from './geometry';
import { buildStepFile } from './step';
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
export function printableParts(geo: LureGeometry): THREE.BufferGeometry[] {
  const parts = [geo.body, geo.bib, geo.tail].filter(Boolean) as THREE.BufferGeometry[];
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

export async function exportSTL(geo: LureGeometry, name: string): Promise<SaveOutcome> {
  const parts = printableParts(geo);
  const group = new THREE.Group();
  for (const part of parts) group.add(new THREE.Mesh(part));
  group.updateMatrixWorld(true);

  const data = new STLExporter().parse(group, { binary: true });
  group.clear();
  for (const part of parts) part.dispose();

  const base = slugify(name);
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
): Promise<SaveOutcome & { faces: number }> {
  const coarse = buildLure(params, STEP_RESOLUTION);
  try {
    const parts = printableParts(coarse);
    const step = buildStepFile(parts, slugify(name));
    for (const part of parts) part.dispose();
    const base = slugify(name);
    const outcome = await offerFile(
      `${base}.step`,
      step.text,
      'application/step',
      `${base}.step.txt`,
    );
    return { ...outcome, faces: step.faces };
  } finally {
    coarse.dispose();
  }
}

export function buildProjectFile(
  name: string,
  params: LureParams,
  palettes: SavedPalette[] = [],
): ProjectFile {
  return {
    format: 'sakuma-project',
    version: 1,
    name,
    savedAt: new Date().toISOString(),
    params,
    palettes,
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
  if (file.size > 2_000_000) {
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

  return {
    name: sanitizeName(data.name, file.name.replace(/\.json$/i, '')),
    params: sanitizeParams(data.params),
    palettes: sanitizePalettes(data.palettes),
  };
}
