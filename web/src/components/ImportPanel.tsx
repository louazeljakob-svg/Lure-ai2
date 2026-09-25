/**
 * Panneau Import — modules W et AD.
 *
 * 1. Import et preparation : lecture, reparations sures, orientation
 *    corrigeable, echelle.
 * 2. Banc d'essai : le modele tel quel, passe dans les memes modeles que les
 *    familles — flottabilite, centres, nage, rupture, impression.
 * 3. Industrialisation : le principe de fabrication du logiciel applique au
 *    maillage, sur commande, avec le compte rendu de chaque implantation.
 */

import { useEffect, useRef, useState } from 'react';
import type { LureParams, WaterId } from '../types/lure';
import { getMaterial, WATER_LABEL } from '../lib/materials';
import { decimate, type ImportedMesh, type OrientationOverride } from '../lib/importMesh';
import type { MeshBody } from '../lib/meshBody';
import { guessFamily, topologyBlocks, type BenchResult, type IndustrialReport } from '../lib/industrialise';
import {
  benchInBackground,
  computeSite,
  importInBackground,
  industrialiseInBackground,
  overallProgress,
  Superseded,
} from '../lib/importJobs';
import { FLOAT_LABEL } from '../lib/archetypes';
import { LIMITS } from '../lib/presets';
import { Fieldset, Segmented, Slider, Switch } from './ui';

interface Props {
  params: LureParams;
  water: WaterId;
  mesh: ImportedMesh | null;
  onMesh: (mesh: ImportedMesh | null) => void;
  onToast: (message: string, kind?: 'ok' | 'error') => void;
  /** Ouvre le projet industrialise dans l'editeur. */
  onOpenIndustrial: (params: LureParams, name: string) => void;
}

