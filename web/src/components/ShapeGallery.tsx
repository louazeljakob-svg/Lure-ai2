/** Ecran d'accueil : galerie des formes de base + projets de la session. */

import { useState } from 'react';
import type { Project, ShapeId } from '../types/lure';
import {
  activeFilters,
  ARCHETYPES,
  FLOAT_LABEL,
  filterValues,
  matchesChoice,
  slendernessOf,
  type LibraryChoice,
} from '../lib/archetypes';
import { ArchetypePreview } from './ArchetypePreview';
import { getPreset } from '../lib/presets';
import { THUMBNAILS } from '../lib/thumbnails';
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
  const [chosen, setChosen] = useState<LibraryChoice>({});
  const shown = ARCHETYPES.filter((item) => matchesChoice(item, chosen));

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
              <strong>Partir d une famille</strong> — deux leurres complets et regles,
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
        Deux familles, une entree chacune — les variantes sont des reglages, et les corps trapus,
        fuseles ou a face creusee s obtiennent aux curseurs de forme. Chaque modele
        arrive fonctionnel : armature anatomique (pedoncule, opercule en relief, orbites
        creusees, nageoires), deux demi-coques vissees avec ergots et gorge de colle,
        goupilles aux attaches, lest place, verdict de flottabilite valide.
      </p>

      <div className="filters" role="group" aria-label="Filtres de la bibliotheque">
        {activeFilters().map((filter) => {
          const values = filterValues(filter.key, chosen);
          return (
            <label key={filter.key}>
              {filter.label}
              <select
                value={chosen[filter.key] ?? ''}
                onChange={(event) => setChosen({ ...chosen, [filter.key]: event.target.value || undefined })}
              >
                <option value="">{filter.all}</option>
                {values.map((value) => (
                  <option key={value} value={value}>
                    {filter.name(value)}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="empty">Aucune famille ne repond a ces filtres.</p>
      ) : null}

      <div className="archetype-grid">
        {shown.map((item) => {
          const preset = getPreset(item.shape);
          const ratio = slendernessOf(preset.params);
          const sheet = THUMBNAILS[item.shape];
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
                  <span className="tag" title="Masse en service du modele livre, quincaillerie et lest compris">
                    {sheet ? `${sheet.massG.toFixed(1).replace('.', ',')} g` : 'masse non calculee'}
                  </span>
                  <span className="tag" title="Volume du corps exporte, a la taille par defaut">
                    {sheet ? `${sheet.volumeCm3.toFixed(2).replace('.', ',')} cm3` : 'volume non calcule'}
                  </span>
                  <span
                    className="tag"
                    title="Triangles du fichier STL exporte (piece assemblee), a la taille par defaut et a la resolution d export"
                  >
                    {sheet ? `${sheet.exportTriangles.toLocaleString('fr-FR')} triangles` : 'triangles non calcules'}
                  </span>
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
