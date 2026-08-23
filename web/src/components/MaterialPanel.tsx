/** Panneau droit — matiere d'impression, lestage interne et livree. */

import { useState } from 'react';
import type {
  BallastWeight,
  LureParams,
  PaintConfig,
  PatternId,
  RattleChamber,
  RattlePocket,
  SavedPalette,
} from '../types/lure';
import { FINISHES, MATERIALS, getMaterial } from '../lib/materials';
import { paintPreviewCss } from '../lib/paint';
import { LIMITS } from '../lib/presets';
import { ColorField, Fieldset, Segmented, Slider, Switch } from './ui';

interface Props {
  params: LureParams;
  onChange: (patch: Partial<LureParams>) => void;
  /** Masse reelle de l'agrafe choisie, calculee depuis sa geometrie. */
  palettes: SavedPalette[];
  onSavePalette: (name: string) => void;
  onApplyPalette: (id: string) => void;
  onDeletePalette: (id: string) => void;
}

const MAX_BALLASTS = 8;
const MAX_RATTLES = 6;

/** Diametre du lest equivalent, en mm, pour la densite choisie. */
const ballastDiameter = (mass: number, density: number, shape: 'sphere' | 'cylinder'): number => {
  const volume = Math.max(mass, 0.01) / Math.max(density, 0.5);
  const radius =
    shape === 'cylinder'
      ? Math.cbrt(volume / (2.5 * Math.PI))
      : Math.cbrt((3 * volume) / (4 * Math.PI));
  return radius * 20;
};

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

