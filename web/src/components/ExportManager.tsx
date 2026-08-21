/**
 * Export & sauvegarde. Tout est fabrique dans le navigateur : STL binaire
 * via STLExporter, projet JSON via Blob, rechargement par input file.
 * Aucun serveur, aucun compte, aucune donnee ne quitte la machine.
 */

import { useRef } from 'react';
import type { LureParams } from '../types/lure';
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
  onExportSTL: () => void;
  onExportSTEP: () => void;
  onExportJSON: () => void;
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
  onSaveSession,
  saveLabel,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const material = getMaterial(params.material);

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
        <button type="button" className="btn btn--primary" onClick={onExportSTL}>
          Exporter STL
        </button>
      </div>

      <div className="stack">
        <div className="export-dock__actions">
          <button type="button" className="btn btn--sm btn--dark" onClick={onExportSTEP}>
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
        STL et STEP a l echelle 1:1 en millimetres, poses sur le plateau, agrafe exclue.
        Tout est genere dans le navigateur : rien n est envoye sur un serveur.
      </p>
    </div>
  );
}
