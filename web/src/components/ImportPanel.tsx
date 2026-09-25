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
import { decimate, importMesh, type ImportedMesh, type OrientationOverride } from '../lib/importMesh';
import { createMeshBody, registerMeshBody, type MeshBody } from '../lib/meshBody';
import {
  guessFamily,
  industrialise,
  runBench,
  topologyBlocks,
  type BenchResult,
  type IndustrialReport,
} from '../lib/industrialise';
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

type Unit = '1' | '10' | '25.4';
const UNITS: { value: Unit; label: string }[] = [
  { value: '1', label: 'mm' },
  { value: '10', label: 'cm' },
  { value: '25.4', label: 'pouce' },
];

type Target = 'auto' | 'float' | 'suspend' | 'sink';

/** Laisse le navigateur peindre l'etat « en cours » avant un calcul lourd. */
const later = (task: () => void) => window.setTimeout(task, 30);

export function ImportPanel({ params, water, mesh, onMesh, onToast, onOpenIndustrial }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [source, setSource] = useState<{ name: string; data: ArrayBuffer } | null>(null);
  const [unit, setUnit] = useState<Unit>('1');
  const [targetLength, setTargetLength] = useState(0);
  const [factor, setFactor] = useState(1);
  const [override, setOverride] = useState<OrientationOverride>({});
  const [body, setBody] = useState<MeshBody | null>(null);
  const [reading, setReading] = useState(false);
  const [bench, setBench] = useState<BenchResult | null>(null);
  const [benchBusy, setBenchBusy] = useState(false);
  const [hollow, setHollow] = useState(true);
  const [wall, setWall] = useState(1.6);
  const [target, setTarget] = useState<Target>('auto');
  const [acceptEnvelope, setAcceptEnvelope] = useState(false);
  const [industrial, setIndustrial] = useState<{ params: LureParams | null; report: IndustrialReport } | null>(null);
  const [industrialBusy, setIndustrialBusy] = useState(false);

  /** (Re)lit la source avec les reglages courants ; rien n'est modifie en place. */
  const read = (
    file: { name: string; data: ArrayBuffer },
    options: { unit: Unit; targetLength: number; override: OrientationOverride; factor: number },
  ) => {
    setReading(true);
    later(() => {
      try {
        const loaded = importMesh(file.name, file.data, {
          unitToMm: Number(options.unit) * options.factor,
          targetLengthMm: options.targetLength > 0 ? options.targetLength : undefined,
          orientation: options.override,
        });
        const created = createMeshBody(`maillage-${Date.now()}`, file.name, loaded.body, null);
        registerMeshBody(created);
        setBody(created);
        setIndustrial(null);
        onMesh(loaded);
        onToast(`${file.name} : ${loaded.diagnosis.triangles.toLocaleString('fr-FR')} facettes`, 'ok');
      } catch (error) {
        onToast(error instanceof Error ? error.message : 'Import impossible', 'error');
      } finally {
        setReading(false);
      }
    });
  };

  const load = async (file: File) => {
    const data = await file.arrayBuffer();
    const next = { name: file.name, data };
    setSource(next);
    setOverride({});
    read(next, { unit, targetLength, override: {}, factor });
  };

  const reread = (patch: Partial<{ unit: Unit; targetLength: number; override: OrientationOverride; factor: number }>) => {
    const options = { unit, targetLength, override, factor, ...patch };
    if (patch.factor !== undefined) setFactor(patch.factor);
    if (patch.unit !== undefined) setUnit(patch.unit);
    if (patch.targetLength !== undefined) setTargetLength(patch.targetLength);
    if (patch.override !== undefined) setOverride(patch.override);
    if (source) read(source, options);
  };

  // Banc d'essai : recalcule quand le maillage, le materiau ou l'eau changent.
  const settings = `${params.material}|${params.infill}|${params.print.perimeters}|${water}`;
  useEffect(() => {
    if (!mesh || !body) {
      setBench(null);
      return;
    }
    setBenchBusy(true);
    const timer = later(() => {
      try {
        setBench(runBench(mesh, body, params, water));
      } catch (error) {
        setBench(null);
        onToast(error instanceof Error ? `Banc d essai : ${error.message}` : 'Banc d essai impossible', 'error');
      } finally {
        setBenchBusy(false);
      }
    });
    return () => window.clearTimeout(timer);
    // Les reglages qui comptent sont resumes dans `settings`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesh, body, settings]);

  const run = () => {
    if (!mesh || !body) return;
    setIndustrialBusy(true);
    later(() => {
      try {
        setIndustrial(
          industrialise(mesh, body, params, {
            hollow,
            wall,
            target: target === 'auto' ? undefined : target,
            acceptEnvelope,
          }),
        );
      } catch (error) {
        onToast(error instanceof Error ? `Industrialisation : ${error.message}` : 'Industrialisation impossible', 'error');
      } finally {
        setIndustrialBusy(false);
      }
    });
  };

  const clear = () => {
    onMesh(null);
    setSource(null);
    setBody(null);
    setBench(null);
    setIndustrial(null);
  };

  const blocks = mesh && body ? topologyBlocks(mesh, body, acceptEnvelope) : [];
  const family = mesh && body ? guessFamily(body, mesh.bib) : null;
  const material = getMaterial(params.material);

  return (
    <div className="panel__body">
      <Fieldset
        legend="Importer un maillage"
        hint="STL binaire ou ASCII, et OBJ. Les fichiers STL n ont pas d unite : dites laquelle, ou imposez la longueur reelle."
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
          <p>{reading ? 'Lecture et reparation du maillage…' : 'Glissez un fichier ici, ou'}</p>
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
        </div>
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
          display={`x ${factor.toFixed(2)}`}
          disabled={targetLength > 0}
          hint="Agrandit ou reduit le modele d un bloc, apres conversion d unite."
          onChange={(value) => reread({ factor: value })}
        />
        <Slider
          label="Longueur reelle imposee"
          value={targetLength}
          min={0}
          max={LIMITS.length.max}
          step={1}
          display={targetLength > 0 ? mm(targetLength) : 'Echelle du fichier'}
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
          <Fieldset legend="Orientation" hint="Nez vers -X, dos vers +Y, plan de symetrie vertical : c'est le repere de fabrication.">
            <p className="control__hint">{mesh.orientation.note}</p>
            <div className="button-row">
              <button type="button" className="toolbtn" onClick={() => reread({ override: { ...override, flipNose: !override.flipNose } })}>
                Inverser nez / queue
              </button>
              <button type="button" className="toolbtn" onClick={() => reread({ override: { ...override, flipBack: !override.flipBack } })}>
                Inverser dos / ventre
              </button>
              <button
                type="button"
                className="toolbtn"
                onClick={() => reread({ override: { ...override, roll: ((override.roll ?? mesh.orientation.roll) + 1) % 4 } })}
              >
                Quart de tour autour de l axe
              </button>
            </div>
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
              Cotes {mm(mesh.bounds.length)} x {mm(mesh.bounds.height)} x {mm(mesh.bounds.width)} ·{' '}
              {mesh.components.length} piece(s) :{' '}
              {mesh.components
                .map((part) => (part.role === 'body' ? 'corps' : part.role === 'bib' ? 'bavette detachee' : 'piece rapportee'))
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
            {body.skin.maxGapMm > 0.3 ? (
              <Switch
                label="Accepter l enveloppe"
                checked={acceptEnvelope}
                hint={`Les coques combleraient ${body.skin.maxGapMm.toFixed(1)} mm de creux la ou une tranche n est pas etoilee. A n accepter qu en connaissance de cause.`}
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