const mm = (value: number) => `${value.toFixed(1)} mm`;
const pct = (value: number) => `${Math.round(value * 100)} %`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(2).replace('.', ',')} s`;

type Unit = '1' | '10' | '25.4';
const UNITS: { value: Unit; label: string }[] = [
  { value: '1', label: 'mm' },
  { value: '10', label: 'cm' },
  { value: '25.4', label: 'pouce' },
];

type Target = 'auto' | 'float' | 'suspend' | 'sink';

interface ReadOptions {
  unit: Unit;
  targetLength: number;
  override: OrientationOverride;
  factor: number;
  mirrorHalf: boolean;
}

/** Taille au-dela de laquelle un fichier est refuse avant lecture. */
const MAX_FILE_BYTES = 400 * 1024 * 1024;

export function ImportPanel({ params, water, mesh, onMesh, onToast, onOpenIndustrial }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [source, setSource] = useState<{ name: string; data: ArrayBuffer } | null>(null);
  const [unit, setUnit] = useState<Unit>('1');
  const [targetLength, setTargetLength] = useState(0);
  const [factor, setFactor] = useState(1);
  const [override, setOverride] = useState<OrientationOverride>({});
  const [mirrorHalf, setMirrorHalf] = useState(true);
  const [body, setBody] = useState<MeshBody | null>(null);
  const [progress, setProgress] = useState<{ stage: string; value: number } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [importMs, setImportMs] = useState<number | null>(null);
  const [site, setSite] = useState<'worker' | 'main' | null>(null);
  const [bench, setBench] = useState<BenchResult | null>(null);
  const [benchBusy, setBenchBusy] = useState(false);
  const [hollow, setHollow] = useState(true);
  const [wall, setWall] = useState(1.6);
  const [target, setTarget] = useState<Target>('auto');
  const [acceptEnvelope, setAcceptEnvelope] = useState(false);
  const [industrial, setIndustrial] = useState<{ params: LureParams | null; report: IndustrialReport; ms: number } | null>(null);
  const [industrialBusy, setIndustrialBusy] = useState(false);
  const reading = progress !== null;

  useEffect(() => {
    void computeSite().then(setSite);
  }, []);

  /** (Re)lit la source avec les reglages courants ; rien n'est modifie en place. */
  const read = (file: { name: string; data: ArrayBuffer }, options: ReadOptions) => {
    setFailure(null);
    setProgress({ stage: 'Lecture du fichier', value: 0 });
    importInBackground(
      file.name,
      file.data,
      {
        unitToMm: Number(options.unit) * options.factor,
        targetLengthMm: options.targetLength > 0 ? options.targetLength : undefined,
        orientation: options.override,
        mirrorHalf: options.mirrorHalf,
      },
      (stage, fraction) => setProgress({ stage, value: overallProgress(stage, fraction) }),
    ).then(
      ({ mesh: loaded, body: created, ms }) => {
        setProgress(null);
        setImportMs(ms);
        setBody(created);
        setIndustrial(null);
        onMesh(loaded);
        onToast(`${file.name} : ${loaded.diagnosis.triangles.toLocaleString('fr-FR')} facettes lues en ${seconds(ms)}`, 'ok');
      },
      (error: unknown) => {
        if (error instanceof Superseded) return;
        setProgress(null);
        const message = error instanceof Error ? error.message : 'cause inconnue';
        setFailure(`Import de ${file.name} impossible — ${message}`);
        onToast(`Import impossible : ${message}`, 'error');
      },
    );
  };

  const load = async (file: File) => {
    setFailure(null);
    if (file.size === 0) {
      setFailure(`Import de ${file.name} impossible — le fichier est vide (0 octet).`);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFailure(
        `Import de ${file.name} impossible — ${(file.size / 1048576).toFixed(0)} Mo depassent la limite de ` +
          `${MAX_FILE_BYTES / 1048576} Mo que le navigateur peut tenir en memoire avec ses reparations.`,
      );
      return;
    }
    let data: ArrayBuffer;
    try {
      data = await file.arrayBuffer();
    } catch (error) {
      setFailure(
        `Import de ${file.name} impossible — le navigateur n a pas pu lire le fichier (${
          error instanceof Error ? error.message : 'acces refuse'
        }).`,
      );
      return;
    }
    const next = { name: file.name, data };
    setSource(next);
    setOverride({});
    setMirrorHalf(true);
    read(next, { unit, targetLength, override: {}, factor, mirrorHalf: true });
  };

  const reread = (patch: Partial<ReadOptions>) => {
    const options = { unit, targetLength, override, factor, mirrorHalf, ...patch };
    if (patch.factor !== undefined) setFactor(patch.factor);
    if (patch.unit !== undefined) setUnit(patch.unit);
    if (patch.targetLength !== undefined) setTargetLength(patch.targetLength);
    if (patch.override !== undefined) setOverride(patch.override);
    if (patch.mirrorHalf !== undefined) setMirrorHalf(patch.mirrorHalf);
    if (source) read(source, options);
  };

  const turn = (axis: 'x' | 'y' | 'z') => reread({ override: { ...override, turns: [...(override.turns ?? []), axis] } });

  // Banc d'essai : recalcule quand le maillage, le materiau ou l'eau changent.
  const settings = `${params.material}|${params.infill}|${params.print.perimeters}|${water}`;
  useEffect(() => {
    if (!mesh || !body) {
      setBench(null);
      return;
    }
    let live = true;
    setBenchBusy(true);
    benchInBackground({ material: params.material, infill: params.infill, print: params.print }, water).then(
      ({ bench: result }) => {
        if (!live) return;
        setBench(result);
        setBenchBusy(false);
      },
      (error: unknown) => {
        if (!live || error instanceof Superseded) return;
        setBench(null);
        setBenchBusy(false);
        onToast(error instanceof Error ? `Banc d essai : ${error.message}` : 'Banc d essai impossible', 'error');
      },
    );
    return () => {
      live = false;
    };
    // Les reglages qui comptent sont resumes dans `settings`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesh, body, settings]);

  const run = () => {
    if (!mesh || !body) return;
    setIndustrialBusy(true);
    industrialiseInBackground(
      { material: params.material, infill: params.infill, print: params.print },
      { hollow, wall, target: target === 'auto' ? undefined : target, acceptEnvelope },
    ).then(
      (result) => {
        setIndustrial(result);
        setIndustrialBusy(false);
      },
      (error: unknown) => {
        setIndustrialBusy(false);
        if (error instanceof Superseded) return;
        onToast(error instanceof Error ? `Industrialisation : ${error.message}` : 'Industrialisation impossible', 'error');
      },
    );
  };

  const clear = () => {
    onMesh(null);
    setSource(null);
    setBody(null);
    setBench(null);
    setIndustrial(null);
    setFailure(null);
    setImportMs(null);
  };

  const blocks = mesh && body ? topologyBlocks(mesh, body, acceptEnvelope) : [];
  const envelopeMatters = mesh && body ? topologyBlocks(mesh, body, false).length !== topologyBlocks(mesh, body, true).length : false;
  const family = mesh && body ? guessFamily(body, mesh.bib) : null;
  const material = getMaterial(params.material);
  const intersections = mesh?.intersections;

  return (
    <div className="panel__body">
      <Fieldset
        legend="Importer un maillage"
        hint="STL binaire ou ASCII (reconnu a son contenu, pas a son extension), et OBJ. Les fichiers STL n ont pas d unite : dites laquelle, ou imposez la longueur reelle."
      >
        <div
          className={`import-drop${dragging ? ' import-drop--over' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) void load(file);
          }}
        >
          {progress ? (
            <div className="import-progress" role="status" aria-live="polite">
              <div className="import-progress__row">
                <span>{progress.stage}…</span>
                <span>{Math.round(progress.value * 100)} %</span>
              </div>
              <div className="import-progress__bar" aria-hidden="true">
                <span style={{ width: `${Math.max(2, progress.value * 100)}%` }} />
              </div>
            </div>
          ) : (
            <p>Glissez un fichier ici, ou</p>
          )}
          <button type="button" className="toolbtn" disabled={reading} onClick={() => input.current?.click()}>
            Importer un STL
          </button>
          <input
            ref={input}
            type="file"
            accept=".stl,.obj,model/stl"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void load(file);
              event.target.value = '';
            }}
          />
          {site ? (
            <p className="import-site">
              {site === 'worker'
                ? 'Calcul en arriere-plan : l interface reste utilisable pendant la lecture.'
                : 'Ce navigateur refuse le calcul en arriere-plan : la lecture se fait sur la page, qui peut ralentir.'}
            </p>
          ) : null}
        </div>
        {failure ? (
          <p className="import-failure" role="alert">
            {failure}
          </p>
        ) : null}
        <Segmented
          label="Unite du fichier"
          value={unit}
          options={UNITS}
          onChange={(value) => reread({ unit: value })}
        />
        <Slider
          label="Facteur d echelle"
          value={factor}
          min={0.25}
          max={4}
          step={0.05}
          hardMin={0.01}
          hardMax={100}
          display={`x ${factor.toFixed(2)}`}
          unit="x"
          disabled={targetLength > 0}
          hint="Agrandit ou reduit le modele d un bloc, apres conversion d unite."
          onChange={(value) => reread({ factor: value })}
        />
        <Slider
          label="Longueur cible"
          value={targetLength}
          min={0}
          max={LIMITS.length.max}
          step={1}
          hardMax={1000}
          display={targetLength > 0 ? mm(targetLength) : 'Echelle du fichier'}
          unit="mm"
          hint="Zero : le fichier est pris a son unite. Sinon, le modele est mis a cette longueur hors-tout."
          onChange={(value) => reread({ targetLength: value })}
        />
        {mesh ? (
          <button type="button" className="toolbtn" onClick={clear}>
            Retirer le maillage importe
          </button>
        ) : null}
      </Fieldset>

      {mesh && body ? (
        <>
          <Fieldset legend="Fiche du maillage" hint="Mesures sur le maillage repare et mis en place, a l echelle choisie.">
            <table className="balance-table">
              <tbody>
                <tr>
                  <th>Facettes</th>
                  <td>
                    {mesh.diagnosis.triangles.toLocaleString('fr-FR')} ({mesh.format}
                    {importMs !== null ? `, lues en ${seconds(importMs)}` : ''})
                  </td>
                </tr>
                <tr>
                  <th>Cotes hors-tout</th>
                  <td>
                    {mm(mesh.bounds.length)} x {mm(mesh.bounds.height)} x {mm(mesh.bounds.width)}
                    <span className="control__hint"> (longueur x hauteur x largeur)</span>
                  </td>
                </tr>
                <tr>
                  <th>Volume</th>
                  <td>{mesh.volume.toFixed(2)} cm3</td>
                </tr>
                {mesh.halfShell ? (
                  <tr>
                    <th>Demi-coque</th>
                    <td>
                      Face de joint de {mesh.halfShell.jointAreaCm2.toFixed(2)} cm2 · fichier {mesh.halfShell.fileVolume.toFixed(2)} cm3
                      {mesh.halfShell.completed ? ' · leurre entier reconstitue' : ' · prise telle quelle'}
                    </td>
                  </tr>
                ) : null}
                <tr>
                  <th>Orientation detectee</th>
                  <td>{mesh.orientation.note}</td>
                </tr>
              </tbody>
            </table>
            {mesh.warnings.length ? (
              <ul className="import-limits">
                {mesh.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </Fieldset>

          <Fieldset
            legend="Orientation"
            hint="Repere de fabrication : nez vers -X, dos vers +Y, plan de symetrie vertical. Le modele est toujours recentre sur l origine."
          >
            <Switch
              label="Mode manuel"
              checked={override.manual === true}
              hint="Garde le repere du fichier sans detection : vous le corrigez par quarts de tour et inversions."
              onChange={(manual) => reread({ override: { manual } })}
            />
            <div className="button-row">
              <button type="button" className="toolbtn" onClick={() => reread({ override: { ...override, flipNose: !override.flipNose } })}>
                Inverser nez / queue
              </button>
              <button type="button" className="toolbtn" onClick={() => reread({ override: { ...override, flipBack: !override.flipBack } })}>
                Inverser dos / ventre
              </button>
            </div>
            <div className="button-row" role="group" aria-label="Rotation par quart de tour">
              <button type="button" className="toolbtn" onClick={() => turn('x')}>
                90 deg autour de X
              </button>
              <button type="button" className="toolbtn" onClick={() => turn('y')}>
                90 deg autour de Y
              </button>
              <button type="button" className="toolbtn" onClick={() => turn('z')}>
                90 deg autour de Z
              </button>
            </div>
            {override.manual ? null : (
              <>
                <Segmented
                  label="Axe longitudinal du fichier"
                  value={String(override.axis ?? mesh.orientation.axis) as '0' | '1' | '2'}
                  options={[
                    { value: '0', label: 'X' },
                    { value: '1', label: 'Y' },
                    { value: '2', label: 'Z' },
                  ]}
                  onChange={(value) => reread({ override: { ...override, axis: Number(value) as 0 | 1 | 2 } })}
                />
                <Switch
                  label="Aligner sur les axes principaux"
                  checked={override.align === true}
                  hint="Pour un modele dessine de biais : recale l axe du corps sur ses axes d inertie avant de l orienter."
                  onChange={(align) => reread({ override: { ...override, align } })}
                />
              </>
            )}
            {Object.keys(override).length ? (
              <button type="button" className="toolbtn" onClick={() => reread({ override: {} })}>
                Revenir a l orientation detectee
              </button>
            ) : null}
            {mesh.halfShell ? (
              <Switch
                label="Reconstituer le leurre entier par symetrie"
                checked={mirrorHalf}
                hint="Le fichier est une demi-coque, reconnue a sa face de joint plane. Sans reconstitution, volume et banc portent sur la moitie, et l industrialisation est bloquee."
                onChange={(on) => reread({ mirrorHalf: on })}
              />
            ) : null}
          </Fieldset>

          <Fieldset legend="Diagnostic et reparations" hint="Seules les reparations sures sont faites ; les autres sont signalees avec ce qu elles bloquent.">
            <table className="balance-table">
              <thead>
                <tr>
                  <th />
                  <th>Recu</th>
                  <th>Apres reparation</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Facettes', mesh.before.triangles, mesh.diagnosis.triangles],
                    ['Aretes ouvertes', mesh.before.openEdges, mesh.diagnosis.openEdges],
                    ['Aretes non-manifold', mesh.before.nonManifold, mesh.diagnosis.nonManifold],
                    ['Faces a contresens', mesh.before.flipped, mesh.diagnosis.flipped],
                    ['Sommets dupliques', mesh.before.welded, 0],
                    ['Faces en double', mesh.diagnosis.duplicates, 0],
                  ] as [string, number, number][]
                ).map(([label, before, after]) => (
                  <tr key={label}>
                    <th>{label}</th>
                    <td>{before.toLocaleString('fr-FR')}</td>
                    <td>{after.toLocaleString('fr-FR')}</td>
                  </tr>
                ))}
                <tr>
                  <th>Etanche</th>
                  <td>{mesh.before.watertight ? 'oui' : 'non'}</td>
                  <td>{mesh.diagnosis.watertight ? 'oui' : 'non'}</td>
                </tr>
                <tr>
                  <th>Auto-intersections</th>
                  <td colSpan={2}>
                    {intersections
                      ? `${intersections.within.toLocaleString('fr-FR')} dans une meme piece · ${intersections.between.toLocaleString('fr-FR')} entre pieces` +
                        (intersections.partial ? ' (recherche arretee au plafond)' : '')
                      : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
            {mesh.repairs.length ? (
              <ul className="import-limits">
                {mesh.repairs.map((repair) => (
                  <li key={repair.label}>
                    {repair.label} : {repair.count.toLocaleString('fr-FR')}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="control__hint">Aucune reparation necessaire.</p>
            )}
            <p className="control__hint">
              {mesh.components.length} piece(s) :{' '}
              {mesh.components
                .map((part) =>
                  part.role === 'body'
                    ? 'corps'
                    : part.role === 'bib'
                      ? 'bavette detachee'
                      : part.role === 'ignored'
                        ? 'piece a l ecart (ignoree)'
                        : 'piece rapportee',
                )
                .join(', ')}
              {mesh.bib
                ? ` · bavette ${mm(mesh.bib.lengthMm)} x ${mm(mesh.bib.widthMm)} x ${mm(mesh.bib.thicknessMm)} a ${Math.round(mesh.bib.angleDeg)} deg`
                : ''}
            </p>
            {mesh.limits.length ? (
              <ul className="import-limits">
                {mesh.limits.map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
            ) : null}
            <Switch
              label="Affichage allege (20 000 facettes)"
              checked={mesh.display !== null}
              hint="Pour l edition seulement : le banc d essai, l industrialisation et l export restent sur le maillage d origine."
              onChange={(on) => {
                const display = on ? decimate(mesh.positions, 20000) : null;
                body.display = display;
                onMesh({ ...mesh, display });
              }}
            />
          </Fieldset>

          <Fieldset
            legend="Banc d essai"
            hint="Le modele tel quel, imprime d un seul tenant, avec des hamecons a sa taille. Estimations d ingenierie : a comparer entre deux versions, a recaler par une pesee et un essai."
          >
            {benchBusy || !bench ? (
              <p className="control__hint">Mesure du modele en cours…</p>
            ) : (
              <>
                <table className="balance-table">
                  <tbody>
                    <tr>
                      <th>Volume</th>
                      <td>{bench.physics.volumeCm3.toFixed(2)} cm3</td>
                    </tr>
                    <tr>
                      <th>Masse en service</th>
                      <td>
                        {bench.physics.totalMass.toFixed(1)} g ({material.label}, {params.print.perimeters} parois,{' '}
                        {params.infill} %)
                      </td>
                    </tr>
                    <tr>
                      <th>Poussee ({WATER_LABEL[water].toLowerCase()})</th>
                      <td>{bench.physics.displacedMass.toFixed(1)} g</td>
                    </tr>
                    <tr>
                      <th>Verdict</th>
                      <td>
                        {FLOAT_LABEL[bench.physics.buoyancy]} · rapport {bench.physics.ratio.toFixed(2)} ·{' '}
                        {bench.marginG >= 0
                          ? `${bench.marginG.toFixed(1)} g de reserve`
                          : `${(-bench.marginG).toFixed(1)} g de trop`}
                      </td>
                    </tr>
                    <tr>
                      <th>Centre de masse</th>
                      <td>
                        X {mm(bench.cgMm.x)} du nez · Y {mm(bench.cgMm.y)} · Z {mm(bench.cgMm.z)}
                      </td>
                    </tr>
                    <tr>
                      <th>Centre de carene</th>
                      <td>
                        X {mm(bench.cbMm.x)} du nez · Y {mm(bench.cbMm.y)} · Z {mm(bench.cbMm.z)}
                      </td>
                    </tr>
                    <tr>
                      <th>Assiette au repos</th>
                      <td>
                        {bench.physics.trimDeg.toFixed(1)} deg · redressement {bench.physics.rollMarginMm.toFixed(1)} mm
                      </td>
                    </tr>
                  </tbody>
                </table>

                <p className="control__hint">Nage (hypotheses par defaut du simulateur)</p>
                <table className="balance-table">
                  <tbody>
                    <tr>
                      <th>Vitesse de decrochage</th>
                      <td>
                        {bench.swim.critical.low.toFixed(1)} a {bench.swim.critical.high.toFixed(1)} km/h
                      </td>
                    </tr>
                    <tr>
                      <th>Profondeur (2,5 a 3,5 km/h, 20 m)</th>
                      <td>
                        {bench.swim.depth
                          ? `${bench.swim.depth[0].toFixed(1)} a ${bench.swim.depth[1].toFixed(1)} m`
                          : 'Sans bavette : nage en surface ou selon le lest'}
                      </td>
                    </tr>
                    <tr>
                      <th>Oscillation a {bench.swim.sweet.toFixed(1)} km/h</th>
                      <td>
                        {bench.swim.frequencyHz.toFixed(1)} Hz · lacet {bench.swim.yawDeg.toFixed(0)} deg · roulis{' '}
                        {bench.swim.rollDeg.toFixed(0)} deg
                      </td>
                    </tr>
                    <tr>
                      <th>Action</th>
                      <td>{bench.swim.action}</td>
                    </tr>
                    {bench.swim.currents.map((item) => (
                      <tr key={item.label}>
                        <th>{item.label} (traine 3 km/h)</th>
                        <td>
                          {item.relative.toFixed(1)} km/h vus
                          {bench.swim.depth ? ` · ${item.depth.toFixed(1)} m` : ''}
                          {item.overSpeed ? ' · DECROCHE' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <p className="control__hint">Charge de rupture par ancrage (goupille en 8 inox 304 proposee)</p>
                {bench.anchors.length ? (
                  <table className="balance-table">
                    <tbody>
                      {bench.anchors.map((anchor) => (
                        <tr key={anchor.label}>
                          <th>{anchor.label}</th>
                          <td>
                            {anchor.kgf.low.toFixed(1)} a {anchor.kgf.high.toFixed(1)} kgf — {anchor.modeLabel}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="control__hint">Aucune portee de goupille ne tient sur ce corps : voir l industrialisation.</p>
                )}

                <p className="control__hint">Controle d impression</p>
                <ul className="checks">
                  {bench.checks.map((check) => (
                    <li key={check.id} className={check.ok ? 'checks__ok' : 'checks__warn'}>
                      <span aria-hidden="true">{check.ok ? '✅' : '⚠️'}</span>
                      <div>
                        <strong>{check.label}</strong>
                        <span>{check.detail}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                <table className="balance-table">
                  <tbody>
                    {bench.orientations.map((item) => (
                      <tr key={item.label}>
                        <th>{item.label}</th>
                        <td>{pct(item.share)} en surplomb</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="control__hint">Orientation conseillee : {bench.recommended}</p>
              </>
            )}
          </Fieldset>

          <Fieldset
            legend="Industrialisation"
            hint="Applique le principe de fabrication du logiciel : creusage, deux demi-coques avec gorge de colle et ergots, vis a ecrou captif, goupilles en 8, fente de bavette, lest. Chaque implantation est proposee puis reste reglable dans l editeur."
          >
            {family ? (
              <p className="control__hint">
                Reglages de depart pris sur la famille « {family.id} » : {family.why}.
              </p>
            ) : null}
            <Switch
              label="Creusage en coque"
              checked={hollow}
              hint="Chambres a paroi constante, cloisons pleines au droit des logements. En FDM peu rempli, le bilan dira si cela allege vraiment."
              onChange={setHollow}
            />
            <Slider
              label="Paroi"
              value={wall}
              {...LIMITS.hollowWall}
              display={mm(wall)}
              disabled={!hollow}
              onChange={setWall}
            />
            <Segmented
              label="Comportement vise pour le lest"
              value={target}
              options={[
                { value: 'auto', label: 'Famille' },
                { value: 'float', label: 'Flottant' },
                { value: 'suspend', label: 'Suspendu' },
                { value: 'sink', label: 'Coulant' },
              ]}
              onChange={setTarget}
            />
            {envelopeMatters ? (
              <Switch
                label="Accepter l enveloppe"
                checked={acceptEnvelope}
                hint="La face avant est creusee : les coques combleraient la cuvette et changeraient l action. A n accepter qu en connaissance de cause."
                onChange={setAcceptEnvelope}
              />
            ) : null}
            {blocks.length ? (
              <ul className="import-limits">
                {blocks.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
            <button type="button" className="btn btn--block" disabled={industrialBusy} onClick={run}>
              {industrialBusy ? 'Industrialisation en cours…' : 'Industrialiser'}
            </button>

            {industrial ? (
              <>
                <p className="control__hint">Calcule en {seconds(industrial.ms)}.</p>
                {industrial.report.physics ? (
                  <p className="ready ready--ok">
                    {FLOAT_LABEL[industrial.report.physics.buoyancy]} · {industrial.report.physics.totalMass.toFixed(1)} g · rapport{' '}
                    {industrial.report.physics.ratio.toFixed(2)} · centre de masse a {Math.round(industrial.report.physics.cgPct)} % du nez
                  </p>
                ) : null}
                <ul className="checks">
                  {industrial.report.placements.map((item, index) => (
                    <li key={`${item.label}-${index}`} className="checks__ok">
                      <span aria-hidden="true">•</span>
                      <div>
                        <strong>{item.label}</strong>
                        <span>{item.detail}</span>
                      </div>
                    </li>
                  ))}
                  {industrial.report.envelope.map((line, index) => (
                    <li key={`enveloppe-${index}`} className="checks__info">
                      <span aria-hidden="true">ℹ️</span>
                      <div>
                        <span>{line}</span>
                      </div>
                    </li>
                  ))}
                  {[...industrial.report.blocked, ...industrial.report.problems].map((line, index) => (
                    <li key={`${line}-${index}`} className="checks__warn">
                      <span aria-hidden="true">⚠️</span>
                      <div>
                        <span>{line}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                {industrial.params ? (
                  <button
                    type="button"
                    className="btn btn--primary btn--block"
                    onClick={() => onOpenIndustrial(industrial.params!, `${mesh.name.replace(/\.(stl|obj)$/i, '')} industrialise`)}
                  >
                    Ouvrir dans l editeur
                  </button>
                ) : null}
              </>
            ) : null}
          </Fieldset>
        </>
      ) : null}
    </div>
  );
}
