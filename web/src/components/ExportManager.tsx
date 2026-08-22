/**
 * Export & sauvegarde. Tout est fabrique dans le navigateur : STL binaire
 * via STLExporter, projet JSON via Blob, rechargement par input file.
 * Aucun serveur, aucun compte, aucune donnee ne quitte la machine.
 */

import { useRef, useState } from 'react';
import type { LureParams } from '../types/lure';
import type { ExportKind } from '../lib/exporters';
import { Segmented } from './ui';
import type { LureGeometry } from '../lib/geometry';
import { getMaterial } from '../lib/materials';
import type { PhysicsResult } from '../lib/physics';

interface Props {
  name: string;
  onNameChange: (name: string) => void;
  params: LureParams;
  geo: LureGeometry;
  physics: PhysicsResult;
  onImport: (file: File) => void;
  onExportSTL: (kind: ExportKind) => void;
  onExportSTEP: (kind: ExportKind) => void;
  onExportJSON: () => void;
  onExportBill: (format: 'dxf' | 'svg') => void;
  onSaveSession: () => void;
  /** « Ajouter aux projets » ou « Mettre a jour » selon le projet actif. */
  saveLabel: string;
}

export function ExportManager({
  name,
  onNameChange,
  params,
  geo,
  physics,
  onImport,
  onExportSTL,
  onExportSTEP,
  onExportJSON,
  onExportBill,
  onSaveSession,
  saveLabel,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const material = getMaterial(params.material);
  const [kind, setKind] = useState<ExportKind>('assembly');
  const split = params.assembly.enabled;
  const piece: ExportKind = split ? kind : 'assembly';

  return (
    <div className="export-dock">
      <div className="export-summary" aria-label="Apercu imprimable">
        <div className="export-summary__cell export-summary__cell--wide">
          <span>Taille reelle imprimee</span>
          <b>
            {geo.bounds.length.toFixed(0)}&#215;{geo.bounds.height.toFixed(0)}&#215;
            {geo.bounds.width.toFixed(0)}
          </b>
          <em>mm</em>
        </div>
        <div className="export-summary__cell">
          <span>Poids imprime</span>
          <b>{physics.bodyMass.toFixed(1)}</b>
          <em>g de {material.label}</em>
        </div>
        <div className="export-summary__cell">
          <span>Remplissage</span>
          <b>{params.infill} %</b>
          <em>matiere deposee</em>
        </div>
      </div>

      {split ? (
        <Segmented
          label="Piece a exporter"
          value={piece}
          options={[
            { value: 'assembly' as ExportKind, label: 'Assemble' },
            { value: 'male' as ExportKind, label: 'Male' },
            { value: 'female' as ExportKind, label: 'Femelle' },
          ]}
          onChange={setKind}
        />
      ) : null}

      <div className="export-dock__name">
        <label className="sr-only" htmlFor="project-name">
          Nom du projet
        </label>
        <input
          id="project-name"
          type="text"
          value={name}
          maxLength={60}
          aria-label="Nom du projet"
          onChange={(event) => onNameChange(event.target.value)}
        />
        <button type="button" className="btn btn--primary" onClick={() => onExportSTL(piece)}>
          Exporter STL
        </button>
      </div>

      <div className="stack">
        <div className="export-dock__actions">
          <button
            type="button"
            className="btn btn--sm btn--dark"
            onClick={() => onExportSTEP(piece)}
          >
            Exporter STEP
          </button>
          <button type="button" className="btn btn--sm" onClick={onExportJSON}>
            Projet JSON
          </button>
          <button type="button" className="btn btn--sm" onClick={onSaveSession}>
            {saveLabel}
          </button>
          <button type="button" className="btn btn--sm" onClick={() => fileRef.current?.click()}>
            Recharger
          </button>
        </div>
        {params.hasBib && params.billMode === 'polycarbonate' ? (
          <div className="export-dock__actions">
            <button type="button" className="btn btn--sm" onClick={() => onExportBill('dxf')}>
              Gabarit DXF
            </button>
            <button type="button" className="btn btn--sm" onClick={() => onExportBill('svg')}>
              Gabarit SVG
            </button>
          </div>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="Recharger un projet JSON"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImport(file);
            // Permet de recharger deux fois de suite le meme fichier.
            event.target.value = '';
          }}
        />
      </div>
      <p className="control__hint">
        STL et STEP a l echelle 1:1 en millimetres, poses sur le plateau. Quincaillerie
        exclue des fichiers imprimes. Tout est genere dans le navigateur : rien n est
        envoye sur un serveur.
      </p>
    </div>
  );
}
