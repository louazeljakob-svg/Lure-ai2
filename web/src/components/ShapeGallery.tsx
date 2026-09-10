/** Ecran d'accueil : galerie des formes de base + projets de la session. */

import type { Project, ShapeId } from '../types/lure';
import { getMaterial } from '../lib/materials';
import { GUIDED_TEMPLATES } from '../lib/templates';
import { SHAPE_PRESETS } from '../lib/presets';
import { LureSilhouette } from './LureSilhouette';
import { ProjectsPanel } from './ProjectsPanel';

interface Props {
  onSelect: (shape: ShapeId) => void;
  /** Ouvre un modele guide : un leurre complet, deja regle. */
  onTemplate: (id: string) => void;
  projects: Project[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onImportClick: () => void;
}

/** Silhouette en deux segments : la carte doit montrer ou tombe le joint. */
function TemplateFigure({ headShare }: { headShare: number }) {
  const cut = 6 + (headShare / 100) * 88;
  return (
    <svg viewBox="0 0 100 34" width="100%" height="72" role="img" aria-label="Silhouette articulee">
      <path
        d={`M6 17 Q ${cut * 0.45} 3 ${cut - 1.4} 8 L ${cut - 1.4} 26 Q ${cut * 0.45} 31 6 17 Z`}
        fill="#101114"
        opacity="0.82"
      />
      <path
        d={`M ${cut + 1.4} 8 Q ${cut + (94 - cut) * 0.5} 4 94 15 L 94 19 Q ${cut + (94 - cut) * 0.5} 30 ${cut + 1.4} 26 Z`}
        fill="#101114"
        opacity="0.55"
      />
      <line x1={cut} y1="2" x2={cut} y2="32" stroke="#e30613" strokeWidth="1.4" strokeDasharray="3 2" />
      <circle cx={cut} cy="17" r="2.1" fill="#e30613" />
    </svg>
  );
}

export function ShapeGallery({
  onSelect,
  onTemplate,
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
            Chaque forme est un point de depart, jamais une contrainte : corps, bavette,
            yeux, branchies, goupille, plan d assemblage et livree restent modifiables
            independamment, et se melangent librement d une forme a l autre. Modelez au
            slider, lestez, lisez si le leurre flotte, suspend ou coule — puis exportez les
            deux coques a imprimer.
          </p>
        </div>
        <div className="hero__steps">
          <div className="hero__step">
            <span>1</span>
            <p>
              <strong>Partir d une forme</strong> — quatre relevees sur des references
              reelles, sept generiques. Tout reste parametrique.
            </p>
          </div>
          <div className="hero__step">
            <span>2</span>
            <p>
              <strong>Composer</strong> : corps, details de tete, quincaillerie et assemblage
              en deux coques, pendant que la physique se recalcule en direct.
            </p>
          </div>
          <div className="hero__step">
            <span>3</span>
            <p>
              <strong>Exporter</strong> les coques male et femelle en STL et STEP, le gabarit
              de bavette en DXF ou SVG, le projet en JSON.
            </p>
          </div>
        </div>
      </section>

      <div className="section-head">
        <h2>Formes de base</h2>
        <span className="section-head__rule" />
        <span className="section-head__hint">
          {SHAPE_PRESETS.length} gabarits parametriques
        </span>
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

      <div className="section-head" style={{ marginTop: 40 }} id="modeles-guides">
        <h2>Modeles guides — articules 2 parties</h2>
        <span className="section-head__rule" />
        <span className="section-head__hint">
          {GUIDED_TEMPLATES.length} leurres complets, deja regles
        </span>
      </div>

      <p className="gallery__lead">
        Un gabarit donne un corps ; un modele guide donne un leurre qui nage — joint place,
        quincaillerie dimensionnee, ancrages poses et flottabilite deja calee. Vous partez d un
        objet qui fonctionne et vous l ajustez ensuite.
      </p>

      <div className="shape-grid">
        {GUIDED_TEMPLATES.map((template) => (
          <button
            type="button"
            className="shape-card shape-card--template"
            key={template.id}
            onClick={() => onTemplate(template.id)}
          >
            <div className="shape-card__figure">
              <span className="shape-card__index">2 PARTIES</span>
              <TemplateFigure headShare={template.headShare} />
            </div>
            <div className="shape-card__body">
              <div className="shape-card__title">
                <h3>{template.label}</h3>
              </div>
              <p className="shape-card__tagline">{template.tagline}</p>
              <p>{template.description}</p>
              <div className="shape-card__meta">
                <span className="tag">{template.length} mm</span>
                <span className="tag">
                  tete {template.headShare} / queue {100 - template.headShare}
                </span>
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
