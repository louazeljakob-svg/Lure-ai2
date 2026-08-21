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

export function exportSTL(geo: LureGeometry, name: string): void {
  const group = buildExportGroup(geo);
  const data = new STLExporter().parse(group, { binary: true });
  downloadBlob(new Blob([data], { type: 'model/stl' }), `${slugify(name)}.stl`);
  group.clear();
}

export function buildProjectFile(name: string, params: LureParams): ProjectFile {
  return {
    format: 'lureforge-project',
    version: 1,
    name,
    savedAt: new Date().toISOString(),
    params,
  };
}

export function exportProjectJSON(name: string, params: LureParams): void {
  const json = JSON.stringify(buildProjectFile(name, params), null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), `${slugify(name)}.json`);
}

export interface ImportedProject {
  name: string;
  params: LureParams;
}

/** Relit un .json precedemment telecharge et restaure l'etat de l'editeur. */
export async function readProjectFile(file: File): Promise<ImportedProject> {
  if (file.size > 2_000_000) {
    throw new Error('Fichier trop volumineux pour etre un projet LUREFORGE.');
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
  if (data.format !== 'lureforge-project') {
    throw new Error('Ce fichier n a pas ete produit par LUREFORGE.');
  }

  return {
    name: sanitizeName(data.name, file.name.replace(/\.json$/i, '')),
    params: sanitizeParams(data.params),
  };
}
