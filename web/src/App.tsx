/**
 * SAKUMA — editeur de leurres de peche imprimables en 3D.
 *
 * Etat entierement en memoire : aucun backend, aucune base, aucun compte.
 * La persistance passe par les fichiers JSON que l utilisateur telecharge.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Decal,
  Inlay,
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
import { buildLure, PREVIEW_RESOLUTION } from './lib/geometry';
import { useHistory } from './lib/history';
import { articulationBlocker, fitToBody } from './lib/articulation';
import { getTemplate } from './lib/templates';
import { emptyReference } from './lib/presets';
import { Outliner, type AddKind, type NodeKind, type SceneNode } from './components/Outliner';
import { OutlineEditor } from './components/OutlineEditor';
import {
  ArticulationInspector,
  DecalInspector,
  DowelInspector,
  InlayInspector,
  JointEyeInspector,
  JointSlotInspector,
  PrintInspector,
  ScalesInspector,
} from './components/Inspector';
import { runPrintChecks } from './lib/printCheck';
import { Fieldset } from './components/ui';
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
import { TacklePanel } from './components/TacklePanel';
import { PhysicsSimulator } from './components/PhysicsSimulator';
import { ProjectsPanel } from './components/ProjectsPanel';
import { ShapeEditor } from './components/ShapeEditor';
import { ShapeGallery } from './components/ShapeGallery';
import { Viewport3D } from './components/Viewport3D';

type Route = 'gallery' | 'editor';
type PanelTab =
  | 'scene'
  | 'material'
  | 'assembly'
  | 'tackle'
  | 'reference'
  | 'physics'
  | 'projects';
type Pane = 'shape' | 'panel';

interface Toast {
  id: number;
  tone: 'ok' | 'error' | 'info';
  message: string;
}

const PANEL_META: Record<PanelTab, { title: string; subtitle: string; tab: string }> = {
  scene: { title: 'Scene', subtitle: 'Arbre des pieces et inspecteur', tab: 'Scene' },
  material: { title: 'Matiere & finition', subtitle: 'Impression, lestage, livree', tab: 'Matiere' },
  assembly: { title: 'Assemblage', subtitle: 'Ancrages, goujons, goupilles', tab: 'Assemblage' },
  tackle: {
    title: 'Quincaillerie',
    subtitle: 'Catalogue pese, montages et bilan de masse',
    tab: 'Quincaillerie',
  },
  reference: { title: 'Reference', subtitle: 'Images calees a l echelle', tab: 'Reference' },
  physics: { title: 'Simulation', subtitle: 'Flottabilite, nage, tenue mecanique', tab: 'Physique' },
  projects: { title: 'Projets', subtitle: 'Creations de la session', tab: 'Projets' },
};

const newId = () => `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export default function App() {
  const [route, setRoute] = useState<Route>('gallery');
  // Toute modification passe par la pile d'annulation : c'est elle qui porte
  // l'etat courant. Les chargements complets la reinitialisent.
  const history = useHistory<LureParams>(() => clonePreset('ryoshi'));
  const params = history.state;
  const setParams = history.set;
  const [name, setName] = useState('Ryoshi 86');
  const [water, setWater] = useState<WaterId>('fresh');
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>('scene');
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
  // Arbre de scene : la selection pilote l'inspecteur, et l'editeur de
  // contour s'ouvre sur la piece qui le demande.
  const [selectedNode, setSelectedNode] = useState<string>('body');
  const [selectedKind, setSelectedKind] = useState<NodeKind>('body');
  const [editing, setEditing] = useState<{
    kind: 'outline' | 'decal' | 'inlay';
    id?: string;
  } | null>(null);
  const [dark, setDark] = useState(false);
  // Modele guide charge : son panneau d'explication reste ouvert tant que
  // l'utilisateur ne le referme pas.
  const [guideId, setGuideId] = useState<string | null>(null);
  // Etat de sauvegarde, lu par la barre basse : « Enregistre » ne doit
  // s'afficher que si le projet en cours correspond a ce qui est en memoire.
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const galleryFileRef = useRef<HTMLInputElement>(null);

  // --- Geometrie & physique, regenerees a chaque changement ---------------
  // Cotes d'assemblage a resolution reduite : l'interface doit signaler un
  // ancrage invalide des la frappe, sans reconstruire tout le maillage. La
  // bavette fantome se pose ensuite dans la fente que ce calcul a retenue.
  const plans = useMemo(() => assemblyPlans(createProfile(params), params), [params]);
  const sockets = plans.sockets;
  const geo = useMemo(
    () =>
      buildLure(
        params,
        PREVIEW_RESOLUTION[params.print.preview],
        plans.billPlan?.root ?? null,
        // Ecailles cuites : le relief existe pour de bon dans le maillage, au
        // prix d'un maillage bien plus dense. Sinon, normal map.
        params.scales.baked,
      ),
    [params, plans],
  );
  useEffect(() => () => geo.dispose(), [geo]);
  const physics = useMemo(() => computePhysics(params, geo, water), [params, geo, water]);

  // Un changement d'ecran repart du haut : sinon on arrive au milieu du panneau.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [route]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  // Toute modification rend le projet different de ce qui est enregistre.
  useEffect(() => {
    setSaveState('dirty');
  }, [params, name]);

  // Annuler / retablir au clavier, partout dans l'editeur.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) history.redo();
      else history.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history]);

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

  const updateDecal = useCallback(
    (id: string, patch: Partial<Decal>) => {
      setParams((current) => ({
        ...current,
        decals: current.decals.map((decal) =>
          decal.id === id ? { ...decal, ...patch } : decal,
        ),
      }));
    },
    [setParams],
  );

  const addDecal = useCallback(() => {
    const id = `decal-${Date.now().toString(36)}`;
    setParams((current) => ({
      ...current,
      decals: [
        ...current.decals,
        {
          id,
          name: current.decals.length === 0 ? 'Decal' : `Decal ${current.decals.length + 1}`,
          visible: true,
          outline: { nodes: [], closed: true, mirror: false },
          reference: emptyReference(),
          style: 'engraved',
          depth: 0.4,
          softness: 30,
          mirror: true,
          previewOpacity: 100,
          // Pose par defaut sur la joue : c'est le decal que l'on dessine en
          // premier neuf fois sur dix.
          position: 0.28,
          height: 0.15,
          rotation: 0,
          size: Math.max(current.length * 0.12, 4),
        },
      ],
    }));
    setSelectedNode(id);
    setSelectedKind('decal');
    setEditing({ kind: 'decal', id });
    return id;
  }, [setParams]);

  const duplicateDecal = useCallback(
    (id: string) => {
      setParams((current) => {
        const source = current.decals.find((decal) => decal.id === id);
        if (!source) return current;
        const copy: Decal = {
          ...source,
          id: `decal-${Date.now().toString(36)}`,
          name: `${source.name} (copie)`,
          outline: {
            ...source.outline,
            nodes: source.outline.nodes.map((node) => ({ ...node })),
          },
          reference: { ...source.reference },
          // Decalee, sans quoi la copie se superposerait a l'original et
          // l'utilisateur croirait qu'il ne s'est rien passe.
          position: Math.min(source.position + 0.06, 0.97),
        };
        return { ...current, decals: [...current.decals, copy] };
      });
    },
    [setParams],
  );

  const removeDecal = useCallback(
    (id: string) => {
      setParams((current) => ({
        ...current,
        decals: current.decals.filter((decal) => decal.id !== id),
      }));
      setSelectedNode('body');
      setSelectedKind('body');
    },
    [setParams],
  );

  const reorderDecal = useCallback(
    (draggedId: string, beforeId: string) => {
      setParams((current) => {
        const list = [...current.decals];
        const from = list.findIndex((decal) => decal.id === draggedId);
        const to = list.findIndex((decal) => decal.id === beforeId);
        if (from < 0 || to < 0 || from === to) return current;
        const [moved] = list.splice(from, 1);
        list.splice(to, 0, moved);
        return { ...current, decals: list };
      });
    },
    [setParams],
  );

  const updateInlay = useCallback(
    (id: string, patch: Partial<Inlay>) => {
      setParams((current) => ({
        ...current,
        inlays: current.inlays.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      }));
    },
    [setParams],
  );

  const addInlay = useCallback(() => {
    const id = `rainure-${Date.now().toString(36)}`;
    setParams((current) => ({
      ...current,
      inlays: [
        ...current.inlays,
        {
          id,
          name: current.inlays.length === 0 ? 'Rainure de collant' : `Rainure ${current.inlays.length + 1}`,
          visible: true,
          shape: 'oval' as const,
          outline: { nodes: [], closed: true, mirror: false },
          reference: emptyReference(),
          // 0,25 mm : un collant reflechissant courant plus sa colle.
          depth: 0.25,
          margin: 0.2,
          cornerRadius: 1.5,
          mirror: true,
          position: 0.42,
          height: 0.1,
          rotation: 0,
          size: Math.max(current.length * 0.26, 8),
        },
      ],
    }));
    setSelectedNode(id);
    setSelectedKind('inlay');
    setPanelTab('scene');
  }, [setParams]);

  const addBallast = useCallback(() => {
    setParams((current) => ({
      ...current,
      ballasts: [
        ...current.ballasts,
        {
          id: `lest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          // Pose bas et au milieu : c'est de la que part tout reglage
          // d'assiette, et l'utilisateur remonte ensuite ce qu'il faut.
          position: 0.5,
          height: -0.7,
          mass: 1.5,
          shape: 'sphere' as const,
        },
      ],
    }));
    setPanelTab('material');
  }, [setParams]);

  /**
   * Ajout d'une articulation, en un geste.
   *
   * L'articulation coupe le corps EN TRAVERS ; l'impression en deux coques le
   * coupe dans la longueur. Les deux a la fois donneraient quatre pieces dont
   * l'assemblage n'est pas genere. Plutot que de laisser l'ajout sans effet
   * visible — c'etait le cas —, on bascule le corps en une piece et on le dit.
   */
  const addArticulation = useCallback(() => {
    const blocked = articulationBlocker(params);
    if (blocked) {
      pushToast('error', blocked);
      return;
    }
    setParams((current) => ({
      ...current,
      assembly: { ...current.assembly, enabled: false },
      articulation: { ...current.articulation, enabled: true },
    }));
    setPanelTab('scene');
    setSelectedNode('articulation');
    setSelectedKind('articulation');
    if (params.assembly.enabled) {
      pushToast(
        'ok',
        'Corps passe en une piece : l articulation le coupe en travers, l impression en deux coques le coupait dans la longueur.',
      );
    }
  }, [params, setParams, pushToast]);

  const fitJoint = useCallback(() => {
    setParams((current) => ({
      ...current,
      articulation: {
        ...current.articulation,
        ...fitToBody(createProfile(current), current.articulation),
      },
    }));
  }, [setParams]);

  const loadTemplate = useCallback(
    (id: string) => {
      const template = getTemplate(id);
      if (!template) return;
      history.reset(template.build());
      setName(template.label);
      setActiveId(null);
      setFitKey((n) => n + 1);
      setRoute('editor');
      setPane('panel');
      setPanelTab('scene');
      setSelectedNode('articulation');
      setSelectedKind('articulation');
      setGuideId(id);
    },
    [history],
  );

  const loadPreset = useCallback((shape: ShapeId) => {
    const preset = getPreset(shape);
    history.reset(clonePreset(shape));
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
    setSaveState('saved');
    pushToast('ok', `« ${cleanName} » ajoute aux projets de la session.`);
  }, [activeId, name, params, pushToast]);

  const openProject = useCallback(
    (id: string) => {
      const project = projects.find((item) => item.id === id);
      if (!project) return;
      history.reset({
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
        history.reset(imported.params);
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

  /**
   * Arbre de scene.
   *
   * Il est DERIVE des parametres a chaque rendu plutot que stocke : il ne
   * peut donc pas se desynchroniser du modele, et une piece supprimee
   * disparait de l'arbre sans code de nettoyage.
   */
  const sceneNodes = useMemo<SceneNode[]>(() => {
    const jointChildren: SceneNode[] = [];
    if (params.articulation.enabled) {
      for (let i = 0; i < params.articulation.eyeCount; i++) {
        jointChildren.push({
          id: `joint-eye-${i}`,
          kind: 'jointEye',
          icon: '◎',
          label: `${i + 1}. Oeillet a vis`,
        });
      }
      if (params.articulation.hardware === 'pin') {
        jointChildren.push({ id: 'joint-pin', kind: 'jointPin', icon: '│', label: 'Goupille' });
      }
      jointChildren.push({ id: 'joint-slot', kind: 'jointSlot', icon: '▭', label: '1. Fente' });
    }

    const bodyChildren: SceneNode[] = [
      { id: 'outline', kind: 'outline', icon: '✎', label: 'Profil' },
      ...params.assembly.anchors.map((anchor, index) => {
        const plan = sockets.find((socket) => socket.anchorId === anchor.id);
        return {
          id: anchor.id,
          kind: 'anchor' as const,
          icon: '⚓',
          label: index === 0 ? 'Attache de ligne' : `Support d hamecon ${index}`,
          warning: plan && !plan.valid ? (plan.problem ?? undefined) : undefined,
          onRemove: () => removeAnchor(anchor.id),
        };
      }),
      { id: 'eyes', kind: 'eyes', icon: '👁', label: 'Yeux', visible: params.eyes.enabled,
        onToggleVisible: () => updateParams({ eyes: { ...params.eyes, enabled: !params.eyes.enabled } }) },
      { id: 'gills', kind: 'gills', icon: '≈', label: 'Branchies', visible: params.gills.enabled,
        onToggleVisible: () => updateParams({ gills: { ...params.gills, enabled: !params.gills.enabled } }) },
      ...params.decals.map((decal) => ({
        id: decal.id,
        kind: 'decal' as const,
        icon: '◈',
        label: decal.name,
        visible: decal.visible,
        warning:
          decal.outline.nodes.length < 2
            ? 'Aucun contour dessine : ce decal ne marque pas le corps.'
            : undefined,
        dragGroup: 'decal',
        onDropBefore: (draggedId: string) => reorderDecal(draggedId, decal.id),
        onToggleVisible: () => updateDecal(decal.id, { visible: !decal.visible }),
        onDuplicate: () => duplicateDecal(decal.id),
        onRemove: () => removeDecal(decal.id),
        onRename: (name: string) => updateDecal(decal.id, { name }),
      })),
      ...params.inlays.map((inlay) => ({
        id: inlay.id,
        kind: 'inlay' as const,
        icon: '▬',
        label: inlay.name,
        visible: inlay.visible,
        warning:
          inlay.shape === 'custom' && inlay.outline.nodes.length < 2
            ? 'Aucun contour trace : cette rainure ne creuse rien.'
            : undefined,
        onToggleVisible: () => updateInlay(inlay.id, { visible: !inlay.visible }),
        onRename: (name: string) => updateInlay(inlay.id, { name }),
        onRemove: () =>
          setParams((current) => ({
            ...current,
            inlays: current.inlays.filter((item) => item.id !== inlay.id),
          })),
      })),
      { id: 'dowels', kind: 'dowels', icon: '⌷', label: 'Goupilles d assemblage',
        visible: params.dowels.enabled,
        warning: physics.dowels?.some((d) => !d.valid)
          ? 'Un logement au moins n a pas pu etre creuse.'
          : undefined,
        onToggleVisible: () => updateParams({ dowels: { ...params.dowels, enabled: !params.dowels.enabled } }) },
      { id: 'scales', kind: 'scales', icon: '⬡', label: 'Ecailles', visible: params.scales.enabled,
        onToggleVisible: () => updateParams({ scales: { ...params.scales, enabled: !params.scales.enabled } }) },
    ];

    if (params.hasBib) {
      bodyChildren.push({ id: 'bib', kind: 'bib', icon: '◣', label: 'Bavette' });
    }
    if (params.articulation.enabled) {
      bodyChildren.push({
        id: 'articulation',
        kind: 'articulation',
        icon: '⚯',
        label: 'Articulation',
        children: jointChildren,
        warning:
          params.assembly.enabled
            ? 'Ne se cumule pas avec l impression en deux coques.'
            : undefined,
        onRemove: () =>
          updateParams({ articulation: { ...params.articulation, enabled: false } }),
      });
    }
    for (const ballast of params.ballasts) {
      bodyChildren.push({
        id: ballast.id,
        kind: 'ballast',
        icon: '●',
        label: `Lest ${ballast.mass.toFixed(1)} g`,
      });
    }

    return [
      {
        id: 'project',
        kind: 'project',
        icon: '▤',
        label: name,
        onRename: setName,
        children: [
          { id: 'environment', kind: 'environment', icon: '≋', label: 'Environnement' },
          { id: 'body', kind: 'body', icon: '🐟', label: 'Corps', children: bodyChildren },
        ],
      },
    ];
  }, [params, sockets, name, physics, updateParams, updateDecal, updateInlay, duplicateDecal, removeDecal, reorderDecal, removeAnchor, setParams]);

  const onAddNode = useCallback(
    (what: AddKind) => {
      if (what === 'decal') return void addDecal();
      if (what === 'scales') {
        updateParams({ scales: { ...params.scales, enabled: true } });
        setSelectedNode('scales');
        setSelectedKind('scales');
        return;
      }
      if (what === 'articulation') {
        addArticulation();
        return;
      }
      if (what === 'template') {
        setRoute('gallery');
        // La bibliotheque de modeles vit sur l'ecran d'accueil : y renvoyer
        // vaut mieux que de dupliquer la liste dans un menu etroit.
        window.setTimeout(() => {
          document.getElementById('modeles-guides')?.scrollIntoView({ behavior: 'smooth' });
        }, 60);
        return;
      }
      if (what === 'eyes') {
        updateParams({ eyes: { ...params.eyes, enabled: true } });
        setSelectedNode('eyes');
        setSelectedKind('eyes');
        return;
      }
      if (what === 'anchor') return addAnchor();
      if (what === 'inlay') return addInlay();
      if (what === 'ballast') return addBallast();
      if (what === 'dowels') {
        updateParams({
          dowels: { ...params.dowels, enabled: true },
          assembly: { ...params.assembly, enabled: true },
        });
        setSelectedNode('dowels');
        setSelectedKind('dowels');
        return;
      }
      if (what === 'bib') {
        updateParams({ hasBib: true });
        setSelectedNode('bib');
        setSelectedKind('bib');
      }
    },
    [addDecal, addAnchor, addBallast, params, updateParams],
  );

  const selectedDecal = params.decals.find((decal) => decal.id === selectedNode) ?? null;
  const selectedInlay = params.inlays.find((item) => item.id === selectedNode) ?? null;
  const guide = guideId ? getTemplate(guideId) : undefined;
  const checks = useMemo(() => runPrintChecks(params, geo), [params, geo]);

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
            Bibliotheque
          </button>
          <button
            type="button"
            className="navlink"
            aria-current={route === 'editor' ? 'page' : undefined}
            onClick={() => setRoute('editor')}
          >
            Editeur
          </button>
          <button
            type="button"
            className="navlink"
            aria-current={route === 'editor' && panelTab === 'physics' ? 'page' : undefined}
            onClick={() => {
              setRoute('editor');
              setPane('panel');
              setPanelTab('physics');
            }}
          >
            Simuler
          </button>
          <button
            type="button"
            className="navlink"
            aria-current={route === 'editor' && panelTab === 'projects' ? 'page' : undefined}
            onClick={() => {
              setRoute('editor');
              setPane('panel');
              setPanelTab('projects');
            }}
          >
            Exporter
          </button>
        </nav>

        <span className="header__spacer" />

        <div className="header__actions">
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            aria-pressed={dark}
            title={dark ? 'Passer au theme clair' : 'Passer au theme sombre'}
            onClick={() => setDark((value) => !value)}
          >
            {dark ? '☀' : '☾'}
          </button>
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
            onTemplate={loadTemplate}
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
                onAddArticulation={addArticulation}
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
              jointFocus={selectedKind.startsWith('joint') || selectedKind === 'articulation'}
            />

            {editing ? (
              <OutlineEditor
                title={
                  editing.kind === 'outline'
                    ? 'Contour du profil'
                    : editing.kind === 'inlay'
                      ? 'Contour de la rainure'
                      : 'Contour du decal'
                }
                hint={
                  editing.kind === 'outline'
                    ? 'Le trace remplace le dos et le ventre calcules par les curseurs. La maquette 3D suit a chaque geste.'
                    : editing.kind === 'inlay'
                      ? 'La forme sera creusee a fond plat sur le flanc, pour recevoir un collant decoupe.'
                      : 'La forme sera projetee sur le corps puis mise en relief ou gravee.'
                }
                outline={
                  editing.kind === 'outline'
                    ? params.outline
                    : ((editing.kind === 'inlay'
                        ? params.inlays.find((d) => d.id === editing.id)?.outline
                        : params.decals.find((d) => d.id === editing.id)?.outline) ?? {
                        nodes: [],
                        closed: true,
                        mirror: false,
                      })
                }
                reference={
                  editing.kind === 'outline'
                    ? params.outlineReference
                    : ((editing.kind === 'inlay'
                        ? params.inlays.find((d) => d.id === editing.id)?.reference
                        : params.decals.find((d) => d.id === editing.id)?.reference) ??
                      emptyReference())
                }
                onChange={(outline) => {
                  if (editing.kind === 'outline') updateParams({ outline });
                  else if (!editing.id) return;
                  else if (editing.kind === 'inlay') updateInlay(editing.id, { outline });
                  else updateDecal(editing.id, { outline });
                }}
                onReference={(reference) => {
                  if (editing.kind === 'outline') updateParams({ outlineReference: reference });
                  else if (!editing.id) return;
                  else if (editing.kind === 'inlay') updateInlay(editing.id, { reference });
                  else updateDecal(editing.id, { reference });
                }}
                onClose={() => setEditing(null)}
                onUndo={history.undo}
                onRedo={history.redo}
                canUndo={history.canUndo}
                canRedo={history.canRedo}
              />
            ) : null}

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
                {panelTab === 'scene' ? (
                  <>
                    {guide ? (
                      <section className="guide">
                        <div className="guide__head">
                          <h3>{guide.label}</h3>
                          <button
                            type="button"
                            className="contour__close"
                            aria-label="Fermer le guide"
                            onClick={() => setGuideId(null)}
                          >
                            ✕
                          </button>
                        </div>
                        <p className="guide__lead">{guide.description}</p>
                        <dl className="guide__list">
                          {guide.guide.map((item) => (
                            <div key={item.setting}>
                              <dt>{item.setting}</dt>
                              <dd>{item.why}</dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                    ) : null}

                    <Outliner
                      nodes={sceneNodes}
                      selected={selectedNode}
                      params={params}
                      onSelect={(id, kind) => {
                        setSelectedNode(id);
                        setSelectedKind(kind);
                        if (kind === 'anchor') setSelectedAnchor(id);
                      }}
                      onAdd={onAddNode}
                    />

                    {selectedKind === 'decal' && selectedDecal ? (
                      <DecalInspector
                        decal={selectedDecal}
                        onChange={(patch) => updateDecal(selectedDecal.id, patch)}
                        onEditOutline={() => setEditing({ kind: 'decal', id: selectedDecal.id })}
                      />
                    ) : null}

                    {selectedKind === 'inlay' && selectedInlay ? (
                      <InlayInspector
                        inlay={selectedInlay}
                        onChange={(patch) => updateInlay(selectedInlay.id, patch)}
                        onEditOutline={() => setEditing({ kind: 'inlay', id: selectedInlay.id })}
                      />
                    ) : null}

                    {selectedKind === 'dowels' ? (
                      <DowelInspector
                        config={params.dowels}
                        placements={physics.dowels ?? []}
                        onChange={(patch) =>
                          updateParams({ dowels: { ...params.dowels, ...patch } })
                        }
                      />
                    ) : null}

                    {selectedKind === 'scales' ? (
                      <ScalesInspector
                        scales={params.scales}
                        onChange={(patch) =>
                          updateParams({ scales: { ...params.scales, ...patch } })
                        }
                      />
                    ) : null}

                    {selectedKind === 'outline' ? (
                      <Fieldset
                        legend="Profil"
                        hint="Silhouette dessinee a la main par-dessus une photo. Tant qu elle est vide, le dos et le ventre suivent les curseurs de forme."
                      >
                        <button
                          type="button"
                          className="btn btn--primary btn--block"
                          onClick={() => setEditing({ kind: 'outline' })}
                        >
                          {params.outline.nodes.length >= 2
                            ? 'Modifier la silhouette'
                            : 'Dessiner la silhouette'}
                        </button>
                        {params.outline.nodes.length >= 2 ? (
                          <button
                            type="button"
                            className="btn btn--block btn--ghost btn--danger"
                            onClick={() =>
                              updateParams({ outline: { nodes: [], closed: true, mirror: false } })
                            }
                          >
                            Revenir aux curseurs
                          </button>
                        ) : null}
                      </Fieldset>
                    ) : null}

                    {selectedKind === 'articulation' ? (
                      <ArticulationInspector
                        config={params.articulation}
                        lengthMm={params.length}
                        effectiveSwing={geo.jointPlan ? geo.jointPlan.swing : null}
                        onChange={(patch) =>
                          updateParams({ articulation: { ...params.articulation, ...patch } })
                        }
                        onFit={fitJoint}
                      />
                    ) : null}

                    {selectedKind === 'jointEye' || selectedKind === 'jointPin' ? (
                      <JointEyeInspector
                        config={params.articulation}
                        onChange={(patch) =>
                          updateParams({ articulation: { ...params.articulation, ...patch } })
                        }
                      />
                    ) : null}

                    {selectedKind === 'jointSlot' ? (
                      <JointSlotInspector
                        config={params.articulation}
                        onChange={(patch) =>
                          updateParams({ articulation: { ...params.articulation, ...patch } })
                        }
                      />
                    ) : null}

                    <details className="advanced advanced--panel" open>
                      <summary>Fabrication &amp; validation</summary>
                      <PrintInspector
                        print={params.print}
                        params={params}
                        onChange={(patch) =>
                          updateParams({ print: { ...params.print, ...patch } })
                        }
                        onParams={updateParams}
                      />

                      <div className={`verdict verdict--${physics.buoyancy}`}>
                        {physics.buoyancy === 'float'
                          ? '🔵 CE LEURRE VA FLOTTER'
                          : physics.buoyancy === 'suspend'
                            ? '🟡 CE LEURRE SERA SUSPENDU'
                            : '⚫ CE LEURRE VA COULER'}
                      </div>
                      <dl className="readout">
                        <div>
                          <dt>Volume</dt>
                          <dd>{physics.volumeCm3.toFixed(2)} cm3</dd>
                        </div>
                        <div>
                          <dt>Poids</dt>
                          <dd>{physics.totalMass.toFixed(2)} g</dd>
                        </div>
                        <div>
                          <dt>vs eau</dt>
                          <dd>
                            {Math.abs(physics.totalMass - physics.displacedMass).toFixed(2)} g
                            {physics.totalMass < physics.displacedMass
                              ? ' plus leger que l eau'
                              : ' plus lourd que l eau'}
                          </dd>
                        </div>
                      </dl>

                      <p className="control__hint">Controle d impression</p>
                      <ul className="checks">
                        {checks.map((check) => (
                          <li key={check.id} className={check.ok ? 'checks__ok' : 'checks__warn'}>
                            <span aria-hidden="true">{check.ok ? '✅' : '⚠️'}</span>
                            <div>
                              <strong>{check.label}</strong>
                              <span>{check.detail}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <p className={checks.every((c) => c.ok) ? 'ready ready--ok' : 'ready'}>
                        {checks.every((c) => c.ok)
                          ? 'Pret a imprimer.'
                          : `${checks.filter((c) => !c.ok).length} point(s) a regarder avant d imprimer.`}
                      </p>
                    </details>
                  </>
                ) : null}
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
                {panelTab === 'tackle' ? (
                  <TacklePanel params={params} physics={physics} onChange={updateParams} />
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
                    sockets={plans.sockets}
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

          {/*
            Barre d'etat : ce qu'il faut savoir en permanence sans quitter le
            modele des yeux — ou en est la sauvegarde, ce que pese la piece,
            et de quoi basculer l'affichage.
          */}
          <footer className="statusbar">
            <span className={`statusbar__save statusbar__save--${saveState}`}>
              {saveState === 'saved'
                ? 'Enregistre'
                : saveState === 'saving'
                  ? 'Enregistrement…'
                  : 'Synchronisation en attente'}
            </span>

            <span className={`statusbar__buoy statusbar__buoy--${physics.buoyancy}`}>
              {physics.buoyancy === 'float'
                ? 'Flotte'
                : physics.buoyancy === 'suspend'
                  ? 'Suspend'
                  : 'Coule'}{' '}
              · {physics.totalMass.toFixed(1)} g
            </span>

            <span className="statusbar__spacer" />

            <button
              type="button"
              className="statusbar__toggle"
              onClick={history.undo}
              disabled={!history.canUndo}
              title="Annuler (Ctrl+Z)"
            >
              ↶ Annuler
            </button>
            <button
              type="button"
              className="statusbar__toggle"
              onClick={history.redo}
              disabled={!history.canRedo}
              title="Retablir (Ctrl+Maj+Z)"
            >
              ↷ Retablir
            </button>

            <button
              type="button"
              className="statusbar__toggle"
              aria-pressed={params.scales.baked}
              disabled={!params.scales.enabled}
              onClick={() =>
                updateParams({ scales: { ...params.scales, baked: !params.scales.baked } })
              }
            >
              Ecailles cuites
            </button>
            <button
              type="button"
              className="statusbar__toggle"
              aria-pressed={params.print.finish === 'faceted'}
              onClick={() =>
                updateParams({
                  print: {
                    ...params.print,
                    finish: params.print.finish === 'faceted' ? 'smooth' : 'faceted',
                  },
                })
              }
            >
              Facette
            </button>
            <button
              type="button"
              className="statusbar__toggle"
              onClick={() => document.documentElement.requestFullscreen?.()}
            >
              Plein ecran
            </button>
          </footer>
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
