/** Ecran d'accueil : galerie des formes de base + projets de la session. */

import type { Project, ShapeId } from '../types/lure';
import { getMaterial } from '../lib/materials';
import { SHAPE_PRESETS } from '../lib/presets';
import { LureSilhouette } from './LureSilhouette';
import { ProjectsPanel } from './ProjectsPanel';

interface Props {
  onSelect: (shape: ShapeId) => void;
  projects: Project[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onImportClick: () => void;
}

export function ShapeGallery({
  onSelect,
  projects,
  activeId,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onExport,
  onImportClick,
}: Props) {
  return (
    <main className="gallery" id="contenu">
      <section className="hero">
        <div>
          <span className="hero__kicker">Atelier de conception 3D</span>
          <h1>Dessinez le leurre, la physique suit.</h1>
          <p>
            Choisissez une forme de base, modelez-la au slider, lestez-la, puis lisez
            immediatement si elle flotte, suspend ou coule — et comment elle nagera. Quand le
            dessin vous convient, exportez le STL et lancez l impression.
          </p>
        </div>
        <div className="hero__steps">
          <div className="hero__step">
            <span>1</span>
            <p>
              <strong>Choisir une forme</strong> parmi les sept gabarits ci-dessous. Tout est
              parametrique : rien n est fige.
            </p>
          </div>
          <div className="hero__step">
            <span>2</span>
            <p>
              <strong>Modeler et lester</strong> pendant que le volume, le centre de gravite et
              l assiette se recalculent en direct.
            </p>
          </div>
          <div className="hero__step">
            <span>3</span>
            <p>
              <strong>Exporter</strong> le STL a l echelle 1:1 et le projet JSON, directement
              dans vos telechargements.
            </p>
          </div>
        </div>
      </section>

      <div className="section-head">
        <h2>Formes de base</h2>
        <span className="section-head__rule" />
        <span className="section-head__hint">{SHAPE_PRESETS.length} gabarits parametriques</span>
      </div>

      <div className="shape-grid">
        {SHAPE_PRESETS.map((preset, index) => (
          <button
            type="button"
            className="shape-card"
            key={preset.id}
            onClick={() => onSelect(preset.id)}
          >
            <div className="shape-card__figure">
              <span className="shape-card__index" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <LureSilhouette params={preset.params} height={112} decorative />
            </div>
            <div className="shape-card__body">
              <div className="shape-card__title">
                <h3>{preset.label}</h3>
              </div>
              <div className="shape-card__tagline">{preset.tagline}</div>
              <p>{preset.description}</p>
              <div className="shape-card__meta">
                <span className="tag">{preset.params.length} mm</span>
                <span className="tag">{getMaterial(preset.params.material).label}</span>
                <span className="tag">{preset.params.hasBib ? 'Bavette' : 'Sans bavette'}</span>
                {preset.params.ballasts.length > 0 ? (
                  <span className="tag">
                    {preset.params.ballasts
                      .reduce((sum, item) => sum + item.mass, 0)
                      .toFixed(1)}{' '}
                    g de lest
                  </span>
                ) : null}
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="section-head" style={{ marginTop: 40 }}>
        <h2>Projets de la session</h2>
        <span className="section-head__rule" />
        <button type="button" className="btn btn--sm" onClick={onImportClick}>
          Recharger un JSON
        </button>
      </div>

      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          padding: '0 16px 18px',
        }}
      >
        <ProjectsPanel
          projects={projects}
          activeId={activeId}
          onOpen={onOpen}
          onRename={onRename}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onExport={onExport}
        />
      </div>
    </main>
  );
}
