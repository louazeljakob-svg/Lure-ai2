/**
 * Taches de l'import (module AK) : lecture, reparations, mise en place, peau,
 * banc d'essai et industrialisation.
 *
 * Ce module ne touche pas au DOM : il tourne tel quel dans le fil de calcul
 * (`importWorker.ts`) et, a defaut de fil, sur le fil d'affichage. Il garde
 * le dernier maillage lu : le banc d'essai et l'industrialisation partent de
 * lui sans le recopier.
 */

import type { LureParams, WaterId } from '../types/lure';
import { bibAllowance, ImportError, importMesh, type ImportedMesh, type ImportOptions } from './importMesh';
import { createMeshBody, registerMeshBody, type MeshBody } from './meshBody';
import {
  industrialise,
  runBench,
  type BenchResult,
  type IndustrialOptions,
  type IndustrialReport,
} from './industrialise';

export type ImportRequest =
  | { type: 'ping'; id: number }
  | { type: 'import'; id: number; name: string; data: ArrayBuffer; options: ImportOptions; bodyId: string }
  | { type: 'bench'; id: number; current: Pick<LureParams, 'material' | 'infill' | 'print'>; water: WaterId }
  | { type: 'industrialise'; id: number; current: Pick<LureParams, 'material' | 'infill' | 'print'>; options: IndustrialOptions };

export type ImportReply =
  | { type: 'pong'; id: number }
  | { type: 'progress'; id: number; stage: string; fraction: number }
  | { type: 'imported'; id: number; mesh: ImportedMesh; body: MeshBody; ms: number }
  | { type: 'bench'; id: number; bench: BenchResult; ms: number }
  | { type: 'industrialised'; id: number; params: LureParams | null; report: IndustrialReport; ms: number }
  | { type: 'error'; id: number; message: string; named: boolean };

/** Dernier maillage lu, et son corps. */
const state: { mesh: ImportedMesh | null; body: MeshBody | null } = { mesh: null, body: null };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Traite une demande et poste la reponse. Toute erreur est rendue avec son
 * message : un import qui echoue ne se tait jamais.
 */
export function handleImportRequest(request: ImportRequest, post: (reply: ImportReply) => void): void {
  const started = now();
  try {
    switch (request.type) {
      case 'ping':
        post({ type: 'pong', id: request.id });
        return;
      case 'import': {
        const progress = (stage: string, fraction: number) => post({ type: 'progress', id: request.id, stage, fraction });
        const mesh = importMesh(request.name, request.data, request.options, progress);
        progress('Peau : tranches et rayons', 0);
        const body = createMeshBody(request.bodyId, request.name, mesh.body, null, bibAllowance(mesh), (fraction) =>
          progress('Peau : tranches et rayons', fraction),
        );
        registerMeshBody(body);
        state.mesh = mesh;
        state.body = body;
        post({ type: 'imported', id: request.id, mesh, body, ms: now() - started });
        return;
      }
      case 'bench': {
        if (!state.mesh || !state.body) throw new Error('Aucun maillage lu : importez un fichier d abord.');
        post({ type: 'bench', id: request.id, bench: runBench(state.mesh, state.body, request.current, request.water), ms: now() - started });
        return;
      }
      case 'industrialise': {
        if (!state.mesh || !state.body) throw new Error('Aucun maillage lu : importez un fichier d abord.');
        const result = industrialise(state.mesh, state.body, request.current, request.options);
        post({ type: 'industrialised', id: request.id, params: result.params, report: result.report, ms: now() - started });
        return;
      }
    }
  } catch (error) {
    post({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
      named: error instanceof ImportError,
    });
  }
}
