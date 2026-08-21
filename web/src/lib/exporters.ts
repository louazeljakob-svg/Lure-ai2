/**
 * Export & sauvegarde — 100 % navigateur.
 *
 * Aucun serveur, aucune base : les fichiers sont fabriques en memoire puis
 * remis a l'utilisateur via un Blob et un lien `download`. Ils atterrissent
 * directement dans son dossier de telechargements.
 */

import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import type { LureParams, ProjectFile } from '../types/lure';
import type { LureGeometry } from './geometry';
import { sanitizeName, sanitizeParams } from './validation';

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
 * Assemble les pieces dans l'orientation d'impression :
 * longueur sur X, largeur sur Y, hauteur sur Z (convention des trancheurs),
 * piece posee sur le plateau et centree en X / Y. L'echelle passe de
 * centimetres a millimetres, unite implicite du format STL.
 */
function buildExportGroup(geo: LureGeometry): THREE.Group {
  const group = new THREE.Group();
  for (const part of [geo.body, geo.bib, geo.tail]) {
    if (part) group.add(new THREE.Mesh(part));
  }
  group.scale.setScalar(10);
  group.rotation.x = Math.PI / 2;
  group.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  group.position.set(-center.x, -center.y, -box.min.z);
  group.updateMatrixWorld(true);
  return group;
}

export async function exportSTL(geo: LureGeometry, name: string): Promise<SaveOutcome> {
  const group = buildExportGroup(geo);
  const data = new STLExporter().parse(group, { binary: true });
  group.clear();
  const base = slugify(name);
  return offerFile(`${base}.stl`, data, 'model/stl', `${base}.stl.txt`);
}

export function buildProjectFile(name: string, params: LureParams): ProjectFile {
  return {
    format: 'sakuma-project',
    version: 1,
    name,
    savedAt: new Date().toISOString(),
    params,
  };
}

export async function exportProjectJSON(
  name: string,
  params: LureParams,
): Promise<SaveOutcome> {
  const json = JSON.stringify(buildProjectFile(name, params), null, 2);
  return offerFile(`${slugify(name)}.json`, json, 'application/json');
}

export interface ImportedProject {
  name: string;
  params: LureParams;
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
  };
}
