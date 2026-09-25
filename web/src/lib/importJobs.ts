/**
 * Client du fil de calcul de l'import (module AK.2).
 *
 * La lecture, la reparation, la peau, le banc d'essai et l'industrialisation
 * partent dans un Web Worker : l'interface reste vivante et la barre de
 * progression avance. Si le navigateur refuse le fil (politique de securite
 * de la page hote), les memes taches tournent sur le fil d'affichage — plus
 * lentement a l'oeil, mais avec le meme resultat.
 */

import ImportWorker from './importWorker?worker&inline';
import { handleImportRequest, type ImportReply, type ImportRequest } from './importTasks';
import type { ImportedMesh, ImportOptions } from './importMesh';
import { registerMeshBody, type MeshBody } from './meshBody';
import type { BenchResult, IndustrialOptions, IndustrialReport } from './industrialise';
import type { LureParams, WaterId } from '../types/lure';

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
type Call = WithoutId<ImportRequest>;
export type Progress = (stage: string, fraction: number) => void;

/** Un import remplace par un autre avant d'avoir abouti : a ignorer. */
export class Superseded extends Error {
  constructor() {
    super('Import remplace par un plus recent.');
  }
}

/**
 * Part de la barre occupee par chaque etape, calee sur les temps mesures
 * pour un fichier de 175 000 facettes.
 */
const STAGES: [RegExp, number, number][] = [
  [/^Lecture/, 0, 0.25],
  [/^Soudure/, 0.25, 0.35],
  [/^Reparations/, 0.35, 0.5],
  [/face de joint/, 0.5, 0.52],
  [/auto-intersections/, 0.52, 0.7],
  [/^Orientation/, 0.7, 0.74],
  [/^Pieces/, 0.74, 0.78],
  [/^Peau/, 0.78, 1],
];

/** Progression globale, de 0 a 1, a partir de l'etape en cours. */
export function overallProgress(stage: string, fraction: number): number {
  const entry = STAGES.find(([pattern]) => pattern.test(stage));
  if (!entry) return 0;
  const [, from, to] = entry;
  return from + (to - from) * Math.min(Math.max(fraction, 0), 1);
}

interface Pending {
  resolve: (reply: ImportReply) => void;
  reject: (error: Error) => void;
  onProgress?: Progress;
  kind: ImportRequest['type'];
}

class Runner {
  private worker: Worker | null = null;
  private mode: Promise<'worker' | 'main'> | null = null;
  private next = 1;
  private pending = new Map<number, Pending>();

  /** Fil de calcul disponible ? Verifie une fois par un aller-retour. */
  private ready(): Promise<'worker' | 'main'> {
    if (this.mode) return this.mode;
    this.mode = new Promise((resolve) => {
      let worker: Worker;
      try {
        worker = new ImportWorker({ name: 'sakuma-import' });
      } catch {
        resolve('main');
        return;
      }
      const id = this.next++;
      const timer = window.setTimeout(() => settle(false), 5000);
      const settle = (ok: boolean) => {
        window.clearTimeout(timer);
        this.pending.delete(id);
        if (ok) {
          this.worker = worker;
          resolve('worker');
        } else {
          worker.terminate();
          resolve('main');
        }
      };
      this.pending.set(id, { kind: 'ping', resolve: () => settle(true), reject: () => settle(false) });
      worker.onmessage = (event: MessageEvent<ImportReply>) => this.receive(event.data);
      worker.onerror = (event) => {
        event.preventDefault();
        this.crash(event.message);
      };
      worker.postMessage({ type: 'ping', id } satisfies ImportRequest);
    });
    return this.mode;
  }

  private receive(reply: ImportReply) {
    const entry = this.pending.get(reply.id);
    if (!entry) return;
    if (reply.type === 'progress') {
      entry.onProgress?.(reply.stage, reply.fraction);
      return;
    }
    this.pending.delete(reply.id);
    if (reply.type === 'error') entry.reject(new Error(reply.message));
    else entry.resolve(reply);
  }

  /** Le fil s'est arrete (memoire, erreur) : tout ce qui attendait echoue, avec la cause. */
  private crash(message: string) {
    const cause = message ? `Le calcul s est arrete : ${message}` : 'Le calcul s est arrete (memoire insuffisante ?).';
    for (const entry of this.pending.values()) entry.reject(new Error(cause));
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.mode = null;
  }

  async call(request: Call, onProgress?: Progress): Promise<ImportReply> {
    const mode = await this.ready();
    const id = this.next++;
    const full = { ...request, id } as ImportRequest;
    return new Promise<ImportReply>((resolve, reject) => {
      this.pending.set(id, { kind: full.type, resolve, reject, onProgress });
      if (mode === 'worker' && this.worker) {
        this.worker.postMessage(full);
      } else {
        // Sur le fil d'affichage : on laisse d'abord peindre l'etat « en cours ».
        window.setTimeout(() => handleImportRequest(full, (reply) => this.receive(reply)), 30);
      }
    });
  }

  /**
   * Un nouvel import rend caduc celui qui tourne encore : le fil est relance
   * plutot que d'attendre la fin d'un calcul dont personne ne veut plus.
   */
  supersede() {
    const stale = [...this.pending.entries()].filter(([, entry]) => entry.kind !== 'ping');
    if (stale.length === 0) return;
    for (const [id, entry] of stale) {
      this.pending.delete(id);
      entry.reject(new Superseded());
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.mode = null;
    }
  }

  /** Mode effectif, pour l'affichage. */
  async where(): Promise<'worker' | 'main'> {
    return this.ready();
  }
}

const runner = new Runner();

export function importInBackground(
  name: string,
  data: ArrayBuffer,
  options: ImportOptions,
  onProgress?: Progress,
): Promise<{ mesh: ImportedMesh; body: MeshBody; ms: number }> {
  runner.supersede();
  const bodyId = `maillage-${Date.now()}`;
  // Copie : la source reste disponible pour relire avec d'autres reglages.
  return runner.call({ type: 'import', name, data: data.slice(0), options, bodyId }, onProgress).then((reply) => {
    if (reply.type !== 'imported') throw new Error('Reponse inattendue du calcul d import.');
    registerMeshBody(reply.body);
    return { mesh: reply.mesh, body: reply.body, ms: reply.ms };
  });
}

export function benchInBackground(
  current: Pick<LureParams, 'material' | 'infill' | 'print'>,
  water: WaterId,
): Promise<{ bench: BenchResult; ms: number }> {
  return runner.call({ type: 'bench', current, water }).then((reply) => {
    if (reply.type !== 'bench') throw new Error('Reponse inattendue du banc d essai.');
    return { bench: reply.bench, ms: reply.ms };
  });
}

export function industrialiseInBackground(
  current: Pick<LureParams, 'material' | 'infill' | 'print'>,
  options: IndustrialOptions,
): Promise<{ params: LureParams | null; report: IndustrialReport; ms: number }> {
  return runner.call({ type: 'industrialise', current, options }).then((reply) => {
    if (reply.type !== 'industrialised') throw new Error('Reponse inattendue de l industrialisation.');
    return { params: reply.params, report: reply.report, ms: reply.ms };
  });
}

export function computeSite(): Promise<'worker' | 'main'> {
  return runner.where();
}
