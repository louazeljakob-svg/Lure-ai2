/** Gestion des creations de la session : renommer, dupliquer, supprimer. */

import { useState } from 'react';
import type { Project } from '../types/lure';
import { getMaterial } from '../lib/materials';
import { LureSilhouette } from './LureSilhouette';

interface Props {
  projects: Project[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
}

const formatDate = (value: number) =>
  new Date(value).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export function ProjectsPanel({
  projects,
  activeId,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onExport,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div className="panel__body">
      <p className="fieldset__hint" style={{ marginTop: 14 }}>
        Ces projets vivent dans l onglet du navigateur, le temps de la session. Pour les
        conserver, telechargez-les en JSON depuis le bloc d export.
      </p>

      {projects.length === 0 ? (
        <p className="empty">
          Aucun projet en memoire. Utilisez « Ajouter aux projets » pour figer la version en
          cours.
        </p>
      ) : (
        <ul className="project-list">
          {projects.map((project) => (
            <li
              className={project.id === activeId ? 'project project--active' : 'project'}
              key={project.id}
            >
              <div className="project__figure">
                <LureSilhouette params={project.params} height={54} decorative />
              </div>
              <div>
                {editingId === project.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      onRename(project.id, draft);
                      setEditingId(null);
                    }}
                  >
                    <label className="sr-only" htmlFor={`rename-${project.id}`}>
                      Nouveau nom du projet
                    </label>
                    <input
                      id={`rename-${project.id}`}
                      type="text"
                      value={draft}
                      maxLength={60}
                      autoFocus
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    <div className="project__actions" style={{ marginTop: 6 }}>
                      <button type="submit" className="btn btn--sm btn--primary">
                        Valider
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        onClick={() => setEditingId(null)}
                      >
                        Annuler
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="project__name">{project.name}</div>
                    <div className="project__meta">
                      {project.params.length.toFixed(0)} mm ·{' '}
                      {getMaterial(project.params.material).label} ·{' '}
                      {formatDate(project.updatedAt)}
                    </div>
                    <div className="project__actions">
                      <button
                        type="button"
                        className="btn btn--sm btn--primary"
                        onClick={() => onOpen(project.id)}
                      >
                        Ouvrir
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => {
                          setEditingId(project.id);
                          setDraft(project.name);
                        }}
                      >
                        Renommer
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => onDuplicate(project.id)}
                      >
                        Dupliquer
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => onExport(project.id)}
                      >
                        JSON
                      </button>
                      {confirmId === project.id ? (
                        <button
                          type="button"
                          className="btn btn--sm btn--primary"
                          onClick={() => {
                            onDelete(project.id);
                            setConfirmId(null);
                          }}
                        >
                          Confirmer ?
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost btn--danger"
                          onClick={() => setConfirmId(project.id)}
                        >
                          Supprimer
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
