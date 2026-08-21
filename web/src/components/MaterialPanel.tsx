/** Panneau droit — matiere d'impression, lestage interne et livree. */

import type { BallastWeight, LureParams, PaintConfig, PatternId } from '../types/lure';
import { LEAD_DENSITY } from '../lib/geometry';
import { FINISHES, MATERIALS, getMaterial } from '../lib/materials';
import { paintPreviewCss } from '../lib/paint';
import { LIMITS } from '../lib/presets';
import { ColorField, Fieldset, Segmented, Slider } from './ui';

interface Props {
  params: LureParams;
  onChange: (patch: Partial<LureParams>) => void;
}

const MAX_BALLASTS = 8;

/** Diametre de la bille de plomb equivalente, en mm. */
const leadDiameter = (mass: number): number =>
  2 * Math.cbrt((3 * (Math.max(mass, 0.01) / LEAD_DENSITY)) / (4 * Math.PI)) * 10;

const PALETTES: { name: string; paint: Partial<PaintConfig> }[] = [
  {
    name: 'Sakuma',
    paint: { dorsal: '#e30613', flank: '#ffffff', belly: '#ffffff', pattern: 'none' },
  },
  {
    name: 'Firetiger',
    paint: {
      dorsal: '#2e6b1f',
      flank: '#f2c200',
      belly: '#f26a00',
      pattern: 'stripes',
      patternColor: '#12200e',
    },
  },
  {
    name: 'Gardon',
    paint: {
      dorsal: '#2b4c6f',
      flank: '#d8dee4',
      belly: '#ffffff',
      pattern: 'dots',
      patternColor: '#9aa7b2',
    },
  },
  {
    name: 'Perche',
    paint: {
      dorsal: '#3b5b22',
      flank: '#c9a227',
      belly: '#f2ead3',
      pattern: 'stripes',
      patternColor: '#22331a',
    },
  },
  {
    name: 'Chrome',
    paint: {
      dorsal: '#c8ced4',
      flank: '#edf1f4',
      belly: '#ffffff',
      pattern: 'none',
      finish: 'chrome',
    },
  },
  {
    name: 'Nuit',
    paint: {
      dorsal: '#14161a',
      flank: '#23262b',
      belly: '#3a3f46',
      pattern: 'none',
      finish: 'matte',
    },
  },
];

