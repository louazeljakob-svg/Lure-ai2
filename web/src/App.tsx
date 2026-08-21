/**
 * SAKUMA — editeur de leurres de peche imprimables en 3D.
 *
 * Etat entierement en memoire : aucun backend, aucune base, aucun compte.
 * La persistance passe par les fichiers JSON que l utilisateur telecharge.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LureParams, PaintConfig, Project, SavedPalette, ShapeId, WaterId } from './types/lure';
import { buildLure } from './lib/geometry';
import { computePhysics } from './lib/physics';
import { clonePreset, getPreset } from './lib/presets';
import {
  exportProjectJSON,
  exportSTEP,
  exportSTL,
  readProjectFile,
  type SaveOutcome,
} from './lib/exporters';
import { ExportManager } from './components/ExportManager';
import { LureSilhouette } from './components/LureSilhouette';
import { MaterialPanel } from './components/MaterialPanel';
import { PhysicsSimulator } from './components/PhysicsSimulator';
import { ProjectsPanel } from './components/ProjectsPanel';
import { ShapeEditor } from './components/ShapeEditor';
import { ShapeGallery } from './components/ShapeGallery';
import { Viewport3D } from './components/Viewport3D';

type Route = 'gallery' | 'editor';
type PanelTab = 'material' | 'physics' | 'projects';
type Pane = 'shape' | 'panel';

interface Toast {
  id: number;
  tone: 'ok' | 'error' | 'info';
  message: string;
}

const PANEL_META: Record<PanelTab, { title: string; subtitle: string }> = {
  material: { title: 'Matiere & finition', subtitle: 'Impression, lestage, livree' },
  physics: { title: 'Simulation', subtitle: 'Flottabilite, assiette, action' },
  projects: { title: 'Projets', subtitle: 'Creations de la session' },
};

const newId = () => `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export default function App() {
  const [route, setRoute] = useState<Route>('gallery');
  const [params, setParams] = useState<LureParams>(() => clonePreset('minnow'));
  const [name, setName] = useState('Minnow 110');
  const [water, setWater] = useState<WaterId>('fresh');
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>('material');
  const [pane, setPane] = useState<Pane>('shape');
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Incremente a chaque remplacement complet des parametres : le viewport recadre.
  const [fitKey, setFitKey] = useState(0);
  const [palettes, setPalettes] = useState<SavedPalette[]>([]);
  const galleryFileRef = useRef<HTMLInputElement>(null);

  // --- Geometrie & physique, regenerees a chaque changement ---------------
  const geo = useMemo(() => buildLure(params), [params]);
  useEffect(() => () => geo.dispose(), [geo]);
  const physics = useMemo(() => computePhysics(params, geo, water), [params, geo, water]);

  // Un changement d'ecran repart du haut : sinon on arrive au milieu du panneau.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [route]);

  const pushToast = useCallback((tone: Toast['tone'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5200);
  }, []);

  const updateParams = useCallback((patch: Partial<LureParams>) => {
    setParams((current) => ({ ...current, ...patch }));
  }, []);

  const loadPreset = useCallback((shape: ShapeId) => {
    const preset = getPreset(shape);
    setParams(clonePreset(shape));
    setName(`${preset.label} ${preset.params.length}`);
    setActiveId(null);
    setFitKey((n) => n + 1);
  }, []);

  const openShape = useCallback(
    (shape: ShapeId) => {
      loadPreset(shape);
      setRoute('editor');
      setPane('shape');
    },
    [loadPreset],
  );

  // --- Export de fichiers --------------------------------------------------
  const runExport = useCallback(
    async (task: () => Promise<SaveOutcome>, label: string) => {
      try {
        const outcome = await task();
        if (outcome.cancelled) {
          pushToast('info', 'Enregistrement annule.');
          return;
        }
        if (outcome.renamedTo) {
          pushToast(
            'ok',
            `${label} remis sous « ${outcome.renamedTo} » : retirez le « .txt » final pour l ouvrir dans votre trancheur.`,
          );
          return;
        }
        pushToast('ok', `${label} genere.`);
      } catch (error) {
        pushToast(
          'error',
          `Export impossible : ${error instanceof Error ? error.message : 'erreur inconnue'}.`,
        );
      }
    },
    [pushToast],
  );

  const handleExportSTL = useCallback(
    () => runExport(() => exportSTL(geo, name), 'STL'),
    [geo, name, runExport],
  );

  const handleExportJSON = useCallback(
    () => runExport(() => exportProjectJSON(name, params, palettes), 'Projet JSON'),
    [name, palettes, params, runExport],
  );

  const handleExportSTEP = useCallback(
    () => runExport(() => exportSTEP(params, name), 'STEP'),
    [name, params, runExport],
  );

  // --- Projets en session --------------------------------------------------
  const saveToSession = useCallback(() => {
    const cleanName = name.trim() || 'Sans titre';
    const snapshot: LureParams = {
      ...params,
      ballasts: params.ballasts.map((item) => ({ ...item })),
      paint: { ...params.paint },
    };
    if (activeId) {
      setProjects((current) =>
        current.map((project) =>
          project.id === activeId
            ? { ...project, name: cleanName, params: snapshot, updatedAt: Date.now() }
            : project,
        ),
      );
      pushToast('ok', `« ${cleanName} » mis a jour.`);
      return;
    }
    const project: Project = {
      id: newId(),
      name: cleanName,
      params: snapshot,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setProjects((current) => [project, ...current]);
    setActiveId(project.id);
    pushToast('ok', `« ${cleanName} » ajoute aux projets de la session.`);
  }, [activeId, name, params, pushToast]);

  const openProject = useCallback(
    (id: string) => {
      const project = projects.find((item) => item.id === id);
      if (!project) return;
      setParams({
        ...project.params,
        ballasts: project.params.ballasts.map((item) => ({ ...item })),
        paint: { ...project.params.paint },
      });
      setName(project.name);
      setActiveId(project.id);
      setFitKey((n) => n + 1);
      setRoute('editor');
    },
    [projects],
  );

  const renameProject = useCallback((id: string, value: string) => {
    const cleanName = value.trim().slice(0, 60) || 'Sans titre';
    setProjects((current) =>
      current.map((project) =>
        project.id === id ? { ...project, name: cleanName, updatedAt: Date.now() } : project,
      ),
    );
    setActiveId((current) => {
      if (current === id) setName(cleanName);
      return current;
    });
  }, []);

  const duplicateProject = useCallback(
    (id: string) => {
      const source = projects.find((item) => item.id === id);
      if (!source) return;
      const copy: Project = {
        id: newId(),
        name: `${source.name} (copie)`.slice(0, 60),
        params: {
          ...source.params,
          ballasts: source.params.ballasts.map((item) => ({ ...item })),
          paint: { ...source.params.paint },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setProjects((current) => [copy, ...current]);
      pushToast('ok', `Copie creee : « ${copy.name} ».`);
    },
    [projects, pushToast],
  );

  const deleteProject = useCallback(
    (id: string) => {
      setProjects((current) => current.filter((project) => project.id !== id));
      setActiveId((current) => (current === id ? null : current));
      pushToast('info', 'Projet supprime de la session.');
    },
    [pushToast],
  );

  const exportProject = useCallback(
    (id: string) => {
      const project = projects.find((item) => item.id === id);
      if (!project) return;
      void runExport(
        () => exportProjectJSON(project.name, project.params, palettes),
        'Projet JSON',
      );
    },
    [palettes, projects, runExport],
  );

  const importProject = useCallback(
    async (file: File) => {
      try {
        const imported = await readProjectFile(file);
        setParams(imported.params);
        setName(imported.name);
        setActiveId(null);
        setFitKey((n) => n + 1);
        setRoute('editor');
        if (imported.palettes.length > 0) {
          // Fusion avec la bibliotheque de la session, sans doublon d'identifiant.
          setPalettes((current) => {
            const known = new Set(current.map((palette) => palette.id));
            return [...current, ...imported.palettes.filter((p) => !known.has(p.id))];
          });
        }
        pushToast('ok', `Projet « ${imported.name} » recharge.`);
      } catch (error) {
        pushToast('error', error instanceof Error ? error.message : 'Import impossible.');
      }
    },
    [pushToast],
  );

  const savePalette = useCallback(
    (label: string) => {
      const paletteName = label.trim().slice(0, 40) || `Livree ${palettes.length + 1}`;
      const palette: SavedPalette = {
        id: `pal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: paletteName,
        paint: { ...params.paint },
      };
      setPalettes((current) => [...current, palette]);
      pushToast('ok', `Livree « ${paletteName} » enregistree.`);
    },
    [palettes.length, params.paint, pushToast],
  );

  const applyPalette = useCallback(
    (id: string) => {
      const palette = palettes.find((item) => item.id === id);
      if (!palette) return;
      const paint: PaintConfig = { ...palette.paint };
      setParams((current) => ({ ...current, paint }));
    },
    [palettes],
  );

  const deletePalette = useCallback((id: string) => {
    setPalettes((current) => current.filter((palette) => palette.id !== id));
  }, []);

  const panelMeta = PANEL_META[panelTab];

  return (
    <div className="app">
      <a className="skip-link" href="#contenu">
        Aller au contenu
      </a>

      <header className="header">
        <button
          type="button"
          className="brand"
          onClick={() => setRoute('gallery')}
          aria-label="SAKUMA — retour a la galerie"
        >
          <span className="brand__mark" aria-hidden="true">
            SK
          </span>
          <span>
            <span className="brand__name">SAKUMA</span>
            <span className="brand__sub">Editeur de leurres 3D</span>
          </span>
        </button>

        <nav className="header__nav" aria-label="Navigation principale">
          <button
            type="button"
            className="navlink"
            aria-current={route === 'gallery' ? 'page' : undefined}
            onClick={() => setRoute('gallery')}
          >
            Galerie
          </button>
          <button
            type="button"
            className="navlink"
            aria-current={route === 'editor' ? 'page' : undefined}
            onClick={() => setRoute('editor')}
          >
            Editeur
          </button>
        </nav>

        <span className="header__spacer" />

        <div className="header__actions">
          {route === 'editor' ? (
            <>
              <span
                className="sr-only"
                aria-live="polite"
              >{`${physics.totalMass.toFixed(1)} grammes, le leurre ${
                physics.buoyancy === 'float'
                  ? 'flotte'
                  : physics.buoyancy === 'sink'
                    ? 'coule'
                    : 'suspend'
              }`}</span>
              <div style={{ width: 88 }} aria-hidden="true">
                <LureSilhouette params={params} height={34} decorative />
              </div>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={handleExportSTL}
              >
                Exporter STL
              </button>
            </>
          ) : null}
        </div>
      </header>

      {route === 'gallery' ? (
        <>
          <ShapeGallery
            onSelect={openShape}
            projects={projects}
            activeId={activeId}
            onOpen={openProject}
            onRename={renameProject}
            onDuplicate={duplicateProject}
            onDelete={deleteProject}
            onExport={exportProject}
            onImportClick={() => galleryFileRef.current?.click()}
          />
          <input
            ref={galleryFileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Recharger un projet JSON"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importProject(file);
              event.target.value = '';
            }}
          />
        </>
      ) : (
        <>
          <div className="panel-tabs" role="tablist" aria-label="Panneaux de l editeur">
            <button
              type="button"
              role="tab"
              aria-selected={pane === 'shape'}
              onClick={() => setPane('shape')}
            >
              Forme
            </button>
            {(Object.keys(PANEL_META) as PanelTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={pane === 'panel' && panelTab === tab}
                onClick={() => {
                  setPane('panel');
                  setPanelTab(tab);
                }}
              >
                {tab === 'material' ? 'Matiere' : tab === 'physics' ? 'Physique' : 'Projets'}
              </button>
            ))}
          </div>

          <main className="editor" id="contenu" data-tab={pane}>
            <section className="panel panel--shape" aria-label="Parametres de forme">
              <div className="panel__head">
                <div>
                  <h2>Forme</h2>
                  <p>Geometrie parametrique du corps</p>
                </div>
              </div>
              <ShapeEditor
                params={params}
                onChange={updateParams}
                onLoadPreset={loadPreset}
              />
            </section>

            <Viewport3D geo={geo} params={params} physics={physics} fitKey={fitKey} />

            <section className="panel panel--side" aria-label="Matiere, simulation et projets">
              <div className="panel__head">
                <div>
                  <h2>{panelMeta.title}</h2>
                  <p>{panelMeta.subtitle}</p>
                </div>
              </div>

              <div className="panel-subtabs" role="tablist" aria-label="Sections du panneau">
                {(Object.keys(PANEL_META) as PanelTab[]).map((tab) => (
                  <button
                    key={tab}
                    id={`subtab-${tab}`}
                    type="button"
                    role="tab"
                    aria-selected={panelTab === tab}
                    onClick={() => setPanelTab(tab)}
                  >
                    {tab === 'material' ? 'Matiere' : tab === 'physics' ? 'Physique' : 'Projets'}
                  </button>
                ))}
              </div>

              <div role="tabpanel" aria-labelledby={`subtab-${panelTab}`}>
                {panelTab === 'material' ? (
                  <MaterialPanel
                    params={params}
                    onChange={updateParams}
                    clipMass={physics.clipMass}
                    palettes={palettes}
                    onSavePalette={savePalette}
                    onApplyPalette={applyPalette}
                    onDeletePalette={deletePalette}
                  />
                ) : null}
                {panelTab === 'physics' ? (
                  <PhysicsSimulator
                    params={params}
                    physics={physics}
                    water={water}
                    onWaterChange={setWater}
                  />
                ) : null}
                {panelTab === 'projects' ? (
                  <ProjectsPanel
                    projects={projects}
                    activeId={activeId}
                    onOpen={openProject}
                    onRename={renameProject}
                    onDuplicate={duplicateProject}
                    onDelete={deleteProject}
                    onExport={exportProject}
                  />
                ) : null}
              </div>

              <ExportManager
                name={name}
                onNameChange={setName}
                params={params}
                geo={geo}
                physics={physics}
                onImport={(file) => void importProject(file)}
                onExportSTL={handleExportSTL}
                onExportSTEP={handleExportSTEP}
                onExportJSON={handleExportJSON}
                onSaveSession={saveToSession}
                saveLabel={activeId ? 'Mettre a jour' : 'Ajouter'}
              />
            </section>
          </main>
        </>
      )}

      <div className="toast-zone" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`toast toast--${toast.tone}`} key={toast.id}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}
