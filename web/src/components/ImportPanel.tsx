/** Panneau Import : lire un maillage existant, le mettre en place, le juger. */

import { useRef, useState } from 'react';
import type { LureParams, WaterId } from '../types/lure';
import { getMaterial, solidFraction, WATER_DENSITY } from '../lib/materials';
import { decimate, importMesh, signedVolume, type ImportedMesh } from '../lib/importMesh';
import { Fieldset, Slider } from './ui';

interface Props {
  params: LureParams;
  water: WaterId;
  mesh: ImportedMesh | null;
  onMesh: (mesh: ImportedMesh | null) => void;
  onToast: (message: string, kind?: 'ok' | 'error') => void;
}

const mm = (value: number) => `${value.toFixed(1)} mm`;

export function ImportPanel({ params, water, mesh, onMesh, onToast }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [targetLength, setTargetLength] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [source, setSource] = useState<{ name: string; data: ArrayBuffer } | null>(null);

  const load = async (file: File, lengthMm: number) => {
    try {
      const data = await file.arrayBuffer();
      const loaded = importMesh(
        file.name,
        data,
        lengthMm > 0 ? { targetLengthMm: lengthMm } : {},
      );
      setSource({ name: file.name, data });
      onMesh(loaded);
      onToast(`${file.name} importe : ${loaded.diagnosis.triangles} facettes`, 'ok');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Import impossible', 'error');
    }
  };

  /** Reechelonne sans relire le fichier : la source est gardee en memoire. */
  const rescale = (lengthMm: number) => {
    setTargetLength(lengthMm);
    if (!source) return;
    try {
      onMesh(importMesh(source.name, source.data, lengthMm > 0 ? { targetLengthMm: lengthMm } : {}));
    } catch {
      /* la lecture a deja reussi une fois : rien a signaler ici */
    }
  };

  const material = getMaterial(params.material);
  const fill = solidFraction(params.material, params.infill, params.print.perimeters);
  const printedMass = mesh ? mesh.volume * material.density * fill : 0;
  const displaced = mesh ? mesh.volume * WATER_DENSITY[water] : 0;
  const ratio = displaced > 1e-9 ? printedMass / displaced : 0;

  return (
    <div className="panel__body">
      <Fieldset
        legend="Importer un maillage"
        hint="STL binaire ou ASCII, et OBJ. Le fichier est suppose en millimetres ; donnez la longueur reelle si ce n est pas le cas."
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
            if (file) void load(file, targetLength);
          }}
        >
          <p>Glissez un fichier ici, ou</p>
          <button type="button" className="toolbtn" onClick={() => input.current?.click()}>
            Importer un STL
          </button>
          <input
            ref={input}
            type="file"
            accept=".stl,.obj,model/stl"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void load(file, targetLength);
              event.target.value = '';
            }}
          />
        </div>
        <Slider
          label="Longueur reelle imposee"
          value={targetLength}
          min={0}
          max={400}
          step={1}
          display={targetLength > 0 ? mm(targetLength) : 'Echelle du fichier'}
          hint="Zero : le fichier est pris tel quel, en millimetres."
          onChange={rescale}
        />
        {mesh ? (
          <button type="button" className="toolbtn" onClick={() => { onMesh(null); setSource(null); }}>
            Retirer le maillage importe
          </button>
        ) : null}
      </Fieldset>

      {mesh ? (
        <>
          <Fieldset legend="Rapport d import">
            <dl className="balance-table">
              <div>
                <dt>Facettes</dt>
                <dd>{mesh.diagnosis.triangles.toLocaleString('fr-FR')}</dd>
              </div>
              <div>
                <dt>Sommets distincts</dt>
                <dd>
                  {mesh.diagnosis.vertices.toLocaleString('fr-FR')}
                  {mesh.diagnosis.welded > 0
                    ? ` (${mesh.diagnosis.welded.toLocaleString('fr-FR')} confondus soudes)`
                    : ''}
                </dd>
              </div>
              <div>
                <dt>Cotes hors-tout</dt>
                <dd>
                  {mm(mesh.bounds.length)} x {mm(mesh.bounds.height)} x {mm(mesh.bounds.width)}
                </dd>
              </div>
              <div>
                <dt>Volume</dt>
                <dd>{mesh.volume.toFixed(2)} cm3</dd>
              </div>
              <div>
                <dt>Etanche</dt>
                <dd>{mesh.diagnosis.watertight ? 'oui' : 'non'}</dd>
              </div>
              <div>
                <dt>Aretes ouvertes</dt>
                <dd>{mesh.diagnosis.openEdges}</dd>
              </div>
              <div>
                <dt>Aretes non-manifold</dt>
                <dd>{mesh.diagnosis.nonManifold}</dd>
              </div>
              <div>
                <dt>Faces retournees</dt>
                <dd>{mesh.diagnosis.flipped}</dd>
              </div>
              <div>
                <dt>Triangles d aire nulle</dt>
                <dd>{mesh.diagnosis.degenerate}</dd>
              </div>
            </dl>
            <p className="hint">{mesh.orientation.note}</p>
          </Fieldset>

          <Fieldset
            legend="Flottabilite du maillage reel"
            hint="Calculee sur le volume mesure du maillage importe, pas sur une silhouette approchee."
          >
            <dl className="balance-table">
              <div>
                <dt>Masse imprimee</dt>
                <dd>
                  {printedMass.toFixed(1)} g ({material.label}, remplissage {params.infill} %)
                </dd>
              </div>
              <div>
                <dt>Poussee</dt>
                <dd>{displaced.toFixed(1)} g</dd>
              </div>
              <div>
                <dt>Verdict</dt>
                <dd>
                  {ratio < 0.97 ? 'Flottant' : ratio > 1.03 ? 'Coulant' : 'Suspending'} — rapport{' '}
                  {ratio.toFixed(2)}
                </dd>
              </div>
            </dl>
            {mesh.diagnosis.watertight ? null : (
              <p className="hint">
                Le maillage n est pas ferme : ce volume est une estimation, pas une mesure.
              </p>
            )}
          </Fieldset>

          <Fieldset
            legend="Reduction de maillage"
            hint="Pour l edition en direct. L original reste en memoire pour l export."
          >
            <button
              type="button"
              className="toolbtn"
              disabled={mesh.diagnosis.triangles <= 20000}
              onClick={() => {
                const reduced = decimate(mesh.positions, 20000);
                onMesh({
                  ...mesh,
                  positions: reduced,
                  volume: Math.abs(signedVolume(reduced)),
                  diagnosis: { ...mesh.diagnosis, triangles: reduced.length / 9 },
                });
                onToast(`Maillage ramene a ${reduced.length / 9} facettes`, 'ok');
              }}
            >
              Ramener a 20 000 facettes
            </button>
          </Fieldset>

          <Fieldset legend="Ce que ce maillage ne permet pas">
            {mesh.limits.length === 0 ? (
              <p className="hint">
                Rien ne bloque du cote de la topologie : le maillage est ferme, oriente et sans
                arete partagee de travers.
              </p>
            ) : (
              <ul className="import-limits">
                {mesh.limits.map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
            )}
            <p className="hint">
              Le maillage importe est mesure et juge pour de bon — volume, masse, poussee,
              verdict. Il ne PILOTE pas encore les composants parametriques : attaches, fente de
              bavette, ecailles, nervures, lest, creusage en coque, demi-coques vissees et
              segments articules restent generes depuis la silhouette parametrique du corps, pas
              depuis ce maillage. Utilisez-le comme reference de forme et pour son verdict.
            </p>
          </Fieldset>
        </>
      ) : null}
    </div>
  );
}
