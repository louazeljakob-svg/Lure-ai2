/**
 * SAKUMA — editeur de leurres de peche imprimables en 3D.
 *
 * Etat entierement en memoire : aucun backend, aucune base, aucun compte.
 * La persistance passe par les fichiers JSON que l utilisateur telecharge.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  LureParams,
  PaintConfig,
  PinAnchor,
  Project,
  SavedPalette,
  SculptPoint,
  ShapeId,
  WaterId,
} from './types/lure';
import { assemblyPlans, suggestExit } from './lib/assembly';
import { createProfile } from './lib/profile';
import {
  applyCalibration,
  readReferenceImage,
  type ReferenceImage,
} from './lib/reference';
import { ReferencePanel } from './components/ReferencePanel';
import { buildLure } from './lib/geometry';
import { computePhysics } from './lib/physics';
import { clonePreset, getPreset } from './lib/presets';
import {
  EXPORT_LABEL,
  exportBillTemplate,
  exportProjectJSON,
  exportSTEP,
  exportSTL,
  readProjectFile,
  type ExportKind,
  type SaveOutcome,
} from './lib/exporters';
import { ExportManager } from './components/ExportManager';
import { LureSilhouette } from './components/LureSilhouette';
import { AssemblyPanel } from './components/AssemblyPanel';
import { MaterialPanel } from './components/MaterialPanel';
import { PhysicsSimulator } from './components/PhysicsSimulator';
import { ProjectsPanel } from './components/ProjectsPanel';
import { ShapeEditor } from './components/ShapeEditor';
import { ShapeGallery } from './components/ShapeGallery';
import { Viewport3D } from './components/Viewport3D';

type Route = 'gallery' | 'editor';
type PanelTab = 'material' | 'assembly' | 'reference' | 'physics' | 'projects';
type Pane = 'shape' | 'panel';

interface Toast {
  id: number;
  tone: 'ok' | 'error' | 'info';
  message: string;
}

const PANEL_META: Record<PanelTab, { title: string; subtitle: string; tab: string }> = {
  material: { title: 'Matiere & finition', subtitle: 'Impression, lestage, livree', tab: 'Matiere' },
  assembly: { title: 'Assemblage', subtitle: 'Ancrages, goujons, goupilles', tab: 'Assemblage' },
  reference: { title: 'Reference', subtitle: 'Images calees a l echelle', tab: 'Reference' },
  physics: { title: 'Simulation', subtitle: 'Flottabilite, assiette, action', tab: 'Physique' },
  projects: { title: 'Projets', subtitle: 'Creations de la session', tab: 'Projets' },
};

const newId = () => `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export default function App() {
  const [route, setRoute] = useState<Route>('gallery');
  const [params, setParams] = useState<LureParams>(() => clonePreset('ryoshi'));
  const [name, setName] = useState('Ryoshi 86');
  const [water, setWater] = useState<WaterId>('fresh');
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>('material');
  const [pane, setPane] = useState<Pane>('shape');
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Incremente a chaque remplacement complet des parametres : le viewport recadre.
  const [fitKey, setFitKey] = useState(0);
  const [palettes, setPalettes] = useState<SavedPalette[]>([]);
  const [placing, setPlacing] = useState(false);
  const [selectedAnchor, setSelectedAnchor] = useState<string | null>(null);
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [calibratingId, setCalibratingId] = useState<string | null>(null);
  const [picks, setPicks] = useState<{ u: number; v: number }[]>([]);
  const [sculpting, setSculpting] = useState(false);
  const [selectedSculpt, setSelectedSculpt] = useState<string | null>(null);
  const galleryFileRef = useRef<HTMLInputElement>(null);

  // --- Geometrie & physique, regenerees a chaque changement ---------------
  // Cotes d'assemblage a resolution reduite : l'interface doit signaler un
  // ancrage invalide des la frappe, sans reconstruire tout le maillage. La
  // bavette fantome se pose ensuite dans la fente que ce calcul a retenue.
  const plans = useMemo(() => assemblyPlans(createProfile(params), params), [params]);
  const sockets = plans.sockets;
  const geo = useMemo(
    () => buildLure(params, undefined, plans.billPlan?.root ?? null),
    [params, plans],
  );
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

  // --- Ancrages de goupille ------------------------------------------------
  const setAnchors = useCallback(
    (next: (anchors: PinAnchor[]) => PinAnchor[]) => {
      setParams((current) => ({
        ...current,
        assembly: { ...current.assembly, anchors: next(current.assembly.anchors) },
      }));
    },
    [],
  );

  const addAnchor = useCallback(
    (position = 0.5, height = 0) => {
      const anchor: PinAnchor = {
        id: `anc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        position,
        height,
        // Un ancrage pres du nez ressort au nez, pres de la queue a la queue,
        // ailleurs au ventre : le cas le plus courant.
        exit: suggestExit(position, height),
        depth: 0,
        pin: 'auto',
        method: params.assembly.socketMethod,
      };
      setAnchors((anchors) => [...anchors, anchor]);
      setSelectedAnchor(anchor.id);
    },
    [params.assembly.socketMethod, setAnchors],
  );

  const updateAnchor = useCallback(
    (id: string, patch: Partial<PinAnchor>) => {
      setAnchors((anchors) =>
        anchors.map((anchor) => (anchor.id === id ? { ...anchor, ...patch } : anchor)),
      );
    },
    [setAnchors],
  );

  const removeAnchor = useCallback(
    (id: string) => {
      setAnchors((anchors) => anchors.filter((anchor) => anchor.id !== id));
      setSelectedAnchor((current) => (current === id ? null : current));
    },
    [setAnchors],
  );

  // --- Images de reference ---------------------------------------------------
  const importReference = useCallback(
    async (file: File) => {
      try {
        const image = await readReferenceImage(file);
        setReferences((current) => [...current, image]);
        pushToast('ok', `Reference « ${image.name} » chargee. Calibrez-la pour la mettre a l echelle.`);
      } catch (error) {
        pushToast('error', error instanceof Error ? error.message : 'Import impossible.');
      }
    },
    [pushToast],
  );

  const updateReference = useCallback((id: string, patch: Partial<ReferenceImage>) => {
    setReferences((current) =>
      current.map((image) => (image.id === id ? { ...image, ...patch } : image)),
    );
  }, []);

  const removeReference = useCallback((id: string) => {
    setReferences((current) => current.filter((image) => image.id !== id));
    setCalibratingId((current) => (current === id ? null : current));
  }, []);

  const pickCalibration = useCallback((_id: string, u: number, v: number) => {
    setPicks((current) => (current.length >= 2 ? [{ u, v }] : [...current, { u, v }]));
  }, []);

  const applyCalibrationDistance = useCallback(
    (millimetres: number) => {
      if (!calibratingId || picks.length < 2 || !(millimetres > 0)) return;
      setReferences((current) =>
        current.map((image) =>
          image.id === calibratingId
            ? applyCalibration(image, {
                ax: picks[0].u,
                ay: picks[0].v,
                bx: picks[1].u,
                by: picks[1].v,
                mm: millimetres,
              })
            : image,
        ),
      );
      setCalibratingId(null);
      setPicks([]);
      pushToast('ok', `Reference mise a l echelle sur ${millimetres} mm.`);
    },
    [calibratingId, picks, pushToast],
  );

  // --- Cage de sculpture -----------------------------------------------------
  const buildCage = useCallback(() => {
    // Grille reguliere : cinq stations le long du corps, quatre directions.
    const points: SculptPoint[] = [];
    const stations = [0.2, 0.35, 0.5, 0.65, 0.8];
    const angles = [0, 90, 180, 270];
    for (const position of stations) {
      for (const angle of angles) {
        points.push({
          id: `cage-${position}-${angle}`,
          position,
          angle,
          amount: 0,
          radius: 0.12,
        });
      }
    }
    setParams((current) => ({ ...current, sculpt: points }));
    setSculpting(true);
  }, []);

  const clearCage = useCallback(() => {
    setParams((current) => ({ ...current, sculpt: [] }));
    setSelectedSculpt(null);
  }, []);

  const updateSculpt = useCallback(
    (id: string, patch: { amount?: number; radius?: number }) => {
      setParams((current) => ({
        ...current,
        sculpt: current.sculpt.map((point) =>
          point.id === id ? { ...point, ...patch } : point,
        ),
      }));
    },
    [],
  );

  const dragSculpt = useCallback((id: string, deltaMm: number) => {
    setParams((current) => ({
      ...current,
      sculpt: current.sculpt.map((point) =>
        point.id === id
          ? { ...point, amount: Math.min(Math.max(point.amount + deltaMm, -8), 8) }
          : point,
      ),
    }));
  }, []);

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
    (kind: ExportKind) =>
      runExport(
        () => exportSTL(params, geo, name, kind),
        kind === 'assembly' ? 'STL' : `STL ${EXPORT_LABEL[kind]}`,
      ),
    [geo, name, params, runExport],
  );

  const handleExportJSON = useCallback(
    () => runExport(() => exportProjectJSON(name, params, palettes), 'Projet JSON'),
    [name, palettes, params, runExport],
  );

  const handleExportSTEP = useCallback(
    (kind: ExportKind) =>
      runExport(
        () => exportSTEP(params, name, kind),
        kind === 'assembly' ? 'STEP' : `STEP ${EXPORT_LABEL[kind]}`,
      ),
    [name, params, runExport],
  );

  const handleExportBill = useCallback(
    (format: 'dxf' | 'svg') =>
      runExport(() => exportBillTemplate(params, name, format), `Gabarit ${format.toUpperCase()}`),
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
                onClick={() => handleExportSTL('assembly')}
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
                {PANEL_META[tab].tab}
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
                sculpting={sculpting}
                onSculptingChange={setSculpting}
                selectedSculpt={selectedSculpt}
                onBuildCage={buildCage}
                onClearCage={clearCage}
                onUpdateSculpt={updateSculpt}
              />
            </section>

            <Viewport3D
              geo={geo}
              params={params}
              physics={physics}
              fitKey={fitKey}
              placing={placing}
              selectedAnchor={selectedAnchor}
              onPlaceAnchor={addAnchor}
              onMoveAnchor={(id, position, height) => updateAnchor(id, { position, height })}
              onSelectAnchor={setSelectedAnchor}
              references={references}
              calibratingId={calibratingId}
              onPickCalibration={pickCalibration}
              sculpting={sculpting}
              selectedSculpt={selectedSculpt}
              onSelectSculpt={setSelectedSculpt}
              onDragSculpt={dragSculpt}
            />

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
                    {PANEL_META[tab].tab}
                  </button>
                ))}
              </div>

              <div role="tabpanel" aria-labelledby={`subtab-${panelTab}`}>
                {panelTab === 'material' ? (
                  <MaterialPanel
                    params={params}
                    onChange={updateParams}
                    palettes={palettes}
                    onSavePalette={savePalette}
                    onApplyPalette={applyPalette}
                    onDeletePalette={deletePalette}
                  />
                ) : null}
                {panelTab === 'assembly' ? (
                  <AssemblyPanel
                    params={params}
                    onChange={updateParams}
                    clipMass={physics.clipMass}
                    pinMass={physics.pinMass}
                    sockets={sockets}
                    placing={placing}
                    onPlacingChange={setPlacing}
                    selectedAnchor={selectedAnchor}
                    onSelectAnchor={setSelectedAnchor}
                    onAddAnchor={() => addAnchor()}
                    onUpdateAnchor={updateAnchor}
                    onRemoveAnchor={removeAnchor}
                  />
                ) : null}
                {panelTab === 'reference' ? (
                  <ReferencePanel
                    references={references}
                    onImport={(file) => void importReference(file)}
                    onUpdate={updateReference}
                    onRemove={removeReference}
                    calibratingId={calibratingId}
                    picks={picks}
                    onStartCalibration={(id) => {
                      setCalibratingId(id);
                      setPicks([]);
                    }}
                    onApplyCalibration={applyCalibrationDistance}
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
                onExportBill={handleExportBill}
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
