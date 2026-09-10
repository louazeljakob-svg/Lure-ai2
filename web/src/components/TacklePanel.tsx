/**
 * Quincaillerie pesee — modules Q.4 et Q.5.
 *
 * Trois choses dans un seul panneau, parce qu'elles ne se comprennent que
 * ensemble : ce qui est monte sur le leurre, ce que ca pese au total, et la
 * table de reference d'ou viennent les masses.
 */

import { useMemo, useRef, useState } from 'react';
import type { LureParams, TackleFamily, TackleItem, TackleMount } from '../types/lure';
import type { PhysicsResult } from '../lib/physics';
import {
  TACKLE_FAMILY_LABEL,
  isHook,
  kgToLb,
  mergeCatalogue,
  parseTackleCsv,
  resolveMount,
  seedCatalogue,
  tackleToCsv,
  type CsvPreview,
} from '../lib/tackle';
import { Fieldset, Slider, Switch } from './ui';

interface Props {
  params: LureParams;
  physics: PhysicsResult;
  onChange: (patch: Partial<LureParams>) => void;
}

const n = (value: number, digits = 2): string =>
  value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const PROVENANCE = {
  geometrie: { label: 'calcule', title: 'Deduit de la geometrie reelle.' },
  verifie: { label: 'verifie', title: 'Ligne de catalogue verifiee ou pesee.' },
  estimation: { label: 'estime', title: 'Ordre de grandeur, a corriger.' },
} as const;

const FAMILIES: TackleFamily[] = ['treble', 'inline', 'assist', 'split', 'solid', 'swivel'];