export function MaterialPanel({ params, onChange }: Props) {
  const material = getMaterial(params.material);

  const setPaint = (patch: Partial<PaintConfig>) =>
    onChange({ paint: { ...params.paint, ...patch } });

  const setBallast = (id: string, patch: Partial<BallastWeight>) =>
    onChange({
      ballasts: params.ballasts.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });

  const addBallast = () => {
    if (params.ballasts.length >= MAX_BALLASTS) return;
    onChange({
      ballasts: [
        ...params.ballasts,
        {
          id: `lest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          position: 0.5,
          height: -0.7,
          mass: 1.5,
        },
      ],
    });
  };

  const removeBallast = (id: string) =>
    onChange({ ballasts: params.ballasts.filter((item) => item.id !== id) });

  return (
    <div className="panel__body">
      <Fieldset legend="Matiere d impression" hint={material.summary}>
        <Segmented
          label="Materiau"
          value={params.material}
          wrap
          options={MATERIALS.map((item) => ({
            value: item.id,
            label: item.label,
            title: `${item.density} g/cm3`,
          }))}
          onChange={(id) =>
            onChange({ material: id, infill: getMaterial(id).defaultInfill })
          }
        />
        <Slider
          label="Remplissage"
          value={params.infill}
          {...LIMITS.infill}
          display={`${params.infill} %`}
          disabled={!material.hollowable}
          hint={
            material.hollowable
              ? `Densite matiere ${material.density} g/cm3. Moins de remplissage = plus de flottabilite.`
              : 'La resine est imprimee pleine dans ce calcul.'
          }
          onChange={(infill) => onChange({ infill })}
        />
        <Slider
          label="Quincaillerie"
          value={params.hardwareMass}
          {...LIMITS.hardwareMass}
          display={`${params.hardwareMass.toFixed(1)} g`}
          hint="Hameçons, anneaux brises et oeillets. Repartis nez / ventre / queue, sous la ligne de quille."
          onChange={(hardwareMass) => onChange({ hardwareMass })}
        />
      </Fieldset>

      <Fieldset
        legend="Lests internes"
        hint="Billes de plomb logees dans le corps. Leur taille affichee est le diametre reel a prevoir."
      >
        {params.ballasts.length === 0 ? (
          <p className="empty">Aucun lest : le leurre ne tient que par son propre volume.</p>
        ) : null}

        {params.ballasts.map((ballast, index) => (
          <div className="ballast" key={ballast.id}>
            <div className="ballast__head">
              <span className="ballast__name">Lest {index + 1}</span>
              <span className="ballast__spec">
                {ballast.mass.toFixed(1)} g · diam. {leadDiameter(ballast.mass).toFixed(1)} mm
              </span>
              <button
                type="button"
                className="btn btn--sm btn--ghost btn--danger"
                onClick={() => removeBallast(ballast.id)}
              >
                Retirer<span className="sr-only"> le lest {index + 1}</span>
              </button>
            </div>

            <Segmented
              label="Emplacement"
              value={
                ballast.position < 0.4 ? 'front' : ballast.position > 0.62 ? 'rear' : 'center'
              }
              options={[
                { value: 'front', label: 'Avant' },
                { value: 'center', label: 'Centre' },
                { value: 'rear', label: 'Arriere' },
              ]}
              onChange={(zone) =>
                setBallast(ballast.id, {
                  position: zone === 'front' ? 0.28 : zone === 'rear' ? 0.75 : 0.5,
                })
              }
            />
            <Slider
              label="Position precise"
              value={ballast.position}
              {...LIMITS.ballastPosition}
              display={`${Math.round(ballast.position * 100)} %`}
              onChange={(position) => setBallast(ballast.id, { position })}
            />
            <Slider
              label="Hauteur dans le corps"
              value={ballast.height}
              {...LIMITS.ballastHeight}
              display={
                ballast.height < -0.35 ? 'Ventre' : ballast.height > 0.35 ? 'Dos' : 'Axe'
              }
              hint="Plus le lest est bas, plus le leurre resiste au roulis."
              onChange={(height) => setBallast(ballast.id, { height })}
            />
            <Slider
              label="Masse"
              value={ballast.mass}
              {...LIMITS.ballastMass}
              display={`${ballast.mass.toFixed(1)} g`}
              onChange={(mass) => setBallast(ballast.id, { mass })}
            />
          </div>
        ))}

        <button
          type="button"
          className="btn btn--block"
          onClick={addBallast}
          disabled={params.ballasts.length >= MAX_BALLASTS}
        >
          + Ajouter un lest
        </button>
      </Fieldset>

      <Fieldset legend="Livree" hint="Zones colorables du corps et motif de surface.">
        <div className="swatch-row">
          <ColorField
            label="Dos"
            value={params.paint.dorsal}
            onChange={(dorsal) => setPaint({ dorsal })}
          />
          <ColorField
            label="Flancs"
            value={params.paint.flank}
            onChange={(flank) => setPaint({ flank })}
          />
          <ColorField
            label="Ventre"
            value={params.paint.belly}
            onChange={(belly) => setPaint({ belly })}
          />
        </div>

        <div className="palette-row">
          {PALETTES.map((palette) => (
            <button
              key={palette.name}
              type="button"
              className="palette-chip"
              onClick={() => setPaint(palette.paint)}
            >
              <i
                aria-hidden="true"
                style={{
                  background: paintPreviewCss({ ...params.paint, ...palette.paint }),
                }}
              />
              {palette.name}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 14 }}>
          <Segmented
            label="Motif"
            value={params.paint.pattern}
            wrap
            options={[
              { value: 'none', label: 'Aucun' },
              { value: 'stripes', label: 'Rayures' },
              { value: 'dots', label: 'Points' },
              { value: 'gradient', label: 'Degrade' },
            ] as { value: PatternId; label: string }[]}
            onChange={(pattern) => setPaint({ pattern })}
          />
          <div className="swatch-row">
            <ColorField
              label="Motif"
              value={params.paint.patternColor}
              onChange={(patternColor) => setPaint({ patternColor })}
            />
          </div>
          <Slider
            label={params.paint.pattern === 'gradient' ? 'Etendue du degrade' : 'Densite du motif'}
            value={params.paint.patternScale}
            {...LIMITS.patternScale}
            display={`${params.paint.patternScale}`}
            disabled={params.paint.pattern === 'none'}
            onChange={(patternScale) => setPaint({ patternScale })}
          />
        </div>

        <Segmented
          label="Finition"
          value={params.paint.finish}
          wrap
          options={(Object.keys(FINISHES) as (keyof typeof FINISHES)[]).map((key) => ({
            value: key,
            label: FINISHES[key].label,
          }))}
          onChange={(finish) => setPaint({ finish })}
        />
      </Fieldset>
    </div>
  );
}