export function MaterialPanel({
  params,
  onChange,
  palettes,
  onSavePalette,
  onApplyPalette,
  onDeletePalette,
}: Props) {
  const material = getMaterial(params.material);
  const [paletteName, setPaletteName] = useState('');

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
          shape: 'sphere',
        },
      ],
    });
  };

  const removeBallast = (id: string) =>
    onChange({ ballasts: params.ballasts.filter((item) => item.id !== id) });

  const setRattle = (id: string, patch: Partial<RattlePocket>) =>
    onChange({
      rattles: params.rattles.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });

  const addRattle = () => {
    if (params.rattles.length >= MAX_RATTLES) return;
    onChange({
      rattles: [
        ...params.rattles,
        {
          id: `bille-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          position: 0.55,
          height: -0.2,
          ball: 6,
        },
      ],
    });
  };

  const setChamber = (patch: Partial<RattleChamber>) =>
    onChange({ chamber: { ...params.chamber, ...patch } });

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
          label="Densite des lests"
          value={params.ballastDensity}
          {...LIMITS.ballastDensity}
          display={`${params.ballastDensity.toFixed(2)} g/cm3`}
          hint="Inox : 7,75 a 8,0. Plomb : 11,34. A masse egale, un lest inox occupe pres de moitie plus de volume."
          onChange={(ballastDensity) => onChange({ ballastDensity })}
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
                {ballast.mass.toFixed(1)} g · diam.{' '}
                {ballastDiameter(ballast.mass, params.ballastDensity, ballast.shape).toFixed(1)} mm
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
            <Segmented
              label="Forme"
              value={ballast.shape}
              options={[
                { value: 'sphere' as const, label: 'Bille' },
                { value: 'cylinder' as const, label: 'Cylindre' },
              ]}
              onChange={(shape) => setBallast(ballast.id, { shape })}
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

      <Fieldset
        legend="Billes mobiles"
        hint="Une bille inox libre dans une portee plus large qu elle : c est le jeu qui fait le bruit. Le logement est une demi-sphere creusee dans chaque coque, il exige donc le corps en deux parties."
      >
        {!params.assembly.enabled ? (
          <p className="control__hint">
            Activez « Corps en deux parties » dans l onglet Assemblage : une bille ne peut pas
            etre enfermee dans un corps imprime d un seul tenant.
          </p>
        ) : null}

        {params.rattles.length === 0 ? (
          <p className="empty">Aucune bille mobile.</p>
        ) : null}

        {params.rattles.map((rattle, index) => (
          <div className="ballast" key={rattle.id}>
            <div className="ballast__head">
              <span className="ballast__name">Bille {index + 1}</span>
              <span className="ballast__spec">
                {rattle.ball.toFixed(1)} mm dans {(rattle.ball + params.fabrication.rattleFit).toFixed(1)} mm
              </span>
              <button
                type="button"
                className="btn btn--sm btn--ghost btn--danger"
                onClick={() =>
                  onChange({ rattles: params.rattles.filter((item) => item.id !== rattle.id) })
                }
              >
                Retirer<span className="sr-only"> la bille {index + 1}</span>
              </button>
            </div>
            <Slider
              label="Position"
              value={rattle.position}
              {...LIMITS.ballastPosition}
              display={`${Math.round(rattle.position * 100)} %`}
              onChange={(position) => setRattle(rattle.id, { position })}
            />
            <Slider
              label="Hauteur"
              value={rattle.height}
              {...LIMITS.ballastHeight}
              display={rattle.height < -0.35 ? 'Ventre' : rattle.height > 0.35 ? 'Dos' : 'Axe'}
              onChange={(height) => setRattle(rattle.id, { height })}
            />
            <Slider
              label="Diametre de bille"
              value={rattle.ball}
              {...LIMITS.rattleBall}
              display={`${rattle.ball.toFixed(1)} mm`}
              hint="La portee vaut ce diametre plus le jeu de fabrication."
              onChange={(ball) => setRattle(rattle.id, { ball })}
            />
          </div>
        ))}

        <button
          type="button"
          className="btn btn--block"
          onClick={addRattle}
          disabled={params.rattles.length >= MAX_RATTLES}
        >
          + Ajouter une bille
        </button>
      </Fieldset>

      <Fieldset
        legend="Chambre de bruit"
        hint="Un tube creuse dans le plan de joint, dans lequel les billes roulent d un bout a l autre pendant la nage."
      >
        <Switch
          label="Chambre a billes"
          checked={params.chamber.enabled}
          onChange={(enabled) => setChamber({ enabled })}
        />
        <Slider
          label="Diametre du tube"
          value={params.chamber.diameter}
          {...LIMITS.chamberDiameter}
          display={`${params.chamber.diameter.toFixed(1)} mm`}
          disabled={!params.chamber.enabled}
          onChange={(diameter) => setChamber({ diameter })}
        />
        <Slider
          label="Depart : position"
          value={params.chamber.fromPosition}
          {...LIMITS.ballastPosition}
          display={`${Math.round(params.chamber.fromPosition * 100)} %`}
          disabled={!params.chamber.enabled}
          onChange={(fromPosition) => setChamber({ fromPosition })}
        />
        <Slider
          label="Depart : hauteur"
          value={params.chamber.fromHeight}
          {...LIMITS.ballastHeight}
          display={params.chamber.fromHeight.toFixed(2)}
          disabled={!params.chamber.enabled}
          onChange={(fromHeight) => setChamber({ fromHeight })}
        />
        <Slider
          label="Arrivee : position"
          value={params.chamber.toPosition}
          {...LIMITS.ballastPosition}
          display={`${Math.round(params.chamber.toPosition * 100)} %`}
          disabled={!params.chamber.enabled}
          onChange={(toPosition) => setChamber({ toPosition })}
        />
        <Slider
          label="Arrivee : hauteur"
          value={params.chamber.toHeight}
          {...LIMITS.ballastHeight}
          display={params.chamber.toHeight.toFixed(2)}
          disabled={!params.chamber.enabled}
          hint="Deux hauteurs differentes donnent un tube incline : les billes reviennent d elles-memes vers l avant."
          onChange={(toHeight) => setChamber({ toHeight })}
        />
        <Slider
          label="Diametre des billes"
          value={params.chamber.ball}
          {...LIMITS.rattleBall}
          display={`${params.chamber.ball.toFixed(1)} mm`}
          disabled={!params.chamber.enabled}
          onChange={(ball) => setChamber({ ball })}
        />
        <Slider
          label="Nombre de billes"
          value={params.chamber.balls}
          {...LIMITS.chamberBalls}
          display={`${params.chamber.balls}`}
          disabled={!params.chamber.enabled}
          onChange={(balls) => setChamber({ balls })}
        />
      </Fieldset>

      <Fieldset legend="Livree" hint="Cinq zones colorables, motif de surface et finition.">
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

        <div className="swatch-row" style={{ marginTop: 8 }}>
          <ColorField
            label="Tete"
            value={params.paint.head}
            onChange={(head) => setPaint({ head })}
          />
          <ColorField
            label="Queue"
            value={params.paint.tail}
            onChange={(tail) => setPaint({ tail })}
          />
          <ColorField
            label="Iris"
            value={params.paint.eyeColor}
            onChange={(eyeColor) => setPaint({ eyeColor })}
          />
        </div>

        <Slider
          label="Etendue de la tete"
          value={params.paint.headLength}
          {...LIMITS.zoneLength}
          display={
            params.paint.headLength < 0.01
              ? 'Aucune'
              : `${Math.round(params.paint.headLength * 100)} %`
          }
          hint="Zone peinte depuis le nez. A zero, la tete suit les couleurs du corps."
          onChange={(headLength) => setPaint({ headLength })}
        />
        <Slider
          label="Etendue de la queue"
          value={params.paint.tailLength}
          {...LIMITS.zoneLength}
          display={
            params.paint.tailLength < 0.01
              ? 'Aucune'
              : `${Math.round(params.paint.tailLength * 100)} %`
          }
          onChange={(tailLength) => setPaint({ tailLength })}
        />
        <Slider
          label="Fondu des zones"
          value={params.paint.blend}
          {...LIMITS.paintBlend}
          display={
            params.paint.blend < 0.15
              ? 'Franc'
              : params.paint.blend > 0.7
                ? 'Tres fondu'
                : 'Degrade'
          }
          hint="Largeur des transitions entre dos, flancs, ventre, tete et queue."
          onChange={(blend) => setPaint({ blend })}
        />

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
              { value: 'scales', label: 'Ecailles' },
              { value: 'camo', label: 'Camouflage' },
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

      <Fieldset
        legend="Bibliotheque de livrees"
        hint="Enregistrez une livree pour la reappliquer plus tard. Elle part avec le projet dans le fichier JSON."
      >
        <form
          className="export-dock__name"
          onSubmit={(event) => {
            event.preventDefault();
            onSavePalette(paletteName);
            setPaletteName('');
          }}
        >
          <label className="sr-only" htmlFor="palette-name">
            Nom de la livree
          </label>
          <input
            id="palette-name"
            type="text"
            placeholder="Nom de la livree"
            value={paletteName}
            maxLength={40}
            onChange={(event) => setPaletteName(event.target.value)}
          />
          <button type="submit" className="btn">
            Enregistrer
          </button>
        </form>

        {palettes.length === 0 ? (
          <p className="empty">Aucune livree enregistree pour l instant.</p>
        ) : (
          <div className="palette-row">
            {palettes.map((palette) => (
              <span key={palette.id} className="palette-chip">
                <i aria-hidden="true" style={{ background: paintPreviewCss(palette.paint) }} />
                <button
                  type="button"
                  className="palette-chip__apply"
                  onClick={() => onApplyPalette(palette.id)}
                >
                  {palette.name}
                </button>
                <button
                  type="button"
                  className="palette-chip__remove"
                  aria-label={`Supprimer la livree ${palette.name}`}
                  onClick={() => onDeletePalette(palette.id)}
                >
                  x
                </button>
              </span>
            ))}
          </div>
        )}
      </Fieldset>
    </div>
  );
}