export function TacklePanel({ params, physics, onChange }: Props) {
  const [family, setFamily] = useState<TackleFamily>('treble');
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const resolved = useMemo(
    () => params.mounts.map((mount) => resolveMount(params.catalogue, mount)),
    [params.mounts, params.catalogue],
  );

  const rows = useMemo(
    () => params.catalogue.filter((item) => item.family === family),
    [params.catalogue, family],
  );

  const hooks = useMemo(
    () => params.catalogue.filter((item) => isHook(item.family)),
    [params.catalogue],
  );
  const rings = useMemo(
    () => params.catalogue.filter((item) => !isHook(item.family)),
    [params.catalogue],
  );

  const setMount = (id: string, patch: Partial<TackleMount>) =>
    onChange({
      mounts: params.mounts.map((mount) => (mount.id === id ? { ...mount, ...patch } : mount)),
    });

  /**
   * Toute correction d'une valeur bascule la ligne en « catalogue verifie ».
   * C'est le point du module : une valeur qu'on a prise la peine de corriger
   * n'est plus un ordre de grandeur.
   */
  const editItem = (id: string, patch: Partial<TackleItem>) =>
    onChange({
      catalogue: params.catalogue.map((item) =>
        item.id === id ? { ...item, ...patch, source: 'verifie' } : item,
      ),
    });

  const download = (name: string, text: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  };

  const addMount = () =>
    onChange({
      mounts: [
        ...params.mounts,
        {
          id: `mount-${Date.now()}`,
          label: `Support ${params.mounts.length + 1}`,
          anchorId: null,
          position: 0.6,
          height: -1,
          ringId: null,
          hookId: null,
          visible: true,
        },
      ],
    });

  return (
    <div className="panel__body">
      <Fieldset
        legend="Montages"
        hint="Un support porte un anneau brise, qui porte un hamecon. Les deux masses se placent a leur bras de levier reel."
      >
        {resolved.map((entry) => {
          const mount = entry.mount;
          return (
            <div className="mount" key={mount.id}>
              <div className="mount__head">
                <input
                  className="mount__name"
                  value={mount.label}
                  aria-label="Nom du support"
                  onChange={(event) => setMount(mount.id, { label: event.target.value })}
                />
                <span className="mount__mass">
                  {entry.massG > 0 ? `${n(entry.massG, 2)} g` : '—'}
                </span>
                <button
                  type="button"
                  className="mount__remove"
                  aria-label={`Supprimer ${mount.label}`}
                  onClick={() =>
                    onChange({ mounts: params.mounts.filter((m) => m.id !== mount.id) })
                  }
                >
                  x
                </button>
              </div>

              <div className="mount__row">
                <label>
                  Anneau
                  <select
                    value={mount.ringId ?? ''}
                    onChange={(event) =>
                      setMount(mount.id, { ringId: event.target.value || null })
                    }
                  >
                    <option value="">aucun</option>
                    {rings.map((item) => (
                      <option key={item.id} value={item.id}>
                        {TACKLE_FAMILY_LABEL[item.family]} {item.size} — {n(item.massG, 2)} g
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Hamecon
                  <select
                    value={mount.hookId ?? ''}
                    onChange={(event) =>
                      setMount(mount.id, { hookId: event.target.value || null })
                    }
                  >
                    <option value="">aucun</option>
                    {hooks.map((item) => (
                      <option key={item.id} value={item.id}>
                        {TACKLE_FAMILY_LABEL[item.family]} {item.size} — {n(item.massG, 2)} g
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <Slider
                label="Position sur l axe"
                value={mount.position}
                min={0.02}
                max={0.98}
                step={0.01}
                display={`${Math.round(mount.position * 100)} %`}
                onChange={(position) => setMount(mount.id, { position })}
              />
              <Slider
                label="Hauteur"
                value={mount.height}
                min={-1}
                max={1}
                step={0.05}
                display={
                  mount.height < -0.2 ? 'ventre' : mount.height > 0.2 ? 'dos' : 'axe'
                }
                onChange={(height) => setMount(mount.id, { height })}
              />
              <Switch
                label="Afficher en 3D"
                checked={mount.visible}
                onChange={(visible) => setMount(mount.id, { visible })}
              />
              {entry.reachMm > 0 ? (
                <p className="control__hint">
                  Longueur pendante {n(entry.reachMm, 0)} mm
                  {entry.hook
                    ? ` — resistance annoncee ${n(entry.hook.strengthKg, 0)} kg (${n(kgToLb(entry.hook.strengthKg), 0)} lb)`
                    : ''}
                </p>
              ) : null}
            </div>
          );
        })}
        <button type="button" className="btn btn--sm" onClick={addMount}>
          + Ajouter un support
        </button>
      </Fieldset>

      <Fieldset
        legend="Bilan de masse"
        hint="Chaque poste indique d ou vient sa valeur : geometrie calculee, catalogue verifie ou estimation."
      >
        <div className="viz__table-scroll">
          <table className="balance-table">
            <thead>
              <tr>
                <th scope="col">Poste</th>
                <th scope="col">Masse</th>
                <th scope="col">Part</th>
                <th scope="col">Provenance</th>
              </tr>
            </thead>
            <tbody>
              {physics.massBreakdown.map((line) => (
                <tr key={line.key}>
                  <th scope="row" title={line.detail}>
                    {line.label}
                  </th>
                  <td>{n(line.massG, 2)} g</td>
                  <td>{n(line.share, 1)} %</td>
                  <td>
                    <span
                      className={`prov prov--${line.provenance}`}
                      title={PROVENANCE[line.provenance].title}
                    >
                      {PROVENANCE[line.provenance].label}
                    </span>
                  </td>
                </tr>
              ))}
              <tr className="balance-table__total">
                <th scope="row">Total</th>
                <td>{n(physics.totalMass, 2)} g</td>
                <td>100 %</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        <div className="stat-grid" style={{ marginTop: 10 }}>
          <div className="stat">
            <span className="stat__label">Eau deplacee</span>
            <div className="stat__value">
              {n(physics.displacedMass, 1)}
              <span className="stat__unit">g</span>
            </div>
            <span className="stat__sub">
              ecart {physics.totalMass >= physics.displacedMass ? '+' : ''}
              {n(physics.totalMass - physics.displacedMass, 2)} g
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Centre de masse</span>
            <div className="stat__value" style={{ fontSize: 18 }}>
              {n(physics.cgPct, 1)}
              <span className="stat__unit">% L</span>
            </div>
            <span className="stat__sub">
              X {n(physics.cg.x * 10, 1)} · Y {n(physics.cg.y * 10, 1)} · Z{' '}
              {n(physics.cg.z * 10, 1)} mm
            </span>
          </div>
        </div>
      </Fieldset>

      <Fieldset
        legend="Catalogue"
        hint="Table de reference du projet. Elle voyage avec le fichier : un leurre partage emporte ses masses."
      >
        <div className="segmented" role="group" aria-label="Famille">
          {FAMILIES.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={family === id}
              onClick={() => setFamily(id)}
              title={TACKLE_FAMILY_LABEL[id]}
            >
              {TACKLE_FAMILY_LABEL[id]}
            </button>
          ))}
        </div>

        <div className="viz__table-scroll" style={{ marginTop: 8 }}>
          <table className="tackle-table">
            <thead>
              <tr>
                <th scope="col">Serie</th>
                <th scope="col">Taille</th>
                <th scope="col">Fil</th>
                <th scope="col">Masse</th>
                <th scope="col">kg</th>
                <th scope="col">lb</th>
                <th scope="col">mm</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id}>
                  <th scope="row" title={item.note}>
                    <input
                      value={item.series}
                      aria-label={`Serie de ${item.size}`}
                      onChange={(event) => editItem(item.id, { series: event.target.value })}
                    />
                  </th>
                  <td>{item.size}</td>
                  <td>
                    <input
                      type="number"
                      step={0.01}
                      value={item.wireMm}
                      aria-label={`Calibre de fil de ${item.size}`}
                      onChange={(event) =>
                        editItem(item.id, { wireMm: Number(event.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step={0.01}
                      value={item.massG}
                      aria-label={`Masse de ${item.size}`}
                      onChange={(event) =>
                        editItem(item.id, { massG: Number(event.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step={0.5}
                      value={item.strengthKg}
                      aria-label={`Resistance de ${item.size}`}
                      onChange={(event) =>
                        editItem(item.id, { strengthKg: Number(event.target.value) })
                      }
                    />
                  </td>
                  <td>{n(kgToLb(item.strengthKg), 0)}</td>
                  <td>
                    <input
                      type="number"
                      step={0.5}
                      value={item.spanMm}
                      aria-label={`Encombrement de ${item.size}`}
                      onChange={(event) =>
                        editItem(item.id, { spanMm: Number(event.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <span className={`prov prov--${item.source === 'verifie' ? 'verifie' : 'estimation'}`}>
                      {item.source === 'verifie' ? 'verifie' : 'indicatif'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="control__hint">
          Les valeurs de depart sont des <strong>ordres de grandeur</strong> : elles varient
          fortement selon la serie, le calibre de fil (standard, 2X, 3X, 4X) et le revetement.
          Corriger une case suffit a faire passer la ligne en « verifie ».
        </p>

        <div className="row-actions">
          <button type="button" className="btn btn--sm" onClick={() => fileRef.current?.click()}>
            Importer un CSV
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() =>
              download('sakuma-quincaillerie.csv', tackleToCsv(params.catalogue), 'text/csv')
            }
          >
            Exporter en CSV
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => onChange({ catalogue: seedCatalogue() })}
          >
            Revenir a la table de depart
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setPreview(parseTackleCsv(await file.text()));
            event.target.value = '';
          }}
        />

        {preview ? (
          <div className="import">
            <h4>Apercu de l import</h4>
            <p className="control__hint">
              {preview.items.length} ligne(s) reconnue(s).{' '}
              {preview.matched.length ? `Colonnes : ${preview.matched.join(', ')}.` : ''}
              {preview.ignored.length ? ` Ignorees : ${preview.ignored.join(', ')}.` : ''}
            </p>
            {preview.rejected.length ? (
              <ul className="import__errors">
                {preview.rejected.slice(0, 6).map((row) => (
                  <li key={row.line}>
                    Ligne {row.line} : {row.reason}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="row-actions">
              <button
                type="button"
                className="btn btn--sm btn--primary"
                disabled={preview.items.length === 0}
                onClick={() => {
                  onChange({ catalogue: mergeCatalogue(params.catalogue, preview.items) });
                  setPreview(null);
                }}
              >
                Appliquer {preview.items.length} ligne(s)
              </button>
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => setPreview(null)}
              >
                Annuler
              </button>
            </div>
          </div>
        ) : null}

        <details className="viz__table">
          <summary>Format attendu du CSV</summary>
          <p className="control__hint">
            Separateur virgule, point-virgule ou tabulation, detecte automatiquement. Les colonnes
            sont reconnues par leur NOM, pas par leur position :{' '}
            <code>famille</code>, <code>serie</code>, <code>taille</code>, <code>fil</code>,{' '}
            <code>masse</code>, <code>resistance</code>, <code>longueur</code>,{' '}
            <code>note</code>. Seules la famille, la taille et la masse sont obligatoires. Les
            lignes importees passent en « catalogue verifie ».
          </p>
        </details>
      </Fieldset>
    </div>
  );
}
