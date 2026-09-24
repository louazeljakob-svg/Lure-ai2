/** Ecran d'accueil : galerie des formes de base + projets de la session. */

import { useState } from 'react';
import type { Project, ShapeId } from '../types/lure';
import {
  ACTION_LABEL,
  ARCHETYPES,
  FLOAT_LABEL,
  slendernessOf,
  type ActionTag,
  type FloatTag,
} from '../lib/archetypes';
import { ArchetypePreview } from './ArchetypePreview';
import { getPreset } from '../lib/presets';
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
  const [fAction, setFAction] = useState('');
  const [fBib, setFBib] = useState('');
  const [fArt, setFArt] = useState('');
  const [fFloat, setFFloat] = useState('');

  const shown = ARCHETYPES.filter(
    (item) =>
      (!fAction || item.actionTag === fAction) &&
      (!fBib || (fBib === 'oui') === item.hasBib) &&
      (!fArt || (fArt === 'oui') === item.articulated) &&
      (!fFloat || item.buoyancy === fFloat),
  );

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
              <strong>Partir d une famille</strong> — sept leurres complets et regles,
              anatomie comprise. Chaque cote reste modifiable au curseur.
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
        <h2>Familles de leurres</h2>
        <span className="section-head__rule" />
        <span className="section-head__hint">
          {shown.length} / {ARCHETYPES.length} familles
        </span>
      </div>

      <p className="gallery__lead">
        Sept familles, une entree chacune — les variantes sont des reglages. Chaque modele
        arrive fonctionnel : armature anatomique (pedoncule, opercule en relief, orbites
        creusees, nageoires), deux demi-coques vissees avec ergots et gorge de colle,
        goupilles aux attaches, lest place, verdict de flottabilite valide.
      </p>

      <div className="filters" role="group" aria-label="Filtres de la bibliotheque">
        <label>
          Action
          <select value={fAction} onChange={(e) => setFAction(e.target.value)}>
            <option value="">Toutes</option>
            {(Object.keys(ACTION_LABEL) as ActionTag[]).map((id) => (
              <option key={id} value={id}>
                {ACTION_LABEL[id]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Bavette
          <select value={fBib} onChange={(e) => setFBib(e.target.value)}>
            <option value="">Indifferent</option>
            <option value="oui">Avec bavette</option>
            <option value="non">Sans bavette</option>
          </select>
        </label>
        <label>
          Articulation
          <select value={fArt} onChange={(e) => setFArt(e.target.value)}>
            <option value="">Indifferent</option>
            <option value="oui">Articule</option>
            <option value="non">Monobloc</option>
          </select>
        </label>
        <label>
          Flottaison
          <select value={fFloat} onChange={(e) => setFFloat(e.target.value)}>
            <option value="">Toutes</option>
            {(Object.keys(FLOAT_LABEL) as FloatTag[]).map((id) => (
              <option key={id} value={id}>
                {FLOAT_LABEL[id]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="empty">Aucune famille ne repond a ces filtres.</p>
      ) : null}

      <div className="archetype-grid">
        {shown.map((item) => {
          const preset = getPreset(item.shape);
          const ratio = slendernessOf(preset.params);
          return (
            <button
              type="button"
              className="archetype"
              key={item.shape}
              onClick={() => onSelect(item.shape)}
            >
              <ArchetypePreview params={preset.params} label={item.family} />
              <div className="archetype__body">
                <div className="archetype__title">
                  <span className="archetype__rank" aria-hidden="true">
                    {String(item.rank).padStart(2, '0')}
                  </span>
                  <h3>{item.family}</h3>
                </div>
                <p className="archetype__action">{item.action}</p>
                <div className="shape-card__meta">
                  <span className="tag">
                    {item.lengths[0]}-{item.lengths[1]} mm
                  </span>
                  <span className="tag">elancement {ratio.toFixed(1)}</span>
                  <span className="tag">{FLOAT_LABEL[item.buoyancy]}</span>
                  <span className="tag">{item.hasBib ? 'Bavette' : 'Sans bavette'}</span>
                  {item.articulated ? <span className="tag">Articule</span> : null}
                </div>
                <p className="archetype__tie">{item.tie}</p>
                {item.caveat ? <p className="archetype__caveat">{item.caveat}</p> : null}
              </div>
            </button>
          );
        })}
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
